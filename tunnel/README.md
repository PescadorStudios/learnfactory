# El Túnel — MVP (Learn Factory)

Experiencia de **entretenimiento educativo**: el usuario "viaja" por un corredor
neuronal 3D renderizado en vivo, llega a estaciones con micro-retos sobre los
temas que eligió, y sale con la sensación de "aprendí sin estudiar". Es el modo
ocio/trance, no el modo estudio.

> **Regla de oro:** el motor es **agnóstico al contenido**. Nada temático está
> hardcodeado en la lógica. El túnel se ensambla en runtime a partir de las
> lecciones que el usuario selecciona, a través de un único contrato de datos.

---

## Cómo correr

```bash
cd tunnel
npm install
npm run dev      # http://localhost:5174
```

Otros scripts:

```bash
npm run build      # typecheck (tsc --noEmit) + build de producción (vite)
npm run preview    # sirve el build
npm run typecheck  # solo chequeo de tipos
```

---

## Estado por fases

Este MVP se construye **por fases** (ver el prompt original). Estado actual:

| Fase | Qué incluye | Estado |
|---|---|---|
| **1 — Esqueleto + datos** | Proyecto Vite/React/TS, contrato de datos, mock provider (3 nichos), lobby de selección, ensamblaje del grafo del riel en runtime + visualización debug | ✅ **Lista** |
| 2 — El mundo neuronal | Túnel procedural sobre curva, shader de corriente neuronal, scroll→`t` con inercia, forks con swipe | ⏳ pendiente |
| 3 — Estaciones + retos | Atraque a la estación, los dos minijuegos completos, captura de `reward` | ⏳ pendiente |
| 4 — HUD + estado + biofeedback | Narrador, scoring, el mundo reacciona al desempeño | ⏳ pendiente |
| 5 — Salida + pulido | Recap compartible, `prefers-reduced-motion`, performance móvil | ⏳ pendiente |

En la Fase 1 el flujo llega hasta el **mapa cenital** del riel ensamblado (vista
debug). En la Fase 2 esa vista se reemplaza por el mundo 3D, que lee del **mismo**
grafo `Rail`.

---

## Dónde está el "seam" de la API

El **único** punto de contacto con el contenido es la interfaz `LessonProvider`
(`src/types/contract.ts`). El motor importa el provider activo desde un solo
lugar:

- **`src/content/index.ts`** → exporta `provider`. Aquí está el marcador
  `// TODO: API Learn Factory`. Para enchufar el backend real, cambia esta línea
  por un provider que cumpla `LessonProvider` (mismas firmas `listLessons` /
  `getLesson`). Nada más del motor necesita cambiar.
- **`src/content/mockProvider.ts`** → el único archivo con contenido temático
  (también marcado con `// TODO: API Learn Factory aquí`).

---

## Cómo añadir o cambiar lecciones (mock)

Edita el arreglo `LESSONS` en `src/content/mockProvider.ts`. Cada lección tiene
`id`, `title`, `niche` (texto libre — agnóstico) y `pods`. Cada pod tiene un
`title`, un `reward` (micro-dato que se "captura") y un `challenge`.

Helpers de autoría:

```ts
// Subtítulos Trampa: cada línea es [texto, esTrampa?]. Se temporizan solos.
trap([
  ["Dato verdadero"],
  ["Dato que MIENTE (hay que cazarlo)", true],
]);

// El Impostor: cada dato es [texto, esFalso?]. Debe haber exactamente 1 falso.
impostor(9000, [
  ["Dato verdadero"],
  ["Dato verdadero"],
  ["Dato falso pero plausible", true],
]);
```

En modo dev se imprime una advertencia si un Impostor no tiene exactamente un
dato falso, o si un reto de Trampa no tiene ninguna trampa.

**Prueba de agnosticismo:** reemplaza las 3 lecciones por otras de nichos
distintos y todo (lobby, ensamblaje, forks, visualización) sigue funcionando sin
tocar el motor.

---

## Arquitectura en capas (desacopladas a propósito)

| Capa | Qué es | Dónde |
|---|---|---|
| **0 — El Riel** | El viaje como **grafo** (`nodes`, `edges`, `forks`, `branches`), ensamblado en runtime desde la selección. El viaje es configuración, no un asset. | `src/types/rail.ts`, `src/rail/assembleRail.ts` |
| **1 — El Mundo** | Corredor procedural neuronal en react-three-fiber. Lee solo del Rail. | _(Fase 2)_ |
| **2 — Las Estaciones** | Cada nodo es un momento de una lección, con su reto. | `Pod` en `src/types/contract.ts` |
| **3 — El HUD semántico** | Frases, narrador, micro-copy y UI de los retos, en React encima del canvas. | `src/screens/*` |
| **4 — El Motor de estado** | Fase del viaje, selección, riel; luego velocidad/posición/score/capturas. | `src/state/journeyStore.ts` |

**Principio:** cambiar una frase (Capa 3) o un shader (Capa 1) no debe requerir
re-render de contenido. Las capas se mantienen separadas.

### El riel — ensamblaje en runtime

Al confirmar la selección (`startJourney`):

1. Por cada lección seleccionada se pide `getLesson(id)` y se toman sus `pods`.
2. Se construye **una vena (branch) por lección**, encadenando sus pods como
   estaciones a lo largo de la curva (carriles paralelos en profundidad).
3. `START` se conecta a la primera estación de cada vena (**fork inicial**:
   "elige tu tema"). Donde se cruzan venas adyacentes se inserta un **fork**
   (swipe izq/centro/der). Todas las venas terminan en `END`.
4. El grafo resultante es la Capa 0; el render solo lee de aquí.

### Puntos de extensión (comentados en el código)

- **Reto nuevo:** añade un miembro a la unión `Challenge` (`contract.ts`) y su
  renderer en Capa 3. El riel no cambia.
- **Color por nicho:** `src/theme.ts` deriva el color con un hash del nombre del
  nicho (sin nombres hardcodeados).
- **Densidad de forks:** constante `CROSS_EVERY` en `assembleRail.ts`.

---

## Stack

Vite · React · TypeScript · zustand (estado) · three / @react-three/fiber /
@react-three/drei (mundo 3D, Fase 2) · lenis + @react-spring/web (scroll→`t`,
Fase 2) · howler (audio de los retos, Fase 3).
