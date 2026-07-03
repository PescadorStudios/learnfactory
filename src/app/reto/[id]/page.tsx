import type { Metadata } from "next";
import { getRetoPublic } from "@/app/retoActions";
import RetoPublicClient from "./RetoPublicClient";

/**
 * Ficha pública de un reto — server component para que los links compartidos
 * (WhatsApp, X, historias) muestren la imagen y descripción del reto (OG).
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const reto = await getRetoPublic(null, id);
  if (!reto) return { title: "Reto no encontrado — Learn Factory" };

  const title = `Reto: ${reto.titulo} — Learn Factory`;
  const description =
    reto.descripcion?.slice(0, 200) ||
    "Completa la ruta con verificación de atención, gana premios reales y quédate con la ruta para siempre.";
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      ...(reto.imagenUrl ? { images: [{ url: reto.imagenUrl }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(reto.imagenUrl ? { images: [reto.imagenUrl] } : {}),
    },
  };
}

export default async function RetoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RetoPublicClient retoId={id} />;
}
