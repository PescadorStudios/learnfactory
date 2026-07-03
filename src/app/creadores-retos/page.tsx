import type { Metadata } from "next";
import RetosLanding from "@/components/landing/RetosLanding";

export const metadata: Metadata = {
  title: "Retos para creadores · Learn Factory",
  description:
    "Convierte tus videos en retos de aprendizaje verificado. Tu público aprende de verdad — y tú ganas el 80% de cada entrada. Nosotros lo montamos gratis; tú solo lo anuncias.",
};

export default function CreadoresRetosPage() {
  return <RetosLanding />;
}
