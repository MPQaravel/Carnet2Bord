//! Compression locale des photos côté client : cible < 300 Ko par image (JPEG).

export const PHOTO_TARGET_BYTES = 300 * 1024;

export async function compressImage(file: File, targetBytes = PHOTO_TARGET_BYTES): Promise<Blob> {
  const bitmap = await loadBitmap(file);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponible");
  // Limite de résolution pour alléger (max 2048 px de côté).
  const maxSide = 2048;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  let quality = 0.85;
  let blob = await toBlob(canvas, quality);
  while (blob.size > targetBytes && quality > 0.35) {
    quality -= 0.1;
    blob = await toBlob(canvas, Math.max(0.35, quality));
  }
  if (blob.size > targetBytes) {
    // Dernière chance : réduire la résolution.
    canvas.width = Math.round(canvas.width * 0.75);
    canvas.height = Math.round(canvas.height * 0.75);
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height);
    blob = await toBlob(canvas, 0.7);
  }
  return blob;
}

function loadBitmap(file: File): Promise<ImageBitmap> {
  if ("createImageBitmap" in window) return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      // ImageBitmap factice via canvas
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      c.getContext("2d")!.drawImage(img, 0, 0);
      createImageBitmap(c).then(resolve, reject);
    };
    img.onerror = reject;
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encodage impossible"))), "image/jpeg", quality));
}
