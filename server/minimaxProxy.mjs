/**
 * MiniMax API 服务端代理：密钥只读根目录 .env 的 MINIMAX_API_KEY，所有浏览器共用。
 */

import multer from 'multer';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const ALLOWED_PREFIXES = [
  '/v1/chat/completions',
  '/v1/video_generation',
  '/v1/image_generation',
  '/v1/t2a_v2',
  '/v1/voice_clone',
];
const ALLOWED_GET_PREFIXES = ['/v1/query/video_generation', '/v1/files/retrieve'];

function normalizeBaseUrl(raw) {
  const base = (raw || 'https://api.minimaxi.com').trim().replace(/\/+$/, '');
  return base.replace(/\/v1$/i, '');
}

function getServerMiniMaxConfig() {
  const apiKey = (process.env.MINIMAX_API_KEY || '').trim();
  const baseUrl = normalizeBaseUrl(process.env.MINIMAX_API_BASE_URL);
  const configured = Boolean(apiKey && apiKey !== 'your_api_key_here');
  return { apiKey, baseUrl, configured };
}

function isPathAllowed(pathname, method) {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const upper = method.toUpperCase();
  if (upper === 'GET') {
    return ALLOWED_GET_PREFIXES.some((p) => path === p || path.startsWith(`${p}?`));
  }
  if (upper === 'POST') {
    return ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(`${p}?`));
  }
  return false;
}

/** @param {import('express').Router} router */
export function attachMiniMaxProxy(router) {
  router.get('/minimax/config', (_req, res) => {
    const { configured, baseUrl } = getServerMiniMaxConfig();
    res.json({
      configured,
      mode: configured ? 'server' : 'client',
      baseUrl,
    });
  });

  router.post('/minimax/proxy', async (req, res) => {
    const { configured, apiKey, baseUrl } = getServerMiniMaxConfig();
    if (!configured) {
      res.status(503).json({
        error: '服务器未配置 MINIMAX_API_KEY，请在项目根目录 .env 中设置后重启 API 服务',
      });
      return;
    }

    const path = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
    const method = (req.body?.method || 'POST').toUpperCase();
    if (!path || !path.startsWith('/v1/')) {
      res.status(400).json({ error: '无效的 MiniMax API path' });
      return;
    }

    const qIndex = path.indexOf('?');
    const pathname = qIndex >= 0 ? path.slice(0, qIndex) : path;
    const search = qIndex >= 0 ? path.slice(qIndex) : '';

    if (!isPathAllowed(pathname + search, method)) {
      res.status(403).json({ error: '不允许代理该 MiniMax 接口' });
      return;
    }

    const targetUrl = `${baseUrl}${path}`;
    const headers = { Authorization: `Bearer ${apiKey}` };
    const init = { method, headers };

    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(req.body?.body ?? {});
    }

    try {
      const upstream = await fetch(targetUrl, init);
      const text = await upstream.text();
      res.status(upstream.status);
      const ct = upstream.headers.get('content-type');
      if (ct) res.setHeader('Content-Type', ct);
      res.send(text);
    } catch (err) {
      console.error('[minimax-proxy]', err);
      res.status(502).json({ error: err?.message || 'MiniMax 上游请求失败' });
    }
  });

  router.post('/minimax/upload', upload.single('file'), async (req, res) => {
    const { configured, apiKey, baseUrl } = getServerMiniMaxConfig();
    if (!configured) {
      res.status(503).json({
        error: '服务器未配置 MINIMAX_API_KEY，请在项目根目录 .env 中设置后重启 API 服务',
      });
      return;
    }

    if (!req.file?.buffer) {
      res.status(400).json({ error: '缺少上传文件' });
      return;
    }

    const purpose = req.body?.purpose === 'prompt_audio' ? 'prompt_audio' : 'voice_clone';
    const form = new FormData();
    form.append('purpose', purpose);
    form.append(
      'file',
      new Blob([req.file.buffer], { type: req.file.mimetype || 'application/octet-stream' }),
      req.file.originalname || 'audio.wav',
    );

    try {
      const upstream = await fetch(`${baseUrl}/v1/files/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      const text = await upstream.text();
      res.status(upstream.status);
      const ct = upstream.headers.get('content-type');
      if (ct) res.setHeader('Content-Type', ct);
      res.send(text);
    } catch (err) {
      console.error('[minimax-upload]', err);
      res.status(502).json({ error: err?.message || 'MiniMax 文件上传失败' });
    }
  });
}
