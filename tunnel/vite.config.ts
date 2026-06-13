import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, open: false },
  build: {
    rollupOptions: {
      output: {
        // El grueso del peso es three.js (+ r3f/drei). Lo aislamos en su propio
        // chunk de vendor: como solo lo importa la pantalla del Túnel (lazy), se
        // carga EN DIFERIDO junto a ella —el lobby no lo toca— y queda cacheable
        // entre despliegues (cambia mucho menos que el código de la app).
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](three|@react-three)[\\/]/.test(id)) {
            return "three";
          }
        },
      },
    },
    // three.js es irreduciblemente grande (~232 kB gzip), pero va diferido tras el
    // primer pintado. Subimos el umbral del aviso para reconocerlo en vez de
    // silenciar un problema real: el bundle inicial (lobby) sigue siendo pequeño.
    chunkSizeWarningLimit: 900,
  },
});
