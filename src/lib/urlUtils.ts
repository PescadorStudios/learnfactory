/**
 * Extrae todas las URLs de un texto pegado (separadas por espacios, tabs,
 * saltos de línea o comas — como al copiar varias celdas o links de YouTube).
 * Devuelve la lista en orden, sin duplicados.
 */
export function extractUrls(text: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of text.split(/[\s,]+/)) {
    const token = raw.trim();
    if (!token) continue;
    let url: string | null = null;
    if (/^https?:\/\/\S+$/i.test(token)) url = token;
    else if (/^www\.\S+\.\S+/i.test(token)) url = `https://${token}`;
    if (url && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}
