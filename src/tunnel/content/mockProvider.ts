// ============================================================================
// MOCK PROVIDER — el ÚNICO archivo del MVP con contenido temático.
// ----------------------------------------------------------------------------
// Demuestra que el motor es agnóstico: 3 nichos distintos (Historia, Biología,
// Finanzas), 3-4 pods cada uno, ambos tipos de reto representados. Si cambias
// este arreglo por lecciones de otros nichos, TODO el motor sigue funcionando
// sin tocar una línea fuera de este archivo.
//
//   👉 TODO: API Learn Factory aquí
//   Reemplaza este provider por uno que consuma el backend real. Debe cumplir
//   la MISMA interfaz `LessonProvider` (ver content/index.ts, el seam único).
//
// PARA AÑADIR / CAMBIAR LECCIONES DEL MOCK: edita el arreglo `LESSONS`.
//   - trap(...)     construye un reto de Subtítulos Trampa (auto-temporizado).
//   - impostor(...) construye un reto El Impostor (exactamente 1 dato falso).
// ============================================================================

import type {
  ImpostorChallenge,
  Lesson,
  LessonProvider,
  LessonSummary,
  TrapSegment,
  TrapSubtitlesChallenge,
} from "../types/contract";

// --- Helpers de autoría ------------------------------------------------------

/** Duración por defecto de cada subtítulo, en segundos. */
const SEG_SECS = 3.6;

/**
 * Construye los segmentos de un reto de subtítulos a una cadencia fija.
 * Cada línea es [texto, esTrampa?]. La trampa = un subtítulo que MIENTE.
 */
function trap(lines: Array<[string, boolean?]>): TrapSubtitlesChallenge {
  const segments: TrapSegment[] = lines.map(([text, isTrap], i) => ({
    start: +(i * SEG_SECS).toFixed(2),
    end: +((i + 1) * SEG_SECS).toFixed(2),
    text,
    isTrap: Boolean(isTrap),
  }));
  // audioUrl vacío = placeholder. En Fase 3 el reto corre sobre un temporizador
  // (silencio cronometrado) o un TTS; el motor no depende del audio real.
  return { type: "trap_subtitles", audioUrl: "", segments };
}

/** Construye un reto El Impostor. Cada dato es [texto, esFalso?]. */
function impostor(
  timeoutMs: number,
  facts: Array<[string, boolean?]>
): ImpostorChallenge {
  return {
    type: "impostor",
    timeoutMs,
    facts: facts.map(([text, isFalse]) => ({ text, isFalse: Boolean(isFalse) })),
  };
}

// --- Contenido (lo único temático) -------------------------------------------

const LESSONS: Lesson[] = [
  {
    id: "hist-roma",
    title: "Roma Antigua",
    niche: "Historia",
    pods: [
      {
        id: "p1",
        title: "Los orígenes de Roma",
        reward: "Roma fue fundada, según la tradición, en el 753 a.C.",
        challenge: trap([
          ["Según la leyenda, Roma fue fundada en el 753 a.C."],
          ["Sus fundadores fueron los hermanos Rómulo y Remo."],
          ["Una loba los crió a orillas del río Tíber."],
          ["Rómulo nombró la ciudad en honor a su hermano Remo.", true],
          ["Comenzó como una monarquía gobernada por siete reyes."],
          ["Tras la monarquía, Roma se convirtió directamente en un imperio.", true],
        ]),
      },
      {
        id: "p2",
        title: "La República",
        reward: "Los cónsules romanos gobernaban solo un año.",
        challenge: impostor(9000, [
          ["El Senado era el órgano más influyente de la República."],
          ["Dos cónsules gobernaban juntos durante un año."],
          ["Los cónsules eran elegidos de por vida.", true],
        ]),
      },
      {
        id: "p3",
        title: "Julio César",
        reward: "Al cruzar el Rubicón, César dijo «la suerte está echada».",
        challenge: trap([
          ["Julio César fue un general y político romano."],
          ["Conquistó la Galia entre el 58 y el 50 a.C."],
          ["Cruzó el río Rubicón con sus legiones en el 49 a.C."],
          ["Al cruzarlo pronunció la frase «veni, vidi, vici».", true],
          ["Fue nombrado dictador perpetuo en el 44 a.C."],
          ["Murió apuñalado en los idus de marzo del 44 a.C."],
        ]),
      },
      {
        id: "p4",
        title: "El Imperio",
        reward: "La red de calzadas romanas superó los 80.000 km.",
        challenge: impostor(9000, [
          ["Augusto fue el primer emperador romano."],
          ["El Coliseo albergaba a unos 50.000 espectadores."],
          ["Roma nunca construyó calzadas fuera de Italia.", true],
        ]),
      },
    ],
  },
  {
    id: "bio-celula",
    title: "La Célula",
    niche: "Biología",
    pods: [
      {
        id: "p1",
        title: "La unidad de la vida",
        reward: "Plantas y animales están hechos de células.",
        challenge: impostor(9000, [
          ["Todos los seres vivos están formados por células."],
          ["Robert Hooke fue el primero en observar células."],
          ["Las células solo existen en los animales.", true],
        ]),
      },
      {
        id: "p2",
        title: "La membrana celular",
        reward: "La membrana es selectivamente permeable, no impermeable.",
        challenge: trap([
          ["La membrana celular rodea y protege a la célula."],
          ["Está formada por una bicapa de lípidos."],
          ["Controla qué sustancias entran y salen."],
          ["La membrana es completamente impermeable a todo.", true],
          ["Permite el paso del agua y de ciertos nutrientes."],
          ["Es una barrera totalmente rígida e inmóvil.", true],
        ]),
      },
      {
        id: "p3",
        title: "Los orgánulos",
        reward: "Los ribosomas fabrican proteínas; no digieren.",
        challenge: impostor(9000, [
          ["Las mitocondrias producen la energía de la célula."],
          ["El núcleo guarda el material genético (ADN)."],
          ["Los ribosomas se encargan de la digestión celular.", true],
        ]),
      },
    ],
  },
  {
    id: "fin-interes",
    title: "Interés Compuesto",
    niche: "Finanzas",
    pods: [
      {
        id: "p1",
        title: "Qué es el interés compuesto",
        reward: "Interés compuesto = intereses que generan más intereses.",
        challenge: trap([
          ["El interés compuesto genera intereses sobre los intereses."],
          ["Hace crecer el dinero de forma exponencial con el tiempo."],
          ["Cuanto antes empiezas a invertir, mejor."],
          ["El interés compuesto solo funciona para los bancos.", true],
          ["El tiempo es su factor más poderoso."],
        ]),
      },
      {
        id: "p2",
        title: "La regla del 72",
        reward: "Regla del 72: 72 ÷ tasa ≈ años para duplicar tu dinero.",
        challenge: impostor(9000, [
          ["Estima en cuántos años se duplica tu dinero."],
          ["Divides 72 entre la tasa de interés anual."],
          ["Solo funciona con tasas superiores al 50%.", true],
        ]),
      },
      {
        id: "p3",
        title: "Empezar temprano",
        reward: "Empezar 10 años antes puede duplicar tu resultado final.",
        challenge: trap([
          ["Ahorrar a los 25 rinde mucho más que a los 35."],
          ["Diez años extra de crecimiento marcan una gran diferencia."],
          ["Aportes pequeños y constantes superan a grandes aportes tardíos."],
          ["Esperar para invertir nunca tiene ningún costo.", true],
          ["La constancia importa más que el monto inicial."],
        ]),
      },
      {
        id: "p4",
        title: "La inflación",
        reward: "La inflación varía; no es un 2% fijo garantizado.",
        challenge: impostor(9000, [
          ["La inflación reduce el poder adquisitivo del dinero."],
          ["Por eso el efectivo guardado pierde valor con el tiempo."],
          ["La inflación es siempre exactamente del 2% cada año.", true],
        ]),
      },
    ],
  },
];

/** Blurbs para el lobby (no viven en `Lesson`, que solo lleva pods). */
const BLURBS: Record<string, string> = {
  "hist-roma": "De la loba fundadora a los idus de marzo.",
  "bio-celula": "La unidad mínima de la vida, por dentro.",
  "fin-interes": "Por qué el tiempo es tu mejor aliado financiero.",
};

// --- Validación suave (ayuda a quien edite el contenido) ---------------------

function warnIfMalformed(lesson: Lesson): void {
  // En Vite era `import.meta.env.DEV`; en Next, NODE_ENV (se reemplaza estático).
  if (process.env.NODE_ENV === "production") return;
  for (const pod of lesson.pods) {
    const c = pod.challenge;
    if (c.type === "impostor") {
      const falses = c.facts.filter((f) => f.isFalse).length;
      if (falses !== 1) {
        console.warn(
          `[mockProvider] ${lesson.id}/${pod.id}: El Impostor debe tener exactamente 1 dato falso (tiene ${falses}).`
        );
      }
    } else if (c.type === "trap_subtitles") {
      if (!c.segments.some((s) => s.isTrap)) {
        console.warn(
          `[mockProvider] ${lesson.id}/${pod.id}: Subtítulos Trampa sin ningún segmento trampa.`
        );
      }
    }
  }
}

// --- Implementación del provider ---------------------------------------------

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const mockProvider: LessonProvider = {
  async listLessons(): Promise<LessonSummary[]> {
    await delay(120); // simula latencia de red
    return LESSONS.map((l) => ({
      id: l.id,
      title: l.title,
      niche: l.niche,
      blurb: BLURBS[l.id] ?? `${l.pods.length} estaciones por explorar.`,
      estPods: l.pods.length,
    }));
  },

  async getLesson(id: string): Promise<Lesson> {
    await delay(120);
    const lesson = LESSONS.find((l) => l.id === id);
    if (!lesson) throw new Error(`Lección no encontrada: ${id}`);
    warnIfMalformed(lesson);
    // Copia profunda: el motor nunca debe mutar el contenido fuente.
    return structuredClone(lesson);
  },
};
