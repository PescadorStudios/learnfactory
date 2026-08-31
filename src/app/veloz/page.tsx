"use client";

// Modo Lectura Veloz. Misma estructura que src/app/podcast/page.tsx:
// auth → muro → lector a pantalla completa → si no, cabecera + medidor + lobby.
//
// El muro se comprueba ANTES de abrir el documento, para que el lector nunca
// arranque ya bloqueado (su comprobación interna es solo para el bloqueo a media
// lectura). El `?doc=` obliga a useSearchParams, y eso obliga al <Suspense>.

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useRequireAuth } from "@/lib/useAuth";
import { useSessionGate } from "@/lib/useSessionGate";
import SessionLockScreen from "@/components/gate/SessionLockScreen";
import SessionMeter from "@/components/gate/SessionMeter";
import AppHeader from "@/components/AppHeader";
import type { ReadingDoc, ReadingDocSummary, ReadingPrefs } from "@/lib/types";
import {
  deleteReadingDoc,
  getReadingDoc,
  getReadingPrefs,
  listReadingDocs,
  renameReadingDoc,
} from "@/app/velozActions";
import VelozLobby from "./VelozLobby";
import VelozReader, { cursorKey } from "./VelozReader";
import ImportDialog from "./ImportDialog";

function Loader() {
  return (
    <main className="min-h-[100dvh] bg-[#040a08] flex items-center justify-center">
      <Loader2 className="w-10 h-10 text-emerald-400 animate-spin" />
    </main>
  );
}

function VelozInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { token, loading, session } = useRequireAuth();
  const gate = useSessionGate(token);

  const [docs, setDocs] = useState<ReadingDocSummary[] | null>(null);
  const [prefs, setPrefs] = useState<ReadingPrefs | null>(null);
  const [open, setOpen] = useState<ReadingDoc | null>(null);
  const [startWord, setStartWord] = useState(0);
  const [opening, setOpening] = useState(false);
  const [importing, setImporting] = useState(false);

  const refresh = useCallback(() => {
    if (token) listReadingDocs(token).then(setDocs);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    listReadingDocs(token).then(setDocs);
    getReadingPrefs(token).then(setPrefs);
  }, [token]);

  /**
   * Punto de partida: gana el cursor MÁS AVANZADO entre el servidor y el espejo
   * local. El espejo cubre el hueco entre dos guardados (cerrar la pestaña de
   * golpe); si no hay storage —modo privado, datos borrados— manda el servidor.
   * Se resuelve aquí, en un manejador, y no dentro del lector: leer localStorage
   * durante el render rompería la hidratación.
   */
  const resolveStart = useCallback((d: ReadingDoc) => {
    let start = d.cursorWord ?? 0;
    try {
      const local = Number(localStorage.getItem(cursorKey(d.id)));
      if (Number.isFinite(local)) start = Math.max(start, local);
    } catch {
      /* sin storage: el servidor es la fuente de verdad */
    }
    // Terminado → volver a empezar en vez de dejarlo en la última palabra.
    return start >= d.wordCount - 1 ? 0 : start;
  }, []);

  const openDoc = useCallback(
    async (docId: string) => {
      if (!token) return;
      setOpening(true);
      const d = await getReadingDoc(token, docId);
      setOpening(false);
      if (d) {
        setStartWord(resolveStart(d));
        setOpen(d);
      }
    },
    [resolveStart, token]
  );

  // Deep link (?doc=): también es el enlace del correo de desbloqueo.
  const deepLink = params.get("doc");
  useEffect(() => {
    if (!deepLink || !token) return;
    let alive = true;
    getReadingDoc(token, deepLink).then(d => {
      if (!alive || !d) return;
      setStartWord(resolveStart(d));
      setOpen(d);
    });
    return () => {
      alive = false;
    };
  }, [deepLink, resolveStart, token]);

  if (loading || !session) return <Loader />;

  // Muro ANTES de abrir nada.
  if (gate.state?.walled) {
    return <SessionLockScreen gate={gate.state} onElapsed={gate.refresh} />;
  }

  if (open && prefs) {
    return (
      <VelozReader
        key={open.id}
        doc={open}
        prefs={prefs}
        initialWord={startWord}
        token={token ?? ""}
        gate={gate}
        onExit={() => {
          setOpen(null);
          refresh();
          if (deepLink) router.replace("/veloz");
        }}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#040a08] text-white">
      <AppHeader />
      {gate.state && !gate.state.unlimited && (
        <div className="max-w-5xl mx-auto px-6 pt-4 flex justify-end">
          <SessionMeter gate={gate.state} />
        </div>
      )}

      {docs === null || opening ? (
        <div className="flex items-center justify-center gap-2 text-zinc-500 py-32">
          <Loader2 className="w-5 h-5 animate-spin" />
          {opening ? "Abriendo el documento..." : "Cargando tu biblioteca..."}
        </div>
      ) : (
        <VelozLobby
          docs={docs}
          wpm={prefs?.wpm ?? 300}
          onOpen={openDoc}
          onImport={() => setImporting(true)}
          onRename={(id, title) => {
            setDocs(list => list?.map(d => (d.id === id ? { ...d, title } : d)) ?? null);
            if (token) void renameReadingDoc(token, id, title);
          }}
          onDelete={id => {
            setDocs(list => list?.filter(d => d.id !== id) ?? null);
            if (token) void deleteReadingDoc(token, id);
          }}
        />
      )}

      {importing && token && (
        <ImportDialog
          token={token}
          onClose={() => setImporting(false)}
          onImported={docId => {
            setImporting(false);
            refresh();
            void openDoc(docId);
          }}
        />
      )}
    </main>
  );
}

export default function VelozPage() {
  return (
    <Suspense fallback={<Loader />}>
      <VelozInner />
    </Suspense>
  );
}
