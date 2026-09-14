const MAX_IMAGE_BYTES = 380_000;

function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  return Math.floor((b64.length * 3) / 4);
}

async function fileToImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not read that image."));
      i.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawSquare(source: CanvasImageSource & { width: number; height: number }, size: number) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare image.");
  ctx.fillStyle = "#121a26";
  ctx.fillRect(0, 0, size, size);
  const side = Math.min(source.width, source.height);
  const sx = (source.width - side) / 2;
  const sy = (source.height - side) / 2;
  ctx.drawImage(source, sx, sy, side, side, 0, 0, size, size);
  return canvas;
}

export async function resizeGoalImage(file: File): Promise<{ dataUrl: string; dim: number; kb: number }> {
  if (!file || !String(file.type || "").startsWith("image/")) {
    throw new Error("Choose a PNG, JPEG, WebP, or GIF.");
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error("Image is over 20MB. Pick a smaller photo.");
  }
  const src = await fileToImage(file);
  try {
    let dataUrl = "";
    const start = Math.min(1024, Math.max(src.width, src.height, 256));
    for (let dim = start; dim >= 256; dim = Math.floor(dim * 0.82)) {
      const canvas = drawSquare(src, dim);
      for (const q of [0.9, 0.82, 0.74, 0.66, 0.58, 0.5]) {
        dataUrl = canvas.toDataURL("image/jpeg", q);
        if (dataUrlBytes(dataUrl) <= MAX_IMAGE_BYTES) {
          return { dataUrl, dim, kb: Math.round(dataUrlBytes(dataUrl) / 1024) };
        }
      }
    }
    throw new Error("Could not compress this image under the size limit.");
  } finally {
    if ("close" in src && typeof src.close === "function") src.close();
  }
}
