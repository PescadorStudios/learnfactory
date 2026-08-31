import { describe, it, expect } from "vitest";
import {
  RSVP_DEFAULTS,
  WPM_MIN,
  buildChunks,
  chunkDurationMs,
  chunkIndexForWord,
  clampWpm,
  estimateMinutes,
  looksLikeScannedPdf,
  nextSentenceWord,
  normalizeText,
  orpIndex,
  previousSentenceWord,
  sectionCount,
  sectionOf,
  tokenizeWords,
} from "./rsvp";

const words = (text: string) => tokenizeWords(normalizeText(text));

describe("orpIndex", () => {
  it("reproduce la tabla clásica de Spritz", () => {
    expect(orpIndex("y")).toBe(0); // 1 letra
    expect(orpIndex("de")).toBe(1); // 2-5
    expect(orpIndex("casa")).toBe(1);
    expect(orpIndex("palabra")).toBe(2); // 6-9
    expect(orpIndex("conocimiento")).toBe(3); // 10-13
    expect(orpIndex("extraordinariamente")).toBe(4); // 14+ (tope)
  });

  it("desplaza el pivote por la puntuación inicial y no cuenta la final", () => {
    // «Hola» → el pivote cae en la misma letra que en Hola, una posición a la
    // derecha por la comilla de apertura.
    expect(orpIndex("«Hola»")).toBe(orpIndex("Hola") + 1);
    expect(orpIndex("casa.")).toBe(orpIndex("casa"));
    expect(orpIndex("¿Qué?")).toBe(orpIndex("Qué") + 1);
  });

  it("cuenta code points: NFC y NFD dan el mismo índice tras normalizar", () => {
    const nfd = "niño"; // niño descompuesto
    expect(normalizeText(nfd)).toBe("niño");
    expect(orpIndex(normalizeText(nfd))).toBe(orpIndex("niño"));
  });

  it("no lanza con cadenas raras", () => {
    expect(orpIndex("")).toBe(0);
    expect(orpIndex("—")).toBe(0);
  });
});

describe("normalizeText", () => {
  it("une el guion de corte de línea", () => {
    expect(normalizeText("cono-\ncimiento")).toBe("conocimiento");
  });

  it("NO une cuando tras el salto va mayúscula (compuesto de verdad)", () => {
    // Falso positivo conocido y aceptado: un compuesto partido a final de línea
    // conserva el guion. Preferimos eso a pegar dos palabras distintas.
    expect(normalizeText("teórico-\nPráctico")).toBe("teórico- Práctico");
  });

  it("el salto simple es espacio y el doble es párrafo", () => {
    expect(normalizeText("una linea\nsigue aquí")).toBe("una linea sigue aquí");
    expect(normalizeText("parrafo uno\n\nparrafo dos")).toBe("parrafo uno\n\nparrafo dos");
    expect(normalizeText("uno\n\n\n\ndos")).toBe("uno\n\ndos");
  });

  it("elimina las líneas que son solo un folio", () => {
    expect(normalizeText("final de pagina\n42\nsigue el texto")).toBe(
      "final de pagina sigue el texto"
    );
  });

  it("colapsa \\r\\n, espacios y tabuladores", () => {
    expect(normalizeText("hola\r\n  mundo\t\tcruel")).toBe("hola mundo cruel");
  });

  it("es idempotente", () => {
    const raw = "Capitulo\r\n1\nuna pala-\nbra rota\n\n\n  otro   parrafo  ";
    const once = normalizeText(raw);
    expect(normalizeText(once)).toBe(once);
  });

  it("devuelve cadena vacía sin lanzar", () => {
    expect(normalizeText("")).toBe("");
  });
});

describe("buildChunks", () => {
  const texto = "El conocimiento es poder, dijo alguien. Pero la práctica manda.";

  it("con chunkSize 1 hay un chunk por palabra", () => {
    const w = words(texto);
    const chunks = buildChunks(w, { chunkSize: 1 });
    expect(chunks).toHaveLength(w.length);
    expect(chunks.reduce((s, c) => s + c.words, 0)).toBe(w.length);
  });

  it("los wordIndex son contiguos y crecientes (esto sostiene el cursor)", () => {
    const w = words(texto);
    for (const size of [1, 2, 3, 4]) {
      const chunks = buildChunks(w, { chunkSize: size });
      expect(chunks[0].wordIndex).toBe(0);
      for (let k = 0; k < chunks.length - 1; k++) {
        expect(chunks[k + 1].wordIndex).toBe(chunks[k].wordIndex + chunks[k].words);
      }
      expect(chunks.reduce((s, c) => s + c.words, 0)).toBe(w.length);
    }
  });

  it("un chunk nunca cruza fin de frase ni de párrafo", () => {
    const w = words("uno dos. tres cuatro cinco\n\nseis siete");
    const chunks = buildChunks(w, { chunkSize: 4 });
    for (const c of chunks) {
      // Si un chunk contiene un corte, ese corte tiene que ser el ÚLTIMO
      // elemento del chunk: por eso su propio `stop` es el del corte.
      const inner = c.text.match(/[.!?]\s/g);
      expect(inner).toBeNull();
    }
    // El corte cierra el chunk: caben 4 palabras, pero "uno dos." se queda en 2.
    expect(chunks[0]).toMatchObject({ text: "uno dos.", stop: "sentence" });
    expect(chunks[1]).toMatchObject({ text: "tres cuatro cinco", stop: "paragraph" });
  });

  it("documento vacío → sin chunks", () => {
    expect(buildChunks([])).toEqual([]);
    expect(buildChunks(words(""))).toEqual([]);
  });

  it("clasifica la puntuación de cierre", () => {
    const stopOf = (t: string) => buildChunks(words(t), { chunkSize: 1 })[0].stop;
    expect(stopOf("casa, mas")).toBe("comma");
    expect(stopOf("casa. Mas")).toBe("sentence");
    expect(stopOf("casa? Mas")).toBe("sentence");
    expect(stopOf("casa… mas")).toBe("sentence");
    expect(stopOf("casa mas")).toBe("none");
  });

  it("caso conocido: una abreviatura marca fin de frase de más", () => {
    // "Sr." se lee como final de frase. Mantener una lista de abreviaturas sería
    // sobreingeniería aquí; el coste es una pausa de más, no un error de lectura.
    expect(buildChunks(words("Sr. García"), { chunkSize: 1 })[0].stop).toBe("sentence");
  });

  it("el ORP de un chunk multipalabra apunta dentro de la palabra central", () => {
    const chunks = buildChunks(["uno", "conocimiento", "tres"], { chunkSize: 3 });
    const c = chunks[0];
    expect(c.text).toBe("uno conocimiento tres");
    // "uno " son 4 caracteres; el pivote de "conocimiento" es el índice 3.
    expect(c.orp).toBe(4 + orpIndex("conocimiento"));
    expect(c.text[c.orp]).toBe("o");
  });
});

describe("chunkDurationMs", () => {
  const plain = { chunkSize: 1, dynamicPauses: false, longWordBoost: false };

  it("300 ppm y una palabra base dura exactamente 200 ms", () => {
    const [c] = buildChunks(["casa"], plain);
    expect(chunkDurationMs(c, 300)).toBe(200);
  });

  it("duplicar la velocidad reduce el tiempo a la mitad", () => {
    const [c] = buildChunks(["casa"], plain);
    expect(chunkDurationMs(c, 600)).toBeCloseTo(chunkDurationMs(c, 300) / 2, 5);
  });

  it("un chunk de tres palabras dura el triple", () => {
    const [c1] = buildChunks(["casa"], plain);
    const [c3] = buildChunks(["casa", "azul", "clara"], { ...plain, chunkSize: 3 });
    expect(chunkDurationMs(c3, 300)).toBeCloseTo(chunkDurationMs(c1, 300) * 3, 5);
  });

  it("punto pausa más que coma, y coma más que nada", () => {
    const at = (t: string) => chunkDurationMs(buildChunks([t], { chunkSize: 1 })[0], 300);
    expect(at("casa.")).toBeGreaterThan(at("casa,"));
    expect(at("casa,")).toBeGreaterThan(at("casa"));
  });

  it("las palabras largas reciben más tiempo", () => {
    const at = (t: string) =>
      chunkDurationMs(buildChunks([t], { chunkSize: 1, dynamicPauses: false })[0], 300);
    expect(at("extraordinariamente")).toBeGreaterThan(at("casa"));
  });

  it("un WPM inválido se acota en vez de devolver Infinity o NaN", () => {
    const [c] = buildChunks(["casa"], plain);
    for (const bad of [0, -50, NaN, Infinity]) {
      const ms = chunkDurationMs(c, bad as number);
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBe(60_000 / WPM_MIN);
    }
    expect(clampWpm(99_999)).toBe(1000);
  });

  it("sin pausas ni bonus, el total corresponde al WPM pedido", () => {
    const w = words(
      Array.from({ length: 400 }, (_, i) => (i % 7 === 6 ? "palabra." : "palabra")).join(" ")
    );
    const chunks = buildChunks(w, plain);
    const total = chunks.reduce((s, c) => s + chunkDurationMs(c, 400), 0);
    expect((total / 60_000) * 400).toBeCloseTo(w.length, 5);
  });

  it("con las pausas por defecto el ritmo sigue en el mismo orden de magnitud", () => {
    const w = words(
      Array.from({ length: 400 }, (_, i) => (i % 7 === 6 ? "palabra." : "palabra")).join(" ")
    );
    const chunks = buildChunks(w, RSVP_DEFAULTS);
    const efectivas = (chunks.reduce((s, c) => s + chunkDurationMs(c, 400), 0) / 60_000) * 400;
    expect(efectivas).toBeGreaterThan(w.length);
    expect(efectivas).toBeLessThan(w.length * 1.5);
  });
});

describe("chunkIndexForWord", () => {
  const w = words("uno dos tres cuatro cinco seis siete ocho nueve diez");

  it("mapea los extremos y acota fuera de rango", () => {
    const chunks = buildChunks(w, { chunkSize: 1 });
    expect(chunkIndexForWord(chunks, 0)).toBe(0);
    expect(chunkIndexForWord(chunks, w.length - 1)).toBe(chunks.length - 1);
    expect(chunkIndexForWord(chunks, -5)).toBe(0);
    expect(chunkIndexForWord(chunks, 9999)).toBe(chunks.length - 1);
    expect(chunkIndexForWord([], 3)).toBe(0);
  });

  it("la misma palabra se encuentra con cualquier tamaño de chunk", () => {
    // Es lo que permite cambiar el chunking a mitad de libro sin perder el sitio.
    for (const target of [0, 3, 6, 9]) {
      for (const size of [1, 2, 3, 4]) {
        const chunks = buildChunks(w, { chunkSize: size });
        const c = chunks[chunkIndexForWord(chunks, target)];
        expect(c.wordIndex).toBeLessThanOrEqual(target);
        expect(c.wordIndex + c.words).toBeGreaterThan(target);
      }
    }
  });
});

describe("secciones del muro", () => {
  it("una sección son 900 palabras", () => {
    expect(sectionOf(0)).toBe(0);
    expect(sectionOf(899)).toBe(0);
    expect(sectionOf(900)).toBe(1);
    expect(sectionOf(-3)).toBe(0);
  });

  it("cuenta secciones sin off-by-one", () => {
    expect(sectionCount(0)).toBe(0);
    expect(sectionCount(1)).toBe(1);
    expect(sectionCount(900)).toBe(1);
    expect(sectionCount(901)).toBe(2);
  });
});

describe("navegación por frase", () => {
  const w = words("uno dos tres. cuatro cinco seis. siete ocho");
  const chunks = buildChunks(w, { chunkSize: 1 });

  it("retrocede al inicio de esta frase y luego a la anterior", () => {
    const enMitad = chunkIndexForWord(chunks, 4); // "cinco"
    expect(previousSentenceWord(chunks, enMitad)).toBe(3); // "cuatro"
    const enInicio = chunkIndexForWord(chunks, 3);
    expect(previousSentenceWord(chunks, enInicio)).toBe(0); // "uno"
  });

  it("nunca devuelve un índice negativo", () => {
    expect(previousSentenceWord(chunks, 0)).toBe(0);
    expect(previousSentenceWord([], 0)).toBe(0);
  });

  it("avanza a la primera palabra de la frase siguiente", () => {
    expect(nextSentenceWord(chunks, chunkIndexForWord(chunks, 0))).toBe(3);
    expect(nextSentenceWord(chunks, chunkIndexForWord(chunks, 4))).toBe(6);
    // En la última frase se queda en el último chunk, no se sale del array.
    expect(nextSentenceWord(chunks, chunks.length - 1)).toBe(w.length - 1);
  });
});

describe("estimateMinutes", () => {
  it("redondea hacia arriba y nunca da 0 si queda texto", () => {
    expect(estimateMinutes(0, 300)).toBe(0);
    expect(estimateMinutes(1, 300)).toBe(1);
    expect(estimateMinutes(900, 300)).toBe(3);
    expect(estimateMinutes(900, 0)).toBe(9); // WPM acotado a 100
  });
});

describe("looksLikeScannedPdf", () => {
  it("detecta el PDF sin capa de texto", () => {
    expect(looksLikeScannedPdf("")).toBe(true);
    expect(looksLikeScannedPdf("  \n ")).toBe(true);
    expect(looksLikeScannedPdf("tres palabras sueltas")).toBe(true);
  });

  it("acepta un texto normal", () => {
    const ok = Array.from({ length: 120 }, () => "palabra").join(" ");
    expect(looksLikeScannedPdf(ok)).toBe(false);
  });
});
