// ============================================================================
// EL SEAM — único punto donde el motor toca el contenido.
// ----------------------------------------------------------------------------
// Todo el motor importa `provider` desde aquí. Para enchufar el backend real
// de Learn Factory, cambia SOLO esta línea por el provider real (que debe
// cumplir la interfaz `LessonProvider`). Nada más necesita cambiar.
//
//   👉 TODO: API Learn Factory
//   export const provider: LessonProvider = createLearnFactoryProvider(apiBase);
// ============================================================================

import type { LessonProvider } from "../types/contract";
import { mockProvider } from "./mockProvider";

export const provider: LessonProvider = mockProvider;
