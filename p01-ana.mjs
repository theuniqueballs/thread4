const fs = require('fs');
const p = 'thread4/batches/T4-08.md';
let t = fs.readFileSync(p, 'utf8');

const from = `P01 — gold-lease-midstair (OC · Ana · R+ · PL111 · P43_OCEAN_DEEP_PRISM)
THESIS: the empress does not rent — the sea draws its lease line on the cloth around her gold and leaves the gold alone
Canon: Ana — very long straight black hair with a cold blue-black sheen, obsidian-black eyes with vertical pupils, gold-leaf skin, dragon-kin anatomy: ridged swept-back horns, gold-leaf skin with living seams at the joints, vertical obsidian pupils
Spine: PL111 Mid-Stair Sit · K89 mid_jaw_part · LEAD collarbone · young register · closer action-close
Stack: CR-W28 + CR-B04 + CR-E32 + CR-I12
POS:

anime style, ecchi anime style, 1girl, solo, dragon girl, dragon horns, ridged swept-back horns, small scale patches on forearms, dragon wings, folded at the back, very long straight black hair, blue-black sheen, obsidian eyes, vertical pupils, metallic gold skin, living seams at the joints, wet clothes, see-through, nipples through clothing, close-up, parted lips, looking at viewer, teal wrap cardigan, drowned marble stairs, bioluminescent glow, bioluminescent water. The sunken stairwell is hers by no lease at all — the gold of her skin signs nothing — and the sea has taken the difference out on the cloth: the teal wrap cardigan sits inside-out on her shoulders, its seams outward, and the tide-line crosses it in one clean splash along the left side, dry weave above the line, the claimed side gone sheer below it where the bioluminescent water holds the fabric against her. The cardigan's contour prints the apex of her chest through the wet weave, worn with nothing underneath, the cold seams of her gold skin reading through where the light lands square on her collarbone. Her jaw parts a degree — her hands at her knees on the wet marble, heels braced on the step below — the exhale the landlord never catches. A single drained petticoat hangs its last inch off the step below her, still dripping at the moon's pace, and a drifting leaf rides the floodline exactly at the lease height. Her face is rendered in stylized 2D anime style: anime eyes (obsidian-black, vertical pupils, half-lidded on the tide), small nose, small mouth parted mid-breath, metallic gold skin. The water rises one seam short of the gold. Masterpiece, best quality, anime artstyle.

NEG:

realistic facial structure, photorealistic facial proportions, natural human nose bridge, realistic lip shape, semi-realistic anime face, 2.5D face, 3d face, child, children, childish, chibi, young girl, immature body, oversized head, loli, shota, exposed genitals, vulva, pubic hair, sex, sexual act, signature, watermark, artist name, logo, candle, candles, candelabra, lamp, lantern, torch, chandelier, brazier, male, man, 1boy, 2girls, nipples exposed, areola, naked breasts, topless, bra, camisole, bandeau, undershirt, pale skin, porcelain skin, brown skin, tan skin, round pupils, horizontal pupils, no horns, no scales, antler horns, branching horns, gold-leaf skin on any other character, extra fingers, fused fingers, mutated hands`;

const to = `P01 — gold-lease-midstair (OC · Ana · R+ · PL111 · P43_OCEAN_DEEP_PRISM)
THESIS: the empress's scales sign nothing — the sea draws its lease line on the cloth around her, and her wings and tail hold the receipt
Canon: Ana — long golden-blonde hair with cyan-teal under-streaks, large glossy obsidian-black eyes, fair warm ivory-gold skin, teal-blue ridged swept-back horns, cyan translucent fin-fans at the head, large translucent cyan-teal wings, gold-teal scale fields across shoulders and arms, thick finned dragon tail
Spine: PL111 Mid-Stair Sit · K89 mid_jaw_part · LEAD collarbone · young register · closer action-close
Stack: CR-W28 + CR-B04 + CR-E32 + CR-I12
POS:

anime style, ecchi anime style, 1girl, solo, dragon girl, long blonde hair, cyan-teal hair streaks, hair down, large obsidian-black eyes, glossy eyes, fair gold skin, teal ridged swept-back horns, cyan fin-fans at the head, large translucent cyan wings, gold and teal scales on shoulders and arms, thick finned tail, wet clothes, see-through, nipples through clothing, close-up, parted lips, looking at viewer, pale teal wrap cardigan, sunken marble stairs, bioluminescent glow, bioluminescent water. The sunken stairwell is hers by no lease at all — her scales sign nothing — and the sea has taken the difference out on the cloth: the pale teal wrap cardigan sits inside-out on her shoulders, its seams outward, and the tide-line crosses it in one clean splash along the left side, dry weave above the line, the claimed side gone sheer below it where the bioluminescent water holds the fabric against her. The cardigan's contour prints the apex of her chest through the wet weave, worn with nothing underneath, the gold-teal scale fields catching the glow where the light lands square on her collarbone. Her jaw parts a degree — her hands at her knees on the wet marble, heels braced on the step below — the exhale the landlord never catches. Her large translucent wings trail into the flood and double themselves in the water, cyan on cyan, and her thick finned tail curls up through the surface exactly at the lease height, its fin riding the floodline like the sea's own signature. Her face is rendered in stylized 2D anime style: anime eyes (large, glossy obsidian-black, half-lidded on the tide), small nose, small mouth parted mid-breath, fair gold skin. The water rises one seam short of the gold. Masterpiece, best quality, anime artstyle.

NEG:

realistic facial structure, photorealistic facial proportions, natural human nose bridge, realistic lip shape, semi-realistic anime face, 2.5D face, 3d face, child, children, childish, chibi, young girl, immature body, oversized head, loli, shota, exposed genitals, vulva, pubic hair, sex, sexual act, signature, watermark, artist name, logo, candle, candles, candelabra, lamp, lantern, torch, chandelier, brazier, male, man, 1boy, 2girls, nipples exposed, areola, naked breasts, topless, bra, camisole, bandeau, undershirt, black hair, brown hair, short hair, dark skin, grey skin, green skin, no wings, missing wings, small wings, vestigial wings, no tail, small tail, antler horns, branching horns, extra fingers, fused fingers, mutated hands`;

if (!t.includes(from)) throw new Error('P01 block not found');
t = t.replace(from, to);
fs.writeFileSync(p, t, 'utf8');
console.log('P01 rewritten, chars:', t.length);
