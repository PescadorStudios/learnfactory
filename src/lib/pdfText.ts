// ──────────────────────────────────────────────────
//  Extracción de texto de un PDF
// ──────────────────────────────────────────────────
// Agnóstico de runtime A PROPÓSITO: no lleva `server-only` ni ningún builtin de
// Node, porque se usa en los dos lados.
//
//   · En el SERVIDOR, para los PDF que llegan por URL o Google Drive
//     (src/lib/generation.ts).
//   · En el NAVEGADOR, para el Modo Lectura Veloz: ahí el archivo del usuario
//     nunca se sube. Se abre localmente, se extrae el texto y solo viaja el
//     texto. Es la diferencia entre guardar el libro de otro y guardar lo que
//     esa persona está leyendo.
//
// `unpdf` (pdf.js empaquetado) pesa ~1,6 MB, así que el import va DENTRO de la
// función: quien no abre un PDF no se lo descarga.

/** Texto plano del PDF. "" si no tiene capa de texto (escaneado) o si falla. */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(data);
    const { text } = await extractText(pdf, { mergePages: true });
    const merged = Array.isArray(text) ? text.join("\n") : text;
    return merged.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  } catch (e) {
    console.error("[PDF] Error extrayendo texto:", e);
    return "";
  }
}
