// ──────────────────────────────────────────────────
//  Imágenes de fondo del dashboard (home con sesión) con Gemini ("Nano Banana").
//  Hermano de gen-landing-images.mjs: mismos prompts/paleta de marca, pero
//  pensadas como FONDO de los 3 bloques de la home (hero, túnel, podcast).
//  Composición a la derecha (igual que el bloque "Estudio activo" de la landing)
//  para que el scrim de la izquierda deje legible el texto.
//
//    node scripts/gen-home-images.mjs              # solo las que faltan
//    node scripts/gen-home-images.mjs --force      # regenera todas
//    node scripts/gen-home-images.mjs home-hero    # solo esa id
//
//  Genera PNG con Gemini y lo convierte a .webp (sharp) en public/home/.
//  El banner principal (home-hero) se pide a mayor resolución que túnel/podcast.
// ──────────────────────────────────────────────────
import { config } from "dotenv";
import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";

config({ path: ".env.local" });

const apiKey = process.env.GEMINI_API_KEY || "";
const PRIMARY = process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview";
const FALLBACK = "gemini-2.5-flash-image";
const OUT_DIR = path.join(process.cwd(), "public", "home");

// Misma paleta de marca que la landing, para coherencia visual total.
const PALETTE =
  "Brand palette: deep near-black background (#09090b), electric violet (#8b5cf6), royal blue (#3b82f6), bioluminescent cyan (#33e1ed), accent rose (#f43f5e). Cinematic, premium, high-end editorial quality, volumetric lighting, subtle film grain, ultra-detailed, 8k. Absolutely NO text, NO letters, NO watermark, NO logo.";

const IMAGES = [
  {
    // Banner principal: pieza central de la identidad → más grande (4K).
    id: "home-hero",
    aspectRatio: "16:9",
    imageSize: "4K",
    prompt:
      "A breathtaking 'factory of knowledge': a vast luminous futuristic foundry where glowing streams of raw information flow into a radiant machine and emerge as structured constellations of bright knowledge-nodes and learning paths assembling in mid-air. Floating holographic study-routes, neural threads and drifting particles of light. Awe-inspiring, premium, cinematic. Composition: the brilliant machinery and glowing knowledge constellations concentrated on the RIGHT two-thirds; the LEFT third is calm, darker near-black negative space. Violet and royal-blue volumetric lighting.",
  },
  {
    id: "home-tunnel",
    aspectRatio: "16:9",
    imageSize: "2K",
    prompt:
      "First-person view flying into a breathtaking 3D neural corridor: a tunnel built from glowing interconnected nodes and pulsing synaptic threads in cyan and violet, with bright knowledge-stations ahead and concentric glowing rings forming the mouth of the tunnel. Deep perspective, motion blur, bioluminescent sci-fi energy. Composition: the luminous tunnel mouth and corridor concentrated on the RIGHT two-thirds; the LEFT third is calm, darker near-black negative space.",
  },
  {
    id: "home-podcast",
    aspectRatio: "16:9",
    imageSize: "2K",
    prompt:
      "A serene young person wearing premium over-ear headphones, eyes calmly closed, immersed in soft flowing sound waves and glowing audio particles in violet and blue — learning while resting. Dreamy, immersive, elegant, cinematic. Composition: the person and the glowing sound waves concentrated on the RIGHT two-thirds; the LEFT third is calm, darker near-black negative space.",
  },
];

async function generateOnce(model, prompt, aspectRatio, imageSize) {
  const imageConfig = { aspectRatio };
  if (model.startsWith("gemini-3")) imageConfig.imageSize = imageSize || "2K";

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${prompt}\n\n${PALETTE}` }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig },
      }),
    }
  );

  if (!res.ok) {
    console.error(`  ✗ ${model} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return null;
  }
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts;
  const b64 = Array.isArray(parts)
    ? parts.find((p) => p?.inlineData?.data)?.inlineData?.data
    : null;
  if (!b64) {
    console.error(`  ✗ ${model}: respuesta sin imagen.`);
    return null;
  }
  return Buffer.from(b64, "base64");
}

async function main() {
  if (!apiKey) {
    console.error("Falta GEMINI_API_KEY en .env.local");
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const onlyIds = args.filter((a) => !a.startsWith("--"));
  const targets = onlyIds.length ? IMAGES.filter((i) => onlyIds.includes(i.id)) : IMAGES;

  for (const img of targets) {
    const out = path.join(OUT_DIR, `${img.id}.webp`);
    if (!force && fs.existsSync(out)) {
      console.log(`• ${img.id}: ya existe, omito (usa --force para regenerar).`);
      continue;
    }
    console.log(`• ${img.id} (${img.aspectRatio} · ${img.imageSize}) → generando...`);
    let buf = null;
    for (const model of [...new Set([PRIMARY, FALLBACK])]) {
      buf = await generateOnce(model, img.prompt, img.aspectRatio, img.imageSize);
      if (buf) {
        console.log(`  ✓ ${img.id} con ${model} (${(buf.length / 1024).toFixed(0)} KB PNG)`);
        break;
      }
    }
    if (!buf) {
      console.error(`  ✗ ${img.id}: no se pudo generar con ningún modelo.`);
      continue;
    }
    const webp = await sharp(buf).webp({ quality: 82 }).toBuffer();
    fs.writeFileSync(out, webp);
    console.log(`  → ${img.id}.webp (${(webp.length / 1024).toFixed(0)} KB)`);
  }
  console.log("Listo.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
