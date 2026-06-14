const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;

export async function readAudioFileAsBase64(file: Blob, label = '参考音频'): Promise<string> {
  if (file.size > MAX_REFERENCE_BYTES) {
    throw new Error(`${label}请小于 12MB（当前 ${(file.size / (1024 * 1024)).toFixed(1)}MB）`);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1]! : dataUrl;
      if (!base64) {
        reject(new Error('读取音频失败'));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('读取音频失败'));
    reader.readAsDataURL(file);
  });
}

export function buildMusicPrompt(
  style: string,
  vocalStyle: string | undefined,
  instrumental: boolean,
): string {
  const parts: string[] = [];
  if (style.trim()) parts.push(style.trim());
  if (!instrumental && vocalStyle?.trim()) parts.push(vocalStyle.trim());
  return parts.join(', ');
}

/** 将歌词整理为「一行一句」，便于 music-2.6 按旋律演唱而非念白 */
export function formatLyricsForSinging(raw: string): string {
  let text = raw.trim();
  if (!text) return text;

  text = text.replace(/\[([^\]]+)\]/gi, (_, tag: string) => `\n[${tag.trim()}]\n`);
  text = text.replace(/\n{3,}/g, '\n\n');

  const lines = text.split('\n');
  const out: string[] = [];

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^\[[^\]]+\]$/i.test(t)) {
      out.push(t);
      continue;
    }
    if (t.length <= 16) {
      out.push(t);
      continue;
    }
    const parts = t.split(/(?<=[，,。！？!?；;、])/);
    for (const part of parts) {
      const s = part.trim();
      if (s) out.push(s);
    }
  }

  return out.join('\n').trim();
}
