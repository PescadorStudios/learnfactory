// ──────────────────────────────────────────────────
//  Marco compartido de páginas legales (Términos, Privacidad).
//  Contenido placeholder (lorem ipsum) hasta tener los textos definitivos.
//  Server component: estático, sin sesión, bueno para SEO.
// ──────────────────────────────────────────────────

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/Logo";

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export default function LegalShell({
  title,
  updated,
  sections,
}: {
  title: string;
  updated: string;
  sections: LegalSection[];
}) {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-50">
      <header className="border-b border-zinc-800/70 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center" aria-label="Inicio">
            <Logo className="h-7" />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Volver al inicio
          </Link>
        </div>
      </header>

      <article className="max-w-3xl mx-auto px-4 py-14 md:py-20">
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight mb-3">{title}</h1>
        <p className="text-sm text-zinc-500 mb-12">Última actualización: {updated}</p>

        <div className="space-y-10">
          {sections.map((s, i) => (
            <section key={i}>
              <h2 className="text-xl md:text-2xl font-bold text-white mb-3">
                {i + 1}. {s.heading}
              </h2>
              {s.paragraphs.map((p, j) => (
                <p key={j} className="text-zinc-400 leading-relaxed mb-3">
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>

        <div className="mt-16 pt-8 border-t border-zinc-800/60 text-sm text-zinc-500">
          <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300/90 px-3 py-1.5 text-xs font-semibold">
            Documento provisional · contenido de marcador (lorem ipsum)
          </span>
        </div>
      </article>
    </main>
  );
}
