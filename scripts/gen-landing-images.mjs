// ──────────────────────────────────────────────────
//  Generación de imágenes de la landing con Gemini ("Nano Banana").
//  One-off: corre manualmente y guarda PNGs en public/landing/.
//  Los assets resultantes se versionan en git (no se generan en runtime).
//
//    node scripts/gen-landing-images.mjs            # solo las que faltan
//    node scripts/gen-landing-images.mjs --force    # regenera todas
//    node scripts/gen-landing-images.mjs hero podcast   # solo esas ids
//
//  Misma config que src/lib/generation.ts: GEMINI_API_KEY + modelo de imagen
//  con fallback a gemini-2.5-flash-image.
// ──────────────────────────────────────────────────
import { config } from "dotenv";
import * as fs from "fs";
import * as path from "path";

config({ path: ".env.local" });

const apiKey = process.env.GEMINI_API_KEY || "";
const PRIMARY = process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview";
const FALLBACK = "gemini-2.5-flash-image";
const OUT_DIR = path.join(process.cwd(), "public", "landing");

// Paleta de marca a inyectar en cada prompt para coherencia visual total.
const PALETTE =
  "Brand palette: deep near-black background (#09090b), electric violet (#8b5cf6), royal blue (#3b82f6), bioluminescent cyan (#33e1ed), accent rose (#f43f5e). Cinematic, premium, high-end editorial quality, volumetric lighting, subtle film grain, ultra-detailed, 8k. Absolutely NO text, NO letters, NO watermark, NO logo.";

const IMAGES = [
  {
    id: "hero",
    aspectRatio: "16:9",
    prompt:
      "A luminous human head in profile formed entirely from a glowing neural constellation — thousands of synaptic points and threads of light — gently dissolving into floating particles that drift upward like an awakening mind. A single bright spark travels along a pathway, symbolizing a clear idea. Sense of focus, clarity and intelligence emerging from darkness. Elegant, awe-inspiring, futuristic.",
  },
  {
    id: "problem",
    aspectRatio: "16:9",
    prompt:
      "A lone young person sitting in heavy darkness, face and hands lit only by the cold blue glow of an endless smartphone feed that stretches away into an infinite repetitive tunnel of identical glowing cards. Hypnotized, hollow, trapped expression. Desaturated and cold except the addictive blue screen light. A visual metaphor for doomscrolling and wasted attention. Moody, cinematic, slightly melancholic.",
  },
  {
    id: "tunnel",
    aspectRatio: "4:3",
    prompt:
      "First-person view flying at high speed through a breathtaking 3D neural corridor: a tunnel built from glowing interconnected nodes and pulsing synaptic threads in cyan and violet, with branching forks and bright knowledge-stations ahead. Deep perspective, motion blur, bioluminescent energy, futuristic sci-fi data-world. Immersive and exhilarating.",
  },
  {
    id: "podcast",
    aspectRatio: "4:3",
    prompt:
      "A serene young person wearing premium over-ear headphones, eyes calmly closed, floating weightlessly in a vast cosmic space made of soft flowing sound waves and glowing audio particles in violet and blue. A feeling of deep, effortless absorption and peace — learning while resting. Dreamy, immersive, elegant, cinematic.",
  },
  {
    id: "divergence",
    aspectRatio: "1:1",
    prompt:
      "An elegant abstract constellation: multiple distinct glowing concept-nodes from different fields (each a different hue — cyan, violet, rose, amber) connected by luminous threads that all cross and converge at one brilliant central point of insight. A brain-like web of cross-disciplinary connections on a deep black background. Premium scientific data-art, intricate, beautiful.",
  },
  {
    id: "creators",
    aspectRatio: "4:3",
    prompt:
      "A charismatic modern content creator and educator in a stylish dark studio, illuminated by a soft ring light, speaking passionately toward the camera with an inspiring expression. Behind them, soft bokeh and faint floating knowledge-network particles in rose and violet. Warm, aspirational, professional, cinematic depth of field.",
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
    const out = path.join(OUT_DIR, `${img.id}.png`);
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
    fs.writeFileSync(out, buf);
  }
  console.log("Listo.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
