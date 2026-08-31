"use client";

// Importar un documento. Dos caminos: pegar el texto (lo más rápido y lo que el
// modo espera por defecto) o soltar un PDF.
//
// El PDF NUNCA se sube: se abre aquí, en el navegador, se le saca el texto y
// solo viaja el texto. Ninguna IA lo toca — la extracción es pdf.js puro, coste
// cero — y el archivo original no llega a existir en ningún servidor.
//
// La previsualización es OBLIGATORIA y no es decorativa: un PDF a dos columnas
// sale con el orden de lectura destrozado y no hay arreglo barato. Ver los
// primeros párrafos es lo que evita que alguien empiece un libro ilegible.

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { FileText, Loader2, Upload, X, ClipboardPaste, AlertTriangle } from "lucide-react";
import { MAX_DOC_CHARS, MAX_PART_CHARS, MAX_PDF_BYTES, looksLikeScannedPdf, normalizeText, tokenizeWords } from "@/lib/rsvp";
import {
  appendReadingDoc,
  cancelReadingImport,
  createReadingDoc,
  finishReadingDoc,
} from "@/app/velozActions";

type Tab = "pegar" | "pdf";

const PREVIEW_CHARS = 600;

export default function ImportDialog({
  token,
  onClose,
  onImported,
}: {
  token: string;
  onClose: () => void;
  onImported: (docId: string, duplicated: boolean) => void;
}) {
  const [tab, setTab] = useState<Tab>("pegar");
  const [raw, setRaw] = useState("");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [filename, setFilename] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const text = normalizeText(raw);
  const words = text ? tokenizeWords(text).length : 0;
  const tooBig = text.length > MAX_DOC_CHARS;

  async function pickFile(file: File) {
    setError(null);
    if (file.size > MAX_PDF_BYTES) {
      setError(`El archivo pesa ${(file.size / 1024 / 1024).toFixed(0)} MB. El máximo son 25 MB.`);
      return;
    }
    setExtracting(true);
    setFilename(file.name);
    try {
      // Import perezoso: pdf.js son ~1,6 MB. Quien solo pega texto no los baja.
      const { extractPdfText } = await import("@/lib/pdfText");
      const buf = new Uint8Array(await file.arrayBuffer());
      const out = await extractPdfText(buf);
      if (looksLikeScannedPdf(out)) {
        setError(
          "Este PDF parece escaneado: no tiene texto que copiar, solo imágenes de páginas. Abre el archivo, copia el texto y pégalo en la otra pestaña."
        );
        setRaw("");
      } else {
        setRaw(out);
        if (!title) setTitle(file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim());
      }
    } catch {
      setError("No se pudo leer el PDF. Prueba a copiar el texto y pegarlo.");
    } finally {
      setExtracting(false);
    }
  }

  async function save() {
    if (!text || tooBig || saving !== null) return;
    setError(null);
    setSaving(0);

    const created = await createReadingDoc(token, {
      title: title.trim() || filename?.replace(/\.pdf$/i, "") || "Documento sin título",
      author,
      source: tab === "pdf" ? "pdf" : "pegado",
      filename: filename ?? undefined,
    });
    if (!created.ok || !created.docId) {
      setError(created.error ?? "No se pudo crear el documento.");
      setSaving(null);
      return;
    }

    // Por partes: un libro no cabe en un solo server action.
    const parts = Math.ceil(text.length / MAX_PART_CHARS);
    for (let p = 0; p < parts; p++) {
      const slice = text.slice(p * MAX_PART_CHARS, (p + 1) * MAX_PART_CHARS);
      const r = await appendReadingDoc(token, created.docId, p, slice);
      if (!r.ok) {
        setError(r.error ?? "Se cortó la subida.");
        await cancelReadingImport(token, created.docId);
        setSaving(null);
        return;
      }
      setSaving(Math.round(((p + 1) / parts) * 100));
    }

    const done = await finishReadingDoc(token, created.docId);
    setSaving(null);
    if (!done.ok || !done.docId) {
      setError(done.error ?? "No se pudo guardar el documento.");
      return;
    }
    onImported(done.docId, Boolean(done.duplicated));
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-3xl p-6 my-8"
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-xl font-bold text-white">Nuevo documento</h2>
            <p className="text-sm text-zinc-500 mt-1">
              Solo tú puedes verlo. No se comparte, no aparece en la biblioteca pública y
              no pasa por ninguna IA.
            </p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-zinc-500 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          {([
            ["pegar", "Pegar texto", ClipboardPaste],
            ["pdf", "Subir PDF", Upload],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-colors ${
                tab === id
                  ? "bg-emerald-500/15 border border-emerald-400/50 text-emerald-300"
                  : "bg-zinc-800/60 border border-zinc-800 text-zinc-400 hover:text-white"
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>

        {tab === "pegar" ? (
          <textarea
            value={raw}
            onChange={e => setRaw(e.target.value)}
            placeholder="Pega aquí el texto copiado del libro o del PDF…"
            rows={8}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl p-4 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-400/60 resize-y"
          />
        ) : (
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) pickFile(f);
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={extracting}
              className="w-full border border-dashed border-zinc-700 hover:border-emerald-400/60 rounded-2xl py-10 flex flex-col items-center gap-2 text-zinc-400 hover:text-emerald-300 transition-colors disabled:opacity-60"
            >
              {extracting ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="text-sm font-bold">Leyendo el PDF en tu navegador…</span>
                  <span className="text-xs text-zinc-600">
                    Un libro largo puede tardar unos segundos. No cierres la pestaña.
                  </span>
                </>
              ) : (
                <>
                  <FileText className="w-6 h-6" />
                  <span className="text-sm font-bold">{filename ?? "Elegir un PDF"}</span>
                  <span className="text-xs text-zinc-600">
                    El archivo no se sube: se lee aquí y solo se guarda el texto.
                  </span>
                </>
              )}
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 flex gap-2 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Previsualización: la única forma barata de detectar un PDF a dos
            columnas antes de empezar a leerlo. */}
        {text && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                Así se va a leer
              </span>
              <span className="text-xs text-zinc-500">
                {words.toLocaleString("es")} palabras · ~{Math.ceil(words / 300)} min a 300 ppm
              </span>
            </div>
            <p className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 text-sm text-zinc-400 leading-relaxed max-h-32 overflow-y-auto whitespace-pre-wrap">
              {text.slice(0, PREVIEW_CHARS)}
              {text.length > PREVIEW_CHARS ? "…" : ""}
            </p>
            <p className="text-xs text-zinc-600 mt-2">
              ¿Sale desordenado o con palabras pegadas? Suele pasar con los PDF a dos
              columnas: copia el texto a mano y pégalo en la otra pestaña.
            </p>
          </div>
        )}

        {tooBig && (
          <p className="mt-3 text-sm text-amber-300">
            Este documento es demasiado grande ({words.toLocaleString("es")} palabras).
            Divídelo por capítulos.
          </p>
        )}

        <div className="grid sm:grid-cols-2 gap-3 mt-5">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Título"
            className="bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-emerald-400/60"
          />
          <input
            value={author}
            onChange={e => setAuthor(e.target.value)}
            placeholder="Autor (opcional)"
            className="bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-emerald-400/60"
          />
        </div>

        <div className="flex items-center justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-5 py-3 text-sm font-bold text-zinc-400 hover:text-white">
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={!text || tooBig || saving !== null || extracting}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:hover:bg-emerald-500 text-emerald-950 rounded-2xl px-6 py-3 text-sm font-bold transition-colors"
          >
            {saving !== null ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Guardando {saving}%
              </>
            ) : (
              "Guardar y leer"
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
