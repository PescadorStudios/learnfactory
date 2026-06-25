// Render de plantillas de outreach (merge fields). Módulo PURO (sin "server-only"):
// se usa en el cliente para el preview en vivo y en el servidor al enviar, para
// que lo que ves sea exactamente lo que se manda.

export interface MergeVars {
  name: string;
  tema: string;
  personalized_note: string;
  route_link: string;
}

/**
 * Reemplaza {{name}}, {{tema}}, {{personalized_note}}, {{route_link}}.
 * {{best_series}} se mantiene como alias retrocompatible de {{tema}} para no
 * romper plantillas guardadas viejas (rinde el mismo valor de `tema`).
 */
export function renderTemplate(tpl: string, vars: MergeVars): string {
  return (tpl || "")
    .replace(/\{\{\s*name\s*\}\}/g, vars.name ?? "")
    .replace(/\{\{\s*tema\s*\}\}/g, vars.tema ?? "")
    .replace(/\{\{\s*best_series\s*\}\}/g, vars.tema ?? "")
    .replace(/\{\{\s*personalized_note\s*\}\}/g, vars.personalized_note ?? "")
    .replace(/\{\{\s*route_link\s*\}\}/g, vars.route_link ?? "");
}

/** Mensaje de seguimiento por defecto (un solo toque). Editable en el panel. */
export const DEFAULT_FOLLOWUP_TEMPLATE =
  "Hola {{name}}, te escribí hace unos días sobre el curso que armé con tu serie de {{tema}}. " +
  "Sé que andas con mil cosas, así que te dejo el enlace de nuevo por si lo quieres ver con calma: {{route_link}}\n\n" +
  "Si no es lo tuyo, sin problema — no te vuelvo a escribir. Un abrazo,\nMauricio — Learn Factory";

/** Valida un email con la misma regla simple que usa el resto del panel. */
export function isValidEmail(email: string | null | undefined): boolean {
  return !!email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
}

// ── Campañas a usuarios registrados ───────────────────────────────────────────
// Merge fields de los correos de re-enganche (invitar a terminar el curso que el
// usuario empezó y no completó). Módulo PURO: se usa en el cliente para el
// preview en vivo y en el servidor al enviar, igual que renderTemplate().

export interface UserMergeVars {
  nombre: string;   // nombre visible del usuario (display_name / @username / local del email)
  curso: string;    // tema del curso que dejó a medias
  progreso: string; // porcentaje de avance, ej. "35%"
  enlace: string;   // URL absoluta para retomar el curso
}

/** Reemplaza {{nombre}}, {{curso}}, {{progreso}}, {{enlace}} en una plantilla. */
export function renderUserTemplate(tpl: string, vars: UserMergeVars): string {
  return (tpl || "")
    .replace(/\{\{\s*nombre\s*\}\}/g, vars.nombre ?? "")
    .replace(/\{\{\s*curso\s*\}\}/g, vars.curso ?? "")
    .replace(/\{\{\s*progreso\s*\}\}/g, vars.progreso ?? "")
    .replace(/\{\{\s*enlace\s*\}\}/g, vars.enlace ?? "");
}

/** Campos de merge disponibles para las campañas a usuarios (para hints en UI). */
export const USER_MERGE_FIELDS = ["{{nombre}}", "{{curso}}", "{{progreso}}", "{{enlace}}"] as const;
