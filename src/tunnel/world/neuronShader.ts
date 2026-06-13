// ============================================================================
// PIEL NEURONAL — shader GLSL de la pared interior del túnel.
// ----------------------------------------------------------------------------
// Se ve desde dentro (BackSide). Tres capas de "corriente":
//   1) pulsos eléctricos que viajan a lo largo (anillos brillantes en movimiento)
//   2) filamentos sinápticos que corren longitudinalmente, ondulando
//   3) chispas dispersas
// El color lo inyecta la vena activa (uColor). La velocidad de avance (uSpeed)
// acelera los pulsos: el túnel "responde" al scroll. Agnóstico al contenido.
// ============================================================================

import * as THREE from "three";

export const NEURON_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const NEURON_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3  uColor;
  uniform float uSpeed;     // unidades/seg de avance de la cámara
  uniform float uIntensity; // brillo general (lo modula el biofeedback en Fase 4)
  varying vec2  vUv;

  void main() {
    float along  = vUv.x;          // a lo largo del túnel
    float around = vUv.y;          // alrededor de la sección
    float t = uTime;
    float flow = 0.6 + uSpeed * 0.09;

    // 1) Pulsos eléctricos viajando a lo largo (anillos con borde de ataque nítido).
    float pulses = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float p = fract(along * (2.0 + fi) - t * flow * (0.5 + fi * 0.3) + fi * 0.33);
      pulses += smoothstep(0.0, 0.04, p) * smoothstep(0.16, 0.0, p);
    }

    // 2) Filamentos sinápticos longitudinales que ondulan alrededor.
    float wob = sin(along * 22.0 + t * 1.5) * 0.5 + sin(along * 9.0 - t) * 0.5;
    float line = abs(fract(around * 5.0 + wob * 0.15) - 0.5);
    float filaments = smoothstep(0.055, 0.0, line);

    // 3) Chispas dispersas que titilan.
    float cell = floor(along * 60.0) + floor(around * 20.0) * 7.0;
    float spark = step(0.992, fract(sin(cell * 12.9898 + floor(t * 3.0) * 0.137) * 43758.5453));

    float glow = pulses * 1.15 + filaments * 0.5 + spark * 0.9;
    vec3 col = uColor * 0.05 + uColor * glow * uIntensity;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export interface NeuronUniforms {
  // Índice para encajar con ShaderMaterial.uniforms ({ [k]: IUniform }).
  [key: string]: THREE.IUniform;
  uTime: { value: number };
  uColor: { value: THREE.Color };
  uSpeed: { value: number };
  uIntensity: { value: number };
}

export function neuronUniforms(color: THREE.Color): NeuronUniforms {
  return {
    uTime: { value: 0 },
    uColor: { value: color },
    uSpeed: { value: 0 },
    uIntensity: { value: 1.25 },
  };
}
