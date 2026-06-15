"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck, ArrowLeft } from "lucide-react";

interface HashResponse {
  orderId: string;
  amount: number;
  currency: string;
  apiKey: string;
  integritySignature: string;
}

type Region = "CO" | "INTL";

const REGIONS: { id: Region; flag: string; label: string; price: string }[] = [
  { id: "CO", flag: "🇨🇴", label: "En Colombia", price: "$23.900 COP" },
  { id: "INTL", flag: "🌎", label: "Fuera de Colombia", price: "USD 7" },
];

/**
 * Botón de pago de Bold para el plan Premium. Pide la firma de integridad al
 * servidor y monta el botón embebido de Bold. Tras pagar, Bold redirige a
 * /premium/gracias, que confirma el plan vía webhook.
 */
export default function PremiumCheckout({ token, email }: { token: string; email?: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [data, setData] = useState<HashResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!region) return;
    let active = true;
    setData(null);
    setError(null);
    setLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/bold/generate-hash", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, region }),
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
  }, [token, region]);

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
    script.setAttribute("data-description", "LearnFactory Premium");
    script.setAttribute("data-redirection-url", `${window.location.origin}/premium/gracias?order=${data.orderId}`);
    if (email) script.setAttribute("data-customer-data", JSON.stringify({ email }));
    script.setAttribute("data-render-mode", "embedded");
    container.appendChild(script);
  }, [data, email]);

  // Paso 1: elegir el país (define la divisa: COP o USD).
  if (!region) {
    return (
      <div className="space-y-3">
        {REGIONS.map(r => (
          <button
            key={r.id}
            onClick={() => setRegion(r.id)}
            className="w-full flex items-center justify-between gap-3 rounded-2xl border border-zinc-700 bg-zinc-800/50 px-5 py-4 text-left transition-colors hover:border-amber-500/50 hover:bg-zinc-800"
          >
            <span className="flex items-center gap-3">
              <span className="text-2xl">{r.flag}</span>
              <span className="font-semibold text-white">{r.label}</span>
            </span>
            <span className="font-bold text-amber-400">{r.price}</span>
          </button>
        ))}
        <p className="flex items-center justify-center gap-1.5 text-xs text-zinc-500 pt-1">
          <ShieldCheck className="w-3.5 h-3.5" /> Pago protegido por Bold
        </p>
      </div>
    );
  }

  const changeCountry = (
    <button
      onClick={() => setRegion(null)}
      className="flex items-center justify-center gap-1.5 w-full text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
    >
      <ArrowLeft className="w-3.5 h-3.5" /> Cambiar país
    </button>
  );

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-center gap-2 text-zinc-400 py-6">
          <Loader2 className="w-5 h-5 animate-spin" /> Preparando el pago seguro...
        </div>
        {changeCountry}
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3 text-center py-2">
        <p className="text-rose-400 text-sm">{error}</p>
        {changeCountry}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div ref={containerRef} className="flex justify-center min-h-[56px]" />
      {data && (
        <a
          href={`https://checkout.bold.co/?order-id=${data.orderId}&amount=${data.amount}&currency=${data.currency}&api-key=${data.apiKey}&integrity-signature=${data.integritySignature}&description=LearnFactory%20Premium&redirection-url=${encodeURIComponent(`${typeof window !== "undefined" ? window.location.origin : ""}/premium/gracias?order=${data.orderId}`)}`}
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
      {changeCountry}
    </div>
  );
}
