// 图片处理：压缩 → 存到磁盘 → 返回相对路径（Markdown 用）和 data URL（即时预览用）
import { writeBinaryFile, readBinaryFile, getImagesDir } from './backend';
export { getImagesDir };

const MAX_DIMENSION = 1600;
const KEEP_ORIGINAL_BYTES = 300 * 1024;

function readAsDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = src;
  });
}

function toDataUrl(canvas: HTMLCanvasElement, mime: string, quality: number): string {
  try {
    const url = canvas.toDataURL(mime, quality);
    if (url && url !== 'data:,' && url.length > 24) return url;
  } catch { /* ignore */ }
  return '';
}

/** 压缩图片，返回压缩后的 data URL（小图原样返回） */
async function compressImage(file: File): Promise<string> {
  const original = await readAsDataUrl(file);
  try {
    if (file.size <= KEEP_ORIGINAL_BYTES) return original;
    const img = await loadImage(original);
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;
    if (!w0 || !h0) return original;
    const scale = Math.min(1, MAX_DIMENSION / Math.max(w0, h0));
    if (scale >= 1 && file.size <= KEEP_ORIGINAL_BYTES * 2) return original;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w0 * scale));
    canvas.height = Math.max(1, Math.round(h0 * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return original;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (file.type === 'image/gif') return original;
    const webp = toDataUrl(canvas, 'image/webp', 0.85);
    if (webp) return webp;
    const jpeg = toDataUrl(canvas, 'image/jpeg', 0.85);
    if (jpeg) return jpeg;
    return original;
  } catch {
    return original;
  }
}

function imageFileName(file: File): string {
  const ext = file.type === 'image/png' ? '.png'
    : file.type === 'image/gif' ? '.gif'
    : file.type === 'image/svg+xml' ? '.svg'
    : '.webp';
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`;
}

/**
 * 处理图片：压缩 → 写入磁盘 → 返回 { relativePath, dataUrl }
 * relativePath: Markdown 中使用的相对路径，如 `images/abc123.webp`
 * dataUrl: 预览即时显示用的 base64 data URL
 */
export async function saveImageToDisk(
  file: File,
  imagesDir: string,
): Promise<{ relativePath: string; dataUrl: string }> {
  const compressed = await compressImage(file);
  const fileName = imageFileName(file);
  const relativePath = `images/${fileName}`;
  const fullPath = `${imagesDir}/${fileName}`;
  await writeBinaryFile(fullPath, compressed);
  return { relativePath, dataUrl: compressed };
}

/**
 * 预览中加载外置图片：将相对路径的 <img> src 转为 data URL 显示
 */
export function loadExternalImages(root: Element): void {
  root.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (src && !src.startsWith('data:') && !src.startsWith('http') && !src.startsWith('blob:')) {
      readBinaryFile(src)
        .then((dataUrl) => { if (dataUrl) img.src = dataUrl; })
        .catch((e) => console.warn('[loadExternalImage]', src, e));
    }
  });
}
