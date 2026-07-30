// ──────────────────────────────────────────────────
//  PRECIO DE LA MEMBRESÍA — fuente ÚNICA de verdad
// ──────────────────────────────────────────────────
// Antes el precio estaba duplicado: el monto real en
// src/app/api/bold/generate-hash/route.ts y el texto mostrado, a mano, en
// src/components/PremiumCheckout.tsx. Cambiar el precio exigía editar dos
// archivos y era fácil que el cartel mintiera respecto a lo que se cobraba.
//
// Módulo PURO (sin "server-only") a propósito: lo importan tanto el route
// handler del servidor como componentes de cliente.
//
// Bold exige montos sin decimales y procesa siempre en COP según la TRM; con USD
// el cliente solo ve el precio en dólares.

export type Region = "CO" | "INTL";

export interface MembershipPrice {
  amount: number;
  currency: "COP" | "USD";
  /** Texto tal cual se le muestra al usuario. */
  display: string;
  flag: string;
  label: string;
}

export const MEMBERSHIP: Record<Region, MembershipPrice> = {
  CO: {
    amount: 23900,
    currency: "COP",
    display: "$23.900 COP",
    flag: "🇨🇴",
    label: "En Colombia",
  },
  INTL: {
    amount: 7,
    currency: "USD",
    display: "USD 7",
    flag: "🌎",
    label: "Fuera de Colombia",
  },
};

/** Días que suma cada pago. La membresía es MENSUAL de renovación manual. */
export const MEMBERSHIP_DAYS = 30;

/** Ambos precios juntos, para el copy de una sola línea. */
export const MEMBERSHIP_BOTH = `${MEMBERSHIP.CO.display} / ${MEMBERSHIP.INTL.display}`;

/** "$23.900 COP / USD 7 al mes" — el precio como se anuncia en el muro. */
export const MEMBERSHIP_MONTHLY_LABEL = `${MEMBERSHIP_BOTH} al mes`;

/** Normaliza lo que llegue del cliente. Default CO por retrocompatibilidad. */
export function regionFrom(value: unknown): Region {
  return value === "INTL" ? "INTL" : "CO";
}
