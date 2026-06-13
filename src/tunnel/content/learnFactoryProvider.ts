// ============================================================================
// PROVIDER REAL — rutas de Learn Factory como lecciones del túnel.
// ----------------------------------------------------------------------------
// Implementa el contrato LessonProvider tirando de la sesión COMPARTIDA de
// Supabase (la misma del resto de la app) y de las server actions del túnel
// (src/app/tunnelActions.ts), que sintetizan retos a partir de los conceptos
// reales de cada ruta.
//
// Degradación elegante (la experiencia nunca se rompe):
//   • Visitante anónimo (sin sesión) → demo curada (mockProvider).
//   • Catálogo real vacío o error de red → demo curada.
//   • ids del demo ("hist-roma"…) → se sirven del mock; ids "route:*" → reales.
//
// Esto respeta la Regla de Oro: el motor sigue agnóstico al contenido; toda la
// lógica temática vive aquí y en mockProvider, detrás del seam de content/.
// ============================================================================

import type { Lesson, LessonProvider, LessonSummary } from "../types/contract";
import { getTunnelCatalog, getTunnelLesson } from "@/app/tunnelActions";
import { supabaseBrowser } from "@/lib/supabase/client";
import { mockProvider } from "./mockProvider";

const LF_PREFIX = "route:"; // ids de lecciones reales (vs. ids del demo)

/** Token de la sesión compartida; `null` para visitantes anónimos. */
async function accessToken(): Promise<string | null> {
  try {
    const { data } = await supabaseBrowser().auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export const learnFactoryProvider: LessonProvider = {
  async listLessons(): Promise<LessonSummary[]> {
    const token = await accessToken();
    if (!token) return mockProvider.listLessons(); // anónimo → demo
    try {
      const catalog = await getTunnelCatalog(token);
      return catalog.length > 0 ? catalog : mockProvider.listLessons();
    } catch {
      return mockProvider.listLessons(); // red caída → demo, no error de pantalla
    }
  },

  async getLesson(id: string): Promise<Lesson> {
    if (!id.startsWith(LF_PREFIX)) return mockProvider.getLesson(id); // id del demo
    const token = await accessToken();
    if (!token) return mockProvider.getLesson(id); // sin sesión (no debería ocurrir)
    const lesson = await getTunnelLesson(token, id);
    if (!lesson) throw new Error("No se pudo cargar esta ruta como viaje.");
    return lesson;
  },
};
