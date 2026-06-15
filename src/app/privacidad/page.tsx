import type { Metadata } from "next";
import LegalShell, { type LegalSection } from "@/components/legal/LegalShell";

export const metadata: Metadata = {
  title: "Política de privacidad · LearnFactory",
  description: "Política de privacidad y tratamiento de datos de LearnFactory.",
};

const LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.";
const LOREM2 =
  "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.";

const SECTIONS: LegalSection[] = [
  { heading: "Información que recopilamos", paragraphs: [LOREM, LOREM2] },
  { heading: "Cómo usamos tu información", paragraphs: [LOREM] },
  { heading: "Base legal del tratamiento", paragraphs: [LOREM2] },
  { heading: "Cookies y tecnologías similares", paragraphs: [LOREM] },
  { heading: "Compartir datos con terceros", paragraphs: [LOREM2, LOREM] },
  { heading: "Conservación de los datos", paragraphs: [LOREM] },
  { heading: "Tus derechos", paragraphs: [LOREM2] },
  { heading: "Seguridad", paragraphs: [LOREM] },
  { heading: "Cambios en esta política", paragraphs: [LOREM2] },
  { heading: "Contacto", paragraphs: [LOREM] },
];

export default function PrivacidadPage() {
  return <LegalShell title="Política de privacidad" updated="15 de junio de 2026" sections={SECTIONS} />;
}
