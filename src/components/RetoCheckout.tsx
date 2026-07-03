"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

interface HashResponse {
  orderId: string;
  amount: number;
  currency: string;
  apiKey: string;
  integritySignature: string;
}

export interface RetoJoinMeta {
  consentContacto: boolean;
  alias: string;
  anonimo: boolean;
}

/**
 * Botón de pago de Bold para la ENTRADA a un reto. El precio y la moneda los
 * fija el reto en el servidor (sin selector de país). `meta` arrastra el
 * consentimiento/alias del formulario de inscripción: el webhook los aplica
 * al crear el participante. Tras pagar, Bold redirige a /reto/[id]/gracias.
 */
export default function RetoCheckout({
  token,
  retoId,
  retoTitulo,
  email,
  meta,
}: {
  token: string;
  retoId: string;
  retoTitulo: string;
  email?: string | null;
  meta: RetoJoinMeta;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<HashResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    setLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/bold/generate-hash", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, purpose: "reto", retoId, meta }),
        });
        const json = await res.json();
        if (!active) return;
        if (!res.ok) {
          setError(json.error || "No se pudo iniciar el pago.");
        } else {
          setData(json);
        }
      } catch {
        if (active) setError("No se pudo conectar con el servicio de pago.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // meta se captura al montar: el formulario se confirma ANTES de mostrar el botón.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, retoId]);

  useEffect(() => {
    if (!data || !containerRef.current) return;
    const container = containerRef.current;
    container.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://checkout.bold.co/library/boldPaymentButton.js";
    script.setAttribute("data-bold-button", "dark-L");
    script.setAttribute("data-order-id", data.orderId);
    script.setAttribute("data-currency", data.currency);
    script.setAttribute("data-amount", String(data.amount));
    script.setAttribute("data-api-key", data.apiKey);
    script.setAttribute("data-integrity-signature", data.integritySignature);
    script.setAttribute("data-description", `Reto: ${retoTitulo}`.slice(0, 100));
    script.setAttribute("data-redirection-url", `${window.location.origin}/reto/${retoId}/gracias?order=${data.orderId}`);
    if (email) script.setAttribute("data-customer-data", JSON.stringify({ email }));
    script.setAttribute("data-render-mode", "embedded");
    container.appendChild(script);
  }, [data, email, retoId, retoTitulo]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 text-zinc-400 py-6">
        <Loader2 className="w-5 h-5 animate-spin" /> Preparando el pago seguro...
      </div>
    );
  }

  if (error) {
    return <p className="text-rose-400 text-sm text-center py-2">{error}</p>;
  }

  return (
    <div className="space-y-3">
      <div ref={containerRef} className="flex justify-center min-h-[56px]" />
      {data && (
        <a
          href={`https://checkout.bold.co/?order-id=${data.orderId}&amount=${data.amount}&currency=${data.currency}&api-key=${data.apiKey}&integrity-signature=${data.integritySignature}&description=${encodeURIComponent(`Reto: ${retoTitulo}`.slice(0, 100))}&redirection-url=${encodeURIComponent(`${typeof window !== "undefined" ? window.location.origin : ""}/reto/${retoId}/gracias?order=${data.orderId}`)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          ¿El botón no carga? Abrir el pago en una pestaña nueva
        </a>
      )}
      <p className="flex items-center justify-center gap-1.5 text-xs text-zinc-500">
        <ShieldCheck className="w-3.5 h-3.5" /> Pago protegido por Bold
      </p>
    </div>
  );
}
