import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import MetaPixel from "@/components/MetaPixel";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

const SOCIAL_IMAGE =
  "https://res.cloudinary.com/deirdgemo/image/upload/v1781300854/FB1BB96B-AA89-48AC-B472-4BE7D43D4015_si9aen.png";
const SITE_TITLE = "LearnFactory — El fin del scroll sin sentido";
const SITE_DESCRIPTION =
  "Convierte el tiempo de pantalla en conocimiento real. Rutas que te retan, te narran y conectan ideas — siempre gratis. O crea la tuya, sobre lo que sea, con IA.";

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    siteName: "Learn Factory",
    locale: "es_ES",
    type: "website",
    images: [
      {
        url: SOCIAL_IMAGE,
        width: 1200,
        height: 630,
        alt: SITE_TITLE,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [SOCIAL_IMAGE],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark">
      <body
        className={`${outfit.variable} font-sans antialiased bg-zinc-950 text-zinc-50`}
      >
        <MetaPixel />
        {children}
      </body>
    </html>
  );
}
