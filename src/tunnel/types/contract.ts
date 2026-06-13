// ============================================================================
// CONTRATO DE DATOS — la frontera entre el MOTOR y el CONTENIDO.
// ----------------------------------------------------------------------------
// El motor (riel, render, HUD, estado) consume EXCLUSIVAMENTE estos tipos.
// Nunca toca contenido temático directamente. Por tanto:
//   - Cambiar el contenido = cambiar el provider, no el motor.
//   - El motor es agnóstico: history, biología, finanzas o lo que llegue.
// Es lo primero que se construye porque todo lo demás depende de ello.
// ============================================================================

/** Agnóstico a propósito: "Historia", "Biología", "Finanzas"… lo que sea. */
export type Niche = string;

/** Ficha ligera para la pantalla de selección (lobby). */
export interface LessonSummary {
  id: string;
  title: string;
  niche: Niche;
  blurb: string; // 1 línea para la pantalla de selección
  estPods: number; // cuántas estaciones aporta al túnel
}

/** Lección completa: lo que se pide al ensamblar el riel. */
export interface Lesson {
  id: string;
  title: string;
  niche: Niche;
  pods: Pod[]; // las estaciones que esta lección aporta
}

/** Una estación = un nodo del riel con su reto y su recompensa. */
export interface Pod {
  id: string;
  title: string;
  challenge: Challenge; // ver tipos de reto abajo
  reward: string; // micro-dato que se "captura" al completar
}

// --- RETOS -------------------------------------------------------------------
// Unión discriminada por `type`. Añadir un reto nuevo en el futuro = añadir un
// miembro a esta unión + su renderer en Capa 3. El riel no necesita cambiar.

export type Challenge = TrapSubtitlesChallenge | ImpostorChallenge;

/**
 * Subtítulos Trampa (reto insignia): audio + subtítulos donde algunos
 * segmentos MIENTEN. El jugador debe tocar la pantalla DURANTE la ventana de
 * un subtítulo falso.
 */
export interface TrapSubtitlesChallenge {
  type: "trap_subtitles";
  audioUrl: string; // placeholder en MVP (TTS o silencio temporizado)
  segments: TrapSegment[];
}

export interface TrapSegment {
  start: number; // segundos
  end: number; // segundos
  text: string; // lo que se MUESTRA (puede mentir si isTrap)
  isTrap: boolean; // true = subtítulo falso → hay que cazarlo
  /**
   * Versión apta para TTS de `text` (mismo significado, pronunciación natural:
   * símbolos, abreviaturas y cifras escritos en palabras). La voz narra esto;
   * si falta, narra `text`. NO revela la trampa: el juego no cambia.
   */
  spoken?: string;
}

/**
 * El Impostor: 3 datos, uno falso pero plausible. Cázalo antes de que el túnel
 * acelere y se lleve la estación.
 */
export interface ImpostorChallenge {
  type: "impostor";
  facts: ImpostorFact[]; // exactamente 1 con isFalse = true
  timeoutMs: number; // ventana antes de que el túnel "se lleve" la estación
}

export interface ImpostorFact {
  text: string;
  isFalse: boolean;
}

// --- PROVIDER ----------------------------------------------------------------
// ÚNICO punto de contacto con el contenido. El MVP usa un mock; el backend real
// de Learn Factory implementará esta misma interfaz sin que el motor se entere.

export interface LessonProvider {
  /** Catálogo para la pantalla de selección. */
  listLessons(): Promise<LessonSummary[]>;
  /** Lección completa (con pods) al ensamblar el riel. */
  getLesson(id: string): Promise<Lesson>;
}
