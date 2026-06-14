/**
 * 原曲搜索（iTunes 预览）与外链音频拉取，供翻唱参考。
 */

const MAX_BYTES = 12 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 45_000;

function isAllowedFetchUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
  if (/^(10|172\.(1[6-9]|2\d|3[01])|192\.168)\./.test(host)) return false;
  return true;
}

async function fetchWithLimit(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'tools120-media-recorder/1.0' },
      redirect: 'follow',
    });
    if (!res.ok) {
      throw new Error(`下载失败 HTTP ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      throw new Error(`音频过大（>${Math.round(MAX_BYTES / (1024 * 1024))}MB）`);
    }
    if (buf.length < 32 * 1024) {
      throw new Error('音频过短，请提供至少约 6 秒的有效音频');
    }
    const ct = (res.headers.get('content-type') || 'audio/mpeg').split(';')[0].trim();
    return { buffer: buf, contentType: ct };
  } finally {
    clearTimeout(timer);
  }
}

async function searchItunesPreview(artist, title) {
  const term = [artist, title].filter(Boolean).join(' ').trim();
  if (!term) {
    throw new Error('请填写歌手名或歌曲名');
  }
  const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&limit=8&country=CN`;
  const res = await fetch(searchUrl, {
    headers: { 'User-Agent': 'tools120-media-recorder/1.0' },
  });
  if (!res.ok) {
    throw new Error(`原曲搜索失败 HTTP ${res.status}`);
  }
  const data = await res.json();
  const results = Array.isArray(data.results) ? data.results : [];
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedArtist = artist.trim().toLowerCase();

  const scored = results
    .filter((t) => typeof t.previewUrl === 'string' && t.previewUrl)
    .map((t) => {
      const trackName = String(t.trackName || '').toLowerCase();
      const artistName = String(t.artistName || '').toLowerCase();
      let score = 0;
      if (normalizedTitle && trackName.includes(normalizedTitle)) score += 3;
      if (normalizedArtist && artistName.includes(normalizedArtist)) score += 3;
      if (normalizedTitle && trackName === normalizedTitle) score += 2;
      return { t, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0]?.t;
  if (!best?.previewUrl) {
    throw new Error(`未找到「${term}」的可下载预览，请粘贴原曲直链或自行上传原曲`);
  }

  return {
    title: best.trackName,
    artist: best.artistName,
    previewUrl: best.previewUrl,
    durationMs: best.trackTimeMillis,
    source: 'itunes',
  };
}

/** @param {import('express').Router} router */
export function attachMusicSource(router) {
  router.get('/music/search', async (req, res) => {
    try {
      const artist = typeof req.query.artist === 'string' ? req.query.artist.trim() : '';
      const title = typeof req.query.title === 'string' ? req.query.title.trim() : '';
      const match = await searchItunesPreview(artist, title);
      res.json(match);
    } catch (err) {
      res.status(400).json({ error: err?.message || '原曲搜索失败' });
    }
  });

  router.post('/music/fetch-audio', async (req, res) => {
    try {
      const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
      if (!url || !isAllowedFetchUrl(url)) {
        res.status(400).json({ error: '无效的原曲链接，请使用 http(s) 公网直链' });
        return;
      }
      const { buffer, contentType } = await fetchWithLimit(url);
      res.json({
        base64: buffer.toString('base64'),
        contentType,
        size: buffer.length,
        sourceUrl: url,
      });
    } catch (err) {
      res.status(400).json({ error: err?.message || '原曲下载失败' });
    }
  });

  router.post('/music/fetch-preview', async (req, res) => {
    try {
      const artist = typeof req.body?.artist === 'string' ? req.body.artist.trim() : '';
      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
      const match = await searchItunesPreview(artist, title);
      const { buffer, contentType } = await fetchWithLimit(match.previewUrl);
      res.json({
        ...match,
        base64: buffer.toString('base64'),
        contentType,
        size: buffer.length,
      });
    } catch (err) {
      res.status(400).json({ error: err?.message || '获取原曲预览失败' });
    }
  });
}
