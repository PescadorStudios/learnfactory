// ============================================================================
// EL SEAM — único punto donde el motor toca el contenido.
// ----------------------------------------------------------------------------
// Todo el motor importa `provider` desde aquí. Ya está enchufado al backend
// REAL de Learn Factory: learnFactoryProvider convierte tus rutas (y la
// biblioteca pública) en lecciones jugables usando la voz Charon y el reloj
// virtual del juego. El demo curado (mockProvider) sigue vivo DENTRO de ese
// provider como red de seguridad: visitantes anónimos, catálogo vacío o red
// caída caen al demo sin romper la experiencia.
//
// Para volver al demo puro en desarrollo, basta cambiar esta única línea.
// ============================================================================

import type { LessonProvider } from "../types/contract";
import { learnFactoryProvider } from "./learnFactoryProvider";

export const provider: LessonProvider = learnFactoryProvider;
