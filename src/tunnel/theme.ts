// ============================================================================
// Paleta bioluminiscente. El color se deriva del nombre del nicho mediante un
// hash estable — NO hay nombres de nicho hardcodeados. Así el lobby, el riel y
// (en Fase 2) la piel neuronal comparten color para un mismo tema, sea cual sea.
// ============================================================================

const PALETTE = [
  "#33e1ed", // cian sináptico
  "#b06bff", // violeta
  "#ff5fa2", // magenta
  "#ffd166", // ámbar
  "#5cff9d", // verde neón
  "#5b8cff", // azul eléctrico
];

export function colorForNiche(niche: string): string {
  let h = 0;
  for (let i = 0; i < niche.length; i++) {
    h = (h * 31 + niche.charCodeAt(i)) >>> 0;
  }
  return PALETTE[h % PALETTE.length];
}

export const NODE_START_COLOR = "#22d3a7";
export const NODE_END_COLOR = "#94a3b8";
