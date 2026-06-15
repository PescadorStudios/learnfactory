import type { Metadata } from "next";
import LegalShell, { type LegalSection } from "@/components/legal/LegalShell";

export const metadata: Metadata = {
  title: "Términos y condiciones · LearnFactory",
  description: "Términos y condiciones de uso de LearnFactory.",
};

const LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.";
const LOREM2 =
  "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.";

const SECTIONS: LegalSection[] = [
  { heading: "Aceptación de los términos", paragraphs: [LOREM, LOREM2] },
  { heading: "Uso de la plataforma", paragraphs: [LOREM] },
  { heading: "Cuentas de usuario", paragraphs: [LOREM2, LOREM] },
  { heading: "Contenido creado por usuarios", paragraphs: [LOREM] },
  { heading: "Propiedad intelectual", paragraphs: [LOREM2] },
  { heading: "Pagos y planes", paragraphs: [LOREM] },
  { heading: "Limitación de responsabilidad", paragraphs: [LOREM2, LOREM] },
  { heading: "Modificaciones", paragraphs: [LOREM] },
  { heading: "Contacto", paragraphs: [LOREM2] },
];

export default function TerminosPage() {
  return <LegalShell title="Términos y condiciones" updated="15 de junio de 2026" sections={SECTIONS} />;
}
