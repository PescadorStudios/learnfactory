// Tests de la aritmética crítica del muro de sesiones: matriz de membresía,
// el off-by-one de la última unidad, el reloj del bloqueo y los predicados de
// recordatorio (incluido "renovar re-arma el aviso"). Correr con: npm run test
import { describe, it, expect } from "vitest";
import {
  isMembershipActive,
  membershipReason,
  budgetAfter,
  lockState,
  formatCountdown,
  renewalReminderDue,
  lapseNoticeDue,
  extendMembership,
  SESSION_BUDGET_DEFAULT,
  LOCK_HOURS,
} from "./sessionBudget";

const NOW = new Date("2026-07-29T12:00:00.000Z");
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const DAY = 86_400_000;
const HOUR = 3_600_000;

// ── isMembershipActive / membershipReason ──

describe("isMembershipActive", () => {
  it("free no tiene acceso ilimitado", () => {
    expect(isMembershipActive({ plan: "free", founder: false, premiumUntil: null }, NOW)).toBe(false);
  });

  it("membresía mensual vigente sí", () => {
    expect(
      isMembershipActive({ plan: "premium", founder: false, premiumUntil: iso(10 * DAY) }, NOW)
    ).toBe(true);
  });

  it("membresía mensual VENCIDA no", () => {
    expect(
      isMembershipActive({ plan: "premium", founder: false, premiumUntil: iso(-DAY) }, NOW)
    ).toBe(false);
  });

  it("premium sin premium_until y sin founder no (mensual a medio migrar)", () => {
    expect(isMembershipActive({ plan: "premium", founder: false, premiumUntil: null }, NOW)).toBe(false);
  });

  it("fundador siempre, incluso con premium_until nulo", () => {
    expect(isMembershipActive({ plan: "premium", founder: true, premiumUntil: null }, NOW)).toBe(true);
  });

  it("fundador siempre, incluso con premium_until vencido", () => {
    expect(isMembershipActive({ plan: "premium", founder: true, premiumUntil: iso(-100 * DAY) }, NOW)).toBe(true);
  });

  it("el vencimiento exacto ya NO da acceso", () => {
    expect(isMembershipActive({ plan: "premium", founder: false, premiumUntil: NOW.toISOString() }, NOW)).toBe(false);
  });

  it("una fecha basura no da acceso", () => {
    expect(isMembershipActive({ plan: "premium", founder: false, premiumUntil: "no-es-fecha" }, NOW)).toBe(false);
  });

  it("distingue la razón del acceso", () => {
    expect(membershipReason({ plan: "premium", founder: true, premiumUntil: null }, NOW)).toBe("founder");
    expect(membershipReason({ plan: "premium", founder: false, premiumUntil: iso(DAY) }, NOW)).toBe("membership");
    expect(membershipReason({ plan: "free", founder: false, premiumUntil: null }, NOW)).toBe("free");
  });
});

// ── budgetAfter: el off-by-one ──

describe("budgetAfter", () => {
  it("sesión nueva tiene las 5 unidades", () => {
    expect(budgetAfter(0, SESSION_BUDGET_DEFAULT)).toEqual({ remaining: 5, willLock: false });
  });

  it("avisa cuando queda UNA sola (la que cierra la ventana)", () => {
    expect(budgetAfter(4, 5)).toEqual({ remaining: 1, willLock: true });
  });

  it("con las 5 gastadas no queda nada", () => {
    expect(budgetAfter(5, 5)).toEqual({ remaining: 0, willLock: true });
  });

  it("nunca devuelve negativo si el contador se pasó", () => {
    expect(budgetAfter(9, 5)).toEqual({ remaining: 0, willLock: true });
  });
});

// ── lockState / formatCountdown ──

describe("lockState", () => {
  it("sin locked_until no hay bloqueo", () => {
    expect(lockState(null, NOW)).toEqual({ locked: false, msLeft: 0 });
  });

  it("bloqueo vigente reporta lo que falta", () => {
    expect(lockState(iso(LOCK_HOURS * HOUR), NOW)).toEqual({ locked: true, msLeft: LOCK_HOURS * HOUR });
  });

  it("bloqueo ya cumplido no bloquea", () => {
    expect(lockState(iso(-1), NOW)).toEqual({ locked: false, msLeft: 0 });
  });

  it("el instante exacto del vencimiento ya no bloquea", () => {
    expect(lockState(NOW.toISOString(), NOW)).toEqual({ locked: false, msLeft: 0 });
  });
});

describe("formatCountdown", () => {
  it("más de una hora", () => {
    expect(formatCountdown(3 * HOUR + 47 * 60_000 + 12_000)).toBe("3h 47m 12s");
  });

  it("menos de una hora omite las horas", () => {
    expect(formatCountdown(47 * 60_000 + 12_000)).toBe("47m 12s");
  });

  it("menos de un minuto rellena los segundos", () => {
    expect(formatCountdown(9_000)).toBe("0m 09s");
  });

  it("cero y negativo dan cadena vacía (nunca un reloj en negativo)", () => {
    expect(formatCountdown(0)).toBe("");
    expect(formatCountdown(-5_000)).toBe("");
  });

  it("las 4 horas completas", () => {
    expect(formatCountdown(4 * HOUR)).toBe("4h 00m 00s");
  });
});

// ── Recordatorios de renovación ──

describe("renewalReminderDue", () => {
  const until = iso(2 * DAY); // vence en 2 días → dentro de la ventana de 3

  it("toca avisar dentro de los 3 días previos", () => {
    expect(renewalReminderDue(until, null, NOW)).toBe(true);
  });

  it("no toca si aún falta más de 3 días", () => {
    expect(renewalReminderDue(iso(10 * DAY), null, NOW)).toBe(false);
  });

  it("no toca dos veces para el mismo vencimiento", () => {
    expect(renewalReminderDue(until, until, NOW)).toBe(false);
  });

  it("RENOVAR re-arma el aviso: premium_until se movió, el sello viejo ya no coincide", () => {
    const renovado = iso(32 * DAY);
    expect(renewalReminderDue(renovado, until, NOW)).toBe(false); // todavía lejos
    // …y cuando se acerque de nuevo, vuelve a tocar aunque haya un sello previo.
    const casiVence = new Date(NOW.getTime() + 30 * DAY);
    expect(renewalReminderDue(renovado, until, casiVence)).toBe(true);
  });

  it("ya vencida no dispara el recordatorio previo (eso es lapseNoticeDue)", () => {
    expect(renewalReminderDue(iso(-DAY), null, NOW)).toBe(false);
  });

  it("sin membresía no hay nada que recordar", () => {
    expect(renewalReminderDue(null, null, NOW)).toBe(false);
  });
});

describe("lapseNoticeDue", () => {
  it("toca cuando ya venció", () => {
    expect(lapseNoticeDue(iso(-HOUR), null, NOW)).toBe(true);
  });

  it("no toca si sigue vigente", () => {
    expect(lapseNoticeDue(iso(DAY), null, NOW)).toBe(false);
  });

  it("no toca dos veces para el mismo vencimiento", () => {
    const v = iso(-HOUR);
    expect(lapseNoticeDue(v, v, NOW)).toBe(false);
  });

  it("tras renovar y volver a vencer, avisa de nuevo", () => {
    const viejo = iso(-40 * DAY);
    const nuevo = iso(-HOUR);
    expect(lapseNoticeDue(nuevo, viejo, NOW)).toBe(true);
  });
});

// ── extendMembership ──

describe("extendMembership", () => {
  it("desde cero cuenta 30 días desde hoy", () => {
    expect(extendMembership(null, 30, NOW).toISOString()).toBe(iso(30 * DAY));
  });

  it("ACUMULA sobre una membresía vigente (renovar temprano no pierde días)", () => {
    expect(extendMembership(iso(5 * DAY), 30, NOW).toISOString()).toBe(iso(35 * DAY));
  });

  it("desde una membresía vencida cuenta desde hoy, no desde la fecha vieja", () => {
    expect(extendMembership(iso(-20 * DAY), 30, NOW).toISOString()).toBe(iso(30 * DAY));
  });
});
