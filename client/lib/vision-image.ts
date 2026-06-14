/** 压缩图片供 M3 多模态 API 使用（减小 base64 体积，避免 request entity too large） */

export async function compressImageForVision(
  file: File,
  maxDim = 1920,
  maxEncodedChars = 4 * 1024 * 1024,
): Promise<{ dataUrl: string; previewUrl: string }> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height, 1));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器不支持 Canvas，无法压缩图片');

    ctx.drawImage(bitmap, 0, 0, width, height);

    let quality = 0.88;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    while (dataUrl.length > maxEncodedChars && quality > 0.45) {
      quality -= 0.08;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }

    if (dataUrl.length > maxEncodedChars) {
      throw new Error('图片过大，请换一张更小的图片（建议 < 3MB）');
    }

    return { dataUrl, previewUrl: dataUrl };
  } finally {
    bitmap.close();
  }
}
