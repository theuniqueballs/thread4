/**
 * T4-04 render verdict — VLM blind audit of all 24 author-selected renders.
 * Backend-only (z-ai-web-dev-sdk). No slot hints: scene/character/fabric/
 * signals are reported factually so slots can be matched afterwards.
 * Meta-law T4-03: VLM over-grades the edge tier — final tier verdict is the
 * author's; this audit verifies scene, structure and MECHANISM VISIBILITY.
 */
import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';
import path from 'path';

const IMG_DIR = '/home/z/my-project/upload/t4-04-imgs';
const OUT = '/home/z/my-project/tool-results/t404-render-audit.json';

const SCALE = `HOUSE RATING SCALE (anime ecchi imagery, judge ONLY what is actually visible in the render):
- PG13 (tease): sexy outfit, bikini, cleavage, thighs, midriff, bare shoulders — no underwear focus.
- R (underwear): underwear visible AND a focus of the frame (panties, bra, upskirt, microbikini, erotic pose with underwear showing), but nothing beyond.
- R+ (edge): at least ONE hard edge signal actually VISIBLE: cameltoe (cleft/mound outline readable through a garment), visible pantyline, taped nipples, topless-with-tape, handbra, or nipples/cleft clearly readable THROUGH sheer/wet fabric.
- X (bare): bare breasts with visible nipples, or bare exposed genitals/buttocks.
Judge conservatively: if a signal is not clearly readable in the image, it did NOT happen.`;

async function main() {
  const files = fs.readdirSync(IMG_DIR).filter(f => /\.(webp|png)$/i.test(f))
    .sort((a, b) => fs.statSync(path.join(IMG_DIR, a)).mtimeMs - fs.statSync(path.join(IMG_DIR, b)).mtimeMs);

  const zai = await ZAI.create();
  const results: Record<string, unknown>[] = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const full = path.join(IMG_DIR, f);
    const b64 = fs.readFileSync(full).toString('base64');
    const mime = f.toLowerCase().endsWith('.png') ? 'image/png' : 'image/webp';
    const prompt = `You are auditing a rendered anime ecchi image for a production pipeline. ${SCALE}

Answer in EXACTLY this format (plain text, no markdown):
SCENE: <one dense line: setting, lighting>
CHARACTER: <hair color+style; special anatomy if any (horns/ears/scales/vines/tail/wings/fire crest/ball joints/seams); skin tone>
WEAR: <every visible garment + its FABRIC STATE: dry / damp / soaked-wet / sheer-see-through / opaque>
POSE: <body position, camera angle, where the frame's attention sits>
SIGNALS_SEEN: <comma list of erotic signals ACTUALLY VISIBLE: e.g. cleavage, panties, upskirt, cameltoe, pantyline, taped nipples, nipples through fabric, wet see-through fabric, topless, bare breasts, none>
DELIVERED: <PG13 | R | R+ | X — the tier the render actually delivers>
WHY: <one short sentence justifying the tier>`;

    try {
      const r = await zai.chat.completions.createVision({
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
          ],
        }],
        thinking: { type: 'disabled' },
      });
      const content = r.choices[0]?.message?.content ?? '(no answer)';
      results.push({ chrono: i + 1, file: f, mtime: fs.statSync(full).mtime.toISOString(), analysis: content });
      console.log(`\n=== chrono #${i + 1} ${f} ===\n${content}`);
    } catch (e) {
      results.push({ chrono: i + 1, file: f, error: String(e) });
      console.log(`#${i + 1} ${f} ERROR: ${e}`);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`\nSaved ${results.length} audits → ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
