// Render de plantillas de outreach (merge fields). Módulo PURO (sin "server-only"):
// se usa en el cliente para el preview en vivo y en el servidor al enviar, para
// que lo que ves sea exactamente lo que se manda.

export interface MergeVars {
  name: string;
  best_series: string;
  personalized_note: string;
  route_link: string;
}

/** Reemplaza {{name}}, {{best_series}}, {{personalized_note}}, {{route_link}}. */
export function renderTemplate(tpl: string, vars: MergeVars): string {
  return (tpl || "")
    .replace(/\{\{\s*name\s*\}\}/g, vars.name ?? "")
    .replace(/\{\{\s*best_series\s*\}\}/g, vars.best_series ?? "")
    .replace(/\{\{\s*personalized_note\s*\}\}/g, vars.personalized_note ?? "")
    .replace(/\{\{\s*route_link\s*\}\}/g, vars.route_link ?? "");
}

/** Mensaje de seguimiento por defecto (un solo toque). Editable en el panel. */
export const DEFAULT_FOLLOWUP_TEMPLATE =
  "Hola {{name}}, te escribí hace unos días sobre el curso que armé con tu serie de {{best_series}}. " +
  "Sé que andas con mil cosas, así que te dejo el enlace de nuevo por si lo quieres ver con calma: {{route_link}}\n\n" +
  "Si no es lo tuyo, sin problema — no te vuelvo a escribir. Un abrazo,\nMauricio — Learn Factory";

/** Valida un email con la misma regla simple que usa el resto del panel. */
export function isValidEmail(email: string | null | undefined): boolean {
  return !!email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
}
