# -*- coding: utf-8 -*-
"""
Задача 7 (2): ручная полировка T4-05 «The Unnamed Goddess» — писец Super Z.
Чинит: сырые CR-/K-ид в тегах (P01-P06), мёртвые ткани (P19 jeans, P22 vinyl,
P24 jeans), закрытые зоны заявок (P07/P11/P17), слоевой хаос (P13),
X Cut hold (P16), якоря пропов (P08/P12), noun-lock именование (P01/P04/P07/P09),
салиенс-контраст (свет НА зоне заявки во всех R+), «his shirt» (P24).
A/B-пары: α P04×P17, β P07×P20, γ P09×P22 — один канал (wet-sheer через
именованный белый верх), разная подача.
"""
import re

PATH = 'thread4/batches/T4-05.md'

MACHINE_NEG_HEAD = ("realistic facial structure, photorealistic facial proportions, natural human nose bridge, "
    "realistic lip shape, semi-realistic anime face, 2.5D face, 3d face, child, children, childish, chibi, "
    "young girl, immature body, oversized head, loli, shota, exposed genitals, vulva, pubic hair, sex, "
    "sexual act, signature, watermark, artist name, logo, candle, candles, candelabra, lamp, lantern, torch, "
    "chandelier, brazier, male, man, 1boy, 2girls")

RPLUS_NEG = MACHINE_NEG_HEAD + ", nipples exposed, areola, naked breasts, topless, bra, camisole, bandeau, undershirt"
X_NEG = MACHINE_NEG_HEAD + ", covered breasts, bra, clothing on chest, penis, cum, uncensored, spread legs, nude lower body"

S = {}

S['P01'] = {
    'thesis': "the veil sees nothing and the thorns keep the hour — the kept secret is the placket's third button, and the rain-soaked white cotton tells the whole truth to the votive red",
    'pos': ("anime style, ecchi anime style, 1girl, solo, very long ivory-white hair, thin white veil covering the eyes, crown of thorns over the veil, snow-pale skin, white cotton robe, wet clothes, see-through, nipples through clothing, rope belt, placket gap, white stocking, one leg extended, stocking draw, votive red light, monastery washroom, night. The night rain caught her on the cloister walk, and the votive hour is all red but her: one crimson lamp on the stone basin, everything else the color of the hour's law, her white cotton robe soaked to honesty against it — the fabric gone sheer where the wet holds it, the dark of her nipples reading through the cloth's plain weave, the claim lit by the frame's only red point. The belt's rope bites the waist's carve deeper with the wet, the placket's gap open at the third button, and the stocking draws up the extended leg to the thigh's crease — one slow pull, the knee braced on the basin's stone edge, the thorns keeping their crown above the veil that sees nothing and tells everything. Her face is rendered in stylized 2D anime style: anime eyes (pale grey behind the veil, rarely seen), small nose, small mouth set in the calm line of a woman who has stopped apologizing to the hour, snow-pale skin. — The rain keeps its ledger. — The cotton pays it. Masterpiece, best quality, anime artstyle."),
    'neg': RPLUS_NEG + ", black hair, dark skin, visible eyes, no veil, no crown",
}
S['P02'] = {
    'thesis': "the nap's towel left its print, the slip's straps left their beds — the low plum sun reads the steam-damp cotton's honesty through the window",
    'pos': ("anime style, ecchi anime style, 1girl, solo, shoulder-length wavy lavender hair, side-swept bangs, round glasses, band-aid on nose bridge, small hoop earring, small purple cheek scales, white cotton slip, wet clothes, see-through, nipples through clothing, strap beds, seatbelt crease, curled on windowseat, low plum sun, evening. She slept an hour in the bath towel and dressed in a hurry, and the windowseat kept her: curled small against the glass with the low plum sun striking the slip's front — the cotton still steam-damp from the bath's afterwork, gone sheer where the light holds it, the dark of her nipples reading through the weave's thin account, the claim lit warm at the frame's center. The towel's print still fades on one cheek, the slip's straps have left their beds pressed into both shoulders, and the vent's gust flips the hem's edge at the calf — one small confession per object, the hour's whole arithmetic, while the seatbelt's sleep-crease still crosses her collarbone from the drive home. Her face is rendered in stylized 2D anime style: anime eyes (golden-yellow, half-lidded and slow with the nap), small nose, small mouth curved at nothing in particular, fair porcelain skin. \"The sun does this every evening,\" she tells the empty room, \"and every evening I let it.\" Masterpiece, best quality, anime artstyle."),
    'neg': RPLUS_NEG + ", straight hair, blue eyes, no glasses, no band-aid, no cheek scales",
}
S['P03'] = {
    'thesis': "the black dress keeps the grief and the white apron betrays it — one soaked bib, one dog's paws, the window's reflection holding both",
    'pos': ("anime style, ecchi anime style, 1girl, solo, very long straight obsidian-black hair, curved ram-like horns, thin serpentine tail, pale icy-grey almond eyes, small beauty mark on cheek, white apron, apron bib soaked, wet clothes, see-through, nipples through clothing, sunburn straps, mourning dress hem, dog paws on thigh, kitchen sink, window reflection, candlelight, night. The dishes from the wake are done and the kitchen keeps its one candle, amber and small, and the whole of its light has found the white apron's bib — soaked through at the washbasin's leaning, gone sheer where the wet holds it, the dark of her nipples reading through the cloth while the black mourning dress beneath says nothing, the grief and the tell in one frame. The funeral's sun has left its strap-lines across her shoulders, the apron's hem rides the thighs' line where the dog has set both paws — the only witness who stayed — and in the black window over the sink her reflection locks eyes with the version of herself that is not grieving. Her face is rendered in stylized 2D anime style: anime eyes (pale icy-grey, level and caught), small nose, small mouth set in the still line of a girl minding the last of the night's work, cream skin with light freckles. The candle keeps the bib. The reflection keeps the rest. Masterpiece, best quality, anime artstyle."),
    'neg': RPLUS_NEG + ", no horns, no tail, blonde hair, brown eyes, no beauty mark",
}
S['P04'] = {
    'thesis': "A-половина пары α (с P17): тот же мокрый белый хлопок — доставка паром и паром купальни, заношенный налево лацкан хранит секрет смены",
    'pos': ("anime style, ecchi anime style, 1girl, solo, wet clothes, see-through, nipples through clothing, white cotton gi jacket, gi lapel crossed wrong, steam, back dimples, strap tan line, trampoline float, mid-air, hands lifted open, spa courtyard, late rust sun. The practice ended an hour ago and the steam room's damp rode her out into the courtyard, where the late rust sun strikes the wet white gi jacket — the cotton gone sheer where the steam-sweat holds it, the dark of her nipples reading through the plain weave, the claim lit by the sun's own rust. The lapel is crossed wrong and she has not fixed it — the day's one kept secret, the belt long dropped — and the trampoline's float has her a half-beat off the mat: both hands lifted open at the apex, the back's dimples bare above the low hakama's waistband, the sunglass strap's tan line crossing the shoulder like a road the light travels. The steam keeps rising off her into the cold. Her face is rendered in stylized 2D anime style: anime eyes (amber, half-lidded with the heat), small nose, small mouth soft and unbothered, fair skin. The float takes its time coming down, and the secret stays crossed where it is. Masterpiece, best quality, anime artstyle."),
    'neg': RPLUS_NEG + ", jacket buttoned, belt tied, dry fabric",
}
S['P05'] = {
    'thesis': "the rain steams off the crest at the tree-fork — the fire is the girl, and the traffic mirror on the corner posts her for the traffic that never comes",
    'pos': ("anime style, ecchi anime style, 1girl, solo, flame salamander girl, low fire crest along the spine, ember freckles, white strapless slip, erotic pose, tree fork sit, legs astride the fork, rain steam, shiver ripple, dive streamline, traffic mirror, night street. She crossed the rain in one dive and the fire went low for it — the crest's flame barely a hand's height now, steaming where the wet still finds it, and she sits astride the tree-fork above the corner with the shiver's ripple running the length of her like a struck string. The white strapless slip is soaked dark at the bias and clings to the sitting's geometry — hips wide on the wood, thighs gripping the fork, the pose honest and uninterested in excuses — while the traffic mirror on its bent pole below holds her whole reflection: the crest, the astride, the ember freckles lit by her own low fire, the street's only poster. The rain keeps its half of the argument. Her face is rendered in stylized 2D anime style: anime eyes (ember-orange, bright with the cold), small nose, small mouth open on a caught breath, pale skin flushed with heat at the cheeks. The mirror posts. The fire stays low. Masterpiece, best quality, anime artstyle."),
    'neg': MACHINE_NEG_HEAD + ", nipples exposed, areola, full fire, tall flames, wet asphalt reflections, no crest, no freckles, human skin only",
}
S['P06'] = {
    'thesis': "the half-buttoned morning tells the night's whole story and the watch stopped at three keeps the exact minute of it",
    'pos': ("anime style, ecchi anime style, 1girl, solo, long dark hair, white shirt half-buttoned, black lace edge, erotic pose, draped across chaise, hotel suite, untied robe, stopped watch, sunset drift light, evening. The checkout hour is a rumor and the suite keeps her: draped along the chaise with her back to the warm side of the evening, the white shirt half-buttoned over the black lace's edge — two buttons doing the work of six — the robe untied on the chair where it was dropped at dawn, the whole room a still life of a night that will not itemize itself. The watch on her wrist stopped at three and stays stopped: the one honest witness, the exact minute kept. The sunset drifts its orange across the parquet and up the chaise's leg, finding the lace, the shirt's gap, the arch of the draped back — the pose belonging to no camera and every camera. Her face is rendered in stylized 2D anime style: anime eyes (dark, downcast and warm), small nose, small mouth set in the faint line of a girl who has decided the morning can wait, fair skin. — The shirt keeps three buttons. — The watch keeps three o'clock. Masterpiece, best quality, anime artstyle."),
    'neg': MACHINE_NEG_HEAD + ", nipples exposed, areola, fully buttoned shirt, running watch, daylight",
}
S['P07'] = {
    'thesis': "⚗ A-половина пары β (с P20): тот же мокрый белый верх — доставка движением, центрифуга твирла как курьер заявки; вердикт решает, доставляет ли движение лучше покоя",
    'pos': ("anime style, ecchi anime style, 1girl, solo, wet clothes, see-through, nipples through clothing, white cotton shirt, plastered wet shirt, skirt fan, twirl, mid-turn, hamstrings, shoulder-snap popped, choker, crossbody bag, porcelain studio, white lacquer light. The rain outside the studio's glass found her on the way in and she answered it with the twirl — the skirt's fan at full centrifuge, the wet white shirt plastered to her front and gone sheer with the rain's whole account, the dark of her nipples reading through the cloth at every quarter-turn, the claim arriving and arriving with the motion. The shoulder-snap has popped its stitching at the apex of the spin, the choker's line holds the throat's column steady while everything below it turns, and the crossbody bag rides the hip's orbit like a moon with opinions — the only object in the frame not moving, and therefore the only one telling the truth. The white lacquer of the studio throws the light back up into the shirt's wet weave. Her face is rendered in stylized 2D anime style: anime eyes (porcelain-grey, bright with the spin), small nose, small mouth open on a laugh, porcelain-ivory skin. \"Again,\" she tells the room, and the room is already turning. Masterpiece, best quality, anime artstyle."),
    'neg': RPLUS_NEG + ", dry fabric, standing still, arms at sides",
}
S['P08'] = {
    'thesis': "the ladder's top rung is her throne for exactly one minute, and the spoon in the cocoa holds the aurora she climbed for",
    'pos': ("anime style, ecchi anime style, 1girl, solo, cropped tee, boyshorts, underwear waistband, erotic pose, ladder climb, hands gripping the top rung, one knee on the rung below, looking down at viewer, hips, rooftop, aurora, night, cocoa mug with spoon. She said one minute of aurora before bed and the fire-escape agreed: three rungs up, hands gripping the top bar, one knee on the rung below, the climb's own geometry doing the posing — the hips' line level with the roof's edge, the boyshorts' waistband reading its simple band above the cropped tee's hem, the cold already finding the strip of skin between. Below her on the parapet the cocoa waits in its mug, the spoon's bowl holding a small bent copy of the whole green sky — the only witness patient enough for her minute. The aurora runs its full ribbon over the roof and down the ladder's rails, over her knuckles, over the band of the waistband. Her face is rendered in stylized 2D anime style: anime eyes (polar-indigo, wide and upward one last time), small nose, small mouth breathing small clouds, arctic-pale skin. The minute holds. The spoon holds the sky. Masterpiece, best quality, anime artstyle."),
    'neg': MACHINE_NEG_HEAD + ", nipples exposed, areola, broken ladder, extra limbs",
}
S['P09'] = {
    'thesis': "A-половина пары γ (с P22): та же белая ходкая ткань до прозрачности — доставка колесом вниз головой, прилив крови зажигает секрет затылка изнутри",
    'pos': ("anime style, ecchi anime style, 1girl, solo, white threadbare tee, see-through, nipples through clothing, stretched neckhole, off-shoulder, nape, mascara smear, cartwheel, legs up, mid-turn, hotel room, city neon, night. The party kept its mascara on her and its heat in her head, and the hotel room's carpet answered with the cartwheel: palms flat, legs up, the world's blood rushing the reverse way — the white tee washed to gauze across a hundred nights, sheer without one drop of water, the dark of her nipples reading through the threadbare weave while the neon sign outside prints its pink through the window and onto the cloth. The neckhole has stretched past the shoulder's ball with the years, the nape bare and downed with small hairs, the smear of mascara one cheek's receipt of the evening — the tee's whole argument that some fabrics stop being clothing and start being a rumor. The neon keeps its pink on the weave. The cartwheel keeps turning its slow half. Her face is rendered in stylized 2D anime style: anime eyes (sumi-ink, bright upside-down), small nose, small mouth set in the level line of a woman counting her own pulse, warm ivory skin. The room is still holding its breath when she comes down. Masterpiece, best quality, anime artstyle."),
    'neg': RPLUS_NEG + ", dry heavy fabric, thick sweater, bra visible",
}
S['P11'] = {
    'thesis': "the gala is over and the slip's one giving seam is the night's last secret — the single sconce keeps it lit on the fourth step",
    'pos': ("anime style, ecchi anime style, 1girl, solo, white silk slip, see-through, nipples through clothing, seam giving, pillow crease, under-chin cup, kneeling on stairs, flushed cheeks, single sconce light, staircase, late night. The last car has gone and the staircase got her halfway: kneeling on the fourth step with both palms cupped under her chin, the white silk slip's side seam giving at the hip's stitch — one thread from the whole evening's story — the silk gone sheer where the sconce's single warm bulb finds it, the dark of her nipples reading through the bias, the claim lit by the only light the house left on. The velvet chair downstairs has printed its press-mark across one cheek, the pillow of the waiting hour left its crease on the other, and the flush under both is her own and ungovernable. The stairs keep their arithmetic — four steps, one seam, one hour past the last goodbye. Her face is rendered in stylized 2D anime style: anime eyes (platinum-pale, half-lidded and done with the room), small nose, small mouth soft around a yawn she refuses to finish, platinum-pale skin. — The seam holds one thread. — The sconce holds the rest. Masterpiece, best quality, anime artstyle."),
    'neg': RPLUS_NEG + ", full lighting, chandelier, intact seam, standing pose",
}
S['P12'] = {
    'thesis': "the cutout's one engineered point and the rope's double beat — the courtyard fountain holds the whole count through the glass",
    'pos': ("anime style, ecchi anime style, 1girl, solo, cutout tank, boyshorts, erotic pose, sofa corner curl, knees up, jump rope, hands gripping rope handles, knuckles white, midriff, fountain through window, industrial dust light, afternoon. The double beat is over and the break room's corner has her: curled into the sofa's arm with the jump rope still fisted in both hands — palms around the handles, knuckles white on the grips, the rope's length coiled at her ankles — the cutout tank's whole engineered point showing the midriff's flat run, the boyshorts' band at the hip's fold, the curl itself the pose and the pose itself the rest. Through the window the courtyard fountain runs its one arc into the basin, holding the afternoon's whole count of her double-unders in the way only water counts. The industrial dust of the light lies flat on the floor and climbs the sofa's side. Her face is rendered in stylized 2D anime style: anime eyes (concrete-grey, bright and half-shut at once), small nose, small mouth set in the thin line of a girl dividing her breaths, dust-pale skin. \"One more lap,\" she tells the fountain through the glass, and the fountain does not argue. Masterpiece, best quality, anime artstyle."),
    'neg': MACHINE_NEG_HEAD + ", nipples exposed, areola, full coverage tank, tangled rope, extra handles",
}
S['P13'] = {
    'thesis': "the fog pays the dress in wet and the window pays it back in cold — the wrap's gap at the collarbone keeps the secret, one streetlamp pays the claim",
    'pos': ("anime style, ecchi anime style, 1girl, solo, white slip dress, wet clothes, see-through, nipples through clothing, wrap gap, collarbone, bare shoulders, socks, leaning against window glass, heels planted, gym ropes corner, fog, one streetlamp, night. The fog got into everything on the walk here and the dress kept the receipt: the white slip dress soaked to sheer at the wrap's front gap, the dark of her nipples reading through the wet weave while the one streetlamp down the block throws its sodium bar through the fog and onto the cloth — the claim lit by borrowed light, the fog doing the rain's work without the rain's noise. She leans against the gym's window at the ring-ropes corner, heels planted, the wrap's V holding the collarbone's two lines and the dress's whole argument, the window's cold glass printing her shoulder blades in return. The fog keeps its half of the frame. Her face is rendered in stylized 2D anime style: anime eyes (pale fog-grey, half-lidded), small nose, small mouth set in the level line of a girl who walked here on purpose, mist-white skin. The lamp holds its bar of gold on the weave. The glass holds the rest of her. Masterpiece, best quality, anime artstyle."),
    'neg': RPLUS_NEG + ", dry fabric, sunlight, closed wrap, standing straight",
}
S['P16'] = {
    'thesis': "the bib is down and the doorway holds the last of the eclipse — one glance back over the shoulder, the secret already told twice",
    'pos': ("anime style, ecchi anime style, hentai anime style, 1girl, solo, wolf-kin, grey-furred pointed ears, bushy tail, overalls, one strap unbuckled, bib down, stretched buttonholes, topless, bare breasts, nsfw, upper body, profile, turned away, glance back, doorway, eclipse light. The barn door's frame holds the eclipse's last ring behind her, and she stops inside it half-turned — the overalls' one strap unbuckled and the bib hanging past the waist's roll, the stretched buttonholes riding the fullest line's curve, her bare chest given to the profile's light with the eclipse's cold ring behind: the bare state named twice because once is a rumor, the silhouette's truth and the skin's truth in one frame. The tail keeps its slow sway at the doorway's edge — the body's own punctuation — and the glance back over the shoulder is the whole conversation the frame will ever need. The ring of light keeps its circle around her. Her face is rendered in stylized 2D anime style: anime eyes (eclipse-amber, averted and then not), small nose, small mouth set in a woman's knowing, sun-warm skin. — The strap gives. — The door keeps her. Masterpiece, best quality, anime artstyle."),
    'neg': X_NEG + ", both straps buckled, bib up, facing camera flat, full moon, daylight",
}
S['P17'] = {
    'thesis': "B-половина пары α (с P04): тот же мокрый белый хлопок — доставка поклоном на бис, софит крыла делает то же, что пар купальни",
    'pos': ("anime style, ecchi anime style, 1girl, solo, elf, long pointed swept-back ears, white cotton blouse, wet clothes, see-through, nipples through clothing, chairback lattice print, encore arms, arms raised, hands open, pencil skirt, one-side untuck, sock rings, stage, one floodlight, empty house, dusk. The last note is still dying in the rafters and she gives it the bow it paid for: encore arms — both raised wide, hands open to the empty house — the white cotton blouse soaked through with the whole concert's work, gone sheer where the one floodlight strikes it from the wings, the dark of her nipples reading through the cloth at the exact center of the light's cone, the claim delivered by wattage instead of weather. The chairback's lattice has printed its grid across the blouse's back from the second act's long sit, the pencil skirt keeps the stride's tuck on one side only, the sock rings mark both calves like the evening's ledger — every tell a line-item and the bow the total. The light keeps its cone. The house keeps its dark. Her face is rendered in stylized 2D anime style: anime eyes (moss-stone, bright and half-shut with the work), small nose, small mouth open on the last held breath, warm fair skin. \"One more,\" she tells the dark, and the dark says nothing back, which is how she likes it. Masterpiece, best quality, anime artstyle."),
    'neg': RPLUS_NEG + ", dry fabric, arms down, full house, bright daylight",
}
S['P19'] = {
    'thesis': "the dawn flight's sweat writes the spine's ledger — the scarf keeps one secret, the wet white tee tells all the others",
    'pos': ("anime style, ecchi anime style, 1girl, solo, gargoyle-kin, small stone horns, stone-dusted skin, wing joints at shoulder blades, white cotton tee, wet clothes, see-through, nipples through clothing, sweat damp spine, runway stride, low-rise white shorts, thong waistband, whale tail, scarf, ferry pier, dawn gold. The commute has a runway and the pier is it: the dawn flight from the rooftops ends in this stride — shoulders back, the gargoyle's landing walk, the white cotton tee soaked down the spine's whole line with the flight's sweat and gone sheer where the first gold of the sun lands on it, the dark of her nipples reading through the weave at the chest's plane, the claim lit by the dawn itself. The thong's waistband rides high above the low-rise shorts' back line — the whale tail's two letters written plain at the small of the back — while the scarf at the throat keeps the one secret the tee is not telling: the mark beneath it, the hour's confession, the only thing left covered. The gold runs the rail's length to meet her. Her face is rendered in stylized 2D anime style: anime eyes (dawn-grey, narrowed into the light), small nose, small mouth set in the level line of a student who commutes by air and punctually, cool stone-pale skin. The stride does not break for the sun. The scarf does not break for anyone. Masterpiece, best quality, anime artstyle."),
    'neg': RPLUS_NEG + ", wings spread, stone wings, jeans, dark tee, no scarf",
}
S['P22'] = {
    'thesis': "B-половина пары γ (с P09): тот же белый прозрачный уток — доставка стойкой на руках у стены, зелёная лента авроры вместо неона",
    'pos': ("anime style, ecchi anime style, 1girl, solo, cat-kin, small fluffy ears, slender tufted tail, white training leotard, wet clothes, see-through, nipples through clothing, handstand split, feet on wall, palms flat, nape, hair pinned, tan lines, practice room, aurora skylight, night. The practice room's skylight holds one green ribbon of the void's aurora and it falls on her exactly: the handstand split walked up the wall — heels to the plaster, both palms flat on the boards, the tail's tuft a counterweight against the gravity she is arguing with — the white training leotard soaked with the session's work and gone sheer where the aurora's green finds it, the dark of her nipples reading through the cloth in the light's own color, the claim delivered upside-down and lit from above. The nape is bare — hair pinned for the session, the neck's line the frame's quiet spine — the summer's tan lines framing the leotard's cut like a second garment made of memory, the practice mat's wax print still across her palms from the floor's long acquaintance. The green keeps its ribbon. The wall keeps her heels. Her face is rendered in stylized 2D anime style: anime eyes (aurora-green, bright and inverted), small nose, small mouth set in the small grin of a body that has won its argument, pale skin. \"Hold it,\" she tells her own arms, and her arms, being hers, do. Masterpiece, best quality, anime artstyle."),
    'neg': RPLUS_NEG + ", hair down, loose braid, dry fabric, floor glare",
}
S['P24'] = {
    'thesis': "the ovens' heat meets the street's rain at the curb — one white linen dress, one prism of streetlight, the secret half-named",
    'pos': ("anime style, ecchi anime style, 1girl, solo, short dark hair, white linen dress, wet clothes, see-through, nipples through clothing, apron strings untied, towel over shoulder, side seam strain, exposed nape, curb step, crosswalk, prism split light, city night, rain. The bakery's three a.m. ends at the curb: one step down between streets, the apron's strings already untied and the bib's weight gone, the work towel over one shoulder still holding its damp rectangle — and the rain between the two streetlights has found the white linen dress, soaked to sheer across the front, the dark of her nipples reading through the weave while the signal across the street throws its light through the rain's prism and splits one bar of color exactly onto the claim, the wet cloth lit in spectrum. The side seams strain with the stride's every pocket and turn, the nape bare where the short hair ends and the oven's heat still lives, the cheekbones carrying the flush of a shift spent at fire. The rain keeps both streets. Her face is rendered in stylized 2D anime style: anime eyes (deep prism-blue, half-lidded and knowing the way home), small nose, small mouth set in the soft arithmetic of a woman counting blocks, fair skin. The curb takes her step. The light takes its toll. Masterpiece, best quality, anime artstyle."),
    'neg': RPLUS_NEG + ", apron bib on, dry fabric, daylight, tied apron",
}

text = open(PATH, encoding='utf-8').read()
lines = text.split('\n')

def find_slot(idx):
    for i, l in enumerate(lines):
        if l.startswith(idx + ' — '):
            return i
    raise SystemExit(f'slot {idx} not found')

for idx, slot in S.items():
    start = find_slot(idx)
    # до следующего слота
    end = len(lines)
    for j in range(start + 1, len(lines)):
        if re.match(r'^P\d\d — ', lines[j]) or lines[j].startswith('## WORKLOG'):
            end = j
            break
    block = lines[start:end]
    out = []
    i = 0
    while i < len(block):
        l = block[i]
        if l.startswith('THESIS:'):
            out.append('THESIS: ' + slot['thesis'])
        elif l.strip() == 'POS:':
            out.append(l)
            # пропустить пустые + старый POS-параграф (первая непустая строка после POS:)
            i += 1
            while i < len(block) and not block[i].strip():
                i += 1
            if i < len(block) and block[i].strip():
                i += 1  # старый параграф выброшен
            out.append('')
            out.append(slot['pos'])
            out.append('')
            continue
        elif l.strip() == 'NEG:':
            out.append(l)
            i += 1
            while i < len(block) and not block[i].strip():
                i += 1
            if i < len(block) and block[i].strip():
                i += 1
            out.append('')
            out.append(slot['neg'])
            out.append('')
            continue
        else:
            out.append(l)
        i += 1
    lines[start:end] = out

open(PATH, 'w', encoding='utf-8').write('\n'.join(lines))
print('Переписано слотов:', len(S))
