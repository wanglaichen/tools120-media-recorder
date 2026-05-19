/**
 * EdgeOne Pages Node Functions：/api/*（Express）
 * 录音存于函数内存，冷启动后会清空。
 */
import { createApiApp } from '../../server/apiApp.mjs';

const app = createApiApp({
  storage: 'memory',
  maxAudioMb: Number(process.env.MAX_AUDIO_MB || 25),
});

export default app;
