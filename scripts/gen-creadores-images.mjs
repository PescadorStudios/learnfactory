// ──────────────────────────────────────────────────
//  Imágenes A MEDIDA de la landing de creadores (/creadoresteologia).
//  One-off: corre manualmente y guarda .webp en public/creadores/.
//  Los assets se versionan en git (no se generan en runtime).
//
//    node scripts/gen-creadores-images.mjs            # solo las que faltan
//    node scripts/gen-creadores-images.mjs --force    # regenera todas
//    node scripts/gen-creadores-images.mjs hero sueno # solo esas ids
//
//  Misma config/endpoint que src/lib/generation.ts ("Nano Banana"):
//  GEMINI_IMAGE_MODEL (gemini-3-pro-image-preview) con fallback a
//  gemini-2.5-flash-image. Convierte el PNG a .webp con sharp.
// ──────────────────────────────────────────────────
import { config } from "dotenv";
import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";

config({ path: ".env.local" });

const apiKey = process.env.GEMINI_API_KEY || "";
const PRIMARY = process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview";
const FALLBACK = "gemini-2.5-flash-image";
const OUT_DIR = path.join(process.cwd(), "public", "creadores");

// Paleta de marca (idéntica a la del script principal) para coherencia total.
const PALETTE =
  "Brand palette: deep near-black background (#09090b), electric violet (#8b5cf6), royal blue (#3b82f6), bioluminescent cyan (#33e1ed), accent rose (#f43f5e). Cinematic, premium, high-end editorial quality, volumetric lighting, subtle film grain, ultra-detailed, 8k. Absolutely NO text, NO letters, NO watermark, NO logo.";

const IMAGES = [
  {
    id: "hero",
    aspectRatio: "4:3",
    prompt:
      "A lone young person with a hollow, empty stare, hypnotized by the cold glow of an endless phone feed in the dark; their blank face lit only by the bluish light of the screen as identical glowing cards stretch into an infinite scroll. A metaphor for years lost to doomscrolling. The subject sits to one side leaving dark negative space. Moody, cinematic, melancholic.",
  },
  {
    id: "sueno",
    aspectRatio: "4:3",
    prompt:
      "A charismatic creator and teacher standing before their community; the people in front of them are leaning in, understanding, advancing and mastering — visible transformation and energized focus on their faces, not passive entertainment. Warm light on the creator blending with violet and rose brand glow, faint floating knowledge-network particles. Aspirational, cinematic, inspiring.",
  },
  {
    id: "rutas",
    aspectRatio: "4:3",
    prompt:
      "A focused learner actively engaged with a glowing futuristic holographic study interface: floating quiz cards, branching path nodes and a streak/score badge lighting up as they respond. Sense of challenge, attention and reward — active gamified studying. Violet and accent-rose lighting, dynamic energy, deep depth of field.",
  },
  {
    id: "podcast",
    aspectRatio: "4:3",
    prompt:
      "A serene young person wearing premium over-ear headphones, eyes calmly closed, learning while walking through a nighttime city; luminous violet and blue sound waves flow from the headphones and wrap around them. A feeling of effortless absorption and learning in motion. Dreamy, immersive, elegant, cinematic.",
  },
  {
    id: "tunnel",
    aspectRatio: "4:3",
    prompt:
      "An immersive 3D neural corridor: a tunnel built from glowing interconnected nodes and pulsing synaptic threads in cyan and violet that recede into deep perspective, with branching forks where concepts from different routes cross and link. Sense of a mental journey connecting ideas. Bioluminescent, futuristic, exhilarating.",
  },
];

async function generateOnce(model, prompt, aspectRatio) {
  const imageConfig = { aspectRatio };
  if (model.startsWith("gemini-3")) imageConfig.imageSize = "2K";

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
    console.log(`• ${img.id} (${img.aspectRatio}) → generando...`);
    let buf = null;
    for (const model of [...new Set([PRIMARY, FALLBACK])]) {
      buf = await generateOnce(model, img.prompt, img.aspectRatio);
      if (buf) {
        console.log(`  ✓ ${img.id} con ${model} (${(buf.length / 1024).toFixed(0)} KB)`);
        break;
      }
    }
    if (!buf) {
      console.error(`  ✗ ${img.id}: no se pudo generar con ningún modelo.`);
      continue;
    }
    const webp = await sharp(buf).webp({ quality: 82 }).toBuffer();
    fs.writeFileSync(out, webp);
    console.log(`  ↳ guardado ${img.id}.webp (${(webp.length / 1024).toFixed(0)} KB)`);
  }
  console.log("Listo.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
