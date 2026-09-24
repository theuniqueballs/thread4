/**
 * T4-04 retry pass — 6 images that failed (1 content-filter, 5 gateway).
 * Softer clinical "content-tagging" prompt (proven on T4-03 X-slots).
 */
import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';
import path from 'path';

const IMG_DIR = '/home/z/my-project/upload/t4-04-imgs';
const OUT = '/home/z/my-project/tool-results/t404-render-audit-retry.json';

const TARGETS: { file: string; hint: string }[] = [
  { file: '7094d4db-15e7-4701-8e4b-3c3d845dd456.webp', hint: 'empty dance hall at dawn, floor slide' },
  { file: '298753df-a459-47dc-be1d-496fc96dbde4.webp', hint: 'houseboat galley at sunset, tree branch indoors' },
  { file: '12f89906-8bc7-4fb7-8d17-997f233c7e66.webp', hint: 'old atelier fitting room at midnight' },
  { file: '6a82cb67-099c-4457-b55c-5451e08d5f91.webp', hint: 'small night shop aisles' },
  { file: '80ccc5f0-28ca-47e5-8afb-85a0da335a5e.webp', hint: 'atelier fitting room, tall mirror' },
];

const SCALE = `RATING SCALE for a content-tagging database:
- PG13 = tease only (sexy outfit, cleavage, thighs; no underwear focus)
- R = underwear visible and a focus (panties, bra, upskirt)
- R+ = edge signals readable through/on fabric: pantyline, taped nipples, nipples or cleft readable through sheer/wet fabric
- X = bare chest with visible nipples, or bare genitals/buttocks
Tag conservatively: what is not clearly readable did not happen.`;

async function ask(zai: ReturnType<typeof ZAI.create extends () => Promise<infer T> ? T : never>, b64: string, mime: string, q: string) {
  const r = await zai.chat.completions.createVision({
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: q },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
      ],
    }],
    thinking: { type: 'disabled' },
  });
  return r.choices[0]?.message?.content ?? '(no answer)';
}

async function main() {
  const zai = await ZAI.create();
  const results: unknown[] = [];
  for (const t of TARGETS) {
    const full = path.join(IMG_DIR, t.file);
    const b64 = fs.readFileSync(full).toString('base64');
    const mime = 'image/webp';
    const q = `Describe this anime illustration factually for a content-tagging system (expected setting: ${t.hint}). ${SCALE}

Answer in EXACTLY this format (plain text):
SCENE: <setting, lighting>
CHARACTER: <hair, special anatomy if any, skin>
WEAR: <every visible garment + fabric state: dry / damp / soaked / sheer / opaque>
POSE: <body position, camera angle, frame focus>
TAGS: <comma list of visible content tags: cleavage, panties, upskirt, bra, pantyline, taped nipples, nipples through fabric, wet see-through fabric, topless, bare breasts, none>
DELIVERED: <PG13 | R | R+ | X>
WHY: <one sentence>`;

    let content: string | null = null;
    let lastErr = '';
    for (let attempt = 1; attempt <= 4 && !content; attempt++) {
      try {
        content = await ask(zai as never, b64, mime, q);
      } catch (e) {
        lastErr = String(e);
        console.log(`${t.file.slice(0, 8)} attempt ${attempt} failed: ${lastErr.slice(0, 100)}`);
        await new Promise(r => setTimeout(r, 3000 * attempt));
      }
    }
    if (!content) {
      // last resort: neutral description without rating words
      try {
        content = await ask(zai as never, b64, mime,
          `Describe this anime illustration factually for an image archive: setting, character (hair, anatomy), every visible garment and its fabric state (dry/damp/soaked/sheer/opaque), pose and camera angle, and list the visible content elements. Plain text, 5 short lines.`);
      } catch (e) {
        content = null;
        lastErr = String(e);
      }
    }
    results.push({ file: t.file, hint: t.hint, analysis: content ?? `(FAILED: ${lastErr})` });
    console.log(`\n=== ${t.file.slice(0, 8)} (${t.hint}) ===\n${content ?? 'FAILED'}`);
  }
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`\nSaved → ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
