"use server";

// ──────────────────────────────────────────────────
//  Modo Lectura Veloz — server actions
// ──────────────────────────────────────────────────
// Patrón del proyecto: el token va como primer argumento, se resuelve el usuario
// y se trabaja con el service role.
//
// OJO 1: aquí NO puede haber `export type { ... }`. Next intenta registrar CADA
// export de un archivo "use server" como server action, y al re-exportar un tipo
// importado emite una referencia en tiempo de ejecución a algo que no existe
// como valor → ReferenceError que tumba las acciones de la petición. Los tipos
// viven en @/lib/types. `next build` NO lo detecta. (Ver src/app/gateActions.ts.)
//
// OJO 2: el service role SALTA RLS, así que `.eq("owner_id", user.id)` en TODA
// consulta es la única barrera de autorización real. Nunca `.eq("id", docId)` a
// secas. Estos documentos son libros privados de cada cuenta: una consulta sin
// esa cláusula sería una fuga, no un bug de UI.

import { createHash } from "crypto";
import { supabaseAdmin, getUserFromToken } from "@/lib/supabase/admin";
import { consumeStudyUnit } from "@/lib/sessionGate";
import {
  MAX_DOC_CHARS,
  MAX_PART_CHARS,
  normalizeText,
  tokenizeWords,
} from "@/lib/rsvp";
import type {
  GateState,
  ImportDocResult,
  ReadingDoc,
  ReadingDocSummary,
  ReadingPrefs,
} from "@/lib/types";

/** Tope por guardado de progreso: ~10 min. Evita inflar el contador. */
const MAX_SECONDS_DELTA = 600;

const DEFAULT_PREFS: ReadingPrefs = {
  wpm: 300,
  chunkSize: 1,
  fontSize: 48,
  dynamicPauses: true,
  longWordBoost: true,
  highlightStyle: "rojo",
  breakMinutes: 20,
  warningAckAt: null,
};

interface DocRow {
  id: string;
  title: string;
  author: string | null;
  source: string;
  word_count: number | null;
  cursor_word: number | null;
  seconds_read: number | null;
  last_read_at: string | null;
  completed_at: string | null;
  created_at: string;
  content?: string;
}

const SUMMARY_COLS =
  "id, title, author, source, word_count, cursor_word, seconds_read, last_read_at, completed_at, created_at";

function toSummary(r: DocRow): ReadingDocSummary {
  return {
    id: r.id,
    title: r.title,
    author: r.author,
    source: r.source === "pdf" ? "pdf" : "pegado",
    wordCount: r.word_count ?? 0,
    cursorWord: r.cursor_word ?? 0,
    secondsRead: r.seconds_read ?? 0,
    lastReadAt: r.last_read_at,
    completedAt: r.completed_at,
    createdAt: r.created_at,
  };
}

function cleanTitle(raw: string): string {
  return (raw || "").replace(/\s+/g, " ").trim().slice(0, 200) || "Sin título";
}

// ── Biblioteca ──────────────────────────────────────────────────────────────

/** Biblioteca privada del usuario. Sin el texto: solo metadatos y progreso. */
export async function listReadingDocs(token: string): Promise<ReadingDocSummary[]> {
  const user = await getUserFromToken(token);
  if (!user) return [];

  const { data, error } = await supabaseAdmin()
    .from("reading_docs")
    .select(SUMMARY_COLS)
    .eq("owner_id", user.id)
    .eq("import_status", "ready")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    console.warn("[veloz] no se pudo listar la biblioteca:", error.message);
    return [];
  }
  return ((data as DocRow[]) ?? []).map(toSummary);
}

/** El documento completo para arrancar el lector. null si no es suyo. */
export async function getReadingDoc(token: string, docId: string): Promise<ReadingDoc | null> {
  const user = await getUserFromToken(token);
  if (!user || !docId) return null;

  const { data, error } = await supabaseAdmin()
    .from("reading_docs")
    .select(`${SUMMARY_COLS}, content`)
    .eq("id", docId)
    .eq("owner_id", user.id)
    .eq("import_status", "ready")
    .maybeSingle();

  if (error || !data) return null;
  const row = data as DocRow;
  return { ...toSummary(row), content: row.content ?? "" };
}

// ── Importación (por partes) ────────────────────────────────────────────────

/**
 * Abre una importación y devuelve el id al que enviar las partes.
 *
 * Se sube por partes porque un libro no cabe en un solo server action: Vercel
 * corta el cuerpo de una función serverless en ~4.5 MB, muy por debajo del
 * bodySizeLimit de 12 mb que declara next.config.ts.
 */
export async function createReadingDoc(
  token: string,
  meta: { title: string; author?: string; source: "pegado" | "pdf"; filename?: string }
): Promise<{ ok: boolean; docId?: string; error?: string }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false, error: "Inicia sesión para guardar documentos." };

  const { data, error } = await supabaseAdmin()
    .from("reading_docs")
    .insert({
      owner_id: user.id,
      title: cleanTitle(meta.title),
      author: meta.author?.trim() ? meta.author.trim().slice(0, 200) : null,
      source: meta.source === "pdf" ? "pdf" : "pegado",
      source_filename: meta.filename?.slice(0, 300) ?? null,
      import_status: "importing",
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[veloz] no se pudo crear el documento:", error?.message);
    return { ok: false, error: "No se pudo crear el documento." };
  }
  return { ok: true, docId: data.id as string };
}

/**
 * Añade una parte del texto.
 *
 * `partIndex` tiene que coincidir con `next_part`: así un reintento por red
 * caída no concatena la misma parte dos veces (y el documento no sale con un
 * capítulo repetido).
 */
export async function appendReadingDoc(
  token: string,
  docId: string,
  partIndex: number,
  text: string
): Promise<{ ok: boolean; nextPart?: number; error?: string }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false, error: "Sesión no válida." };
  if (text.length > MAX_PART_CHARS) return { ok: false, error: "Fragmento demasiado grande." };

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("reading_docs")
    .select("content, next_part, import_status")
    .eq("id", docId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (error || !data) return { ok: false, error: "Documento no encontrado." };
  if (data.import_status !== "importing") return { ok: false, error: "La importación ya se cerró." };

  const expected = (data.next_part as number) ?? 0;
  // Reintento de una parte ya aplicada: se acepta sin volver a concatenar.
  if (partIndex < expected) return { ok: true, nextPart: expected };
  if (partIndex > expected) return { ok: false, error: "Fragmento fuera de orden.", nextPart: expected };

  const content = ((data.content as string) ?? "") + text;
  if (content.length > MAX_DOC_CHARS) {
    return { ok: false, error: "El documento supera el tamaño máximo." };
  }

  const { error: e2 } = await sb
    .from("reading_docs")
    .update({ content, next_part: expected + 1, updated_at: new Date().toISOString() })
    .eq("id", docId)
    .eq("owner_id", user.id);

  if (e2) return { ok: false, error: "No se pudo guardar el fragmento." };
  return { ok: true, nextPart: expected + 1 };
}

/**
 * Cierra la importación: normaliza, cuenta palabras y calcula el hash.
 *
 * Si ese hash ya existe para este dueño, borra el documento recién creado y
 * devuelve el original: subir dos veces el mismo libro no debe llenar la
 * biblioteca de copias. La deduplicación es POR DUEÑO — cruzarla entre cuentas
 * revelaría qué lee otra gente.
 */
export async function finishReadingDoc(token: string, docId: string): Promise<ImportDocResult> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false, error: "Sesión no válida." };

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("reading_docs")
    .select("content")
    .eq("id", docId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (error || !data) return { ok: false, error: "Documento no encontrado." };

  const content = normalizeText((data.content as string) ?? "");
  const words = tokenizeWords(content).length;
  if (words === 0) {
    await sb.from("reading_docs").delete().eq("id", docId).eq("owner_id", user.id);
    return { ok: false, error: "El documento quedó vacío." };
  }

  const hash = createHash("sha256").update(content).digest("hex");
  const { data: dup } = await sb
    .from("reading_docs")
    .select("id")
    .eq("owner_id", user.id)
    .eq("content_hash", hash)
    .neq("id", docId)
    .maybeSingle();

  if (dup) {
    await sb.from("reading_docs").delete().eq("id", docId).eq("owner_id", user.id);
    return { ok: true, docId: dup.id as string, duplicated: true, words };
  }

  const { error: e2 } = await sb
    .from("reading_docs")
    .update({
      content,
      content_hash: hash,
      char_count: content.length,
      word_count: words,
      import_status: "ready",
      updated_at: new Date().toISOString(),
    })
    .eq("id", docId)
    .eq("owner_id", user.id);

  if (e2) {
    console.error("[veloz] no se pudo cerrar la importación:", e2.message);
    return { ok: false, error: "No se pudo guardar el documento." };
  }
  return { ok: true, docId, words };
}

/** Cancela una importación a medias (el usuario cerró el diálogo). */
export async function cancelReadingImport(token: string, docId: string): Promise<{ ok: boolean }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false };
  await supabaseAdmin()
    .from("reading_docs")
    .delete()
    .eq("id", docId)
    .eq("owner_id", user.id)
    .eq("import_status", "importing");
  return { ok: true };
}

// ── Progreso ────────────────────────────────────────────────────────────────

/**
 * Guarda el cursor y el tiempo leído. Se llama con throttle (~10 s) y al
 * ocultar la pestaña.
 *
 * `force` es para retroceder a mano: sin él, el cursor solo avanza, y así una
 * petición vieja que llega tarde no puede tirar del lector hacia atrás.
 */
export async function saveReadingProgress(
  token: string,
  docId: string,
  wordIndex: number,
  secondsDelta: number,
  force = false
): Promise<{ ok: boolean }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false };

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("reading_docs")
    .select("cursor_word, seconds_read, word_count")
    .eq("id", docId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!data) return { ok: false };

  const total = (data.word_count as number) ?? 0;
  const prev = (data.cursor_word as number) ?? 0;
  const next = Math.max(0, Math.min(total, Math.floor(wordIndex) || 0));
  const cursor = force ? next : Math.max(prev, next);
  const delta = Math.max(0, Math.min(MAX_SECONDS_DELTA, Math.round(secondsDelta) || 0));
  const now = new Date().toISOString();

  await sb
    .from("reading_docs")
    .update({
      cursor_word: cursor,
      seconds_read: ((data.seconds_read as number) ?? 0) + delta,
      last_read_at: now,
      completed_at: total > 0 && cursor >= total - 1 ? now : null,
      updated_at: now,
    })
    .eq("id", docId)
    .eq("owner_id", user.id);

  if (delta > 0) {
    // Espejo de podcast_seconds / scroll_seconds: contador global del perfil.
    const { data: p } = await sb
      .from("profiles")
      .select("reading_seconds, reading_words")
      .eq("id", user.id)
      .maybeSingle();
    await sb
      .from("profiles")
      .update({
        reading_seconds: ((p?.reading_seconds as number) ?? 0) + delta,
        reading_words: Math.max((p?.reading_words as number) ?? 0, 0) + Math.max(0, cursor - prev),
      })
      .eq("id", user.id);
  }

  return { ok: true };
}

/**
 * Cobra la sección de 900 palabras donde arranca la lectura.
 *
 * Espejo exacto de startPodcastEpisode: se cobra al EMPEZAR, no al terminar,
 * para que el muro aparezca antes de invertir tiempo. `itemKey` es
 * `docId:sección`, que es lo que hace idempotente volver a esa sección dentro de
 * la misma ventana. `routeId` va a null: un libro del usuario no es una ruta.
 */
export async function startReadingSection(
  token: string,
  docId: string,
  sectionIndex: number
): Promise<{ allowed: boolean; gate: GateState | null }> {
  const user = await getUserFromToken(token);
  if (!user) return { allowed: true, gate: null };

  const section = Math.max(0, Math.floor(sectionIndex) || 0);
  try {
    const r = await consumeStudyUnit(
      supabaseAdmin(),
      user.id,
      "lectura",
      `${docId}:${section}`,
      null
    );
    return { allowed: r.allowed, gate: r };
  } catch (e) {
    // Igual que en el Túnel: un fallo del muro no puede cortar la lectura.
    console.warn("[sessionGate] no se pudo cobrar la sección de lectura:", e);
    return { allowed: true, gate: null };
  }
}

// ── Preferencias ────────────────────────────────────────────────────────────

export async function getReadingPrefs(token: string): Promise<ReadingPrefs> {
  const user = await getUserFromToken(token);
  if (!user) return DEFAULT_PREFS;

  const { data } = await supabaseAdmin()
    .from("reading_prefs")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return DEFAULT_PREFS;

  return {
    wpm: (data.wpm as number) ?? DEFAULT_PREFS.wpm,
    chunkSize: (data.chunk_size as number) ?? DEFAULT_PREFS.chunkSize,
    fontSize: (data.font_size as number) ?? DEFAULT_PREFS.fontSize,
    dynamicPauses: (data.dynamic_pauses as boolean) ?? DEFAULT_PREFS.dynamicPauses,
    longWordBoost: (data.long_word_boost as boolean) ?? DEFAULT_PREFS.longWordBoost,
    highlightStyle: (data.highlight_style as ReadingPrefs["highlightStyle"]) ?? "rojo",
    breakMinutes: (data.break_minutes as number) ?? DEFAULT_PREFS.breakMinutes,
    warningAckAt: (data.warning_ack_at as string) ?? null,
  };
}

export async function saveReadingPrefs(
  token: string,
  prefs: Partial<ReadingPrefs>
): Promise<{ ok: boolean }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false };

  // Los checks de la tabla acotan igualmente; esto evita el viaje perdido.
  const row: Record<string, unknown> = { user_id: user.id, updated_at: new Date().toISOString() };
  const num = (v: unknown, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)));

  if (prefs.wpm !== undefined) row.wpm = num(prefs.wpm, 100, 1000);
  if (prefs.chunkSize !== undefined) row.chunk_size = num(prefs.chunkSize, 1, 4);
  if (prefs.fontSize !== undefined) row.font_size = num(prefs.fontSize, 24, 96);
  if (prefs.dynamicPauses !== undefined) row.dynamic_pauses = Boolean(prefs.dynamicPauses);
  if (prefs.longWordBoost !== undefined) row.long_word_boost = Boolean(prefs.longWordBoost);
  if (prefs.breakMinutes !== undefined) row.break_minutes = num(prefs.breakMinutes, 0, 120);
  if (prefs.highlightStyle && ["rojo", "subrayado", "negrita"].includes(prefs.highlightStyle)) {
    row.highlight_style = prefs.highlightStyle;
  }
  if (prefs.warningAckAt !== undefined) row.warning_ack_at = prefs.warningAckAt;

  const { error } = await supabaseAdmin()
    .from("reading_prefs")
    .upsert(row, { onConflict: "user_id" });
  if (error) {
    console.warn("[veloz] no se pudieron guardar las preferencias:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

// ── Gestión ─────────────────────────────────────────────────────────────────

export async function renameReadingDoc(
  token: string,
  docId: string,
  title: string
): Promise<{ ok: boolean }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false };
  const { error } = await supabaseAdmin()
    .from("reading_docs")
    .update({ title: cleanTitle(title), updated_at: new Date().toISOString() })
    .eq("id", docId)
    .eq("owner_id", user.id);
  return { ok: !error };
}

export async function deleteReadingDoc(token: string, docId: string): Promise<{ ok: boolean }> {
  const user = await getUserFromToken(token);
  if (!user) return { ok: false };
  const { error } = await supabaseAdmin()
    .from("reading_docs")
    .delete()
    .eq("id", docId)
    .eq("owner_id", user.id);
  return { ok: !error };
}
