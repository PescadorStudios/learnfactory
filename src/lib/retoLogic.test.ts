// Tests de la lógica crítica de la Academia de Retos: verificación de
// finalización, ranking de ganadores (con desempates), asignación de premios
// y validación del canje de cupos. Correr con: npm run test
import { describe, it, expect } from "vitest";
import {
  isVerifiedComplete,
  rankFinishers,
  assignPrizes,
  validateCupoRedemption,
  effectiveEstado,
  cupoCodeFromBytes,
  splitPago,
  RETO_ATTENTION_MIN,
  type Finisher,
} from "./retoLogic";

// ── isVerifiedComplete ──

const LESSONS = [
  { nodeId: "1a", hasAttention: true },
  { nodeId: "1b", hasAttention: true },
  { nodeId: "2a", hasAttention: false }, // debate: sin audio
];

describe("isVerifiedComplete", () => {
  it("completa cuando todas las lecciones están aprobadas y verificadas", () => {
    const r = isVerifiedComplete(LESSONS, [
      { nodeId: "1a", passed: true, attention: { correct: 3, total: 3 } },
      { nodeId: "1b", passed: true, attention: { correct: 8, total: 12 } },
      { nodeId: "2a", passed: true },
    ]);
    expect(r.complete).toBe(true);
    expect(r.completionPct).toBe(100);
    expect(r.attentionScore).toBeCloseTo(11 / 15);
  });

  it("NO completa si falta una lección por aprobar", () => {
    const r = isVerifiedComplete(LESSONS, [
      { nodeId: "1a", passed: true, attention: { correct: 3, total: 3 } },
      { nodeId: "2a", passed: true },
    ]);
    expect(r.complete).toBe(false);
    expect(r.completionPct).toBe(67);
  });

  it("NO completa si una lección con audio no pasó la atención (dejó correr el audio)", () => {
    const r = isVerifiedComplete(LESSONS, [
      { nodeId: "1a", passed: true, attention: { correct: 3, total: 3 } },
      // atención por debajo del umbral: no cuenta aunque passed=true
      { nodeId: "1b", passed: true, attention: { correct: 2, total: 12 } },
      { nodeId: "2a", passed: true },
    ]);
    expect(r.complete).toBe(false);
  });

  it("NO cuenta una lección con audio sin datos de atención", () => {
    const r = isVerifiedComplete(LESSONS, [
      { nodeId: "1a", passed: true, attention: null },
      { nodeId: "1b", passed: true, attention: { correct: 12, total: 12 } },
      { nodeId: "2a", passed: true },
    ]);
    expect(r.complete).toBe(false);
  });

  it("usa el MEJOR intento aprobado por nodo (reintentos cuentan)", () => {
    const r = isVerifiedComplete(LESSONS, [
      { nodeId: "1a", passed: true, attention: { correct: 1, total: 3 } }, // falló atención
      { nodeId: "1a", passed: true, attention: { correct: 3, total: 3 } }, // reintento OK
      { nodeId: "1b", passed: true, attention: { correct: 12, total: 12 } },
      { nodeId: "2a", passed: true },
    ]);
    expect(r.complete).toBe(true);
  });

  it("los debates (sin audio) solo requieren passed", () => {
    const r = isVerifiedComplete([{ nodeId: "2a", hasAttention: false }], [
      { nodeId: "2a", passed: true },
    ]);
    expect(r.complete).toBe(true);
    expect(r.attentionScore).toBe(0);
  });

  it("intentos no aprobados no cuentan", () => {
    const r = isVerifiedComplete([{ nodeId: "1a", hasAttention: true }], [
      { nodeId: "1a", passed: false, attention: { correct: 3, total: 3 } },
    ]);
    expect(r.complete).toBe(false);
  });

  it("el umbral exacto cuenta como verificado", () => {
    const total = 10;
    const justo = Math.ceil(total * RETO_ATTENTION_MIN);
    const r = isVerifiedComplete([{ nodeId: "1a", hasAttention: true }], [
      { nodeId: "1a", passed: true, attention: { correct: justo, total } },
    ]);
    expect(r.complete).toBe(true);
  });
});

// ── rankFinishers + assignPrizes ──

function f(userId: string, finishedAt: string, attentionScore = 1, enrolledAt = "2026-01-01T00:00:00Z"): Finisher {
  return { userId, finishedAt, attentionScore, enrolledAt };
}

describe("rankFinishers", () => {
  it("caso normal: ordena por timestamp de finalización", () => {
    const ranked = rankFinishers([
      f("c", "2026-03-03T10:00:00Z"),
      f("a", "2026-03-01T10:00:00Z"),
      f("b", "2026-03-02T10:00:00Z"),
    ]);
    expect(ranked.map(x => x.userId)).toEqual(["a", "b", "c"]);
  });

  it("empate en timestamp: gana quien tiene mayor atención", () => {
    const t = "2026-03-01T10:00:00Z";
    const ranked = rankFinishers([f("bajo", t, 0.6), f("alto", t, 0.95)]);
    expect(ranked.map(x => x.userId)).toEqual(["alto", "bajo"]);
  });

  it("empate total: gana quien se inscribió primero", () => {
    const t = "2026-03-01T10:00:00Z";
    const ranked = rankFinishers([
      f("tarde", t, 0.8, "2026-02-10T00:00:00Z"),
      f("temprano", t, 0.8, "2026-02-01T00:00:00Z"),
    ]);
    expect(ranked.map(x => x.userId)).toEqual(["temprano", "tarde"]);
  });

  it("no muta el array de entrada", () => {
    const input = [f("b", "2026-03-02T10:00:00Z"), f("a", "2026-03-01T10:00:00Z")];
    rankFinishers(input);
    expect(input[0].userId).toBe("b");
  });
});

describe("assignPrizes", () => {
  const ranked = rankFinishers([
    f("a", "2026-03-01T10:00:00Z"),
    f("b", "2026-03-02T10:00:00Z"),
    f("c", "2026-03-03T10:00:00Z"),
  ]);

  it("asigna posiciones 1..N en orden de llegada", () => {
    const prizes = assignPrizes(ranked, 2);
    expect(prizes.get("a")).toBe(1);
    expect(prizes.get("b")).toBe(2);
  });

  it("premios agotados: el finalizador N+1 queda sin premio", () => {
    const prizes = assignPrizes(ranked, 2);
    expect(prizes.has("c")).toBe(false);
  });

  it("más premios que finalizadores: solo se asignan los llegados", () => {
    const prizes = assignPrizes(ranked, 10);
    expect(prizes.size).toBe(3);
  });

  it("sin premios configurados no hay ganadores", () => {
    expect(assignPrizes(ranked, 0).size).toBe(0);
  });
});

// ── validateCupoRedemption ──

describe("validateCupoRedemption", () => {
  const reto = { id: "r1", estadoEfectivo: "en_curso" as const };

  it("código válido y disponible: ok", () => {
    const r = validateCupoRedemption({ estado: "disponible", retoId: "r1" }, reto, false);
    expect(r.ok).toBe(true);
  });

  it("código ya canjeado: rechaza", () => {
    const r = validateCupoRedemption({ estado: "canjeado", retoId: "r1" }, reto, false);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ya fue canjeado/i);
  });

  it("código inexistente (cupos agotados / código malo): rechaza", () => {
    const r = validateCupoRedemption(null, reto, false);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/inválido/i);
  });

  it("código de OTRO reto: rechaza", () => {
    const r = validateCupoRedemption({ estado: "disponible", retoId: "otro" }, reto, false);
    expect(r.ok).toBe(false);
  });

  it("ya participante: rechaza", () => {
    const r = validateCupoRedemption({ estado: "disponible", retoId: "r1" }, reto, true);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/inscrito/i);
  });

  it("reto finalizado o en borrador: rechaza", () => {
    for (const estadoEfectivo of ["finalizado", "borrador"] as const) {
      const r = validateCupoRedemption(
        { estado: "disponible", retoId: "r1" },
        { id: "r1", estadoEfectivo },
        false
      );
      expect(r.ok).toBe(false);
    }
  });
});

// ── effectiveEstado ──

describe("effectiveEstado", () => {
  const now = new Date("2026-03-15T00:00:00Z");

  it("publicado antes de fecha_inicio sigue publicado", () => {
    expect(
      effectiveEstado({ estado: "publicado", fechaInicio: "2026-04-01T00:00:00Z", fechaFin: "2026-05-01T00:00:00Z" }, now)
    ).toBe("publicado");
  });

  it("publicado dentro de fechas pasa a en_curso", () => {
    expect(
      effectiveEstado({ estado: "publicado", fechaInicio: "2026-03-01T00:00:00Z", fechaFin: "2026-05-01T00:00:00Z" }, now)
    ).toBe("en_curso");
  });

  it("fecha_fin vencida pasa a finalizado", () => {
    expect(
      effectiveEstado({ estado: "publicado", fechaInicio: "2026-01-01T00:00:00Z", fechaFin: "2026-02-01T00:00:00Z" }, now)
    ).toBe("finalizado");
  });

  it("borrador nunca se deriva", () => {
    expect(
      effectiveEstado({ estado: "borrador", fechaInicio: "2026-01-01T00:00:00Z", fechaFin: "2026-02-01T00:00:00Z" }, now)
    ).toBe("borrador");
  });
});

// ── utilidades ──

describe("cupoCodeFromBytes", () => {
  it("produce el formato RETO-XXXXX sin caracteres ambiguos", () => {
    const code = cupoCodeFromBytes(new Uint8Array([0, 50, 100, 200, 255]));
    expect(code).toMatch(/^RETO-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
  });
});

describe("splitPago", () => {
  it("reparte 80/20 sin perder centavos", () => {
    expect(splitPago(23900)).toEqual({ creador: 19120, plataforma: 4780 });
    expect(splitPago(7)).toEqual({ creador: 6, plataforma: 1 }); // redondeo: suma intacta
    const { creador, plataforma } = splitPago(99999);
    expect(creador + plataforma).toBe(99999);
  });
});
