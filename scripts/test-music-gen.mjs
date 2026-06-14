/**
 * 本地联调：音乐生成三种模式（经 8787 MiniMax 代理）
 * 用法：node scripts/test-music-gen.mjs [instrumental|vocal|cover|all]
 */

const API = process.env.API_BASE_URL || 'http://127.0.0.1:8787';
const modeArg = (process.argv[2] || 'instrumental').toLowerCase();

async function proxyMusic(body, label) {
  const started = Date.now();
  console.log(`\n[${label}] 请求中…（通常 1–3 分钟）`);
  const res = await fetch(`${API}/api/minimax/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: '/v1/music_generation',
      method: 'POST',
      body,
    }),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${label} 非 JSON 响应 (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`${label} HTTP ${res.status}: ${data.error || text.slice(0, 300)}`);
  }
  const base = data.base_resp;
  if (base?.status_code && base.status_code !== 0) {
    throw new Error(`${label} API ${base.status_code}: ${base.status_msg || 'unknown'}`);
  }
  const hex = data.data?.audio?.trim();
  const status = data.data?.status;
  const duration = data.extra_info?.music_duration;
  const format = data.extra_info?.music_format || 'mp3';
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  if (!hex) {
    throw new Error(`${label} 无音频 hex，status=${status}, 响应: ${text.slice(0, 400)}`);
  }
  console.log(
    `[${label}] ✓ 成功 · status=${status} · format=${format} · ~${duration ?? '?'}ms · hex=${hex.length} chars · ${elapsed}s`,
  );
  return data;
}

function audioSetting() {
  return {
    sample_rate: 44100,
    bitrate: 256000,
    format: 'mp3',
  };
}

/** 10 秒静音 mono 16-bit WAV（翻唱需真实人声，此处仅作工具保留） */
function silentWavBase64(seconds = 10, sampleRate = 44100) {
  const numSamples = seconds * sampleRate;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf.toString('base64');
}

async function testInstrumental() {
  return proxyMusic(
    {
      model: 'music-2.6',
      prompt: 'Lo-fi hip hop, chill, study, soft piano',
      is_instrumental: true,
      output_format: 'hex',
      audio_setting: audioSetting(),
    },
    '纯音乐 instrumental',
  );
}

async function testVocal() {
  return proxyMusic(
    {
      model: 'music-2.6',
      prompt: '独立民谣, 忧郁, 内省, 温暖男声, 中文',
      lyrics_optimizer: true,
      output_format: 'hex',
      audio_setting: audioSetting(),
    },
    '有人声 vocal (AI 优化歌词)',
  );
}

async function testCover() {
  if (process.env.MUSIC_COVER_AUDIO) {
    const fs = await import('node:fs/promises');
    const buf = await fs.readFile(process.env.MUSIC_COVER_AUDIO);
    const prompt = '保留原唱音色，改成更轻快的流行编曲，吉他伴奏';
    const lyrics =
      '[verse]\n街灯微亮 晚风轻抚\n影子拉长 独自漫步\n[chorus]\n推开木门 香气弥漫\n熟悉的角落 陌生人看';
    return proxyMusic(
      {
        model: 'music-cover',
        prompt,
        audio_base64: buf.toString('base64'),
        lyrics,
        output_format: 'hex',
        audio_setting: audioSetting(),
      },
      '翻唱 cover',
    );
  }
  console.log(
    '[翻唱 cover] 跳过：需真实含人声参考音频。设置环境变量 MUSIC_COVER_AUDIO=路径 后再测，或在页面用录音/上传联调。',
  );
}

async function checkConfig() {
  const res = await fetch(`${API}/api/minimax/config`);
  const cfg = await res.json();
  console.log('[config]', cfg);
  if (!cfg.configured) {
    throw new Error('MINIMAX_API_KEY 未配置，请在根目录 .env 设置后重启 API');
  }
}

const tests = {
  instrumental: [testInstrumental],
  vocal: [testVocal],
  cover: [testCover],
  all: [testInstrumental, testVocal, testCover],
};

async function main() {
  const suite = tests[modeArg];
  if (!suite) {
    console.error(`未知模式: ${modeArg}，可选 instrumental | vocal | cover | all`);
    process.exit(1);
  }
  await checkConfig();
  for (const fn of suite) {
    await fn();
  }
  console.log('\n全部联调通过。');
}

main().catch((err) => {
  console.error('\n联调失败:', err.message || err);
  process.exit(1);
});
