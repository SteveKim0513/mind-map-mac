/**
 * Turn a picked/pasted/dropped image File into a size-capped base64 data URI.
 * Spec: docs/product/specs/2026-06-12-note-images.md — images embed directly in
 * the markdown so a single .md file stays fully portable.
 */

const MAX_EDGE = 1600; // cap the longest side; keeps base64 from bloating the note

export async function fileToDataUrl(file: File): Promise<string> {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  // No re-encode needed for already-small non-transparent-sensitive cases? We
  // still go through canvas to apply the cap uniformly. SVG/GIF can't be drawn
  // losslessly (animation/vector), so pass those through untouched.
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') {
    return readAsDataUrl(file);
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return readAsDataUrl(file);
  ctx.drawImage(bitmap, 0, 0, w, h);

  // Keep PNG when the source is PNG (may carry transparency); otherwise JPEG to
  // shrink photos. WebP/others fall back to PNG.
  const usePng = file.type === 'image/png';
  return canvas.toDataURL(usePng ? 'image/png' : 'image/jpeg', usePng ? undefined : 0.82);
}

function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    return createImageBitmap(file).catch(() => loadViaImg(file));
  }
  return loadViaImg(file);
}

function loadViaImg(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** Pull image files out of a paste/drop payload. */
export function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files).filter((f) => f.type.startsWith('image/'));
}
