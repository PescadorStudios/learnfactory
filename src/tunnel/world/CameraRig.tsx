// ============================================================================
// RIG DE CÁMARA — VUELO LIBRE por la red neuronal (Fase B).
// ----------------------------------------------------------------------------
// La cámara CAMINA el grafo (Capa 0) arista por arista. Pedido del usuario: solo
// anda cuando el piloto la mueve, y CON INERCIA.
//   • velocidad: un escalar CON SIGNO. El throttle del piloto fija la velocidad
//     objetivo; un resorte la sigue (inercia al acelerar) y, al soltar, decae a 0
//     (momentum) hasta DETENERSE. No hay deriva automática: sin input, se para.
//   • cruces: al llegar a un nodo con varias salidas, el rumbo (steer) elige la
//     vena → así se "cambia de ruta" en pleno vuelo. Hacia atrás camina igual por
//     las aristas de entrada (se puede retroceder).
//   • orientación: mira hacia donde se mueve (giro amortiguado; en reposo mantiene
//     el rumbo). reduced-motion: sin balanceo ni giro suave.
//   • atraque: NO atraca solo. Cuando está cerca de una estación y casi quieta,
//     reporta `canEnter` al store; el piloto decide entrar (Capa 3).
// Escribe al store solo valores discretos (progreso / estación cercana).
// ============================================================================

import { useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useJourney } from "../state/journeyStore";
import type { Rail } from "../types/rail";
import type { TunnelRuntime } from "./types";
import type { FlyInput } from "../hooks/useFlyControls";
import { buildNavGraph, chooseEdge, nearestStation } from "./graphNav";

const MAX_SPEED = 20; // u/seg a fondo
const ACCEL_TAU = 0.3; // inercia al acelerar (seg)
const COAST_TAU = 0.7; // inercia al soltar (coast largo = momentum)
const STOP_EPS = 0.06; // por debajo, sin input, se detiene del todo
const TAU_E = 0.8; // suavizado de energía (biofeedback)
const TURN_TAU = 0.3; // suavizado de la orientación (giro)
const ENTER_RADIUS = 4.2; // distancia a estación para ofrecer "Entrar"
const ENTER_SPEED = 5; // velocidad bajo la cual se puede entrar

export function CameraRig({
  rail,
  input,
  rt,
}: {
  rail: Rail;
  input: MutableRefObject<FlyInput>;
  rt: MutableRefObject<TunnelRuntime>;
}) {
  const { camera } = useThree();
  const graph = useMemo(() => buildNavGraph(rail), [rail]);
  const zRange = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const n of rail.nodes) {
      if (n.position.z < lo) lo = n.position.z;
      if (n.position.z > hi) hi = n.position.z;
    }
    if (!isFinite(lo)) return { lo: 0, span: 1 };
    return { lo, span: Math.max(1, hi - lo) };
  }, [rail]);

  // Posición en el grafo (fuera de React: se actualiza cada frame).
  const edgeId = useRef<string | null>(null);
  const tRef = useRef(0);
  const velRef = useRef(0);
  const fwd = useRef(new THREE.Vector3(0, 0, 1));

  // Temporales reutilizables (sin asignaciones por frame).
  const camPos = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3());
  const dirV = useRef(new THREE.Vector3());
  const wantV = useRef(new THREE.Vector3());

  const prevNear = useRef<{ id: string | null; can: boolean }>({ id: null, can: false });
  const prevPct = useRef(-1);

  // (Re)arranca en el START mirando hacia adentro al cambiar de grafo.
  useEffect(() => {
    const outs = graph.out.get(graph.startId) ?? [];
    const e0 =
      chooseEdge(graph, graph.startId, outs, (e) => e.to, 0) ?? outs[0] ?? rail.edges[0] ?? null;
    edgeId.current = e0 ? e0.id : null;
    tRef.current = 0;
    velRef.current = 0;
    fwd.current.set(0, 0, 1);
  }, [graph, rail]);

  useFrame((state, dtRaw) => {
    const eId = edgeId.current;
    if (!eId) return;
    let e = graph.edgeById.get(eId);
    if (!e) return;

    const dt = Math.min(dtRaw, 0.05);
    const st = useJourney.getState();
    const docked = st.activeStationId != null;
    const frozen = docked || st.atEnd; // lección abierta o Recap: cámara quieta

    // --- 1) Velocidad inercial. El throttle fija el objetivo; al soltar decae a 0
    //        (momentum) hasta parar. Nunca avanza sola. ---
    const thr = frozen ? 0 : input.current.throttle;
    const target = thr * MAX_SPEED;
    const driving = Math.abs(thr) > 0.01;
    const tau = driving ? ACCEL_TAU : COAST_TAU;
    velRef.current += (target - velRef.current) * (1 - Math.exp(-dt / tau));
    if (!driving && Math.abs(velRef.current) < STOP_EPS) velRef.current = 0;

    rt.current.energy += (st.energy - rt.current.energy) * (1 - Math.exp(-dt / TAU_E));
    rt.current.speed = Math.abs(velRef.current);

    // --- 2) Caminar el grafo según la distancia recorrida este frame. ---
    let t = tRef.current;
    let remaining = velRef.current * dt; // distancia con signo (mundo)
    const steer = frozen ? 0 : input.current.steer;
    let guard = 0;
    while (Math.abs(remaining) > 1e-5 && guard++ < 12) {
      const len = graph.len.get(e.id) ?? 1;
      const nt = t + remaining / len;
      if (nt >= 1) {
        const over = (nt - 1) * len; // sobrante hacia adelante
        const next = chooseEdge(graph, e.to, graph.out.get(e.to) ?? [], (x) => x.to, steer);
        if (!next) {
          t = 1;
          velRef.current = 0;
          break;
        }
        e = next;
        t = 0;
        remaining = over;
      } else if (nt <= 0) {
        const over = -nt * len; // sobrante hacia atrás
        const prev = chooseEdge(graph, e.from, graph.inn.get(e.from) ?? [], (x) => x.from, steer);
        if (!prev) {
          t = 0;
          velRef.current = 0;
          break;
        }
        e = prev;
        t = 1;
        remaining = -over;
      } else {
        t = nt;
        remaining = 0;
      }
    }
    edgeId.current = e.id;
    tRef.current = t;

    // --- 3) Posición y orientación. ---
    const a = graph.pos.get(e.from);
    const b = graph.pos.get(e.to);
    if (!a || !b) return;
    camPos.current.copy(a).lerp(b, t);
    dirV.current.copy(b).sub(a).normalize();

    // Mira hacia donde se mueve; en reposo mantiene el rumbo. Giro amortiguado
    // (instantáneo en reduced-motion para no marear con interpolación).
    if (Math.abs(velRef.current) > 0.05) {
      wantV.current.copy(dirV.current).multiplyScalar(velRef.current >= 0 ? 1 : -1);
      const turn = st.reducedMotion ? 1 : 1 - Math.exp(-dt / TURN_TAU);
      fwd.current.lerp(wantV.current, turn).normalize();
    }

    camera.up.set(0, 1, 0);
    camera.position.copy(camPos.current);
    // Balanceo sutil de vuelo (no en reposo / atracado / reduced-motion).
    if (!st.reducedMotion && !docked && Math.abs(velRef.current) > 0.4) {
      const tt = state.clock.elapsedTime;
      camera.position.x += Math.sin(tt * 0.9) * 0.05;
      camera.position.y += Math.cos(tt * 1.1) * 0.045;
    }
    look.current.copy(camera.position).add(fwd.current);
    camera.lookAt(look.current);

    // --- 4) Proximidad → ofrecer "Entrar" (el piloto decide; no atraca solo). ---
    const near = nearestStation(graph, camPos.current);
    const can =
      !frozen && !!near && near.dist < ENTER_RADIUS && Math.abs(velRef.current) < ENTER_SPEED;
    const nid = can && near ? near.id : null;
    const pn = prevNear.current;
    if (pn.id !== nid || pn.can !== can) {
      st.setNearest(nid, can);
      pn.id = nid;
      pn.can = can;
    }

    // --- 5) Progreso = profundidad alcanzada (z) sobre el rango del grafo. ---
    const pct = Math.round(
      THREE.MathUtils.clamp((camPos.current.z - zRange.lo) / zRange.span, 0, 1) * 100
    );
    if (prevPct.current !== pct) {
      st.setProgress(pct);
      prevPct.current = pct;
    }
  });

  return null;
}
