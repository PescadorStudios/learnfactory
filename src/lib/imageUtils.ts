"use client";

/**
 * Redimensiona una imagen en el navegador y la devuelve como data URL (JPEG).
 * Evita enviar fotos de varios MB a las server actions: una foto de celular
 * pasa de ~8 MB a ~150-300 KB sin pérdida visible para avatares/portadas.
 */
export function fileToResizedDataUrl(
  file: File,
  maxWidth: number,
  maxHeight: number,
  quality = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas no disponible"));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen"));
    };
    img.src = url;
  });
}
