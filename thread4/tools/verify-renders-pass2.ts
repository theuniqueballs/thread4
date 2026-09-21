/**
 * Second pass — adversarial verification of weak R+ calls + retry of the
 * content-filtered P05 render. Backend-only (z-ai-web-dev-sdk).
 */
import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';
import path from 'path';

const IMG_DIR = '/home/z/my-project/upload/t4-03-imgs';
const OUT = '/home/z/my-project/tool-results/t403-render-verdict-pass2.json';

const TARGETS: { file: string; slot: string; question: string }[] = [
  {
    file: 'db3cecbb-d13e-44e6-9e5d-5a366b285b7f.webp', slot: 'P09 swing/stage suit',
    question: `Look at this anime illustration VERY skeptically. A prior audit claimed "a visible pantyline through the tight fabric of her skirt". Verify: (1) Is there a REAL, clearly readable underwear line/edge visible through the garment on her hips/buttocks — or is it just fabric folds/seam? (2) Is any cleft or mound outline (cameltoe) readable through the garment between her legs? (3) Are nipples or areolae readable through any fabric? (4) What is the actual bottom garment and is it sheer, wet, or opaque? Answer format:
PANTYLINE: <yes, clearly | faint/unclear | no — plus one sentence>
CLEFT/CAMELTOE: <yes clearly | faint | no>
NIPPLES_THROUGH_FABRIC: <yes | no>
BOTTOM_GARMENT: <what + fabric state>
VERDICT: <PG13 | R | R+ | X per this scale: PG13=tease only; R=underwear visible as focus; R+=pantyline/cleft/nipples CLEARLY readable through fabric; X=bare breasts/genitals>`
  },
  {
    file: '23d77c24-90c8-46ea-9f15-1f70ef35a176.webp', slot: 'P17 stable/sweatpants',
    question: `Look at this anime illustration VERY skeptically. A prior audit claimed "a distinct pantyline visible through tight grey sweatpants". Verify: (1) Is there a REAL, clearly readable underwear line/edge through the sweatpants on her hips/buttocks — or just fabric folds/crease? (2) Any cleft/mound outline readable between the legs? (3) Are nipples/areolae readable through any fabric? (4) Chest garment and its fabric state? Answer format:
PANTYLINE: <yes, clearly | faint/unclear | no — plus one sentence>
CLEFT/CAMELTOE: <yes clearly | faint | no>
NIPPLES_THROUGH_FABRIC: <yes | no>
BOTTOM_GARMENT: <what + fabric state>
VERDICT: <PG13 | R | R+ | X per this scale: PG13=tease only; R=underwear visible as focus; R+=pantyline/cleft/nipples CLEARLY readable through fabric; X=bare breasts/genitals>`
  },
  {
    file: '75e8a4b4-6d29-45ab-a248-a1588443ec95.webp', slot: 'P23 festival/wet shirt',
    question: `Look at this anime illustration VERY skeptically. A prior audit claimed "a visible pantyline through a wet white shirt, breast outline readable through sheer material". Verify: (1) Is her chest actually sheer/see-through with nipples or breast shape clearly readable? (2) Is there a real underwear line readable through any garment at the hips? (3) What bottoms is she wearing, and is there any cleft/mound outline? Answer format:
PANTYLINE: <yes, clearly | faint/unclear | no — plus one sentence>
CLEFT/CAMELTOE: <yes clearly | faint | no>
NIPPLES_THROUGH_FABRIC: <yes | no>
BOTTOM_GARMENT: <what + fabric state>
VERDICT: <PG13 | R | R+ | X per this scale: PG13=tease only; R=underwear visible as focus; R+=pantyline/cleft/nipples CLEARLY readable through fabric; X=bare breasts/genitals>`
  },
  {
    file: 'ac50f744-19bf-4964-96a7-04912b2b799d.webp', slot: 'P05 overpass (claimed X)',
    question: `Describe this anime illustration factually for a content-tagging system: character (hair, ears, features), clothing state (name every visible garment and what body areas are bare), pose, setting, lighting. Then answer:
BARE_BREASTS: <yes | no — are bare breasts with visible nipples shown?>
DELIVERED: <PG13 | R | R+ | X> (X = bare breasts or genitals visible; R+ = edge signals only through fabric; R = underwear focus; PG13 = tease only)`
  },
];

async function main() {
  const zai = await ZAI.create();
  const results: unknown[] = [];
  for (const t of TARGETS) {
    const b64 = fs.readFileSync(path.join(IMG_DIR, t.file)).toString('base64');
    try {
      const r = await zai.chat.completions.createVision({
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: t.question },
            { type: 'image_url', image_url: { url: `data:image/webp;base64,${b64}` } },
          ],
        }],
        thinking: { type: 'disabled' },
      });
      const content = r.choices[0]?.message?.content ?? '(no answer)';
      results.push({ slot: t.slot, file: t.file, analysis: content });
      console.log(`\n=== ${t.slot} ===\n${content}`);
    } catch (e) {
      results.push({ slot: t.slot, file: t.file, error: String(e) });
      console.log(`${t.slot} ERROR: ${e}`);
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`\nSaved → ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
