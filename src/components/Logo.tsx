// ──────────────────────────────────────────────────
//  Identidad gráfica de la marca.
//  - <Logo />     : el logotipo completo (wordmark) — header, hero, login.
//  - <LogoMark /> : el símbolo aislado — reemplaza el icono de IA en puntos
//                   estratégicos. Minimalista, con un glow sutil opcional.
// ──────────────────────────────────────────────────

export const LOGO_URL =
  "https://res.cloudinary.com/deirdgemo/image/upload/v1781192596/IMG_9266_nixp8t.png";
export const LOGO_MARK_URL =
  "https://res.cloudinary.com/deirdgemo/image/upload/v1781189366/5BCE0556-1995-4039-9B48-9C36AE4F8716_js2w0v.png";

/** Logotipo completo. `className` controla el alto (ej. "h-7"); el ancho es automático. */
export function Logo({ className = "h-7", glow = false }: { className?: string; glow?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={LOGO_URL}
      alt="LearnFactory"
      className={`${className} w-auto object-contain select-none ${glow ? "drop-shadow-[0_0_24px_rgba(139,92,246,0.45)]" : ""}`}
      draggable={false}
    />
  );
}

/** Símbolo de la marca (cuadrado). Sustituye iconos de IA en lugares clave. */
export function LogoMark({ className = "w-6 h-6", glow = false }: { className?: string; glow?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={LOGO_MARK_URL}
      alt=""
      aria-hidden="true"
      className={`${className} object-contain select-none ${glow ? "drop-shadow-[0_0_16px_rgba(139,92,246,0.5)]" : ""}`}
      draggable={false}
    />
  );
}
