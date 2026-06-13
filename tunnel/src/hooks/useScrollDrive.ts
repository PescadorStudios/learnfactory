// ============================================================================
// scroll → velocidad (input de avance). lenis suaviza wheel/touch en una sola
// señal con inercia; empujamos su `velocity` al store, y el rig de cámara la
// convierte en avance sobre la curva. El scroll ACELERA; sin scroll, el túnel
// sigue derivando solo (estado de trance). lenis resetea velocity a 0 al parar.
// ============================================================================

import { useEffect } from "react";
import Lenis from "lenis";
import { useJourney } from "../state/journeyStore";

export function useScrollDrive(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const lenis = new Lenis({
      smoothWheel: true,
      syncTouch: true,
      infinite: true, // nunca topa fondo: siempre hay scroll para acelerar
      autoRaf: true,
      lerp: 0.08,
      wheelMultiplier: 1,
      touchMultiplier: 1.4,
    });

    const setScrollVelocity = useJourney.getState().setScrollVelocity;
    const onScroll = (l: Lenis) => setScrollVelocity(l.velocity);
    lenis.on("scroll", onScroll);

    return () => {
      lenis.off("scroll", onScroll);
      lenis.destroy();
      useJourney.getState().setScrollVelocity(0);
    };
  }, [enabled]);
}
