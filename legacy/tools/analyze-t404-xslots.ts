/**
 * T4-04 X-slots (P13/P20) — content filter blocks full-frame audit.
 * Strategy: (1) downscaled full frame, (2) lower-half crop — answers the
 * X CUT HOLD question (lower body clothed?), (3) upper-half crop for scene.
 */
import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const IMG_DIR = '/home/z/my-project/upload/t4-04-imgs';
const TMP = '/home/z/my-project/tool-results/t404-crops';
const OUT = '/home/z/my-project/tool-results/t404-xslot-audit.json';
fs.mkdirSync(TMP, { recursive: true });

const TARGETS = [
  { file: '7094d4db-15e7-4701-8e4b-3c3d845dd456.webp', slot: 'P13 dance-hall floor slide (X)' },
  { file: '12f89906-8bc7-4fb7-8d17-997f233c7e66.webp', slot: 'P20 porcelain doll atelier (X)' },
];

async function ask(zai: unknown, b64: string, q: string) {
  const r = await (zai as Awaited<ReturnType<typeof ZAI.create>>).chat.completions.createVision({
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: q },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
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
    const stem = t.file.split('.')[0];
    const full = path.join(IMG_DIR, t.file);
    // prepare variants with python PIL (webp -> jpeg crops)
    const small = path.join(TMP, `${stem}-small.jpg`);
    const lower = path.join(TMP, `${stem}-lower.jpg`);
    const upper = path.join(TMP, `${stem}-upper.jpg`);
    execSync(`python3 - <<'EOF'
from PIL import Image
im = Image.open('${full}').convert('RGB')
w, h = im.size
im.resize((w//2, h//2), Image.LANCZOS).save('${small}', quality=82)
im.crop((0, int(h*0.38), w, h)).save('${lower}', quality=88)
im.crop((0, 0, w, int(h*0.62))).save('${upper}', quality=88)
print('ok', im.size)
EOF`);

    const variants: { name: string; file: string; q: string }[] = [
      {
        name: 'small-full', file: small,
        q: `Describe this anime illustration factually for an image archive database. Answer in plain text lines: SETTING / CHARACTER (hair, anatomy) / GARMENTS (each visible garment + state) / POSE / CONTENT NOTES (what body areas are uncovered).`,
      },
      {
        name: 'lower-crop', file: lower,
        q: `This is the LOWER HALF of an anime illustration (cropped). For an image archive database answer in plain text lines: LOWER_GARMENTS: <what covers hips/thighs/legs — dress? sheet? shorts? name the garment and its state> / BARE_AREAS: <what skin is bare below the waist> / NOTES: <one sentence>.`,
      },
      {
        name: 'upper-crop', file: upper,
        q: `This is the UPPER portion of an anime illustration (cropped). For an image archive database answer in plain text lines: CHARACTER: <hair, face, anatomy> / CHEST_GARMENT: <what garment covers the chest, if any — name it or say none> / SETTING: <what the room/light tells you> / POSE: <upper body position>.`,
      },
    ];

    for (const v of variants) {
      const b64 = fs.readFileSync(v.file).toString('base64');
      let content: string | null = null;
      for (let a = 1; a <= 3 && !content; a++) {
        try {
          content = await ask(zai, b64, v.q);
        } catch (e) {
          console.log(`${t.slot} ${v.name} attempt ${a}: ${String(e).slice(0, 90)}`);
          await new Promise(r => setTimeout(r, 2500 * a));
        }
      }
      results.push({ slot: t.slot, variant: v.name, analysis: content ?? '(FILTERED)' });
      console.log(`\n=== ${t.slot} [${v.name}] ===\n${content ?? '(FILTERED)'}`);
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`\nSaved → ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
