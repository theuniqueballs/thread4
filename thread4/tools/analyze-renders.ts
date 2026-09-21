/**
 * T4-03 render verdict — VLM analysis of all 21 main renders.
 * Backend-only (z-ai-web-dev-sdk). Rates each render on the house scale
 * (PG13 / R / R+ / X) and describes the scene for slot matching.
 */
import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';
import path from 'path';

const IMG_DIR = '/home/z/my-project/upload/t4-03-imgs';
const OUT = '/home/z/my-project/tool-results/t403-render-verdict.json';

const SCALE = `HOUSE RATING SCALE (anime ecchi imagery, judge ONLY what is actually visible in the render):
- PG13 (tease): sexy outfit, bikini, cleavage, thighs, midriff, bare shoulders — no underwear focus.
- R (underwear): underwear visible AND a focus of the frame (panties, bra, upskirt, microbikini, erotic pose with underwear showing), but nothing beyond.
- R+ (edge): at least ONE hard edge signal actually VISIBLE: cameltoe (cleft/mound outline readable through a garment), visible pantyline, taped nipples, topless-with-tape, handbra, or nipples/cleft clearly readable THROUGH sheer/wet fabric.
- X (bare): bare breasts with visible nipples, or bare exposed genitals/buttocks.
Judge conservatively: if a signal is not clearly readable in the image, it did NOT happen.`;

async function main() {
  const files = fs.readdirSync(IMG_DIR).filter(f => f.endsWith('.webp'))
    .sort((a, b) => fs.statSync(path.join(IMG_DIR, a)).mtimeMs - fs.statSync(path.join(IMG_DIR, b)).mtimeMs);

  const zai = await ZAI.create();
  const results: Record<string, unknown>[] = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const b64 = fs.readFileSync(path.join(IMG_DIR, f)).toString('base64');
    const prompt = `You are auditing a rendered anime ecchi image against its intended rating. ${SCALE}

Answer in EXACTLY this format (plain text, no markdown):
SCENE: <one dense line: setting, character type (ears/tail/skin features if any), pose, clothing state, lighting>
SIGNALS_SEEN: <comma list of erotic signals ACTUALLY VISIBLE: e.g. cleavage, panties, upskirt, cameltoe, pantyline, taped nipples, nipples through fabric, topless, bare breasts, none>
DELIVERED: <PG13 | R | R+ | X — the tier the render actually delivers>
WHY: <one short sentence justifying the tier>`;

    try {
      const r = await zai.chat.completions.createVision({
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/webp;base64,${b64}` } },
          ],
        }],
        thinking: { type: 'disabled' },
      });
      const content = r.choices[0]?.message?.content ?? '(no answer)';
      results.push({ idx: i + 1, file: f, mtime: fs.statSync(path.join(IMG_DIR, f)).mtime.toISOString(), analysis: content });
      console.log(`\n=== #${i + 1} ${f} ===\n${content}`);
    } catch (e) {
      results.push({ idx: i + 1, file: f, error: String(e) });
      console.log(`#${i + 1} ${f} ERROR: ${e}`);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`\nSaved ${results.length} verdicts → ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
