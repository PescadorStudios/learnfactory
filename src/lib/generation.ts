// ──────────────────────────────────────────────────
//  Núcleo de generación con Gemini (solo servidor).
//  Usado por las server actions y el pipeline de rutas.
// ──────────────────────────────────────────────────
import "server-only";

import { GoogleGenerativeAI, Part } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as cheerio from "cheerio";
import type {
  Sintesis,
  StudyPack,
  NodeType,
  SocraticEvaluation,
  DebateMessage,
  DebateTurnResult,
  QuizNodeData,
  BossExamData,
  LessonStep,
  AttentionMode,
  AttentionData,
  SpyMission,
  SubtitleCue,
  CopilotCheckpoint,
} from "./types";

const apiKey = process.env.GEMINI_API_KEY || "";
const genAI = new GoogleGenerativeAI(apiKey);
const fileManager = apiKey ? new GoogleAIFileManager(apiKey) : null;

// ── Semáforo de TTS ──
// La generación de lecciones ahora corre EN PARALELO; el TTS es lo pesado y lo
// que se ratelimita, así que limitamos cuántas síntesis corren a la vez. El
// resto (JSON) vuela en paralelo total.
const TTS_MAX_CONCURRENT = 3;
let ttsActive = 0;
const ttsWaiters: Array<() => void> = [];

async function acquireTtsSlot(): Promise<void> {
  if (ttsActive < TTS_MAX_CONCURRENT) {
    ttsActive++;
    return;
  }
  await new Promise<void>(resolve => ttsWaiters.push(resolve));
  ttsActive++;
}

function releaseTtsSlot(): void {
  ttsActive--;
  const next = ttsWaiters.shift();
  if (next) next();
}

// Timeouts (ms): si Gemini/TTS se cuelgan, la promesa se rechaza y el loop
// de generación continúa con la siguiente lección en vez de quedar bloqueado.
const TEXT_TIMEOUT_MS = 90_000;   // generación de texto/JSON
const TTS_TIMEOUT_MS = 180_000;   // síntesis de ~3 min de audio (más lenta)

// ──────────────────────────────────────────────────
//  HELPERS
// ──────────────────────────────────────────────────

/**
 * Rechaza la promesa si excede `ms`. Universal: aunque el fetch subyacente
 * siga vivo, el caller deja de esperar y puede continuar / marcar error.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} excedió el tiempo límite (${Math.round(ms / 1000)}s)`)),
      ms
    );
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); }
    );
  });
}

function extractDriveId(url: string): string | null {
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /\/open\?id=([a-zA-Z0-9_-]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractYoutubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function detectSourceType(url: string): "drive" | "youtube" | "web" | "text" {
  if (url.includes("drive.google.com")) return "drive";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.startsWith("http")) return "web";
  return "text";
}

async function waitForFileProcessing(fileName: string): Promise<void> {
  if (!fileManager) return;
  let file = await fileManager.getFile(fileName);
  while (file.state === FileState.PROCESSING) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    file = await fileManager.getFile(fileName);
  }
  if (file.state === FileState.FAILED) {
    throw new Error(`El archivo ${fileName} falló al procesarse en Gemini.`);
  }
}

function getJsonModel() {
  return genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json" },
  });
}

function parseJsonResponse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(clean);
  }
}

function sintesisBlock(sintesis: Sintesis): string {
  return `
SÍNTESIS MAESTRA del material de estudio (tu ÚNICA fuente de verdad):
${JSON.stringify(sintesis)}

REGLAS DE FIDELIDAD (obligatorias):
- Básate EXCLUSIVAMENTE en la Síntesis Maestra. PROHIBIDO afirmar algo que no esté respaldado por ella o que contradiga la tesis global.
- Respeta las "advertenciasDeContexto": son malentendidos conocidos, NO los repitas como si fueran ciertos.
- Si la síntesis no cubre algún aspecto, dilo honestamente ("el material no profundiza en esto") en lugar de inventar.
- Cuando sea posible, apóyate en las citas textuales de la síntesis.`;
}

// ──────────────────────────────────────────────────
//  TTS (Gemini Speech Generation)
// ──────────────────────────────────────────────────

const TTS_MODEL = "gemini-2.5-flash-preview-tts";
const TTS_VOICE = "Charon"; // voz madura de adulto joven
const TTS_SAMPLE_RATE = 24000;

/** Envuelve PCM 16-bit mono en un contenedor WAV (header de 44 bytes) */
function pcmToWav(pcm: Buffer, sampleRate = TTS_SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export async function synthesizeSpeech(text: string): Promise<{ wav: Buffer; durationSeconds: number } | null> {
  await acquireTtsSlot();
  try {
    // Backoff progresivo: en paralelo es normal recibir algún 429 puntual.
    const waits = [4000, 10000];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await synthesizeSpeechOnce(text);
      if (result) return result;
      if (attempt < 3) {
        console.warn(`[TTS] Reintentando síntesis (intento ${attempt + 1}/3)...`);
        await new Promise(r => setTimeout(r, waits[attempt - 1]));
      }
    }
    return null;
  } finally {
    releaseTtsSlot();
  }
}

async function synthesizeSpeechOnce(text: string): Promise<{ wav: Buffer; durationSeconds: number } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
  try {
    console.log(`[TTS] Sintetizando ${text.length} caracteres...`);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } },
            },
          },
        }),
      }
    );

    if (!res.ok) {
      console.error(`[TTS] HTTP ${res.status}:`, (await res.text()).slice(0, 500));
      return null;
    }

    const data = await res.json();
    const b64 = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!b64) {
      console.error("[TTS] La respuesta no contiene audio.");
      return null;
    }

    const pcm = Buffer.from(b64, "base64");
    const durationSeconds = pcm.length / (TTS_SAMPLE_RATE * 2);
    console.log(`[TTS] ✓ Audio generado: ${durationSeconds.toFixed(1)}s (${(pcm.length / 1024 / 1024).toFixed(1)} MB)`);
    return { wav: pcmToWav(pcm), durationSeconds };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error(`[TTS] Abortado por timeout (${TTS_TIMEOUT_MS / 1000}s).`);
    } else {
      console.error("[TTS] Error:", error);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ──────────────────────────────────────────────────
//  GENERACIÓN DE PORTADAS (Gemini Image — "Nano Banana")
// ──────────────────────────────────────────────────

// Modelo de imagen configurable por env. Default: "Nano Banana 2"
// (gemini-3-pro-image-preview); si no está disponible para la API key,
// se hace fallback automático a Nano Banana clásico (gemini-2.5-flash-image).
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview";
const IMAGE_MODEL_FALLBACK = "gemini-2.5-flash-image";
const IMAGE_TIMEOUT_MS = 150_000;

/** Imagen de referencia para la generación (p. ej., foto del autor). */
export interface ReferenceImage {
  mimeType: string;
  /** Base64 puro, sin prefijo data URL. */
  data: string;
}

/** Construye un prompt de portada elegante a partir del tema y la tesis global. */
export function buildCoverPrompt(topic: string, tesisGlobal?: string): string {
  const tesis = tesisGlobal ? ` La esencia del tema: ${tesisGlobal}.` : "";
  return `Ilustración editorial elegante y moderna para la portada de un curso sobre "${topic}".${tesis} Estilo: arte digital sofisticado, composición limpia, iluminación cinematográfica, paleta rica y armónica. Formato apaisado 16:9. SIN texto, SIN letras, SIN palabras, SIN logos. Una sola imagen evocadora y profesional que represente el concepto central.`;
}

/**
 * Genera una imagen de portada con Gemini (Nano Banana) y devuelve el binario.
 * - Fuerza relación de aspecto 16:9 vía `imageConfig` (tamaño exacto de tarjeta).
 * - Acepta imágenes de referencia (p. ej., foto del autor) como `inlineData`.
 * - Intenta primero IMAGE_MODEL (Nano Banana 2) y cae a IMAGE_MODEL_FALLBACK.
 */
export async function generateCoverImage(
  prompt: string,
  referenceImages: ReferenceImage[] = []
): Promise<Buffer | null> {
  if (!apiKey) return null;

  const models = [...new Set([IMAGE_MODEL, IMAGE_MODEL_FALLBACK])];
  for (const model of models) {
    const result = await generateCoverImageOnce(model, prompt, referenceImages);
    if (result) return result;
    console.warn(`[Cover] ${model} no produjo imagen; ${model === models[models.length - 1] ? "sin más modelos" : "probando fallback"}...`);
  }
  return null;
}

async function generateCoverImageOnce(
  model: string,
  prompt: string,
  referenceImages: ReferenceImage[]
): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    console.log(`[Cover] Generando portada (${model}, ${referenceImages.length} ref)...`);

    // Las referencias van primero como inlineData; el texto al final.
    const parts: Array<Record<string, unknown>> = referenceImages.map(img => ({
      inlineData: { mimeType: img.mimeType, data: img.data },
    }));
    parts.push({ text: prompt });

    // imageConfig fija la relación de aspecto exacta de la portada (16:9).
    // imageSize ("2K") solo lo soporta Nano Banana 2 (gemini-3-*).
    const imageConfig: Record<string, unknown> = { aspectRatio: "16:9" };
    if (model.startsWith("gemini-3")) imageConfig.imageSize = "2K";

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig,
          },
        }),
      }
    );

    if (!res.ok) {
      console.error(`[Cover] ${model} HTTP ${res.status}:`, (await res.text()).slice(0, 500));
      return null;
    }

    const data = await res.json();
    const respParts = data?.candidates?.[0]?.content?.parts;
    const imgPart = Array.isArray(respParts)
      ? respParts.find((p: { inlineData?: { data?: string } }) => p?.inlineData?.data)
      : null;
    const b64 = imgPart?.inlineData?.data;
    if (!b64) {
      console.error(`[Cover] ${model}: la respuesta no contiene imagen.`);
      return null;
    }
    const buf = Buffer.from(b64, "base64");
    console.log(`[Cover] ✓ Portada generada con ${model} (${(buf.length / 1024).toFixed(0)} KB)`);
    return buf;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error(`[Cover] ${model} abortado por timeout (${IMAGE_TIMEOUT_MS / 1000}s).`);
    } else {
      console.error(`[Cover] ${model} error:`, error);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ──────────────────────────────────────────────────
//  PROCESAMIENTO DE FUENTES
// ──────────────────────────────────────────────────

interface ProcessedSources {
  textContext: string;
  files: Array<{ mimeType: string; uri: string }>;
}

async function downloadFromDrive(fileId: string): Promise<Buffer | null> {
  try {
    const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    console.log(`[Drive] Intentando descarga directa: ${fileId}`);

    let res = await fetch(directUrl, { redirect: "follow" });

    if (!res.ok) {
      console.warn(`[Drive] Descarga directa falló (${res.status}). ¿El archivo es público?`);
      return null;
    }

    const contentType = res.headers.get("content-type") || "";

    if (contentType.includes("text/html")) {
      console.log("[Drive] Recibida página de confirmación. Intentando con confirm=t...");
      const confirmUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
      res = await fetch(confirmUrl, { redirect: "follow" });

      if (!res.ok) {
        console.warn(`[Drive] Descarga con confirmación también falló (${res.status}).`);
        return null;
      }

      const ct2 = res.headers.get("content-type") || "";
      if (ct2.includes("text/html")) {
        console.warn("[Drive] Aún se recibe HTML. El archivo probablemente no es público o es demasiado grande.");
        return null;
      }
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    console.log(`[Drive] Descargado exitosamente: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
    return buffer;
  } catch (error) {
    console.error("[Drive] Error descargando archivo:", error);
    return null;
  }
}

async function getYoutubeContext(videoId: string): Promise<string> {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const oembedRes = await fetch(oembedUrl);
    let videoTitle = "Video de YouTube";

    if (oembedRes.ok) {
      const data = await oembedRes.json();
      videoTitle = data.title || videoTitle;
    }

    const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const pageRes = await fetch(pageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      }
    });

    let description = "";
    if (pageRes.ok) {
      const html = await pageRes.text();
      const descMatch = html.match(/\"shortDescription\":\"(.*?)\"/);
      if (descMatch) {
        description = descMatch[1]
          .replace(/\\n/g, "\n")
          .replace(/\\"/g, '"')
          .substring(0, 5000);
      }
    }

    const context = `
--- VIDEO DE YOUTUBE: "${videoTitle}" ---
URL: https://www.youtube.com/watch?v=${videoId}
Título: ${videoTitle}
${description ? `Descripción del video:\n${description}` : "No se pudo extraer la descripción."}
(Nota: El usuario quiere aprender basándose en el contenido de este video. Genera contenido educativo coherente con el título y la descripción del video.)
---`;

    console.log(`[YouTube] Contexto extraído para "${videoTitle}"`);
    return context;
  } catch (error) {
    console.error("[YouTube] Error extrayendo contexto:", error);
    return `\n--- VIDEO DE YOUTUBE (ID: ${videoId}) ---\n(No se pudo extraer información del video. Genera contenido basado en el tema principal.)\n---`;
  }
}

async function scrapeWebPage(url: string): Promise<string> {
  try {
    console.log(`[Web] Haciendo scraping a: ${url}`);
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!res.ok) {
      console.warn(`[Web] Error HTTP ${res.status} al acceder a ${url}`);
      return `\nReferencia web: ${url} (no accesible)\n`;
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    $("script, style, nav, footer, header, aside, iframe, noscript").remove();

    const title = $("title").text().trim();
    const mainContent = $("main, article, .content, .post, #content").text().trim();
    const bodyText = mainContent || $("body").text().trim();

    const cleanText = bodyText.replace(/\s+/g, " ").trim();

    console.log(`[Web] Extraídos ${cleanText.length} caracteres de "${title}"`);
    return `\n--- CONTENIDO DE "${title}" (${url}) ---\n${cleanText.substring(0, 15000)}\n---\n`;
  } catch (error) {
    console.error(`[Web] Error procesando ${url}:`, error);
    return `\nReferencia web: ${url} (error al procesar)\n`;
  }
}

export async function processSources(sourcesStr: string): Promise<ProcessedSources> {
  const emptyResult: ProcessedSources = { textContext: "", files: [] };

  if (!sourcesStr || !apiKey) return emptyResult;

  const sources = sourcesStr.split(",").map(s => s.trim()).filter(Boolean);
  let combinedContext = "";
  const geminiFiles: Array<{ mimeType: string; uri: string }> = [];

  for (const source of sources) {
    const sourceType = detectSourceType(source);

    try {
      switch (sourceType) {
        case "drive": {
          const fileId = extractDriveId(source);
          if (!fileId) {
            console.warn("[Drive] No se pudo extraer ID de:", source);
            combinedContext += `\nReferencia (Drive no reconocido): ${source}\n`;
            break;
          }

          if (!fileManager) {
            console.warn("[Drive] No hay FileManager disponible.");
            break;
          }

          const buffer = await downloadFromDrive(fileId);
          if (!buffer) {
            combinedContext += `\nReferencia (Drive inaccesible): ${source}\n`;
            break;
          }

          const tempFilePath = path.join(os.tmpdir(), `learnfactory_drive_${fileId}.pdf`);
          fs.writeFileSync(tempFilePath, buffer);

          console.log(`[Drive] Subiendo a Gemini File API...`);
          const uploadResult = await fileManager.uploadFile(tempFilePath, {
            mimeType: "application/pdf",
            displayName: `Drive_${fileId}.pdf`,
          });

          await waitForFileProcessing(uploadResult.file.name);

          geminiFiles.push({
            mimeType: uploadResult.file.mimeType,
            uri: uploadResult.file.uri,
          });
          console.log(`[Drive] ✓ Archivo listo en Gemini: ${uploadResult.file.uri}`);

          try { fs.unlinkSync(tempFilePath); } catch {}
          break;
        }

        case "youtube": {
          const videoId = extractYoutubeId(source);
          if (videoId) {
            const context = await getYoutubeContext(videoId);
            combinedContext += context;
          } else {
            combinedContext += `\nReferencia (YouTube no reconocido): ${source}\n`;
          }
          break;
        }

        case "web": {
          const webContent = await scrapeWebPage(source);
          combinedContext += webContent;
          break;
        }

        default: {
          combinedContext += `\nReferencia del usuario: ${source}\n`;
        }
      }
    } catch (e) {
      console.error(`[processSources] Error procesando "${source}":`, e);
      combinedContext += `\nReferencia (error): ${source}\n`;
    }
  }

  return { textContext: combinedContext, files: geminiFiles };
}

// ──────────────────────────────────────────────────
//  STUDY PACK (Síntesis Maestra + Árbol)
// ──────────────────────────────────────────────────

export async function generateStudyPack(topic: string, sourcesStr: string = ""): Promise<StudyPack> {
  if (!apiKey) {
    console.log("No GEMINI_API_KEY found. Returning mock study pack.");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return generateMockStudyPack(topic);
  }

  try {
    const model = getJsonModel();
    const processed = await processSources(sourcesStr);

    let sourceInstruction = "";
    if (processed.textContext) {
      sourceInstruction = `\n\nBasa el curso EXCLUSIVAMENTE en este contenido extraído de las fuentes del usuario:\n${processed.textContext}`;
    }
    if (processed.files.length > 0) {
      sourceInstruction += `\n\nAdemás, se han adjuntado ${processed.files.length} archivo(s) PDF. Basa la síntesis y la estructura del curso en el contenido COMPLETO de estos archivos.`;
    }

    const promptText = `
Actúa como el motor de análisis de "LearnFactory", una academia gamificada.
El usuario quiere dominar el siguiente tema: "${topic}".
${sourceInstruction}

TAREA 1 — SÍNTESIS MAESTRA:
Lee COMPLETAMENTE las fuentes antes de escribir nada. Construye una "Síntesis Maestra" que capture la tesis global del material como un todo coherente. Esta síntesis será la ÚNICA fuente de verdad para generar todas las lecciones del curso, así que debe ser absolutamente fiel al material: NUNCA saques conclusiones de fragmentos aislados; cada concepto debe explicarse según el argumento completo del autor, no según una frase suelta.

TAREA 2 — ÁRBOL DE CONOCIMIENTO:
Genera el árbol de aprendizaje (3 a 5 niveles lógicos) BASADO en la síntesis anterior.
Cada nivel debe tener un id (number), title, description, y un arreglo de "nodes".
Cada node representa una habilidad o microlección con id (string como "1a", "2b"), title, type, status (todos "locked" excepto el primero que debe ser "unlocked"), y "conceptIds" con los ids de los conceptos de la síntesis que cubre.
Tipos de nodo: "theory" y "practice" (microlecciones), "debate" (debate con la IA, usa 1-2 por curso en niveles intermedios), "quiz" (repaso acumulativo, usa 1-2 por curso), "boss" (examen final, SOLO el último nodo del último nivel).

Reglas estrictas:
- Entre 6 y 12 conceptos. La síntesis completa NO debe superar 5000 caracteres.
- "citaTextual" debe ser una cita LITERAL y breve del material (máx 250 caracteres). Si la fuente no da texto literal (ej. solo un video), usa la paráfrasis más fiel posible.
- "advertenciasDeContexto": lista de malentendidos probables si alguien lee un fragmento fuera de contexto, y cuál es la lectura correcta según el material completo.

SOLO devuelve el JSON, sin formato markdown ni texto adicional:
{
  "sintesis": {
    "tesisGlobal": "La idea central de TODO el material, en 2 a 4 oraciones.",
    "conceptos": [
      {
        "id": "c1",
        "nombre": "...",
        "definicion": "Definición fiel al material (1-2 oraciones).",
        "citaTextual": "Cita literal del material.",
        "relacion": "Cómo se conecta con la tesis global y con otros conceptos."
      }
    ],
    "advertenciasDeContexto": ["..."]
  },
  "tree": {
    "topic": "${topic}",
    "levels": [
      {
        "id": 1,
        "title": "Fundamentos",
        "description": "Conceptos básicos.",
        "nodes": [
          { "id": "1a", "title": "Introducción", "status": "unlocked", "type": "theory", "conceptIds": ["c1"] },
          { "id": "1b", "title": "Conceptos Clave", "status": "locked", "type": "practice", "conceptIds": ["c2"] }
        ]
      }
    ]
  }
}
`;

    const parts: Part[] = [];
    for (const file of processed.files) {
      parts.push({
        fileData: {
          mimeType: file.mimeType,
          fileUri: file.uri,
        }
      });
    }
    parts.push({ text: promptText });

    console.log(`[StudyPack] Generando con ${processed.files.length} archivo(s) y ${processed.textContext.length} chars de contexto...`);
    const result = await withTimeout(model.generateContent(parts), TEXT_TIMEOUT_MS, "Generación de la síntesis maestra");
    const parsed = parseJsonResponse(result.response.text());

    if (!parsed?.sintesis?.conceptos?.length || !parsed?.tree?.levels?.length) {
      throw new Error("Respuesta incompleta: falta sintesis o tree.");
    }

    console.log(`[StudyPack] ✓ Síntesis con ${parsed.sintesis.conceptos.length} conceptos, árbol con ${parsed.tree.levels.length} niveles`);
    return parsed as StudyPack;
  } catch (error) {
    console.error("[StudyPack] Error:", error);
    return generateMockStudyPack(topic);
  }
}

// ──────────────────────────────────────────────────
//  CONTENIDO DE MICROLECCIÓN
//  Audio + sistema de atención rotativo (espía / subtítulos / co-piloto)
// ──────────────────────────────────────────────────

export interface LessonContent {
  steps: LessonStep[];
  attention: AttentionData | null;
  durationSeconds: number | null;
  wav: Buffer | null;
}

const TTS_NARRATION_PREFIX =
  "Narra en español con voz de adulto joven: tono maduro, claro, cálido y profesional, como un narrador de documentales cercano:\n\n";

/** Baraja un par opciones/correctIndex (el modelo tiende a poner la correcta primero). */
function shuffleOptions(options: string[], correctIndex: number): { options: string[]; correctIndex: number } {
  const indices = options.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return {
    options: indices.map(i => options[i]),
    correctIndex: indices.indexOf(correctIndex),
  };
}

function guidanceBlock(guidance?: string): string {
  return guidance?.trim()
    ? `\nPETICIÓN DEL CREADOR DEL CURSO (ajústate a ella sin violar la fidelidad a la síntesis): «${guidance.trim().slice(0, 500)}»\n`
    : "";
}

/** PARTE B compartida: los 5 pasos de la lección. */
function stepsPromptPart(): string {
  return `
PARTE B — "steps": exactamente estos 5 pasos:
1. { "type": "theory", "title": "...", "content": "Explicación fiel a la síntesis (máx 3 oraciones)", "cita": "Cita textual de la síntesis que la respalda" }
2. { "type": "analogy", "title": "Analogía", "content": "Una analogía muy creativa para recordarlo, que NO distorsione el significado original" }
3. { "type": "elaboration", "title": "Conéctalo", "prompt": "Pregunta de elaboración: pide al usuario conectar este concepto con la tesis global o con un concepto ya visto, en sus propias palabras", "conceptContext": "Resumen de 2-3 oraciones de los conceptos relevantes para evaluar la respuesta" }
4. { "type": "debate", "title": "Pregunta Socrática", "prompt": "Pregunta retadora basada en la síntesis", "conceptContext": "Resumen de 2-3 oraciones de los conceptos relevantes para evaluar la respuesta" }
5. { "type": "quiz", "title": "Comprueba tu comprensión", "question": "...", "options": ["A", "B", "C", "D"], "correctAnswer": 0, "explicacion": "Por qué es correcta, apoyándote en la síntesis", "conceptId": "id del concepto focal evaluado" }`;
}

function lessonPromptHeader(
  topic: string,
  nodeTitle: string,
  nodeType: NodeType,
  sintesis: Sintesis,
  conceptIds: string[],
  studiedConceptIds: string[],
  guidance?: string
): string {
  const practiceInstruction = nodeType === "practice"
    ? `\nEsta es una lección de PRÁCTICA: el paso "theory" debe presentar un caso o escenario concreto donde se aplique el concepto (no solo definirlo), y el paso "quiz" debe ser de nivel de APLICACIÓN (resolver una situación), no de simple recuerdo.`
    : "";
  const recapInstruction = studiedConceptIds.length
    ? `\nAl inicio de la narración, conecta brevemente lo ya aprendido (conceptos: ${studiedConceptIds.join(", ")}) con lo que viene.`
    : "";
  return `
Actúa como tutor experto en la academia "LearnFactory".
${sintesisBlock(sintesis)}
${guidanceBlock(guidance)}
Conceptos focales de esta lección: ${conceptIds.length ? conceptIds.join(", ") : "los más relevantes al subtema"}

Crea una microlección sobre "${nodeTitle}" (tema general: "${topic}").${practiceInstruction}${recapInstruction}

REGLAS DE NARRACIÓN (la PARTE A se leerá en voz alta TAL CUAL):
- Tono de narrador de podcast entusiasta y cercano, en segunda persona. Cuenta el contexto como una historia: gancho → panorama → conceptos → ejemplos → por qué importa.
- Nada de markdown, emojis, títulos ni acotaciones; solo prosa hablada natural y fluida.
- Fiel a la síntesis: nada inventado.`;
}

// ── Prompts de la PARTE A por mecánica ──

function spyPromptPart(): string {
  return `
PARTE A — "guion" + "misiones" (MECÁNICA: MISIÓN DE ESPÍA):
"guion": mini-podcast de ~3 minutos en exactamente 10 segmentos de 40-45 palabras cada uno (narración pura, sin preguntas habladas).

"misiones": exactamente 3 misiones de escucha que el oyente recibe ANTES de oír el audio y responde AL FINAL. Reglas estrictas:
- Cada misión instruye a DETECTAR algo concreto durante la narración: una causa, el orden en que aparecen varios elementos, una característica que aplica a un escenario específico, una contradicción aparente, quién/qué hizo algo.
- PROHIBIDO preguntar por el tema central explícito del audio: las misiones son sobre detalles que SOLO se capturan prestando atención sostenida.
- Reparto obligatorio: la misión 1 se responde con información del primer tercio del audio, la 2 con el tercio medio y la 3 con el final (así toda interacción exige memoria de lo escuchado).
- "instruccion": lenguaje de juego de espías, imperativo y breve (máx 15 palabras), SIN revelar la respuesta. Ej: "Detecta qué provocó el colapso del sistema."
- "pregunta": la pregunta directa que se hace al final (máx 14 palabras).
- "options": exactamente 3 opciones cortas y plausibles (máx 5 palabras); "correctIndex" la correcta.

Devuelve SOLO este JSON:
{
  "guion": [ { "texto": "40-45 palabras..." } ],
  "misiones": [ { "instruccion": "...", "pregunta": "...", "options": ["...","...","..."], "correctIndex": 0 } ],
  "steps": [...]
}`;
}

function subtitlesPromptPart(): string {
  return `
PARTE A — "cues" (MECÁNICA: SUBTÍTULOS TRAMPA):
La narración de ~3 minutos se divide en exactamente 40 "cues" (frases cortas de 8 a 13 palabras) que juntas forman una narración continua y natural (al concatenarlas se leen como prosa fluida).

Exactamente 12 cues llevan además "textoAlterado": una versión del cue donde UNA palabra o frase clave fue cambiada de modo que CONTRADICE lo que el audio realmente dice. Reglas estrictas:
- La alteración SIEMPRE afecta contenido clave: una cifra, un orden, una causa, un nombre conceptual, una relación (causa↔consecuencia, antes↔después, más↔menos).
- El texto alterado debe leerse 100% natural y plausible por sí solo: PROHIBIDO que sea detectable solo leyendo; solo se nota al COMPARAR con lo que se oye.
- Las 12 trampas se reparten por TODO el audio y nunca hay dos en cues consecutivos.
- Al menos 2 trampas deben contradecir información que el audio estableció mucho antes (30+ segundos atrás), no solo la frase actual.

Devuelve SOLO este JSON:
{
  "cues": [ { "texto": "frase que se narra..." }, { "texto": "frase que se narra...", "textoAlterado": "misma frase con el cambio trampa..." } ],
  "steps": [...]
}`;
}

function copilotPromptPart(): string {
  return `
PARTE A — "guion" (MECÁNICA: CO-PILOTO NARRATIVO):
Mini-podcast de ~3 minutos en exactamente 12 segmentos de 35-45 palabras. Los segmentos 2, 4, 6, 8, 10 y 12 TERMINAN con una duda conversacional del narrador dirigida al oyente (forma parte del texto narrado), p. ej.: "...y aquí te lo pregunto a ti, copiloto: ¿esto ocurrió por la presión externa o por una decisión interna?". Esos 6 segmentos llevan además "checkpoint". Reglas estrictas:
- La duda narrada plantea una bifurcación REAL sobre causas, consecuencias, definiciones o contrastes presentes en la síntesis.
- Solo puede responderse habiendo ESCUCHADO los segundos anteriores: las opciones en pantalla NO contienen contexto suficiente por sí solas.
- "options": exactamente 2, cortas (máx 5 palabras), correspondiendo a las dos alternativas de la duda narrada; "correctIndex" la correcta.
- "correccion": 1 frase breve en voz del narrador para cuando el oyente ELIGIÓ LA OPCIÓN INCORRECTA: debe empezar corrigiendo el error y dar la respuesta correcta (ej.: "Casi, pero no: en realidad fue la presión externa, recuerda que..."). PROHIBIDO redactarla como confirmación o felicitación.
- Al menos UNO de los 6 checkpoints debe girar sobre algo dicho 2 o más segmentos atrás (30+ segundos antes), no sobre la frase inmediata.
- El segmento SIGUIENTE a cada duda comienza resolviéndola con naturalidad en su primera frase (confirma la respuesta correcta y sigue), para que el audio fluya tanto si el oyente acertó como si no.

Devuelve SOLO este JSON:
{
  "guion": [ { "texto": "35-45 palabras..." }, { "texto": "35-45 palabras que terminan con la duda narrada...", "checkpoint": { "options": ["...","..."], "correctIndex": 0, "correccion": "..." } } ],
  "steps": [...]
}`;
}

/** Llama al modelo JSON con un reintento ante errores transitorios (429/503). */
async function generateLessonJson(prompt: string): Promise<Record<string, unknown>> {
  const model = getJsonModel();
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await withTimeout(model.generateContent(prompt), TEXT_TIMEOUT_MS, "Generación del contenido de la lección");
      return parseJsonResponse(result.response.text());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const transient = /429|quota|rate|503|overloaded|fetch failed/i.test(msg);
      if (attempt < 2 && transient) {
        console.warn(`[LessonContent] Error transitorio (${msg.slice(0, 120)}). Reintentando en 6s...`);
        await new Promise(r => setTimeout(r, 6000));
        continue;
      }
      throw e;
    }
  }
}

export async function generateLessonContent(
  topic: string,
  nodeTitle: string,
  nodeType: NodeType,
  sintesis: Sintesis,
  conceptIds: string[],
  studiedConceptIds: string[],
  attentionMode: AttentionMode = "spy",
  guidance?: string
): Promise<LessonContent> {
  if (!apiKey) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return { steps: generateMockSteps(topic, nodeTitle), attention: null, durationSeconds: null, wav: null };
  }

  const header = lessonPromptHeader(topic, nodeTitle, nodeType, sintesis, conceptIds, studiedConceptIds, guidance);
  const partA =
    attentionMode === "subtitles" ? subtitlesPromptPart() :
    attentionMode === "copilot" ? copilotPromptPart() :
    spyPromptPart();

  const parsed = await generateLessonJson(`${header}\n${partA}\n${stepsPromptPart()}\n\nDevuelve SOLO el JSON indicado, sin texto adicional ni markdown.`);
  if (!Array.isArray(parsed?.steps) || parsed.steps.length === 0) {
    throw new Error("La lección no tiene pasos válidos.");
  }
  const steps = parsed.steps as LessonStep[];

  const noAudio: LessonContent = { steps, attention: null, durationSeconds: null, wav: null };

  // ── Construir guion + datos de atención según la mecánica ──

  if (attentionMode === "subtitles") {
    const rawCues: Array<{ texto?: string; textoAlterado?: string }> = Array.isArray(parsed.cues) ? (parsed.cues as Array<{ texto?: string; textoAlterado?: string }>) : [];
    const cuesIn = rawCues.filter(c => typeof c?.texto === "string" && c.texto.trim().length > 0);
    const trampasIn = cuesIn.filter(c => c.textoAlterado?.trim());
    if (cuesIn.length < 24 || trampasIn.length < 8) {
      console.warn(`[LessonContent] Subtítulos insuficientes (${cuesIn.length} cues, ${trampasIn.length} trampas): lección sin audio.`);
      return noAudio;
    }

    const fullScript = cuesIn.map(c => c.texto!.trim()).join(" ");
    const speech = await synthesizeSpeech(TTS_NARRATION_PREFIX + fullScript);
    if (!speech) return noAudio;

    // Ventana temporal de cada cue: proporcional a sus caracteres
    const totalChars = fullScript.length;
    const cues: SubtitleCue[] = [];
    let offset = 0;
    for (const c of cuesIn) {
      const texto = c.texto!.trim();
      const start = (offset / totalChars) * speech.durationSeconds;
      const end = ((offset + texto.length) / totalChars) * speech.durationSeconds;
      const alterado = Boolean(c.textoAlterado?.trim());
      cues.push({
        atSeconds: Math.round(start * 10) / 10,
        endSeconds: Math.round(end * 10) / 10,
        texto: alterado ? c.textoAlterado!.trim() : texto,
        alterado,
        original: alterado ? texto : undefined,
      });
      offset += texto.length + 1; // espacio separador
    }

    return {
      steps,
      attention: { mode: "subtitles", cues, trampas: cues.filter(c => c.alterado).length },
      durationSeconds: speech.durationSeconds,
      wav: speech.wav,
    };
  }

  if (attentionMode === "copilot") {
    const rawGuion: Array<{ texto?: string; checkpoint?: { options?: string[]; correctIndex?: number; correccion?: string } }> =
      Array.isArray(parsed.guion) ? (parsed.guion as Array<{ texto?: string; checkpoint?: { options?: string[]; correctIndex?: number; correccion?: string } }>) : [];
    const segs = rawGuion.filter(s => typeof s?.texto === "string" && s.texto.trim().length > 0);
    const withCp = segs.filter(s => s.checkpoint?.options?.length === 2);
    if (segs.length < 8 || withCp.length < 4) {
      console.warn(`[LessonContent] Co-piloto insuficiente (${segs.length} segmentos, ${withCp.length} checkpoints): lección sin audio.`);
      return noAudio;
    }

    const fullScript = segs.map(s => s.texto!.trim()).join("\n\n");
    const speech = await synthesizeSpeech(TTS_NARRATION_PREFIX + fullScript);
    if (!speech) return noAudio;

    // Pausa al FINAL del segmento que termina con la duda narrada
    const totalChars = fullScript.length;
    const checkpoints: CopilotCheckpoint[] = [];
    let offset = 0;
    for (const s of segs) {
      const texto = s.texto!.trim();
      const segEnd = ((offset + texto.length) / totalChars) * speech.durationSeconds;
      if (s.checkpoint?.options?.length === 2) {
        const { options, correctIndex } = shuffleOptions(
          s.checkpoint.options.map(o => String(o)),
          s.checkpoint.correctIndex === 1 ? 1 : 0
        );
        checkpoints.push({
          // Clamp: el último segmento termina con el audio; la pausa debe caer antes del final
          atSeconds: Math.round(Math.min(segEnd + 0.2, speech.durationSeconds - 1.5) * 10) / 10,
          options,
          correctIndex,
          correccion: s.checkpoint.correccion?.trim() || "Repasemos: la otra opción era la correcta. Sigamos.",
        });
      }
      offset += texto.length + 2; // separador "\n\n"
    }

    return {
      steps,
      attention: { mode: "copilot", checkpoints },
      durationSeconds: speech.durationSeconds,
      wav: speech.wav,
    };
  }

  // ── Misión de Espía (default) ──
  const rawGuion: Array<{ texto?: string }> = Array.isArray(parsed.guion) ? (parsed.guion as Array<{ texto?: string }>) : [];
  const segs = rawGuion.filter(s => typeof s?.texto === "string" && s.texto.trim().length > 0);
  const rawMisiones: Array<{ instruccion?: string; pregunta?: string; options?: string[]; correctIndex?: number }> =
    Array.isArray(parsed.misiones) ? (parsed.misiones as Array<{ instruccion?: string; pregunta?: string; options?: string[]; correctIndex?: number }>) : [];
  const misionesIn = rawMisiones.filter(m => m?.instruccion && m?.pregunta && Array.isArray(m.options) && m.options.length >= 2);
  if (segs.length < 7 || misionesIn.length < 2) {
    console.warn(`[LessonContent] Misión de espía insuficiente (${segs.length} segmentos, ${misionesIn.length} misiones): lección sin audio.`);
    return noAudio;
  }

  const fullScript = segs.map(s => s.texto!.trim()).join("\n\n");
  const speech = await synthesizeSpeech(TTS_NARRATION_PREFIX + fullScript);
  if (!speech) return noAudio;

  const misiones: SpyMission[] = misionesIn.slice(0, 3).map(m => {
    const opts = m.options!.map(o => String(o)).slice(0, 3);
    const rawCorrect = typeof m.correctIndex === "number" && m.correctIndex >= 0 && m.correctIndex < opts.length ? m.correctIndex : 0;
    const { options, correctIndex } = shuffleOptions(opts, rawCorrect);
    return {
      instruccion: String(m.instruccion).trim(),
      pregunta: String(m.pregunta).trim(),
      options,
      correctIndex,
    };
  });

  return {
    steps,
    attention: { mode: "spy", misiones },
    durationSeconds: speech.durationSeconds,
    wav: speech.wav,
  };
}

// ──────────────────────────────────────────────────
//  EVALUACIÓN SOCRÁTICA (escala 0-5)
// ──────────────────────────────────────────────────

export async function evaluateSocraticAnswerCore(
  question: string,
  userAnswer: string,
  conceptContext: string
): Promise<SocraticEvaluation> {
  if (!apiKey) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return generateMockEvaluation();
  }

  try {
    const model = getJsonModel();

    const prompt = `
Actúa como un tutor socrático experto y cercano de la academia "LearnFactory".

CONTEXTO CONCEPTUAL (fuente de verdad): ${conceptContext}
PREGUNTA PLANTEADA: ${question}
RESPUESTA DEL ESTUDIANTE: ${userAnswer}

Evalúa la respuesta con honestidad pero con tono motivador. Valora la comprensión real, no la longitud ni el vocabulario. Si la respuesta contradice el contexto conceptual, señálalo con claridad y explica cuál es la lectura correcta.

SOLO devuelve el JSON, sin texto adicional:
{
  "puntuacion": 0,
  "fortalezas": ["1-2 puntos concretos que el estudiante hizo bien"],
  "mejoras": ["1-2 sugerencias concretas y accionables"],
  "ideaClave": "La idea esencial que una respuesta perfecta debía incluir (1-2 oraciones)."
}
(puntuacion: escala 0-5. 0 = no responde la pregunta, 1 = muy débil, 2 = comprensión parcial, 3 = comprensión aceptable, 4 = comprensión sólida, 5 = excelente con razonamiento propio. Usa toda la escala con criterio.)
`;

    const result = await withTimeout(model.generateContent(prompt), TEXT_TIMEOUT_MS, "Evaluación socrática");
    const parsed = parseJsonResponse(result.response.text());
    return {
      puntuacion: Math.max(0, Math.min(5, Number(parsed.puntuacion) || 0)),
      fortalezas: Array.isArray(parsed.fortalezas) ? parsed.fortalezas : [],
      mejoras: Array.isArray(parsed.mejoras) ? parsed.mejoras : [],
      ideaClave: parsed.ideaClave || "",
    };
  } catch (error) {
    console.error("[SocraticEval] Error:", error);
    return generateMockEvaluation();
  }
}

// ──────────────────────────────────────────────────
//  DEBATE MULTI-TURNO
// ──────────────────────────────────────────────────

export async function debateTurnCore(
  topic: string,
  nodeTitle: string,
  sintesis: Sintesis,
  transcript: DebateMessage[]
): Promise<DebateTurnResult> {
  if (!apiKey) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return generateMockDebateTurn(nodeTitle, transcript);
  }

  try {
    const model = getJsonModel();
    const studentTurns = transcript.filter(m => m.rol === "estudiante").length;

    const prompt = `
Actúa como un oponente de debate inteligente y respetuoso en la academia "LearnFactory".
${sintesisBlock(sintesis)}

Debate sobre: "${nodeTitle}" (tema general: "${topic}").

TU ROL: adopta una postura desafiante pero DEFENDIBLE. Si las "advertenciasDeContexto" de la síntesis incluyen un malentendido relacionado con este subtema, ÚSALO como tu postura: el estudiante debe corregirte usando el material. Nunca afirmes como verdad absoluta algo que contradiga la síntesis: márcalo siempre como tu postura a debatir.

TRANSCRIPT DEL DEBATE HASTA AHORA (vacío = debes abrir el debate):
${JSON.stringify(transcript)}

INSTRUCCIONES:
- Si el transcript está vacío: abre el debate presentando tu postura en 2-4 oraciones y termina con una pregunta directa al estudiante. "esCierre": false.
- Si el transcript tiene 1 respuesta del estudiante: contraargumenta de forma constructiva (reconoce lo válido, presiona donde su argumento es débil) y termina con otra pregunta. "esCierre": false.
- Si el transcript tiene ${Math.max(2, studentTurns)} o más respuestas del estudiante (ya tiene ${studentTurns}): CIERRA el debate. Reconoce sus mejores argumentos, aclara cuál es la posición correcta según la síntesis, y devuelve "feedbackFinal".

SOLO devuelve el JSON, sin texto adicional:
{
  "mensajeIA": "Tu mensaje al estudiante",
  "esCierre": false,
  "feedbackFinal": {
    "puntuacion": 0,
    "fortalezas": ["..."],
    "mejoras": ["..."],
    "ideaClave": "..."
  }
}
("feedbackFinal" SOLO cuando esCierre es true; omítelo en los demás turnos. puntuacion: escala 0-5 según la calidad argumentativa global del estudiante.)
`;

    const result = await withTimeout(model.generateContent(prompt), TEXT_TIMEOUT_MS, "Turno de debate");
    const parsed = parseJsonResponse(result.response.text());
    return {
      mensajeIA: parsed.mensajeIA || "",
      esCierre: Boolean(parsed.esCierre),
      feedbackFinal: parsed.feedbackFinal
        ? {
            puntuacion: Math.max(0, Math.min(5, Number(parsed.feedbackFinal.puntuacion) || 0)),
            fortalezas: parsed.feedbackFinal.fortalezas || [],
            mejoras: parsed.feedbackFinal.mejoras || [],
            ideaClave: parsed.feedbackFinal.ideaClave || "",
          }
        : undefined,
    };
  } catch (error) {
    console.error("[DebateTurn] Error:", error);
    return generateMockDebateTurn(nodeTitle, transcript);
  }
}

// ──────────────────────────────────────────────────
//  QUIZ ACUMULATIVO
// ──────────────────────────────────────────────────

export async function generateQuizNode(
  topic: string,
  sintesis: Sintesis,
  focalConceptIds: string[],
  reviewConceptIds: string[] = [],
  guidance?: string
): Promise<QuizNodeData> {
  if (!apiKey) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return generateMockQuizNode(topic, focalConceptIds);
  }

  try {
    const model = getJsonModel();

    const composition = `Genera exactamente 6 preguntas: 4 sobre los conceptos focales (${focalConceptIds.join(", ") || "los principales"}) y 2 de repaso sobre conceptos ya estudiados (${reviewConceptIds.join(", ") || "cualquier otro concepto de la síntesis"}). Intercala las de repaso, no las pongas al final.`;

    const prompt = `
Actúa como diseñador de evaluaciones en la academia "LearnFactory".
${sintesisBlock(sintesis)}
${guidanceBlock(guidance)}
Tema general: "${topic}".

${composition}

Reglas:
- Basadas EXCLUSIVAMENTE en la síntesis.
- Varía el nivel cognitivo: recuerdo, comprensión y aplicación.
- Cada pregunta incluye "explicacion" (por qué la respuesta es correcta, citando la síntesis) y "conceptId" (el concepto que evalúa).
- Los distractores deben ser plausibles; si hay "advertenciasDeContexto" relevantes, úsalas como distractores (así el estudiante aprende a evitar el malentendido).

SOLO devuelve el JSON, sin texto adicional:
{
  "preguntas": [
    { "question": "...", "options": ["A", "B", "C", "D"], "correctAnswer": 0, "explicacion": "...", "conceptId": "c1" }
  ]
}
`;

    const result = await withTimeout(model.generateContent(prompt), TEXT_TIMEOUT_MS, "Generación del quiz");
    const parsed = parseJsonResponse(result.response.text());
    if (!Array.isArray(parsed?.preguntas) || parsed.preguntas.length === 0) {
      throw new Error("El quiz no contiene preguntas válidas.");
    }
    return parsed as QuizNodeData;
  } catch (error) {
    console.error("[QuizNode] Error:", error);
    return generateMockQuizNode(topic, focalConceptIds);
  }
}

// ──────────────────────────────────────────────────
//  BOSS: EXAMEN FINAL
// ──────────────────────────────────────────────────

export async function generateBossExam(topic: string, sintesis: Sintesis, guidance?: string): Promise<BossExamData> {
  if (!apiKey) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return generateMockBossExam(topic);
  }

  try {
    const model = getJsonModel();

    const prompt = `
Actúa como diseñador del examen final ("Boss Battle") de la academia "LearnFactory".
${sintesisBlock(sintesis)}
${guidanceBlock(guidance)}
Tema general: "${topic}".

Genera el examen final que cubra TODOS los conceptos de la síntesis:
1. Exactamente 8 preguntas de opción múltiple, repartidas entre todos los conceptos, con niveles variados (recuerdo, comprensión, aplicación). Cada una con "explicacion" y "conceptId". Usa las "advertenciasDeContexto" como distractores donde sea posible.
2. UNA pregunta abierta final ("preguntaAbierta") sobre la tesis global del material: debe exigir que el estudiante demuestre que entiende el argumento COMPLETO, no fragmentos. Incluye "conceptContext" (resumen de la tesis global y conceptos clave, 3-4 oraciones, para evaluar la respuesta).

SOLO devuelve el JSON, sin texto adicional:
{
  "preguntas": [
    { "question": "...", "options": ["A", "B", "C", "D"], "correctAnswer": 0, "explicacion": "...", "conceptId": "c1" }
  ],
  "preguntaAbierta": { "prompt": "...", "conceptContext": "..." }
}
`;

    const result = await withTimeout(model.generateContent(prompt), TEXT_TIMEOUT_MS, "Generación del examen boss");
    const parsed = parseJsonResponse(result.response.text());
    if (!Array.isArray(parsed?.preguntas) || !parsed?.preguntaAbierta?.prompt) {
      throw new Error("El examen no tiene la estructura esperada.");
    }
    return parsed as BossExamData;
  } catch (error) {
    console.error("[BossExam] Error:", error);
    return generateMockBossExam(topic);
  }
}

// ──────────────────────────────────────────────────
//  MOCK DATA (Fallback cuando no hay API Key)
// ──────────────────────────────────────────────────

function generateMockStudyPack(topic: string): StudyPack {
  return {
    sintesis: {
      tesisGlobal: `El material sobre ${topic} sostiene que dominar sus principios fundamentales permite aplicarlos de forma coherente en la práctica. Cada concepto cobra sentido dentro del argumento completo, no de forma aislada.`,
      conceptos: [
        {
          id: "c1",
          nombre: `Fundamentos de ${topic}`,
          definicion: `Los principios básicos sobre los que se construye todo el conocimiento de ${topic}.`,
          citaTextual: "Si los cimientos no son fuertes, todo colapsa.",
          relacion: "Es la base de la tesis global: sin fundamentos no hay aplicación coherente.",
        },
        {
          id: "c2",
          nombre: "Aplicación práctica",
          definicion: `Cómo llevar los principios de ${topic} a situaciones reales.`,
          citaTextual: "La teoría sin práctica es estéril.",
          relacion: "Conecta los fundamentos (c1) con el dominio del tema.",
        },
        {
          id: "c3",
          nombre: "Análisis crítico",
          definicion: "La capacidad de evaluar argumentos y detectar conclusiones fuera de contexto.",
          citaTextual: "Un fragmento aislado puede decir lo contrario que el texto completo.",
          relacion: "Protege la comprensión global frente a malentendidos.",
        },
      ],
      advertenciasDeContexto: [
        `Leer fragmentos aislados de ${topic} puede llevar a conclusiones opuestas al argumento completo del material.`,
      ],
    },
    tree: {
      topic,
      levels: [
        {
          id: 1,
          title: "Fundamentos de " + topic,
          description: "Conceptos básicos esenciales.",
          nodes: [
            { id: "1a", title: "Introducción", status: "unlocked", type: "theory", conceptIds: ["c1"] },
            { id: "1b", title: "Conceptos Clave", status: "locked", type: "practice", conceptIds: ["c1", "c2"] },
          ]
        },
        {
          id: 2,
          title: "Aplicación Práctica",
          description: "Lleva la teoría al mundo real.",
          nodes: [
            { id: "2a", title: "Análisis", status: "locked", type: "debate", conceptIds: ["c3"] },
            { id: "2b", title: "Repaso General", status: "locked", type: "quiz", conceptIds: ["c2", "c3"] },
          ]
        },
        {
          id: 3,
          title: "Dominio y Boss Battle",
          description: "Demuestra lo que has aprendido.",
          nodes: [
            { id: "3a", title: "Examen Final", status: "locked", type: "boss", conceptIds: ["c1", "c2", "c3"] },
          ]
        }
      ]
    },
  };
}

function generateMockSteps(topic: string, nodeTitle: string): LessonStep[] {
  return [
    {
      type: "theory",
      title: "Concepto Clave",
      content: `La base de ${topic} enfocada en ${nodeTitle} es entender sus principios fundamentales.`,
      cita: "Si los cimientos no son fuertes, todo colapsa.",
    },
    {
      type: "analogy",
      title: "Analogía",
      content: `Entender ${nodeTitle} es como construir una casa: si los cimientos de ${topic} no son fuertes, todo colapsa.`,
    },
    {
      type: "elaboration",
      title: "Conéctalo",
      prompt: `En tus propias palabras, ¿cómo se conecta ${nodeTitle} con la idea central de ${topic}?`,
      conceptContext: `${nodeTitle} es uno de los fundamentos de ${topic}; sin él, la aplicación práctica carece de base.`,
    },
    {
      type: "debate",
      title: "Pregunta Socrática",
      prompt: `Imagina que alguien te dice que ${nodeTitle} es irrelevante para ${topic}. ¿Cómo lo defenderías en tus propias palabras?`,
      conceptContext: `${nodeTitle} es uno de los fundamentos de ${topic}; sin él, la aplicación práctica carece de base.`,
    },
    {
      type: "quiz",
      title: "Comprueba tu comprensión",
      question: `¿Cuál es el propósito principal de ${nodeTitle}?`,
      options: ["Acelerar el proceso", "Mejorar la base fundamental", "Ignorar las reglas", "Crear confusión"],
      correctAnswer: 1,
      explicacion: "Según el material, los fundamentos sólidos son la base de todo lo demás.",
      conceptId: "c1",
    }
  ];
}

function generateMockEvaluation(): SocraticEvaluation {
  return {
    puntuacion: 3,
    fortalezas: ["Respondiste con tus propias palabras", "Conectaste la idea con el tema general"],
    mejoras: ["Apóyate en un ejemplo concreto del material para reforzar tu argumento"],
    ideaClave: "Una respuesta completa conecta el concepto con la tesis global del material, no con una impresión aislada.",
  };
}

function generateMockDebateTurn(nodeTitle: string, transcript: DebateMessage[]): DebateTurnResult {
  const studentTurns = transcript.filter(m => m.rol === "estudiante").length;
  if (studentTurns === 0) {
    return {
      mensajeIA: `Sostengo que ${nodeTitle} suele malinterpretarse cuando se analiza por fragmentos. De hecho, creo que la lectura más popular es incorrecta. ¿Tú qué opinas y en qué te basas?`,
      esCierre: false,
    };
  }
  if (studentTurns === 1) {
    return {
      mensajeIA: "Interesante punto. Pero si eso fuera cierto, ¿cómo explicas los casos donde el contexto completo cambia la conclusión? Dame un argumento basado en el material.",
      esCierre: false,
    };
  }
  return {
    mensajeIA: "Buen debate. Reconozco tus mejores argumentos: defendiste tu postura con razones y no con impresiones. La posición correcta, según el material completo, es que cada concepto debe leerse dentro del argumento global.",
    esCierre: true,
    feedbackFinal: {
      puntuacion: 3,
      fortalezas: ["Mantuviste una postura coherente durante el debate"],
      mejoras: ["Cita partes específicas del material para reforzar tus argumentos"],
      ideaClave: "Debatir bien es defender la lectura del texto completo frente a conclusiones de fragmentos aislados.",
    },
  };
}

function generateMockQuizNode(topic: string, focalConceptIds: string[]): QuizNodeData {
  const cid = focalConceptIds[0] || "c1";
  return {
    preguntas: [
      {
        question: `¿Cuál es la idea central del material sobre ${topic}?`,
        options: ["Memorizar datos sueltos", "Comprender el argumento completo", "Leer solo fragmentos", "Evitar la práctica"],
        correctAnswer: 1,
        explicacion: "La tesis global insiste en comprender el material como un todo coherente.",
        conceptId: cid,
      },
      {
        question: "¿Qué riesgo tiene estudiar solo fragmentos aislados?",
        options: ["Aprender más rápido", "Llegar a conclusiones erróneas", "Mejorar la memoria", "Ninguno"],
        correctAnswer: 1,
        explicacion: "Un fragmento aislado puede decir lo contrario que el texto completo.",
        conceptId: cid,
      },
      {
        question: `¿Cómo se aplica ${topic} en la práctica?`,
        options: ["Ignorando la teoría", "Aplicando los principios fundamentales", "Improvisando siempre", "Copiando sin entender"],
        correctAnswer: 1,
        explicacion: "La aplicación coherente nace de los fundamentos bien comprendidos.",
        conceptId: cid,
      },
      {
        question: "¿Qué hace un buen análisis crítico?",
        options: ["Acepta todo lo que lee", "Evalúa argumentos en su contexto completo", "Busca confirmar prejuicios", "Evita las fuentes"],
        correctAnswer: 1,
        explicacion: "El análisis crítico protege contra los malentendidos de contexto.",
        conceptId: cid,
      },
    ],
  };
}

function generateMockBossExam(topic: string): BossExamData {
  const base = generateMockQuizNode(topic, ["c1"]).preguntas;
  return {
    preguntas: [...base, ...base].slice(0, 8).map((p, i) => ({ ...p, question: `(${i + 1}) ${p.question}` })),
    preguntaAbierta: {
      prompt: `Explica con tus propias palabras la tesis global del material sobre ${topic} y cómo se conectan sus conceptos principales.`,
      conceptContext: `La tesis global de ${topic}: dominar los principios fundamentales permite aplicarlos coherentemente; cada concepto cobra sentido dentro del argumento completo.`,
    },
  };
}
