/**
 * EdgeOne Pages Node Functions：同源 /api/*（与 tools120-media-recorder.edgeone.dev 同域）
 * 录音数据存于函数内存，冷启动后会清空；长期存储请后续接入 Pages KV。
 */
import { createApiApp } from '../../server/apiApp.mjs';

const app = createApiApp({
  storage: 'memory',
  maxAudioMb: Number(process.env.MAX_AUDIO_MB || 25),
});

export default app;
