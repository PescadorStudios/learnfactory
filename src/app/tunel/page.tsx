"use client";

// ============================================================================
// /tunel — ruta nativa de "El Túnel": la experiencia PARALELA a las rutas
// actuales de Learn Factory (adhesión, no reemplazo).
// ----------------------------------------------------------------------------
// El mundo es WebGL/canvas + APIs de navegador, así que se carga SOLO en cliente:
// ssr:false (permitido únicamente DENTRO de un Client Component en Next 16).
// El chunk pesado de three.js queda diferido a ESTA ruta — el resto de la app no
// carga nada del túnel y sigue funcionando exactamente igual.
// ============================================================================

import dynamic from "next/dynamic";

const TunnelRoot = dynamic(() => import("@/tunnel/TunnelRoot"), {
  ssr: false,
  // Pantalla de arranque en el mismo negro del túnel (sin destello blanco)
  // mientras baja el chunk del mundo 3D.
  loading: () => (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "#06070d",
        color: "#8a93a7",
        fontSize: 13,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
      }}
    >
      Entrando al túnel…
    </div>
  ),
});

export default function TunelPage() {
  return <TunnelRoot />;
}
