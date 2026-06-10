"use server";

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
  MicroLessonData,
} from "@/lib/types";

// Inicializar SDK
const apiKey = process.env.GEMINI_API_KEY || "";
const genAI = new GoogleGenerativeAI(apiKey);
const fileManager = apiKey ? new GoogleAIFileManager(apiKey) : null;

// ──────────────────────────────────────────────────
//  HELPERS
// ──────────────────────────────────────────────────

/** Extraer el ID de archivo de una URL de Google Drive */
function extractDriveId(url: string): string | null {
  // Formatos: /file/d/ID/..., id=ID, open?id=ID
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

/** Extraer el video ID de una URL de YouTube */
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

/** Detectar tipo de fuente */
function detectSourceType(url: string): "drive" | "youtube" | "web" | "text" {
  if (url.includes("drive.google.com")) return "drive";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.startsWith("http")) return "web";
  return "text";
}

/** Esperar a que un archivo subido a Gemini esté procesado */
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

/** Modelo configurado para devolver JSON puro */
function getJsonModel() {
  return genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json" },
  });
}

/** Parsear respuesta JSON (con fallback para fences de markdown) */
function parseJsonResponse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(clean);
  }
}

/** Bloque de síntesis reutilizado en los prompts de generación */
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
//  PROCESAMIENTO DE FUENTES
// ──────────────────────────────────────────────────

interface ProcessedSources {
  textContext: string;
  files: Array<{ mimeType: string; uri: string }>;
}

/** Descargar un archivo de Google Drive (sigue redirects de confirmación) */
async function downloadFromDrive(fileId: string): Promise<Buffer | null> {
  try {
    // Primer intento: descarga directa
    const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    console.log(`[Drive] Intentando descarga directa: ${fileId}`);

    let res = await fetch(directUrl, { redirect: "follow" });

    if (!res.ok) {
      console.warn(`[Drive] Descarga directa falló (${res.status}). ¿El archivo es público?`);
      return null;
    }

    const contentType = res.headers.get("content-type") || "";

    // Si Google devuelve HTML en vez del PDF, es la página de "confirmar descarga"
    if (contentType.includes("text/html")) {
      console.log("[Drive] Recibida página de confirmación. Intentando con confirm=t...");
      const confirmUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
      res = await fetch(confirmUrl, { redirect: "follow" });

      if (!res.ok) {
        console.warn(`[Drive] Descarga con confirmación también falló (${res.status}).`);
        return null;
      }

      // Verificar de nuevo que no sea HTML
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

/** Obtener transcripción de YouTube usando la página de oEmbed + scraping de la página */
async function getYoutubeContext(videoId: string): Promise<string> {
  try {
    // Obtener info básica del video vía oEmbed (no necesita API key)
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const oembedRes = await fetch(oembedUrl);
    let videoTitle = "Video de YouTube";

    if (oembedRes.ok) {
      const data = await oembedRes.json();
      videoTitle = data.title || videoTitle;
    }

    // Intentar obtener la página del video y extraer cualquier metadata
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
      // Extraer la descripción del meta tag
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

/** Hacer scraping de una URL web genérica */
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

    // Limpiar elementos no relevantes
    $("script, style, nav, footer, header, aside, iframe, noscript").remove();

    // Intentar obtener el contenido principal
    const title = $("title").text().trim();
    const mainContent = $("main, article, .content, .post, #content").text().trim();
    const bodyText = mainContent || $("body").text().trim();

    // Limpiar espacios múltiples
    const cleanText = bodyText.replace(/\s+/g, " ").trim();

    console.log(`[Web] Extraídos ${cleanText.length} caracteres de "${title}"`);
    return `\n--- CONTENIDO DE "${title}" (${url}) ---\n${cleanText.substring(0, 15000)}\n---\n`;
  } catch (error) {
    console.error(`[Web] Error procesando ${url}:`, error);
    return `\nReferencia web: ${url} (error al procesar)\n`;
  }
}

/** Función principal: procesa todas las fuentes y devuelve contexto + archivos para Gemini */
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

          // Guardar temporalmente y subir a Gemini
          const tempFilePath = path.join(os.tmpdir(), `learnfactory_drive_${fileId}.pdf`);
          fs.writeFileSync(tempFilePath, buffer);

          console.log(`[Drive] Subiendo a Gemini File API...`);
          const uploadResult = await fileManager.uploadFile(tempFilePath, {
            mimeType: "application/pdf",
            displayName: `Drive_${fileId}.pdf`,
          });

          // Esperar a que Gemini procese el archivo
          await waitForFileProcessing(uploadResult.file.name);

          geminiFiles.push({
            mimeType: uploadResult.file.mimeType,
            uri: uploadResult.file.uri,
          });
          console.log(`[Drive] ✓ Archivo listo en Gemini: ${uploadResult.file.uri}`);

          // Limpiar archivo temporal
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
//  GENERAR STUDY PACK (Síntesis Maestra + Árbol)
// ──────────────────────────────────────────────────

export async function generateStudyPack(topic: string, sourcesStr: string = ""): Promise<StudyPack> {
  if (!apiKey) {
    console.log("No GEMINI_API_KEY found. Returning mock study pack.");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return generateMockStudyPack(topic);
  }

  try {
    const model = getJsonModel();

    // Procesar las fuentes reales
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

    // Construir las partes del mensaje correctamente para el SDK
    const parts: Part[] = [];

    // Primero los archivos (si hay)
    for (const file of processed.files) {
      parts.push({
        fileData: {
          mimeType: file.mimeType,
          fileUri: file.uri,
        }
      });
    }

    // Luego el prompt textual
    parts.push({ text: promptText });

    console.log(`[StudyPack] Generando con ${processed.files.length} archivo(s) y ${processed.textContext.length} chars de contexto...`);
    const result = await model.generateContent(parts);
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
//  GENERAR MICROLECCIÓN (grounded en la síntesis)
// ──────────────────────────────────────────────────

export async function generateMicroLesson(
  topic: string,
  nodeTitle: string,
  nodeType: NodeType = "theory",
  sintesis: Sintesis | null = null,
  conceptIds: string[] = [],
  studiedConceptIds: string[] = []
): Promise<MicroLessonData> {
  if (!apiKey || !sintesis) {
    console.log("No GEMINI_API_KEY or no sintesis. Returning mock lesson data.");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return generateMockLesson(topic, nodeTitle, studiedConceptIds);
  }

  try {
    const model = getJsonModel();

    const practiceInstruction = nodeType === "practice"
      ? `\nEsta es una lección de PRÁCTICA: el paso "theory" debe presentar un caso o escenario concreto donde se aplique el concepto (no solo definirlo), y el paso "quiz" debe ser de nivel de APLICACIÓN (resolver una situación), no de simple recuerdo.`
      : "";

    const recapInstruction = studiedConceptIds.length
      ? `2. { "kind": "recap", "emoji": "🧠", "title": "Anteriormente...", "text": "Conecta lo que ya aprendió (conceptos: ${studiedConceptIds.join(", ")}) con lo que viene en esta lección" }`
      : `(NO incluyas tarjeta "recap": el estudiante aún no ha completado ninguna lección)`;

    const prompt = `
Actúa como tutor experto en la academia "LearnFactory".
${sintesisBlock(sintesis)}

Conceptos focales de esta lección: ${conceptIds.length ? conceptIds.join(", ") : "los más relevantes al subtema"}

Crea una microlección sobre "${nodeTitle}" (tema general: "${topic}").${practiceInstruction}

La lección tiene DOS partes:

PARTE A — "briefing": 4-6 tarjetas estilo "stories" que dan contexto ANTES de la lección a alguien que llega desde cero. Reglas del briefing:
- Una sola idea por tarjeta. El campo "text" de cada tarjeta NO debe superar 280 caracteres.
- Tono cercano, chispeante y en segunda persona ("¿Sabías que...?", "Imagina que..."). Nada de muros de texto.
- Fiel a la síntesis: nada inventado.
- Orden y tipos de tarjeta:
1. { "kind": "hook", "emoji": "🤔", "title": "...", "text": "Un dato sorprendente o pregunta intrigante DEL MATERIAL que despierte curiosidad" }
${recapInstruction}
3. { "kind": "context", "emoji": "🗺️", "title": "El panorama", "text": "Dónde encaja esta lección dentro de la tesis global del material, como si señalaras un punto en un mapa" }
4. { "kind": "vocab", "emoji": "📖", "title": "Palabras clave", "terms": [{ "termino": "...", "definicion": "una línea" }] } (2-3 términos que aparecerán en la lección)
5. { "kind": "predict", "emoji": "🔮", "title": "Tu predicción", "question": "Pregunta que invite a apostar una respuesta ANTES de aprender", "options": ["2-3 opciones plausibles"], "correctIndex": 0, "reveal": "Revela la respuesta en 1-2 oraciones que generen ganas de seguir, SIN destripar toda la lección" }

PARTE B — "steps": exactamente estos 5 pasos:
1. { "type": "theory", "title": "...", "content": "Explicación fiel a la síntesis (máx 3 oraciones)", "cita": "Cita textual de la síntesis que la respalda" }
2. { "type": "analogy", "title": "Analogía", "content": "Una analogía muy creativa para recordarlo, que NO distorsione el significado original" }
3. { "type": "elaboration", "title": "Conéctalo", "prompt": "Pregunta de elaboración: pide al usuario conectar este concepto con la tesis global o con un concepto ya visto, en sus propias palabras", "conceptContext": "Resumen de 2-3 oraciones de los conceptos relevantes para evaluar la respuesta" }
4. { "type": "debate", "title": "Pregunta Socrática", "prompt": "Pregunta retadora basada en la síntesis", "conceptContext": "Resumen de 2-3 oraciones de los conceptos relevantes para evaluar la respuesta" }
5. { "type": "quiz", "title": "Comprueba tu comprensión", "question": "...", "options": ["A", "B", "C", "D"], "correctAnswer": 0, "explicacion": "Por qué es correcta, apoyándote en la síntesis", "conceptId": "id del concepto focal evaluado" }

Devuelve SOLO este JSON, sin texto adicional ni markdown:
{ "briefing": [...], "steps": [...] }
`;

    const result = await model.generateContent(prompt);
    const parsed = parseJsonResponse(result.response.text());
    if (!Array.isArray(parsed?.briefing) || !Array.isArray(parsed?.steps) || parsed.steps.length === 0) {
      throw new Error("La lección no tiene la estructura {briefing, steps} esperada.");
    }
    return parsed as MicroLessonData;
  } catch (error) {
    console.error("[MicroLesson] Error:", error);
    return generateMockLesson(topic, nodeTitle, studiedConceptIds);
  }
}

// ──────────────────────────────────────────────────
//  EVALUAR RESPUESTA SOCRÁTICA / DE ELABORACIÓN
// ──────────────────────────────────────────────────

export async function evaluateSocraticAnswer(
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
(puntuacion: 0 = no responde la pregunta, 1 = comprensión parcial, 2 = comprensión sólida, 3 = excelente con razonamiento propio)
`;

    const result = await model.generateContent(prompt);
    const parsed = parseJsonResponse(result.response.text());
    return {
      puntuacion: Math.max(0, Math.min(3, Number(parsed.puntuacion) || 0)),
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
//  DEBATE MULTI-TURNO CON LA IA
// ──────────────────────────────────────────────────

export async function debateTurn(
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
("feedbackFinal" SOLO cuando esCierre es true; omítelo en los demás turnos. puntuacion: 0-3 según la calidad argumentativa global del estudiante.)
`;

    const result = await model.generateContent(prompt);
    const parsed = parseJsonResponse(result.response.text());
    return {
      mensajeIA: parsed.mensajeIA || "",
      esCierre: Boolean(parsed.esCierre),
      feedbackFinal: parsed.feedbackFinal
        ? {
            puntuacion: Math.max(0, Math.min(3, Number(parsed.feedbackFinal.puntuacion) || 0)),
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
//  QUIZ ACUMULATIVO (retrieval practice + interleaving)
// ──────────────────────────────────────────────────

export async function generateQuizNode(
  topic: string,
  sintesis: Sintesis,
  focalConceptIds: string[],
  reviewConceptIds: string[] = [],
  reviewMode: boolean = false
): Promise<QuizNodeData> {
  if (!apiKey) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return generateMockQuizNode(topic, focalConceptIds);
  }

  try {
    const model = getJsonModel();

    const composition = reviewMode
      ? `Genera exactamente 4 preguntas de REPASO sobre estos conceptos ya estudiados: ${focalConceptIds.join(", ")}.`
      : `Genera exactamente 6 preguntas: 4 sobre los conceptos focales (${focalConceptIds.join(", ") || "los principales"}) y 2 de repaso sobre conceptos ya estudiados (${reviewConceptIds.join(", ") || "cualquier otro concepto de la síntesis"}). Intercala las de repaso, no las pongas al final.`;

    const prompt = `
Actúa como diseñador de evaluaciones en la academia "LearnFactory".
${sintesisBlock(sintesis)}

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

    const result = await model.generateContent(prompt);
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

export async function generateBossExam(topic: string, sintesis: Sintesis): Promise<BossExamData> {
  if (!apiKey) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return generateMockBossExam(topic);
  }

  try {
    const model = getJsonModel();

    const prompt = `
Actúa como diseñador del examen final ("Boss Battle") de la academia "LearnFactory".
${sintesisBlock(sintesis)}

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

    const result = await model.generateContent(prompt);
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

function generateMockLesson(topic: string, nodeTitle: string, studiedConceptIds: string[] = []): MicroLessonData {
  const briefing: MicroLessonData["briefing"] = [
    {
      kind: "hook",
      emoji: "🤔",
      title: "¿Sabías que...?",
      text: `La mayoría de la gente cree dominar ${topic}... hasta que alguien le pide explicar ${nodeTitle} con sus propias palabras.`,
    },
    ...(studiedConceptIds.length
      ? [{
          kind: "recap" as const,
          emoji: "🧠",
          title: "Anteriormente...",
          text: `Ya viste los fundamentos de ${topic}. Hoy vas a conectarlos con ${nodeTitle}: todo lo que aprendiste cobra sentido aquí.`,
        }]
      : []),
    {
      kind: "context",
      emoji: "🗺️",
      title: "El panorama",
      text: `${nodeTitle} es una pieza central del argumento completo de ${topic}: sin ella, el resto del material se queda cojo.`,
    },
    {
      kind: "vocab",
      emoji: "📖",
      title: "Palabras clave",
      terms: [
        { termino: "Fundamento", definicion: "El principio base sobre el que se construye todo lo demás." },
        { termino: "Contexto", definicion: "El argumento completo que da sentido a cada fragmento." },
      ],
    },
    {
      kind: "predict",
      emoji: "🔮",
      title: "Tu predicción",
      question: `¿Qué crees que pasa si estudias ${nodeTitle} solo con fragmentos sueltos?`,
      options: ["Aprendo más rápido", "Puedo llegar a conclusiones erróneas"],
      correctIndex: 1,
      reveal: "Exacto: un fragmento aislado puede decir lo contrario que el texto completo. En esta lección verás cómo evitarlo.",
    },
  ];

  const steps: LessonStep[] = [
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

  return { briefing, steps };
}

function generateMockEvaluation(): SocraticEvaluation {
  return {
    puntuacion: 2,
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
      puntuacion: 2,
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
