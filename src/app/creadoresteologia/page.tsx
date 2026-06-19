import type { Metadata } from "next";
import CreatorsLanding from "@/components/landing/CreatorsLanding";

export const metadata: Metadata = {
  title: "Para creadores · LearnFactory",
  description:
    "Convierte tu contenido en rutas que de verdad se estudian y se recuerdan. Tu primera ruta, gratis. Tu audiencia la estudia gratis, para siempre.",
};

export default function CreadoresTeologiaPage() {
  return <CreatorsLanding />;
}
