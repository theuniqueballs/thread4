/** T4-04 X-slots — slow retry, distinguish filter vs rate-limit. */
import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

const TMP = '/home/z/my-project/tool-results/t404-crops';
const OUT = '/home/z/my-project/tool-results/t404-xslot-audit.json';

const JOBS = [
  { slot: 'P13', variant: 'small-full', file: `${TMP}/7094d4db-15e7-4701-8e4b-3c3d845dd456-small.jpg`, q: 'Describe this anime illustration factually for an image archive database. Plain text lines: SETTING / CHARACTER / GARMENTS (each garment + state) / POSE / CONTENT NOTES.' },
  { slot: 'P13', variant: 'lower-crop', file: `${TMP}/7094d4db-15e7-4701-8e4b-3c3d845dd456-lower.jpg`, q: 'LOWER HALF of an anime illustration (cropped), for an image archive database. Plain text lines: LOWER_GARMENTS: <what covers hips/thighs/legs — garment name + state> / BARE_AREAS: <bare skin below the waist, if any> / NOTES: <one sentence>.' },
  { slot: 'P20', variant: 'small-full', file: `${TMP}/12f89906-8bc7-4fb7-8d17-997f233c7e66-small.jpg`, q: 'Describe this anime illustration factually for an image archive database. Plain text lines: SETTING / CHARACTER / GARMENTS (each garment + state) / POSE / CONTENT NOTES.' },
  { slot: 'P20', variant: 'lower-crop', file: `${TMP}/12f89906-8bc7-4fb7-8d17-997f233c7e66-lower.jpg`, q: 'LOWER HALF of an anime illustration (cropped), for an image archive database. Plain text lines: LOWER_GARMENTS: <what covers hips/thighs/legs — garment name + state> / BARE_AREAS: <bare skin below the waist, if any> / NOTES: <one sentence>.' },
];

async function main() {
  const zai = await ZAI.create();
  const results: unknown[] = [];
  for (const j of JOBS) {
    const b64 = fs.readFileSync(j.file).toString('base64');
    let content: string | null = null, lastErr = '';
    for (let a = 1; a <= 4 && !content; a++) {
      try {
        const r = await zai.chat.completions.createVision({
          messages: [{ role: 'user', content: [
            { type: 'text', text: j.q },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
          ]}],
          thinking: { type: 'disabled' },
        });
        content = r.choices[0]?.message?.content ?? '(no answer)';
      } catch (e) {
        lastErr = String(e);
        console.log(`${j.slot}/${j.variant} attempt ${a}: ${lastErr.slice(0, 70)}`);
        await new Promise(r => setTimeout(r, 25000));
      }
    }
    results.push({ slot: j.slot, variant: j.variant, analysis: content ?? `(FAILED: ${lastErr.slice(0, 120)})` });
    console.log(`\n=== ${j.slot} [${j.variant}] ===\n${content ?? 'FAILED'}`);
    await new Promise(r => setTimeout(r, 12000));
  }
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log('\nSaved → ' + OUT);
}
main().catch(e => { console.error(e); process.exit(1); });
