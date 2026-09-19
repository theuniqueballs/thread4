# RULES_CORE.md — THREAD 3.2-EXP-V13 · ДЕЙСТВУЮЩЕЕ ПРАВО
# Сгенерировано из RULES.md 2026-09-11 (§53 MATURITY & HELPER LAW). §1-§53 в
# текущих формулировках; инлайн-аннотации суперцессий СОХРАНЕНЫ — это
# операционные предупреждения («§41 annotation: ...»), а не история.
# История версий и карта суперцессий → RULES_HISTORY.md.
# Полный контейнер (право + история) → RULES.md.
# Загрузка на каждый батч: RULES_CORE + RATING_MAP + POOLS_V8 + POSE_LIBRARY
# + активные окна TRACKER/MOTIF_LOG (см. ONTOLOGY v9 integration pointer).

THREAD 3.0 — RULES.md
Single canonical spec. Supersedes __THREAD_2_0___STYLE_GUIDE.txt entirely.
No inline version tags on rules — if a rule contradicts a later rule in
the old file, the resolution is already made below. History goes in
CHANGELOG.md, not inside the rule itself, so nothing has to be read
against its own supersession again.

Pipeline: author (theme) → Claude (solver + assembler + self-check) → .md batch file → author generates on PixAI/Tsubaki2 → sorts → posts on Yodayo.
No GLM in the loop.

Reference files: ONTOLOGY.yaml (palettes, light, camera, wardrobe, BDM, skin,
eyes, hair texture, emotion, fetish, engagement, kinetic — reused as-is,
these were sound), POSE_LIBRARY.yaml (new — physical pose content, was
missing entirely), OC_CANON.yaml (new — 10 active OCs), CONSTRAINTS.yaml
(reused as-is — numeric batch targets were sound).

1. PIXAI BLOCK ORDER (mandatory)
[COMPOSITION] → [LIGHTING] → [DOF] → [ANGLE] → [SUBJECT] → [ENVIRONMENT] → [DETAILS]

Style declaration goes at the start, never as a trailing tag —
"anime artstyle" as the last token is read as a genre label, not a
rendering instruction, by Tsubaki2's DiT encoder.

COMPOSITION: "A 2D hand-drawn anime illustration, [shot], [framing]."
LIGHTING: LQ + light_direction + fill_ratio + color_temperature, integrated in prose.
DOF: what's sharp, what dissolves.
ANGLE: viewpoint. Never the word "camera" — Tsubaki2 draws it as an object. Use "viewed from [angle]".
SUBJECT (longest block): identity → hair → eyes → skin → face geometry anchor (mandatory, own sentence) → body-through-light → pose → wardrobe.
Face geometry anchor, always: "Her face is rendered in stylized 2D anime style: large expressive eyes, small nose, small mouth, flat cel-shaded skin." This is the PH-defense line — it survives paraphrase because it's a complete sentence with specific anatomical terms. Don't replace with vague style tags; those get stripped.
ENVIRONMENT: setting as light source + narrative context, never "a room."
DETAILS (last): palette-specific quality tags, never generic ones.
2. BODY-THROUGH-LIGHT (BPT rotation, ≤3 each per batch)
Body is never described anatomically as a checklist — always through how light interacts with it. 8 rotation angles: bust-first, hips-first, thighs-first, waist-first, back-first, hands-first, silhouette-first, motion-first. See ONTOLOGY.yaml bdm for the numeric tuple these map onto.

2A. SUB-PALETTES (C002 — was soft and silently skipped, now concrete)
C002 has existed in CONSTRAINTS.yaml since v2.0 ("3 sub-variations within the palette family") and I was quietly satisfying it with narrative-act framing instead of actual color variation — flagged as a gap after Requiem, confirmed as one by the author after Enigma. Concrete fix: every macro-palette used in a batch splits into exactly 3 named sub-variants before the 7-prompt block is written, derived mechanically from that palette's own accent list and light_type in ONTOLOGY.yaml — not invented per-prompt, so it's reproducible:

Sub-variant A (accent-lead): the palette's first listed accent color pushed forward as a secondary highlight, dominant stays as specified.
Sub-variant B (accent-alt): the palette's second listed accent (or a analogous-hue neighbor of the first, if only one accent exists) pushed forward instead.
Sub-variant C (temperature-shift): same dominant/accent pair, but the palette's light_type gets a warm or cool bias opposite its default (a palette with a warm default light_type gets a single cooler-biased prompt, and vice versa).
Target rotation across a 7-prompt block: roughly 3/2/2 or 2/3/2 across the three sub-variants — not required to be exact, but no sub-variant should carry the whole block alone (that's the failure mode this is fixing). Name the sub-variant in the prompt's internal notes (not necessarily in the SIG) so it's auditable later.

3. BANNED PATTERNS (auto-reject)
Pattern
Replace with
"vivid saturated colors" / "rich color palette" / "high color contrast" palette-locked color harmony, named dominant/accent
"The [X] fills the chamber"     specific environment detail
"Her [part] the primary focus" (max 3/batch)    active verb + light interaction
"The moment stretches"  explicit time-state (suspended/collapsing/arrested)
"beautiful, gorgeous, stunning, perfect skin"   specific texture or light effect (use OAS entry)
"camera [anything]"     "viewed from [angle]"
"desk lamp", "brass lamp" (named objects)       "warm key from off-frame"
"[subject] does not [verb]" (max 2/batch)       active alternative

4. NEGATIVE CONSTRUCTION
NEG = [PALETTE.forbidden_colors] + [THEME.negatives] + [UNIVERSAL] + [GEOMETRIC FACE DEFENSE] + [PROMPT-LEVEL: OC-specific / pose-specific / LQ-specific]

Geometric face defense (batch-level, always): "realistic facial structure, photorealistic facial proportions, natural human nose bridge, realistic lip shape, semi-realistic anime face, 2.5D face, 3D face." Do not ban "cel shading" or "flat anime shading" — those are the anime rendering techniques being requested, not defects.

Mandatory contradiction check, before finalizing any prompt (this was the recurring bug in v2.0 — closes it):
Before a NEG block is attached to a prompt, cross-check every NEG term against that prompt's own NCS value and POS content. If POS requests NAKED/TOPLESS/VISIBLE/nipples visible through X, the NEG must not contain any phrase that bans nipple visibility, breast exposure, or the specific fabric/skin state POS just asked for. This is not a manual reminder — it's a mechanical check I run against my own output before delivery (grep-equivalent: for every "no X" / "X not visible" NEG term, confirm X does not appear as a POS request in the same prompt).

Universal genital lock (added after the Requiem pilot): every NEG, regardless of NCS/LLS tier, includes exposed genitals, vulva, pubic hair. This is never conditional and never dropped — it's the one exposure boundary that isn't a per-prompt creative choice, so it's enforced structurally rather than left to be remembered per batch.

5. NCS ↔ LLS MAPPING (was undefined — closes a second recurring bug)
NCS (wardrobe/exposure state) and LLS tier (overall explicitness tier) are two different axes that must agree per prompt:

NCS value
Maps to LLS tier
CONCEALED       L0
COVERED L0 or L1
THROUGH_FABRIC  L1 or L2
VISIBLE L2
TAPE    L2
TOPLESS_BACK    L2
TOPLESS L2 or L3
NAKED   L3

A prompt with NCS=NAKED tagged as LLS=L1 (or similar mismatch) is a validation failure — flag and fix before delivery.

6. QUALITY TAGS
Always palette-specific, generated from that palette's sd_fragment in ONTOLOGY.yaml + "Masterpiece, best quality, anime artstyle." Never generic filler tags (banned list, section 3).

7. SIG FORMAT
OC_or_Random-[BDM 8-tuple]-[Palette]-[LQ]-[LightDir]-[PL]-[GAR]-[Emotion]

Example (corrected — previous style guide's example used a stale 4-part BDM; BDM is 8 dimensions per ONTOLOGY.yaml):
Sue-B4H4T3W1S1HE2MU0BD1-P02_DAWN_AMBER-LQ01-side-high-PL14-GAR01-E04

8. NICHE GUIDELINES
Checklist (human review, not keyword-scan): does it feel atmospheric/impossible rather than merely dark? Is the body focus rotated (not always breasts)? Is the emotional register distinct from the last 2–3 NICHE prompts in this batch?

Light quality — favor the most visually striking LQ codes (LQ03 Rim Only, LQ07 Volumetric Beam, LQ11 Prism Split, LQ15 Bioluminescent) over flat defaults.
Camera — favor unusual angles (CAM10 Through Element, CAM11 Mirror Reflection, CAM12 Aerial Top) over eye-level front.
Body focus rotation — don't default to breast-forward; use hip/back/silhouette/hands BPT angles.

NICHE is not "atmospheric darkness" — it should read as something physically impossible and beautiful (light behaving in a way it couldn't in reality: prism-split skin, bioluminescent glow with no visible source, reflection that doesn't match the pose). Failure mode: generic moody lighting with no impossible element — that's just a dim photo, not NICHE.

9. VOLT GUIDELINES
Checklist: does it read as erotic, or as "through fabric with tension" (soft/PG-13 failure mode)? Is the power dynamic rotated (not always submissive)? Is wardrobe state rotated (not always pristine — consider disheveled, torn, half-removed, damp)?

Power dynamics — rotate across the batch: submissive, dominant, mutual, teasing, reluctant, commanding. Don't default to one register for 14 VOLT prompts.
LLS guidance — see the NCS↔LLS table (section 5) for what each tier actually requires; don't eyeball it.

VOLT failure modes ("soy"/PG-13): vague sensory language without commitment to a specific NCS/pose combination; wardrobe always intact; power dynamic flat across the whole batch; breast-only body focus for >50% of VOLT prompts.

10. YURI-FORCE RULES (all interactions female — mandatory)
Mandatory female qualifiers near any ambiguous-gender word. Bulge-word replacements: any tentacle/appendage/object description that could read as a phallic bulge must be replaced with an explicitly non-phallic shape descriptor (e.g. "smooth curved appendage," "ribbon-like tendril" — never leave a bare "bulge" or "shaft" near a body). Male-coded words: never used in prose, full stop — no exceptions, no narrative justification overrides this.
Dynamic rotation: use 6+ distinct interaction dynamics per batch (see ONTOLOGY.yaml engagement/emotion for the vocabulary). Touch rotation: use 5+ distinct touch types per batch.

11. OC CANON-LOCK
OC_CANON.yaml is the single source of truth. Every OC prompt matches it exactly: hair, eyes, skin, body_type, and every entry in signature_marks must appear in prose. Theme adapts to the OC, never the reverse (BDM/hair/eyes/wardrobe are immutable per OC).

Forbidden in prose: a trailing CANON: [name] — ... summary suffix. The canon data lives in the descriptive prose itself, not as bolted-on metadata.

Required in NEG per OC: that OC's anti_shield list from OC_CANON.yaml, appended to the prompt-level NEG.

OC prompts are standalone — not tied to the batch's theme. 3 per session, author's choice of which 3 OCs.
AUTHOR CONFIRMATION (2026-09-05, N16 OC orders): OC orders may ship as
their own file, separate from the batch (mains and OC ТЗ are separate
deliverables when the author splits them); each OC prompt runs on her own
single theme and her own palette — never themed with the batch, never
cross-referenced with the other OC prompts of the same order.

12. RANDOM-GIRL GENERATION (the 18 non-OC prompts per batch)
These are NOT OC-locked — identity (hair color+texture, eye color, skin, body via BDM) varies per prompt within ONTOLOGY.yaml's pools (eye_color, hair_type, skin/OAS, bdm).

Identity-collision rule (new — was previously unstated, real risk): a random girl's combined identity (hair color + ear/horn/tail features + eye color) must not reproduce a specific OC's signature combination closely enough to read as that OC off-canon. Concretely: don't generate a random girl with silver-white hair + amber slit eyes (reads as Sol), or black hair + single white streak + red eyes (reads as Vae), or platinum bob + ice-blue eyes + small breasts (reads as Nix). Standard human ears/no horns/no tail by default for random girls unless the batch theme explicitly calls for fantasy features — the OC roster is where fantasy anatomy lives; keep random girls visually distinct from it by default.

Hair color pool for random girls (draw freely, avoid the OC-locked combinations above): black, dark-brown, chestnut, auburn, honey-blonde, ash-blonde, strawberry-blonde, silver-grey (not silver-white), dusty-rose, wine-red, teal, navy, charcoal-violet (not lavender — that's Doe), sage-green, ink-black-blue-sheen.

13. THEME-DEPTH MODE (optional — not forced)
21 prompts can be either standalone ideas under a loose umbrella theme, or organized into sub-themes. No forced narrative arc. (The old style guide had two contradictory rules here — a v2.0.8 mandatory arc-curve and a v2.0.11 note deprecating it because forced arcs produced repetitive, "soulless" prompts. The deprecation is correct and is the only rule now: arc structure is available as an option per batch, author's call, never mandatory.)

If used: sub-themes must each carry a distinct concept_anchor (ONTOLOGY.yaml, kebab-case, 2-4 words) — this is still enforced regardless of whether arc mode is on, because it's what actually prevents the P16/17/18-identical failure, not the forced curve.

14. WOW-FACTOR / IMPOSSIBLE ELEMENT ROTATION (NICHE)
Rotate through genuinely different "impossible" visual devices across a batch's NICHE prompts (7 of them) rather than reusing the same device (e.g. don't make all 7 "glowing particles in the air" — vary: light that doesn't match its source, reflections that lag or diverge from the pose, color bleeding across a boundary that shouldn't transmit it, scale distortion, impossible transparency).

15. PORTRAIT QUOTA (soft — added after the Requiem pilot)
This model produces unusually strong results on close, emotionally-loaded framing (close_up/extreme_close + CAM05 Macro Close or tight CAM01/CAM04, paired with a clear single emotion). The Requiem pilot had none of these and the author flagged the gap. Going forward: 2–3 dedicated close-up portrait prompts per 21-batch, prioritizing emotional read over body/pose complexity — face, light, and one clear emotional beat carrying the whole prompt. These count toward the normal NICHE/VOLT and LLS quotas, they're not an extra category, just a framing/CAM bias to build in deliberately rather than let framing fall out randomly.

16. DELIVERY FORMAT (author preference, not a content rule)
POS: and NEG: each go on their own line, followed by a blank line, then the prompt text starts as its own paragraph. The blank line isn't optional styling — a single line break after the label renders as a soft break in standard Markdown (collapses to a space, same paragraph), so without it "POS:" and the prompt text show up glued together on one line regardless of intent. A full paragraph break is the only way to guarantee "POS:" sits alone on its own line in every renderer. Applies to every prompt delivered from here on.

COLOR CLOSER MANDATE (added 2026-09-10, serves §51): every POS ends with
the quality line in the pattern "Richly pigmented [depth-anchored dominant]
tones, [saturated anchor or highlight] highlights, saturated film color.
Masterpiece, best quality, anime artstyle." The closer is the render
anchor — it obeys the five locks of the SATURATION DOCTRINE (§51): the
dominant named as depth (deep-mist-grey depth, never pale-fog tones),
the highlight saturated, "saturated film color" always present.

17A. POSE-CLAUSE REUSE & MOTIF DIVERSITY (found after Enigma — real gap, not theoretical)
Two related bugs, both confirmed with actual counts, not guessed at:

Pose-clause verbatim reuse. POSE_LIBRARY.yaml's one-line physical description (e.g. PL33's "kneeling, shoulders rounded forward, head bowed, hands resting on thighs") is meant as a reference, not a copy-paste source. When a PL code repeats within a batch, the description must be reworded in the actual prose — same physical pose, different sentence — never the library's stock phrase twice. This wasn't happening; Enigma has PL33's clause verbatim three times.

OC prompts are not exempt from pose-code accounting. RULES.md previously treated OC prompts as fully outside batch quotas (§11: "standalone, not tied to theme"). That's still true for genre/LLS/palette quotas, but pose-code reuse is a prose-quality issue, not a batch-quota issue, and OC prompts live in the same delivered file the author reads back to back with the 21. Going forward: pose-code usage is tracked across the whole delivered file (OC + 21 together), not just within the 21, specifically for the reuse-must-be-reworded rule above.

Cross-batch verbatim reuse — worse than pose-code overlap. Diffing Requiem against Enigma directly (not just comparing axis IDs) found full identity-block reuse, not just pose-clause reuse: Requiem-P12 and Enigma-P11 share an identical hair/eye/skin description (black straight hair loose around her knees, black-obsidian eyes closed, warm ivory skin) and an identical pose sentence (Seated on the floor, knees drawn to her chest, arms wrapped around her shins, an oversized sweater...), across two different batches, two different themes. Root cause: certain narrative roles (the quiet NICHE mid-batch pause, the defiant kneeling-bowed VOLT beat, the legs-spread corset VOLT beat) were apparently being filled from a small mental cache of "descriptions that worked," independent of axis bookkeeping — the BDM/PL/CAM counters were all technically satisfied while the actual prose repeated.

Mandatory pre-delivery check, going forward: if any prior batch file is present in the conversation, run an actual text-similarity pass (not an eyeball check) between the new batch's POS text and every previous batch's POS text before delivery — same method as the retroactive audit that caught this (sequence-matcher ratio, flag anything above ~0.4). This is now part of the standard self-check alongside the NEG/POS contradiction check, not a one-off audit.

Motif/setting-noun diversity (soft cap). No single recurring setting element or prop noun (candles, mirrors, wax seals, fog, a specific named room) should appear in more than roughly a third of a batch's prompts (~7/21), unless it's the mandatory palette quality-tag line itself (that repetition is structural and expected, not a motif). Requiem's "candle" in 22 prompt-mentions and Enigma's "prism"/"absolute black" in 31 and 20 mentions are the same failure shape — one image doing all the batch's atmospheric work instead of the palette and lighting axes doing it.

17B. CROSS-BATCH REPEAT REGISTRY
Concept anchors are already required unique within a batch (ONTOLOGY.yaml concept_anchor), but nothing has ever checked uniqueness across batches — Requiem and Enigma were never cross-referenced against each other before delivery. Fix: MOTIF_LOG.yaml (new file, delivered alongside this update) logs every concept anchor and every recurring motif-noun count, per batch, going forward. Before writing a new batch, I read this file and check new concept anchors against it.

Important limitation, stated plainly: this only works if the author keeps MOTIF_LOG.yaml and re-uploads it at the start of future sessions. My filesystem resets between conversations — nothing persists on my end unless it's in the conversation itself. This isn't a "the system remembers" claim; it's "the file is the memory, and it only works if it's back in front of me."

18B. FIXES AFTER PENITENCE (author feedback, all confirmed with real numbers)
Sub-palettes were too weak, confirmed by author. Root cause: §2A only nudged one accent clause per prompt while the mandatory quality-tag line (§6) stayed 100% identical across all 7 prompts in an act, and the dominant-color words saturate the rest of the prose regardless. One clause can't outweigh a fixed closing line plus a saturated dominant hue repeated in every sentence. Fix: the quality-tag line itself now varies per sub-variant — three short variants per palette, pre-written when the palette is chosen for a batch, not improvised per-prompt. Example for a blue-dominant palette: subA "...palette, deep blue tones, amber-lit" / subB "...palette, deep blue tones, silver-starlit" / subC "...palette, blue tones warming toward dawn." Small wording change, but it's the line that actually anchors the render, so it's where the variation has to live.

Hairstyle diversity was low. Going forward, explicitly rotate through ONTOLOGY.yaml's 7 hair_type textures (straight/wavy/curly/braided/loose_long/short_pixie/wet) across a 21-batch — don't let 2-3 textures (loose-long, wavy, straight) carry the whole thing by default, which is what happened.

Viewing-angle repetition, caught by the author, missed by my similarity script. Four "shot from behind, bare back" compositions across Enigma(P09,P10) and Penitence(P10,P11) — different pose codes, different text, so §17A's text-diff never flagged it, but it reads as repetition anyway because the camera relationship to the body repeated, not just the sentence. New soft cap: no more than 2 back-facing / bare-back compositions per 21-batch. Track viewing angle (front/side/back/three-quarter) as its own diversity dimension, separate from CAM code and separate from text similarity.

Ecchi-craft over raw nudity, per author's explicit note. P08 and P13 (Penitence) worked because the pose and tension carried the heat, not because of the exposure level — author called this out directly as the standard to hit more often. Combined with the L3 cap-cut above: the removed TOPLESS slots don't just disappear, they convert into higher-craft L1/L2 moments — wet/clinging fabric, near-reveal, implication, tension in the pose itself. This is now the default compensation mechanism, not just a nice-to-have.

19. DO NOT: PH-decoy paragraphs
Don't open a prompt with a scene-setting atmospheric sentence before the COMPOSITION-ATOM. It dilutes the framing signal and gets paraphrased away by PixAI's prompt-helper anyway. Go straight into "A 2D hand-drawn anime illustration, [shot]..."

17B. FREQ LINT — IN-BATCH PHRASE FREQUENCY (V15; closes the §17A blind
spot found by the author in the N24 review, 2026-09-13)
§17A compares whole sentences BETWEEN batches; it is structurally blind to
the "author's favorite word" — a phrase that quietly rides most of ONE
batch's prompts never trips it. Found live in N24: «camel-honest» 22
mentions / 21 prompts, «shape-honest» 20/21, «printed» 29 (author's rough
count; machine-verified by scripts/freq_lint.py — POS-scope spreads 52% /
48% / 71%). The tic is not batch-local: N21→N24 whole-file «camel-honest»
counts 9 → 18 → 17 → 22 — a systemic register, not an accident.

ROOT CAUSE: «camel-honest» is a RATING_MAP §4A LEXICON EXEMPLAR — the
§17A pose-clause bug recurring in the carrier lexicon, which had no
anti-copy law of its own. Same shape, different bank.

THE LEXICON ANTI-COPY LAW (extends §17A to RATING_MAP §4/§4A and every
other exemplar bank): lexicon exemplars are REFERENCE, not copy-paste.
A carrier drawn from the bank must be REWORDED in POS — same mechanics
(noun + determiner + outcome), different words — never the exemplar's own
hyphenation verbatim. The «-honest» hyphenation family is RETIRED from
batch prose: ≤2 lexicon-verbatim hyphenated carriers per batch, TOTAL
(the N24 number was 32).

THE FREQ CHECK (mandatory pre-delivery; scripts/freq_lint.py; exit code
rides the standard suite): count unigrams (incl. hyphenated compounds),
bigrams, trigrams across the batch's POS blocks. Law-mandated boilerplate
(§53A anchors, §53 face formula, §16 color closer, §52/§4A tag bank,
genre opener, quality tail) is scrubbed BEFORE counting and reported in
its own transparency section — excluded, never hidden. Hard flag: any
phrase or hyphenated compound in >35% of prompts; any plain unigram in
>65%. --baseline <previous batch> isolates NEW tics (present now, absent
in the reference). OC files (3 prompts) are report-only — the sample is
 too small to gate.

V15 WATCHLIST (authoring caps for the next batch, lint-enforced): «owns
the frame» 0 (N24 new tic, 76% spread); «-honest» family ≤2 total;
«printed» ≤5/21; «line» ≤12/21 (house signature saturating 54→67→96→105
whole-file across N21→N24); «keeps»/«standing» ≤6/21; «seam» ≤8/21
(carrier-mechanics noun — the A-class stack needs it, the prose does not
need it everywhere); skin-tone prose rotates per girl («warm ivory» rode
95% of N24 — the §51 warm witness collapsed into one skin word).

v3.2-EXP — EXPERIMENTAL ADDENDUM
The following sections (§20–§40) are added in the experimental build to merge
the cognitive layer from A2P12 / A3P2, the NICHE/VOLT genre rebuild from A6/A7,
the body-system from BBAN v2, and the bug fixes from A5P4 Core. These sections
DO NOT replace §1–§19 — they extend them. Where conflicts arise (e.g. the
"vivid saturated" ban in §3 vs §40's color-disease fix), the later section wins.

20. CAUSAL GATE (cognitive layer — mandatory, was missing in THREAD 3.0)
Before writing any prompt, answer all 5 questions (V15: was 6 — FOCUS
merged into §21). If ANY answer is missing
or vague → reject concept and start over.

MOMENT — What is happening right now? (one sentence, present tense)
CAUSE — Why is this happening? (physical cause, not abstract mood)
BODY — How does the body achieve this physically? (specific muscle/bone/light)
FEELING — What emotion drives this? (one of E01–E70 from extended pool)
LIGHT — Where does the light come from? Which ANGLE? (specific source, named angle)

(V15 merge: the sixth question, FOCUS — "what does the viewer see first?"
— is RETIRED here and absorbed by §21 VISUAL THESIS; they answered one
question twice. The THESIS is the focus. Five questions remain.)
These answers live in the prompt's pre-header as internal notes (not in POS
text itself, not in SIG). They are auditable but not rendered.

The failure mode this fixes: v16/AEGIS had 21 structurally-perfect prompts
that were all "girl standing in room looking at light" with no underlying
moment or cause. The gate makes that structurally impossible.

21. VISUAL THESIS (one idea, ten words — the prompt's spine)
Every prompt must be reducible to ONE visual thesis statement in ≤10 words:
"this image is [single idea]." If you cannot compress it, the prompt has no
spine — it is a list of axes, not an image.

Examples (good):

"she is unmaking the bath with her body"
"the robe remembers where it was"
"two versions of the same girl, two seconds apart"
Anti-examples (bad — these are axis-lists, not theses):

"1girl, Nix, P10_ARCTIC_WHITE, LQ11, side-mid, PL27, CUSTOM_GAR, E04"
"atmospheric NICHE with mist and reflection and scale contrast"
The thesis is logged in the pre-header as THESIS: <10 words>. If it reads
like a metadata line rather than a sentence → reject. (V15: the thesis
absorbs §20's retired FOCUS question — "what the viewer sees first" IS
the thesis, compressed.)

22. PRE-DELIVERY SUBJECTIVE CHECK (the "would I scroll past this" test)
Before delivery, the author asks ONE question per prompt, out loud:

"If this came up in my feed, would I actually stop scrolling?"

If the honest answer is "no" or "maybe" → the prompt is rejected and reworked
even if every structural constraint passes. This is the only non-mechanical
check, and that's exactly why it matters — it catches what no quota catches.

The audit: each prompt gets a PASS / REWORK verdict. REWORK verdicts must
name the specific failure ("too uniform with P14", "no wow-element", "feels
clinical"). Logged in the batch header.

23. ERROR BUDGET (max 1 complex element per prompt — was the AEGIS killer)
A "complex element" is any of: IT (impossible-tech wow), VT (visual-tech
trick like reflection-mismatch), CS (composition-stunt like split-frame),
TC (texture-change like fabric-becoming-water), SM (scale-mismatch).

Rule: Maximum 1 complex element per prompt. If a prompt has IT + VT
together, or VT + CS together → REJECT, simplify to one.

The failure mode: when multiple complex elements stack, Tsubaki2's DiT
encoder tries to satisfy all of them, fails at all of them, and the
result is "technically requested, visually incoherent." One strong idea
beats three competing ones.

24. NICHE NCS-LOCK (genre discipline — was eroded)
NICHE prompts use NCS values from {CONCEALED, COVERED} only.
NCS values {THROUGH_FABRIC, VISIBLE, TAPE, TOPLESS_BACK, TOPLESS, NAKED}
are FORBIDDEN in NICHE prompts — that prompt is automatically a VOLT.

The LLS-pairing in §5 already implies this, but it was never enforced. Now
it is a hard mechanical check: grep NCS field of every NICHE prompt, reject
if outside the allowed set.

NICHE ≠ "VOLT with less exposure". NICHE = atmospheric / non-erotic / mood.
If the body is exposed in a NICHE prompt, it is exposed by environment
(water/smoke/shadow/leaf) — never by NCS=VISIBLE or similar.

25. NICHE 7 ARCHETYPES (wow-factor rotation — was missing)
Each NICHE prompt in a batch belongs to one of 7 archetypes (min 1 per
batch from each, when 7 NICHE slots exist; rotation is the design goal):

SURREAL — impossible physics, dream-logic, Escher spaces
SCALE-EPIC — tiny figure in vast architecture, cosmic scale
ABSTRACT-BEAUTY — body as landscape, body as canvas, body as weather
NARRATIVE-MOMENT — a story captured mid-beat (before/after implied)
UNEXPECTED-ANGLE — worm's-eye, bird's-eye, through-object, keyhole
PALETTE-SHOCK — monochrome+1, complementary-shock, inverted
STILL-LIFE-WITH-BODY — body as part of composition, not subject
Logged in pre-header as ARCH: <name>. Anti-rule (§38) extends this.

26. VOLT MOMENT-BEFORE (kinetic mandatory — was the VOLT failure)
Every VOLT prompt captures the body MID-PROCESS, not in a static pose.
"Mid" means: mid-removal (K62), mid-arch-break (K66), mid-grip-tighten (K69),
mid-breath-inhale (K71), mid-reach-extend (K78), mid-lean-back (K79), etc.

Static pose + exposed body = clinical, not erotic. Mid-motion + body = the
moment before, which is where erotic tension lives (the V3 principle from BBAN).

Mandatory: every VOLT prompt declares a K-code (K01–K79) in pre-header.
At least 5 distinct K-codes per batch (was 0 enforced in v16). Each K-code
max 3× per batch. The "moment-before" framing is the design intent, not just
the code presence — the prose must read as mid-motion, not as static.

27. VOLT E-B-T TRIAD (Emotion + Body + Tension — was missing)
Every VOLT prompt must contain all three:

EMOTION (≥1 from E01–E70): visible in expression, not stated as a tag
BODY (≥1 specific body part described with sensory detail, NOT just size):
fabric interaction / skin texture / body fluid / pose that implies context
TENSION (≥1 from): voyeur-angle / eye-contact-with-viewer / implied-touch /
wardrobe-malfunction-in-progress / visible breath-pulse-tremble
Anti-rule (auto-reject): "girl standing with nipples visible" — no emotion,
no tension, just exposure. That is anatomy, not erotica.

28. PROSE-SHAPE ROTATION (guidance — V15: merged into the LEAD axis §29;
was "BPT PROSE ROTATION", 8 body-description templates — was fossilized)
Body is NEVER described as a checklist ("medium bust, curvy hips, toned
thighs"). It is described through ONE lead shape, chosen by the prompt's
LEAD zone (§29), each with a different sentence entry. The lead zone gets
2× more prose attention than others. The eight shapes survive as GUIDANCE
keyed to the lead zone — no separate declaration, no separate counter
(the V15 merge: one axis, one field):

Lead zone            Prose shape (guidance, not law)
breasts              "Her breasts, [size] and [adjective], [light-interaction verb] the [fabric/light]..."
hips                 "Her hips, [shape] and [adjective], [carry/tilt/offer verb] the [fabric/pose]..."
thighs               "Her thighs, [texture] and [state], [press/drape/spread verb] against [surface]..."
waist                "Her waist, [shape] and [light], [cinch/define/expose verb] the [garment/silhouette]..."
back-spine           "Her back, [shape] and [light-state], [arch/press/curve verb] against [surface/light]..."
hands                "Her hands, [state] and [tension], [grip/pull/trace verb] the [fabric/skin/object]..."
silhouette           "Her silhouette, [shape] and [contrast], [emerge/cut/dissolve verb] against [light/backdrop]..."
motion               "Her body, [in-motion-state] and [tension], [verb]s through the [fabric/light/space]..."

(v16 used the bust lead 21× — that fossilization is still banned; the
rotation mandate lives on through the LEAD zone caps in §29.)

29. THE LEAD AXIS (body-emphasis zones — the ONE declared zone field; V15
merger of the old BPT counter + D19 declaration, which per the author's
N24 review "typically pair" one-to-one and were two counters on one
variable)
Every prompt declares ONE lead zone in its spine:
LEAD: <zone> from {face, eyes, lips, throat, collarbone, breasts, navel,
hands, hips, buttocks, thighs, back-spine, waist, silhouette, motion}
(12 D19 zones + the three BPT-only leads — nothing was lost in the merge).
The lead zone gets 2× more prose attention than other zones (word count +
descriptive density, measurable). The spine field "BPT:" is RETIRED from
all delivered files; the batch lint counts the LEAD axis alone.

Batch-level mandates (hard, unchanged from the old §29):
ASS-MANDATE: ≥3 prompts with LEAD=buttocks (back-to-camera or from-behind)
BACK-MANDATE: ≥3 prompts with LEAD=back-spine
LEGS-MANDATE: ≥3 prompts with LEAD=thighs
HANDS-MANDATE: ≥3 prompts with LEAD=hands
Each zone max 4× per batch (forces 8+ distinct zones total)
30. LIGHT VERB POOL (21 verbs, max 3× each — math fix)
Light is described through one of 21 verbs (was 13, math was impossible):
cuts / catches / finds / pools / threads / grazes / spills / drapes /
fractures / limns / stains / sinks / fans / coats / refracts / splits /
shatters / dissolves / crystallizes / scatters / absorbs.

Max 3× per verb per batch (was 2×, mathematically impossible at 13 verbs
× 2 = 26 < 48 slots). Pool size 21 × cap 3 = 63 ≥ 48 — feasible.

Verbs are also rotated cross-batch: prior batch's full verb list is logged
in MOTIF_LOG, and the new batch's verbs are drawn from the complement first.
The list above is the master pool — a batch's working pool is a subset
selected by theme (e.g. water-theme pulls: pools / spills / drapes / sinks /
fans / threads / coats; mineral-theme pulls: cuts / fractures / shatters /
refracts / crystallizes).

31. CLOSURE PATTERN SHUFFLE (5 styles, max 30% each — was monotonous)
The closing sentence of every prompt follows one of 5 styles:

F1 STILLNESS — action frozen, moment held
F2 INCOMPLETE-ACTION — cut mid-beat, implied continuation
F3 OBJECT-DETAIL — camera zooms on object at end
F4 SENSORY-ECHO — opening sense returns at end
F5 BODY-HOLD — one anatomical detail held in final clause
Max 30% per style per batch (so max 6 prompts use F1, max 6 use F2, etc.).
Currently every prompt closes with the palette quality-tag line — that's
F0 (palette-line) which is now REJECTED as a closure choice. Quality tags
go AFTER the closure sentence, not as the closure sentence.

Pre-header logs closure style: CLO: F1 (etc).

32. OPENING STRATEGY POOL (10 strategies, max 3× each — was monotonous)
The opening of every prompt (after "A 2D hand-drawn anime illustration, [shot].")
follows one of 10 strategies:

material-led — the material (silk/water/steam) opens
action-led — the verb (peeling/arching/catching) opens
thought-led — the conceptual line (the robe remembers) opens
sensory-led — a sense other than visual (the room smells of) opens
body-led — a body part in motion (her hand trailing) opens
setting-led — a setting noun (the cistern / the veranda) opens
dialogue-led — a quoted word ("Don't." / "Now.") opens
list-led — a list (three things she lost) opens
definition-led — a word defined (OBSESSION: the moment when) opens
weather-led — weather (post-rain stillness / pre-dawn fog) opens
Max 3× per strategy per batch (forces 7+ distinct openings).

33. POSE-CAMERA-PAIR MANDATORY (was decoupled — v16's #1 failure)
Every PL code is paired with a camera angle. PL without camera = REJECT.

The pairing table lives in POSE_LIBRARY.yaml (added in v3.2-EXP). Each PL
has 3–5 preferred cameras. Outside the preferred set is allowed but flagged.

Examples:

PL14 Kneel Forward Reach → from-above / over-shoulder / 3-quarter-low
PL22 Knees-to-Chest Sit → from-above / 3-quarter / from-side
PL33 Kneel Head Bowed → from-above / from-side / over-shoulder
PL41 Slow Undress Pause → from-front / 3-quarter / over-shoulder
The pose must "make sense" from the camera angle. PL14 (kneeling forward) +
cowboy front-eye-level = the viewer is looking down at her back from her
height — physically impossible unless viewer is also kneeling. The pair
rule is what stops these mismatches.

34. MATERIAL-ACTION VERB MANDATE (was passive)
Material is described through what it DOES, not what it IS.

WRONG: "silk dress"
RIGHT: "silk drapes across the hip bone"
RIGHT: "silk clings wet at the navel"
RIGHT: "silk threads through her fingers"

The 12 material-action verbs (from BBAN v2 / A6):
drips / coats / refracts / cracks / melts / stains / glazes / shatters /
dissolves / crystallizes / chars / rusts

For VOLT materials (silk/sweat/water/honey/wine/skin): use tactile-action
verbs instead — clings / drapes / pulls / slicks / sheens / beads.

A prompt with a bare material noun ("the silk robe") is flagged — must
show the material doing something to light or body.

35. EMOTIVE COUNTERPOINT (≥3 per batch — was missing)
At least 3 prompts per batch contain TWO CONFLICTING emotional signals in
the same frame. Coherence is calm; counterpoint is electricity.

Examples:

confident pose + shy blush
defiant gaze + vulnerable open mouth
still body + trembling fingers
serene expression + weeping eyes
arched-back offering + averted gaze
This is NOT "mixed expression" (one face showing two emotions) — it is
the FACE doing one thing while the BODY does another. Logged in pre-header
as COUNT: yes when used.

36. GEAR / HAND ACTIVITY (mandatory — was missing)
Hands are never "relaxed at sides" by default. Hands DO something:

hold a GEAR item (towel / cup / phone / letter / mirror / flower)
touch own body (collarbone / hip / cheek / neck)
interact with fabric (grip / pull / untie / catch-mid-slip)
interact with setting (press wall / brace table / grip rail)
extend toward viewer or off-frame
The default "arms at sides" is now banned as lazy. If the pose doesn't
specify hands, the prompt must declare a GEAR item from the env-matched
pool (bedroom: phone/pillow/sheet/cup; bath: towel/brush/bottle; outdoor:
leaf/flower/sunglasses/hat; etc.).

37. BRE / BK / B MINIMUM (L2+ — was unused)
For L2+ VOLT prompts, the body-emphasis zone gets a technique code:

BRE (breast technique, when D19=breasts):
BRE17 (through-wet-sheer-aroused) / BRE19 (caught-in-fabric-gap) /
BRE21 (under-fabric-tension) / BRE22 (as-silhouette) / BRE24 (lifted-by-own-hand)
BK (back technique, when D19=back-spine):
BK7 (water-tracing-spine) / BK8 (shadow-contouring) / BK10 (spine-exposed) /
BK12 (strap-marks)
B (butt technique, when D19=buttocks):
B17 (curve-in-profile) / B19 (focus-from-behind) / B21 (in-fabric-tension)
Mandatory minimum per batch (in L2+ prompts):

≥3 BRE codes (was 0 in v16)
≥2 BK codes (was 0)
≥2 B codes (was 0)
These describe the TECHNIQUE used to depict the zone, not the zone itself.
"Breasts through wet sheer" (BRE17) is a different visual than "breasts as
silhouette" (BRE22) even though both are D19=breasts.

38. ANTI-BORING NICHE RULE (A7 §3 reformulated)
The following NICHE structures are FORBIDDEN, automatically:

"girl standing in room looking at light" (girl + vertical + looking + light-source)
"girl reclining in mist" (girl + horizontal + atmospheric-particles)
"girl sitting on floor staring" (girl + seated + averted-gaze)
If a NICHE prompt can be summarized in any of these three phrases → REJECT.

The fix: NICHE must have ONE of (a) impossible physics, (b) scale mismatch,
(c) reflection/portal that doesn't match, (d) time-frozen element, (e)
body-as-landscape metaphor, (f) monochrome+1 palette shock, (g) unexpected
camera angle (worm/bird/keyhole/through-object).

The 7 archetypes in §25 are the allowed NICHE structures. Anything else is
"VOLT with less exposure" which is exactly what NICHE is not.

39. ANTI-FOSSILIZATION RULE (meta — was missing)
Any spec rule that has been applied IDENTICALLY (same wording, same target)
for 4+ consecutive batches without variation is FLAGGED for review. The
author must either (a) vary the rule, (b) justify why it must stay, or (c)
retire the rule.

This applies to:

Banned-phrase lists (the same phrases banned across 4 batches = re-audit)
Sub-palette variants (the same 3 sub-variants every batch = re-derive)
Verb pools (the same 13 verbs every batch = rotate per §30)
Pose-category distributions (the same VERTICAL 8 / HORIZONTAL 5 = reshuffle)
Closure distributions (the same F1/F2/F3 ratios = re-permute)
The flag is logged in MOTIF_LOG as FOSSIL: <rule-id> <batch-count>.

40. CANDLE / LAMP SPAWN BAN + COLOR-DISEASE FIX (Tsubaki2 bugs)
A. Candle/lamp spawn ban (extends §3 ban on named light objects):

The following words cause Tsubaki2 to render a PHYSICAL OBJECT in frame:
candle / candles / candelabra / lamp / lantern / torch /
chandelier / brazier / wax (when used as a light-source noun).

Requiem pilot: "candle" appeared in 22 of 21 prompts → candles spawned as
visible physical objects in nearly every render. Disaster.

Replacements (use these instead):

"warm key from off-frame" / "amber glow from off-frame left"
"firelight from off-frame" (for ritual contexts)
"rim light from an unseen source" / "warm spill across the back wall"
The light source is OFF-FRAME. The result is light, not a lamp.

B. Color-disease fix (overrides §3 ban on "vivid saturated"):

The §3 ban on "vivid saturated colors" / "rich color palette" / "high
color contrast" is REMOVED in v3.2-EXP. These phrases were a wrong
diagnosis: the actual problem was Tsubaki2 defaulting to muddy desaturated
tones when palette direction is weak, NOT Tsubaki2 over-saturating when
told to be vivid. Banning vivid language made the disease worse.

New approach (in §6 Quality Tags):

DO use: "richly pigmented [palette dominant] tones, saturated film color"
DO use: "deep [palette dominant] with [accent] highlights"
DO NOT use: "muted, desaturated, washed-out, flat color" (this is what
actually triggers the disease — Tsubaki2 reads "muted" as "boring")
DO NOT use as generic filler: "vivid saturated colors" without a named
palette direction — the phrase alone is empty. With a named palette,
it's fine.

C. Anti-wash NEG block (added 2026-09-10; §49-compatible TIER 3 scene risk):

The observed washout disease (author: «будто маска какой-то блеклости»)
is fed from the NEG side too: no prompt ever carried anti-wash terms
(audit 2026-09-10: N18 0, N19 2, N20 1 occurrences across whole files).
From N21 every NEG carries the base anti-wash guard — "washed-out, faded
colors, low contrast" (3 terms) — plus the extended guard "desaturated
palette, milky haze, grey overlay, flat lighting" (up to +4) whenever the
chosen palette's dominant is a pale-family word (fog/mist/smoke/ash/bone/
milk families). This rides TIER 3 (scene risk), not TIER 1 — it is
palette-conditional, and it is ONE guard per axis, no color-soup
duplication (§49 ether rule 3 applies). Full doctrine: §51 + the
PALETTE_LIBRARY tail.
The §3 banned-phrase list is updated: "vivid saturated colors" / "rich
color palette" / "high color contrast" are NO LONGER auto-banned. They
become banned only when used WITHOUT a named palette direction in the
same prompt. With a named palette, they are allowed and encouraged.

41. EXPLICITNESS DISTRIBUTION v2 — THE YOADAYO LADDER (v3.2-EXP-V9, author directive 2026-09-08 — BINDING, supersedes the v3.2-EXP-V3 §41)
[§50 annotation, 2026-09-09: §41 defines the ladder's TIERS and the STATE
axis. The DEGREE axis (carriers / payload share / framing) and the honesty
enforcement now live in §50 + RATING_MAP.md. The X-tasteful discipline
below is SCOPED TO THE X SLOTS — it is not a license for R/R+ retreat
prose. «When in doubt, tag the higher tier» survives for tag hygiene only;
§50's fix direction for a failed gate is ADD CARRIERS, never hedge.]
Author directive (2026-09-08, verbatim core): the project's rating system is
rebuilt on the Yodayo community ladder. XXX is not considered, and X in the
sense of showing genitals is not either — that will never happen. Nipples
and breasts ARE allowed, because the project has X slots. The two working
criteria the author fixed:

R: "sexy character" — the girl is sexy, the picture is not yet about it.
R+: "картинка уже явно сделана ради сексуального возбуждения" — the image
is overtly made for arousal.

THE FIVE TIERS (community standard, as delivered):

PG — Safe. Ordinary clothes; no sexual context; no erotic poses; minimal
violence; no blood. (girl in dress, casual clothing, fantasy warrior, beach
scene in normal clothes.)

PG-13 — Mildly suggestive. Skin and attractiveness present, but the image
does not yet read as an erotic scene: bikini/swimsuit; open shoulders; deep
cleavage; short skirt; exposed midriff; light eroticism; moderate
fanservice; light blood.

R — Suggestive. The sexy-character tier: visible underwear (panties, bra),
upskirt, lingerie, openly suggestive poses, sexualized presentation,
see-through at shape level (may jump higher), bloody violence.

R+ — Over-the-top suggestive. The made-for-arousal tier, WITHOUT bare
nudity: cameltoe; nipples strongly visible through clothes; prominently
outlined bulge; extremely revealing clothing; overly sexual pose;
aggressive erotic framing; clothing barely covering the intimate zones
while no bare nipple is in frame.

X — Nudity. Visible nipples, visible areola, bare chest, exposed genital
AREA. Per community rules nipple pasties and maebari also classify X, as
does micro/slingshot swimwear with visible areola. PROJECT RULES ON TOP:
bare chest/nipples are the ONLY X content the project produces (the 2
X-slots per batch); genitals are NEVER drawn, narrated, or implied — the
§4 universal genital lock is eternal and unconditional; XXX (acts) does
not exist in the project.

THE HONEST BOUNDARY RULE (operational line between R+ and X):
As long as fabric (however wet, however sheer) covers the point, the state
is R+ ("nipples strongly visible through clothes" is the community's own
R+ definition). The moment the point itself is bare in frame, the tag is X.
When in doubt, tag the higher tier — the Yodayo tag controls impressions,
so it wins over the creative tag every time (the v3.2-EXP-V3 rule,
retained).

LLS ↔ YOADAYO MAPPING v2 (replaces the v3.2-EXP-V3 table; RX retired):

LLS tier / NCS state                    Yodayo tag
L0 (atmospheric, no erotic body-focus)  PG or PG-13
L1 (body as subject, shape-only)        PG-13 or R
L2 (visible underwear/lingerie, plain)  R
L2 (cameltoe / nipples-through-fabric /
    aggressive framing / extreme cut)   R+
L2+ (sideboob/underboob past frame,
     the old RX states)                 R+
L3 (TOPLESS_BACK, strategic conceal)    R+
L3 (TAPE / pasties / maebari)           X  — community rule (bookkeeping);
                                           Vae's canonical tape state tags X
                                           honestly. PLATFORM EMPIRICS
                                           (2026-09-09): Yodayo itself reads
                                           TAPE as R+ — see the amendment
                                           directly below the table.
L3 (TOPLESS, front bare)                X
L3 (NAKED)                              X  — with the §4 lock: no genitals
                                           ever in frame; strategic angle or
                                           cover keeps them out

PLATFORM EMPIRICS AMENDMENT (author order 2026-09-09, binding from N19 on;
does not change the community bookkeeping above): the Yodayo generator
reads TAPE / pasties / maebari as R+, not X. Author verbatim: "TAPE /
pasties / maebari считывается Yodayo как R+. Не знаю почему, но это так."
The ladder above stays as written — it is the community standard and the
honest formal ledger; the platform's observed class is what actually
renders, and for the TAPE cell the two are now explicitly split.
Operational consequences:
(1) The genre-line "Yodayo:" column for any TAPE state = R+ (Vae's
    canonical tape included: formal ledger X, platform column R+).
(2) X-slots must be bare (TOPLESS / VISIBLE) — TAPE never escalates to
    X on-platform, so a TAPE prompt cannot deliver an X-tier image.
(3) TAPE is a RELIABLE R+ tool: the model reliably stops at the covering —
    the tape swap is the honest one-edit dial-down from X to R+ whenever
    an X prompt needs it.
(4) N19 audit: no TAPE states anywhere in N19 (both X-slots P08/P19 are
    TOPLESS-bare; SET4's X-slot is TOPLESS-bare) — nothing retro-relabelled.

Default batch distribution (unchanged): 21 mains carry 2 X by default
(C073; bare-chest X-tasteful), the rest spread across PG-13 / R / R+ per
the LLS tier requirements; L0 ≥ 3, L1 ≥ 5, L2 ∈ [9,12], L3 ∈ [2,3] (C006).
OC prompts: the author's floor per order (SET4: R+ minimum — X is above
the floor and needs no separate permission, but stays the author's call to
dial back with one edit).

X-tasteful discipline (for the 2 default X prompts — unchanged):

X ≠ pornographic. X = bare chest visible, but with concept / tension /
emotion / pose doing the work, not the exposure itself.
The breast is bare to the eye but the PROSE emphasizes light, material
interaction, pose-tension, facial expression — not the nipple as focal
point.
Anti-pattern (auto-reject X): "her pink nipples on display" / "bare
breasts offered to the viewer" / "nipples visible, nipples erect"
Acceptable X prose: "her chest bare to the moonlight, the line of her
collarbone catching the cold blue" / "bare-breasted in the steam, the
underbust curve in shadow" — the nipple is implied by NCS=TOPLESS, not
narrated as a focal subject.

For R+ prompts (no bare nipple — unchanged C072 doctrine):
Do not write "nipple visible" / "bare nipple" / "nipples visible through"
in R+ POS prose — those phrases flip the Yodayo classification from R+ to
X against the prompt's intent. The C072 allowed-replacements list
("nipples dark beneath the wet fabric", "the shape pressed against",
"concealed by hand/hair/arm", "past frame edge") remains the working
vocabulary — and note that under the new ladder those phrasings now sit
honestly INSIDE R+ (fabric-covered detail is the R+ tier's own content),
no longer in a gray zone.

The simple test per prompt: "What does Yodayo see?" Fabric over the point
→ R+. The point itself bare → X. Log the tag honestly; the Yodayo tag and
the LLS tag MUST agree at delivery; if they don't, the Yodayo tag wins and
the LLS tag is corrected.

Self-correction history (kept for the record): VOID delivered 0 X
(over-corrected; author: "маловастенько эротики... запрещать Х, соски и
прочие - не нужно"); v3.2-EXP-V3 restored the 2-X default; v3.2-EXP-V9
(N19 cycle) re-grades the ladder on the author's community spec — the
practical effect is MORE honest R+ (wet-sheer and through-fabric detail is
now squarely R+ content by definition, not a violation) and a cleaner X
line (bare = X, pasties = X, fabric = never X). 2026-09-09 amendment: the
platform empirically reads pasties/TAPE as R+ — bookkeeping (X) and
rendering (R+) now explicitly split for the TAPE cell.

42. PALETTE LIBRARY & ROTATION (replaces C001's ≤3 palette cap)
The original C001 constraint (1 batch uses ≤3 palettes) produced
stylistically-uniform batches (one dominant hue repeated 7× across an
act). The author flagged this directly: "картинки со всем их
разнообразием получаются довольно одинаковые стилистически."

New system (replaces C001):

PALETTE_LIBRARY.yaml defines 50 palettes (P21-P70), each with 6 color
slots: dominant, secondary, accent1, accent2, shadow, forbidden.
C001_NEW (default mode): batch uses ≥7 distinct palettes, max 3 prompts
per palette. This forces stylistic variety across the 21-prompt batch.
C001_EXP (VOID mode, "21×21"): 21 distinct palettes for 21 prompts,
each used exactly 1×. The VOID batch used this mode; future batches
may use it when the theme warrants it.
Per-prompt palette discipline (C069):

Every palette's accent1 must appear as a NAMED color word in POS
prose (not just the quality-tag line — embedded in the body description).
Every palette's dominant must set the overall color mood (named in
the quality-tag line: "richly pigmented [dominant] tones, [accent1] highlights").
Every palette's forbidden_colors must NOT appear in POS as named
color words. (This is the §17A-style mechanical check.)
Cross-batch palette rotation (C071):

Prior batch's full palette list is logged in MOTIF_LOG.
The new batch's palettes are drawn from the complement first (no palette
used in the prior 2 batches, unless explicitly required by theme).
The 4-batch window tracks palette-usage frequency; same palette 3+
batches in a row = fossilization flag per §39.
Six-slot color discipline:
The 6-slot palette structure forces internal variety even WITHIN a single
palette. P23_VOID_VIOLET's dominant is deep-violet, but its accent1 is
gold-filigree and its accent2 is ivory-bone — meaning a single P23 prompt
can carry 3 distinct color words in prose, not 1. Across 21 prompts × 3
color words each = 63 color-word slots per batch. The 50-palette library
gives ~50³ = 125,000 distinct 3-color combinations. Variety is no longer
structurally constrained by the palette system.

43. SPINE-VERTEBRA BAN (author's direct correction)
Banned phrase (auto-reject): "spine vertebra by vertebra" and any
variant that anatomizes the spine as a sequence of bones.

Author note: "Концепт с позвоночником - не выделяй его, иначе по
спине видится такой костяной хрящ, неприятный и не очень красивый."

Tsubaki2 reads "vertebra by vertebra" / "spine vertebra by vertebra" /
"each vertebra" as a literal anatomical instruction and renders an
external bone ridge along the back — a horror-movie protrusion, not a
smooth back. This was A7 §1's "spine exterior ban" finding, which was
noted but not fully integrated into the spine-description vocabulary.

Banned variants:

"spine vertebra by vertebra"
"vertebra by vertebra"
"each vertebra"
"the vertebrae"
"vertebrae visible"
"spinal column"
"spine protruding"
"spine fully exposed" (sounds like skeleton)
Allowed replacements (smooth back, not bone-ridge):

"the line of her spine" / "the curve of her spine"
"the line of her lower back" / "the small of her back"
"back muscles defined by shadow"
"spine visible through sheer fabric" (NOT "spine exposed")
"the dip between her shoulder blades" / "the dimples at the base of her spine"
"her back arched, the muscles defined" / "the curve of her back"
Reinforcement in NEG (when back-spine is body-emphasis):
Add "smooth back, no protruding bones, no visible skeleton, natural
back, no external spine, no bone ridge" to NEG block.

This applies to every prompt where the back is the focus. The back is
described as a CURVE / LINE / SHADOW-CONTOURED SHAPE — never as a
sequence of bones. The back-technique BK codes (BK7-BK13) from §37 use
"water-tracing-spine" / "shadow-contouring" / "fabric-trailing" —
none of these narrate vertebrae. Honor that vocabulary.

44. ULTIMATE DICE (cross-batch concept validator — author's direct correction)
Author note: "В 21 была повторка концепта — нитки и крови на рту —
повторений между батчами быть не должно. Сделай себе валидатор повторений,
если что-нибудь между батчами кроме quality tags и палитр (условно) будет
повторяться - мы будем переписывать промпт. Назовём её ULTIMATE DICE."

The bug this fixes: Women in Dungeon P21 ("moss-keeps-her-thread")
repeated VOID P21 ("final-resolution-her-thread"). Both used the
structural formula "single ivory-thread at hand + single blood-edge at
lip". MOTIF_LOG recorded both with the same concept anchor suffix
"-her-thread" and identical two-element body-resolution pattern.
The §17A text-diff did not catch this because the prose differed (different
palettes, different bodies, different cameras) — but the CONCEPTUAL
FORMULA repeated. This is the failure mode ULTIMATE DICE prevents.

ULTIMATE DICE runs in two phases:

Phase A — Pre-flight (before writing any prompt):
Read MOTIF_LOG and grep all prior batches' POS text + concept anchors +
structural formulas. Build a "concept index" of:

Every concept anchor used (kebab-case phrases, all batches)
Every "structural formula" — defined as a combination of:
body-emphasis zone + specific named color + specific body-location
(e.g. "single ivory-thread at hand + single blood-edge at lip" is a
2-element formula at 2 body locations with 2 named colors)
setting + interaction type (e.g. "moss + still-life-with-body" is a
setting-interaction formula)
light-verb + body-zone + named-color (e.g. "limns + spine + gold-leaf"
is a verb-zone-color formula)
Every "narrative-role formula" — defined as:
act-position + emotional arc (e.g. P21 + body-resolved-to-two-edges)
archetype + closure (e.g. STILL_LIFE_WITH_BODY + F4 sensory-echo)
Phase B — Audit (after writing the batch, before delivery):
For every prompt in the new batch, compute:

Concept anchor similarity ratio vs all prior concept anchors (using
difflib.SequenceMatcher on kebab-case phrases).
Structural formula match: does the new prompt use the same
body-emphasis + named-color + body-location combo as any prior prompt?
Does it use the same setting + interaction combo? Same verb + zone +
color combo?
Narrative-role formula match: does the new prompt occupy the same
act-position + emotional-arc + archetype + closure as any prior prompt?
Thresholds (TIGHTENED in v3.2-EXP-V6 — 3-batch rollback + TRACKER.yaml):

v3.2-EXP-V6 adds the cross-batch ROLLBACK WINDOW: everything used in the
last 3 batches is BLACKLISTED for the next batch. After 3 batches, items
EXPIRE and return to the pool. This applies to ALL tracked elements:

What ULTIMATE DICE tracks (v3.2-EXP-V6 — "literally everything except quality and lighting"):

Concept anchors (kebab phrases) — per batch, all positions
Hair colors — per position (P01-P21)
Eye colors — per position
VIS codes — per prompt
BPT templates — per batch distribution (V15: retired — the LEAD axis §29
absorbs it; legacy batches keep their BPT fields read-only)
LEAD zones (V15 merge of BPT+D19) — per batch distribution
K codes — per batch
FET codes — per batch
BRE/BK/B technique codes — per batch
Closure patterns (F1-F5) — per batch distribution
Opening strategies — per batch distribution
Palettes used — per batch
Interaction types — per batch
Act-position structural tuples — per position
What is EXEMPT from tracking:

Quality tags ("Masterpiece, best quality, anime artstyle") — always required
Lighting descriptions (LQ codes, light_type, light_direction, fill_ratio,
color_temperature) — the author explicitly excluded these from Dice tracking
Face geometry anchor sentence — always required per §1
Opening structure ("A 2D hand-drawn anime illustration") — always required
OC canon-block — always required per §11
Universal genital lock — always required per §4
Banned-phrase NEG library — always required
3-batch rollback mechanic:

TRACKER.yaml stores all per-batch, per-position data for the last 3 batches
Before writing batch N, read TRACKER.yaml, identify the last 3 batches (N-1, N-2, N-3)
Everything in those 3 batches is BLACKLISTED at the SAME position
(e.g. if FLUERE P05 used "auburn hair", the next batch's P05 cannot use "auburn")
At DIFFERENT positions, the same element is allowed (position-locked, not global)
After 3 batches, the oldest batch EXPIRES — its data stays in TRACKER for
reference but no longer blocks
After delivering batch N, append its data to TRACKER.yaml
Same-position blocking (v3.2-EXP-V6):
At each act-position P##, the next batch must NOT match ANY of:

Hair color from last 3 batches at P##
Eye color from last 3 batches at P##
VIS codes from last 3 batches at P##
Structural tuple (genre + D19 + NCS + LLS) ≥3/4 from last 3 batches at P##
Cross-position blocking (v3.2-EXP-V6):
Concept anchors are checked globally (not per-position) — any new anchor
with kebab ratio >0.5 vs any anchor in the last 3 batches → REWRITE.
VIS codes are position-locked (same VIS at a different position is allowed).

The original v3.2-EXP-V4 thresholds were too lenient. The author flagged
BLASPHEMOUS P1, P10, P11, P17 as "прям пиздец как похожи" on WiD's
same-position prompts — even though the kebab anchors differed (ratio
0.43-0.69, below the 0.85 "high" threshold). The structural formula at
the SAME ACT-POSITION was nearly identical. v3.2-EXP-V5 tightens:

Concept anchor kebab ratio >0.5 → REWRITE (was 0.85).
No borderline-acceptable. Author: "ультимейт дайс должен работать как часы".
Same-act-position structural-tuple match ≥4/5 → REWRITE (NEW).
The structural tuple is: (act-position, archetype/genre, D19 body-emphasis,
interaction-type, NCS/LLS). If a new prompt at P## matches ≥4 of 5
elements with a prior prompt at the SAME act-position (P##) → REWRITE
regardless of kebab ratio.
Interaction-type catalog (for tuple match):
chain-binding / vine-cradle / magic-mark (rune/stigmata) / robe-slip /
smoke-lift / water-trace / mirror-truth / hand-bra / strap-snap /
wind-lift / bath-discovery / walk-in / fall-catch / pool-malfunction /
confessional-voyeur / altar-offering / icon-witness / relic-touch /
threshold-entry / choir-sing / throne-bind / exit-escape
The 4 BLASPHEMOUS bugs that triggered the tightening:

BLASPHEMOUS-P01 "heretic-crosses-the-threshold" vs WiD-P01 "first-step-into-stone":
both at P01 + NICHE SCALE_EPIC + D19=silhouette + threshold-entry interaction +
COVERED L0 = 5/5 tuple match → should have been REWRITTEN.
BLASPHEMOUS-P10 "stigmata-glow-her-thighs" vs WiD-P10 "rune-presses-her-thigh":
both at P10 + VOLT + D19=thighs + magic-mark interaction + THROUGH_FABRIC L2 =
5/5 tuple match → should have been REWRITTEN.
BLASPHEMOUS-P11 "sanctuary-offers-her-bare-chest" vs WiD-P11 "vault-keeps-her-bare":
both at P11 + X + D19=breasts + altar-offering interaction + TOPLESS L3 =
5/5 tuple match → should have been REWRITTEN.
BLASPHEMOUS-P17 "throne-chains-bind-her-thighs" vs WiD-P17 "chains-trace-her-thighs":
both at P17 + VOLT + D19=thighs + chain-binding interaction + THROUGH_FABRIC L2 =
5/5 tuple match → should have been REWRITTEN.
Implication for batch design: The act-structure itself must vary across
batches. P01 doesn't always have to be NICHE SCALE_EPIC threshold-entry;
P11 doesn't always have to be X altar-offering; P17 doesn't always have to
be VOLT chain-binding. Vary the archetypes/interactions at each act-position
across batches so the structural-tuple never matches ≥4/5 with a prior
prompt at the same position.

What is ALLOWED to repeat across batches:

Quality tags ("Masterpiece, best quality, anime artstyle") — structural, expected
Palette IDs (P21-P70 from PALETTE_LIBRARY) — palette reuse is rotation,
not repetition (per §42 C070 cross-batch rotation)
Face geometry anchor sentence — required per §1
Opening structure ("A 2D hand-drawn anime illustration, [shot]") — required per §1
OC canon-block (Sue is Sue, Vae is Vae regardless of theme) — required
per §11 canon-lock, exempt per §17A
Universal genital lock in NEG — required per §4
Banned-phrase NEG library (candle, lamp, spine-vertebra, etc.) — required
What is NOT allowed to repeat:

Concept anchors (exact match OR semantic similarity >0.5 — TIGHTENED from 0.85)
Structural formulas (specific element combinations at specific body
locations with specific named colors)
Same-act-position structural-tuple match ≥4/5 (NEW — see above)
Setting + interaction combinations (e.g. "moss + still-life-with-body"
once per project, unless theme mandates and the prose differs
substantially)
Narrative-role formulas at the same act-position (closing the batch
with "body resolved to two edges" twice in a row = the P21 bug)
Self-correction from VOID → WiD: P21 in both batches used
STILL_LIFE_WITH_BODY + body-resolved-to-two-edges + F4 sensory-echo +
"single ivory-thread at hand + single blood-edge at lip". This was a
4-element narrative-role + structural formula repeat. ULTIMATE DICE
would have rejected WiD-P21 at audit phase and required a different
closing archetype (e.g. NARRATIVE_MOMENT or UNEXPECTED_ANGLE) and a
different body-resolution pattern.

Self-correction from WiD → BLASPHEMOUS (v3.2-EXP-V5): 4 prompts
(P01, P10, P11, P17) passed v3.2-EXP-V4 ULTIMATE DICE (kebab ratio
<0.85) but had 5/5 structural-tuple match at the same act-position.
v3.2-EXP-V5 adds the structural-tuple check to prevent this.

The rule's intent: Cross-batch repetition at the concept / formula
level is the failure mode the v3.2-EXP self-check caught at the prose
level (§17A text-diff), but §17A only catches verbatim prose overlap.
ULTIMATE DICE catches the structural / conceptual layer that §17A misses.
Together, §17A + §44 form a two-layer repeat defense: prose-level (§17A)
and concept-level (§44). v3.2-EXP-V5 adds a third layer: structural-tuple
at same act-position, preventing same-position-same-formula repeats even
when prose and kebab anchors differ.

Logging:
ULTIMATE DICE findings are logged in MOTIF_LOG under cross_batch_audit_log
as ultimate_dice_audit entries, separate from the §17A text-diff
cross_batch_audit_log entries. Each entry lists:

new batch name
prompt ID rejected
prior batch + prompt ID it matched
match type (concept-anchor / structural-formula / narrative-role /
structural-tuple-same-position)
resolution (rewritten with: new concept anchor / new formula / new
archetype / new act-position pattern)
45. HAIR / EYE DIVERSITY (per-batch enforcement — author's direct correction)
Author note (after バカ！変態なんだよ! batch review): "есть вайб, что у
всех плюс-минус одинаковый оттенок глаз и волос."

The bug this fixes: Across ALL v3.2-EXP batches, the random-girl
prompts collapsed to a single hair color ("dark-blonde") and a single
eye color ("hazel"). Counts:

Hydrography: 5/24 dark-blonde hair, 6/24 hazel eyes
VOID: 11/24 dark hair, 8/24 hazel eyes
WiD: 12/24 dark-blonde/dark hair, 15/24 hazel eyes
BLASPHEMOUS: 14/24 dark-blonde/dark hair, 16/24 hazel eyes
Baka-hentai: 18/18 random-girls dark-blonde hair, 18/18 hazel eyes — 100% monoculture
ULTIMATE DICE (§44) does NOT catch this — it tracks concept anchors, not
hair/eye color diversity. The hair/eye axes exist in ONTOLOGY.yaml (hair_type,
eye_color) but were never enforced per-batch. This is the same failure shape
as the BPT-1 overuse bug, but on identity-colors instead of body-prose templates.

Hard rule:

≥15 distinct hair colors per batch (out of 18 random-girl slots; OC slots exempt per §11 canon-lock)
≥10 distinct eye colors per batch (same)
Max 3× per hair color (forces ≥7 distinct when 21 prompts)
Max 3× per eye color (forces ≥7 distinct when 21 prompts)
Silhouette / indistinct-hair prompts (NICHE L0 with D19=silhouette, where hair color is "indistinct at distance") are EXEMPT from the count — they don't count toward the 15+10 minimum, but they also don't count as "one color" repeated
Hair color pool for random girls (from §12, expanded):
black, dark-brown, chestnut, auburn, honey-blonde, ash-blonde,
strawberry-blonde, silver-grey, dusty-rose, wine-red, teal, navy,
charcoal-violet, sage-green, ink-black-blue-sheen, dark-honey,
copper-red, mahogany-brown, sandy-blonde, raven-black, jet-black, dust-blonde

Eye color pool for random girls (15 standard):
amber, hazel, emerald, blue, brown, gold, violet, crimson, sapphire,
jade, topaz, amethyst, ruby, copper, slate-grey

OC-locked combos EXEMPT from random-girl pool (per §12):

silver-white hair + amber slit pupils (Sol)
black hair + heterochromia red/blue (Miyu)
lavender hair + golden-yellow eyes (Doe)
platinum-white + soft purple right eye (Sue)
obsidian skin + red eyes (Vae)
ivory-white hair + veiled eyes (Ash)
copper-red side braid + emerald + golden flecks (Noa)
deep copper-red hair in loose side braid + sharp ice-blue eyes (Nix)
very long black hair + single white streak + red eyes (Vae alternative)
yellowish-blonde + pink gradient + golden ring-pupils (Yui)
Random girls must NOT closely reproduce any of these combos (per §12
identity-collision rule).

Audit mechanic:
After writing the batch, grep all POS blocks for hair-color words and
eye-color words. Compute distinct counts. If hair <15 OR eyes <10 OR
any color >3× (excluding silhouette/indistinct) → REJECT, redistribute.

Self-correction from Baka-hentai: All 18 random-girls used
"dark-blonde hair" + "hazel eyes". The fix: redistribute across the
expanded pool above, max 3× per color. This is mechanical — different
hair/eye color words in the same prose structure.

46. SIGNATURE FEATURES / VIS (random-girl memorability — author's direct correction)
Author note (after バカ！変態なんだよ! batch review): "хотелось бы
больше какой-то интересной фишки в девушках, потому что сейчас — даже
в ОС никого особо не заберёшь. фишек может быть две, три, да хоть десять
— лишь бы стакались. если посмотришь на девочек в Кор ОС — они все,
кроме доу или никс, имеют при себе что-то крутое и отличительное — как
их визитная карточка. Предлагаю так поступать и в батче 21. Не со всеми,
но с подавляющим большинством."

The bug this fixes: Random-girls are visually forgettable. The Core
OCs are memorable BECAUSE each has 2-4 stacked signature features (Sol:
fox ears + gold hoop earrings + gemstone earrings + golden tail; Doe:
round glasses + band-aid + deer horns + purple scales + asymmetric
earring; Yui: pink gradient + ring-shaped pupils + fangs + beauty mark).
Random-girls had NONE — they were defined only by hair color + eye color

BDM, which is forgettable.
Hard rule:

≥15 of 18 random-girls have ≥2 VIS (signature feature) codes stacked in POS prose
Each VIS feature appears in the prose as a named, specific physical detail — not a tag, not metadata, but a descriptive sentence or clause
VIS features can stack: a girl can have 3, 4, even 5 features if the theme warrants
The remaining ≤3 random-girls (usually NICHE silhouette/indistinct prompts where the body is dissolved) are EXEMPT — they don't need VIS features because the body isn't visible enough
VIS features must NOT reproduce OC-locked combos (per §12 identity-collision rule)
VIS Pool (40 codes, from A5P4B §2 + Fluere-specific additions):

General VIS (VIS01-VIS30, from A5P4B):

VIS01: single feather woven into hair
VIS02: brass key on leather cord at throat
VIS03: mismatched earrings (one stud, one hoop)
VIS04: scar through left eyebrow
VIS05: ink stain on right middle finger
VIS06: single white streak in dark hair (different placement from Vae's)
VIS07: silver cuff on left wrist only
VIS08: moth-shaped beauty mark below right eye
VIS09: chipped front tooth visible when smiling
VIS10: white ribbon tied around upper arm
VIS11: tattoo of small bird on inner wrist
VIS12: calluses on fingertips (instrument player)
VIS13: slightly pointed left ear
VIS14: freckle cluster on left collarbone
VIS15: bite scar on lower lip
VIS16: silver ring on thumb only
VIS17: small tattoo behind right ear
VIS18: always holding a single flower
VIS19: wire-rimmed glasses, slightly crooked (different style from Doe's round)
VIS20: henna patterns on left hand only
VIS21: scar across palm
VIS22: black thread tied around index finger
VIS23: single pearl glued to cheek
VIS24: constellation freckles across nose
VIS25: white streak in eyebrow
VIS26: small bell on choker
VIS27: permanent blush across nose
VIS28: beauty mark at corner of mouth
VIS29: bite mark on shoulder
VIS30: asymmetrical haircut (longer on one side)
Fluere-theme VIS (VIS31-VIS40, NEW):

VIS31: water-drop shaped pendant on cord
VIS32: beads of water permanently on eyelashes (impossibly persistent)
VIS33: iridescent scales on collarbone (NOT Doe's purple — different color: teal/silver)
VIS34: river-stone bracelet (smooth polished stones on cord)
VIS35: sea-glass shard on cord at throat
VIS36: tide-line tan on wrists (visible water-line marks)
VIS37: water-color tattoo on shoulder (flowing lines, not solid)
VIS38: droplet-shaped earring (single, asymmetric)
VIS39: flowing ink calligraphy on inner forearm
VIS40: mermaid-scale shimmer on hip (subtle, not Doe's cheek scales)
Anatomical VIS (VIS41-VIS70, NEW in v3.2-EXP-V6 — author's direct correction):
Author: "Фишки — это не только серёжки, татушки и браслеты. Если ты глянешь
на Core OC — там есть рожки, ушки, очки, чешуйки, хвосты. Eye patch у Сью,
рога — разные, эльфийские ушки и подобные вещи разнообразят контент."

These are ANATOMICAL signature features — not accessories. They define the
girl's BODY, not her jewelry. Stack freely with VIS01-VIS40 (accessories).

VIS41: small curved ram-like horns (smooth, not branched — different from Vae/Lua)
VIS42: small deer-like antler horns (smooth, not branched — different from Doe)
VIS43: small dragon-like horns (ridged, swept back)
VIS44: small demon horns (asymmetric pair, one slightly taller)
VIS45: small goat-like horns (curved, ribbed)
VIS46: long pointed elf ears (both, swept back)
VIS47: single pointed elf ear (left only — asymmetric)
VIS48: small cat ears (fluffy, on top of head — NOT Sol's fox ears)
VIS49: small wolf ears (pointed, grey-furred)
VIS50: small bat-wing ears (ribbed, dark)
VIS51: thin serpentine tail (smooth, not Vae's — different color: teal/silver)
VIS52: thin cat tail (slender, tufted tip)
VIS53: thin lizard tail (smooth, scaled)
VIS54: small vestigial wings on back (non-functional, feathered)
VIS55: small bat wings on back (non-functional, ribbed)
VIS56: small dragon-wing fragments on shoulders (non-functional, scaled)
VIS57: single white eyepatch over right eye (different placement from Sue's left)
VIS58: medical-style eyepatch with cross detail (not Sue's square white)
VIS59: small soft scales on cheeks (teal/silver — different from Doe's purple)
VIS60: small soft scales on shoulders (iridescent, not Doe's cheek placement)
VIS61: small soft scales on forearms (subtle, shimmer)
VIS62: small gemstone embedded in forehead (single, teal or amber — not Sol's earrings)
VIS63: small third-eye mark on forehead (a simple line or dot, not a real eye)
VIS64: fangs — small sharp canine teeth (different from Miyu/Yui — only one fang, or lower-jaw only)
VIS65: small slit pupils (not Sol's amber slit — different eye color required)
VIS66: heterochromia — sectoral (one eye half one color, half another — NOT Miyu's full-red/blue)
VIS67: one eye permanently closed (scar-based, not Sue's eyepatch)
VIS68: small beauty mark in shape of a crescent moon (not VIS28's standard dot)
VIS69: small beauty mark in shape of a star (different from VIS28)
VIS70: small beauty mark in shape of a heart (different from VIS28)
VIS Usage rules (v3.2-EXP-V6 updated):

≥15/18 random-girls have ≥2 VIS codes stacked in POS prose
VIS can be: accessory-only (VIS01-40) OR anatomical (VIS41-70) OR mixed
Strongly recommended: ≥5 random-girls per batch have ≥1 ANATOMICAL VIS (VIS41-70)
— this adds the "fantasy body" memorability that Core OCs have
VIS41-70 (anatomical) must NOT reproduce OC-locked combos:
VIS41 ram horns → too close to Vae/Lua (use VIS43 dragon or VIS44 demon instead)
VIS42 deer horns → too close to Doe (use VIS43 dragon or VIS45 goat instead)
VIS48 cat ears → different from Sol's fox ears (ok, but specify "small cat ears, not fox")
VIS57 right eyepatch → different placement from Sue's left (ok)
VIS64 fangs → specify "one fang, lower-jaw only" to differ from Miyu/Yui's full pair
VIS66 sectoral heterochromia → different from Miyu's full-red/blue (ok, but specify sectoral)
VIS stacking examples:

P02: VIS03 (mismatched earrings) + VIS14 (freckle cluster) + VIS34 (river-stone bracelet) = 3 accessories, 0 anatomical
P08: VIS06 (white streak) + VIS08 (moth beauty mark) + VIS17 (tattoo behind ear) + VIS43 (small dragon horns) = 3 accessories + 1 anatomical = 4 total
P11: VIS04 (scar through eyebrow) + VIS23 (pearl on cheek) + VIS30 (asymmetrical haircut) + VIS62 (gemstone in forehead) = 2 accessories + 1 anatomical + 1 structural = 4 total
3-batch rollback (NEW — see TRACKER.yaml):
All VIS codes used in the last 3 batches are BLACKLISTED for the next batch.
After 3 batches, they EXPIRE and return to the pool. This means:

If FLUERE P05 used VIS07+VIS36+VIS13, those codes are blacklisted for
the next batch at P05 (same-position) for 3 batches.
At a DIFFERENT position (e.g. P12), the same VIS codes are allowed
(position-locked, not global-locked — unless the author wants global lock).
The TRACKER.yaml file stores all per-batch, per-position VIS usage.
Usage in prose:
VIS features must appear as specific physical descriptions, not tags.
Example for VIS03 + VIS14 + VIS28:
"mismatched earrings — a small silver stud in her left ear, a gold hoop
in her right — catching the afternoon light, a cluster of freckles on
her left collarbone, a dark beauty mark at the corner of her mouth"

Logging:
VIS codes are logged in the prompt's pre-header as VIS: VIS03+VIS14+VIS28.
The audit footer counts how many random-girls have ≥2 VIS features and
flags any with 0-1 (excluding silhouette-exempt).

Self-correction from Baka-hentai: That batch had 0 VIS features on
all 18 random-girls. Every girl was defined only by hair color + eye
color + BDM + wardrobe — visually forgettable. The fix: stack 2-3 VIS
features per random-girl in ≥15/18 prompts. This is additive — it
doesn't change the prose structure, it adds memorable detail.

47. AUTHOR VOLT POLICY (2026-09-04, N14 review — BINDING, supersedes conflicting batch-level targets)
Author note: "волт ещё довольно стерилен, потому что начинается не с R, а
с PG 13+. Решение — слегка ужесточить волт. Две-три стерильные картинки,
далее — начинаем с R и выше. ОС промпты — всегда от R."

The batch volt head: AT MOST 2-3 sterile (NICHE / L0 / PG-13 / Yodayo R)
images, CLUSTERED AT THE BATCH HEAD (P01-P03 region). Everything after the
head: rating floor = R (L1+). OC prompts: always ≥ R (existing OC_CANON
policy, restated here as binding).

What this amends:
- C003 (7 NICHE + 14 VOLT) → NICHE ∈ [2,3], head-clustered; VOLT = the rest
  (18-19). The scattered-NICHE structure of N12/N13/N14 is retired.
- C004 (VOLT max-run 3) → superseded for the post-head region: a sustained
  15-18 VOLT run is the point of the policy, not a violation.
- C005 (P01 = NICHE, P21 = NICHE) → P01 = NICHE (head); P21 follows the
  floor (VOLT ≥ R). A batch may still close on a calm VOLT (L1) if the arc
  wants it.
- C006 LLS targets become SATISFIABLE under this policy: with L0 = 2-3,
  the L1≥5 / L2∈[9,12] / L3∈[2,3] targets fit the 18-19 VOLT slots with
  room — N15 is the first batch to satisfy C006 in full since V6.
- The 2 X-tasteful default (§41) is unchanged and stays inside the floor.

48. AUTHOR CARD-FORMAT DIRECTIVE (2026-09-04, batch N15 — scoped exception to the registry-only policy)
For "An Archive of Imaginary Memories" the author explicitly directed
tarot-card-format prompts: each prompt echoes the ORIGINAL DESIGN of an
existing Rider-Waite card — not verbatim, not completely; the rendered
result is NOT a card: no frame, no border, no title banner, no captions,
no numerals, no lettering, no card-as-object. POS prose therefore never
uses the words "tarot"/"arcana"/"card" or any card name; iconography is
described directly. Every NEG carries the batch-level CARD-ARTIFACT BLOCK
("tarot card, card frame, card border, title banner, caption, text,
lettering, inscription, roman numerals, playing card, trading card, card
layout, card spread, deck, tabletop"). This directive LIFTS the
OC_CANON v1.2.1 registry-only ban FOR N15 ONLY (explicit author direction
per the ban's own carve-out); zodiac/element fields remain registry-only.
The OC slots of N15 echo each OC's OWN registry arcana — an assistant
decision flagged for author veto (swap = one edit per OC header); mapping
author-confirmed in the 2026-09-05 re-read.
AMENDMENT (2026-09-05, later the same day — author correction, second
re-read): the card format was OVER-APPLIED. The author's instruction
meant a normal theme batch of 21 random prompts PLUS 3 OC prompts in
tarot — not 24 card prompts. The card format therefore binds the OC
slots of N15 ALONE; the 21 mains were rebuilt in place as ordinary
archive-theme prompts: zero card compositions, zero tarot iconography,
zero card vocabulary in POS (the §48 POS ban now doubles as a drift
guard for the mains). The batch-level NEG CARD-ARTIFACT BLOCK stays in
every NEG as standing anti-hallucination armor. §48A unchanged.

48A. OC CARD PROMPTS — NEAR-REPLICA COMPOSITION (2026-09-05, author re-read)
Scope: OC card prompts ONLY. The author's re-read of the card-format
directive: for the OC slots there is to be NO invented scene — the
composition ALMOST REPLICATES the original Rider-Waite design of the OC's
arcana, and the OC is interpreted INTO the card's own figure (same layout,
same key objects, same figure placement). Examples (N15): OC-Lyn/X = the
Wheel proper — three rings, eight spokes, the jackal climbing the right
flank, the serpent descending the left, four cloud-cornered winged readers
with open books, the OC seated on the sphinx's crown-seat holding the
upright blade; OC-Rue/XII = the living tau-shaped bough in leaf, single-
ankle inversion, the free leg's figure-four, hands behind the back, the
disc of gold light about the hanging head; OC-Mab/XIV = the winged pour
between two cups, one foot on land and one in water, the path to two
peaks, the low sun, irises at the water's edge, the chest emblem. "Our
way" lives in the rendering, not the scene: 2D anime style, house palette
and light physics, 1girl, our wardrobe/exposure rules, Archive nesting of
the backdrop only where it does not displace card elements. The RW rings'
letters/sigils become plain ornament (POS never names letters; NEG bans
runes/glyphs/lettering as usual). The mains' card format was retired by
the §48 AMENDMENT (2026-09-05, second re-read): the near-replica rule
binds the OC card prompts alone, and the mains carry no card
compositions at all. §48's no-frame /
no-letters / no-numerals rules and the NEG CARD-ARTIFACT BLOCK apply to
OC card prompts unchanged.

49. NEGATIVE ECONOMY (author directive 2026-09-05, night — BINDING, refines §4)
Author note: "У нас довольно странный негатив, полный всего, что не
используется. Я понимаю, что ты хочешь защититься от всего сразу, но не
всегда это всё сразу появляется непременно. Подумай над негативом в
целом — что действительно мешает и просто забивает эфир."

The doctrine: a NEG term earns its place only if it names a failure mode
that is PLAUSIBLE FOR THIS PROMPT — this character, this scene, this
palette. "Protection from everything at once" is not protection, it is
dilution: a 90-term NEG guards nothing better than a 30-term NEG, but it
(a) buries the terms that actually matter in a list the encoder reads
with flattening attention, (b) multiplies the §4 contradiction surface —
every extra term is one more chance to ban what POS just asked for, and
(c) makes the NEG unauditable: nobody can say why a term is there, so
nobody can say when it is wrong.

NEG construction, three tiers (runs wherever §4 runs; the §4 formula —
palette-forbidden + theme + universal + face defense + prompt-level —
keeps its structure, but every term in it must now pass the economy test):

TIER 1 — HOUSE LOCKS (always, ~12-16 terms). These stay because violations
are catastrophic (Yodayo classification, style death), not merely plausible:
- Geometric face defense (§4, 7 terms) — unchanged
- 3d render, photorealistic — the 2D style anti-drift
- Universal genital lock (§4, 3 terms) — never dropped, never conditional
- C072 BARE-FORMS block for R+ prompts (nipple visible, bare nipple,
  bare breasts) — the R+/X boundary itself. AMENDED 2026-09-10 (§52):
  «nipples visible through» is REMOVED from the block — that phrase is
  §41's own DEFINITION of R+ («nipples strongly visible through clothes»)
  and banning it in NEG ordered every R+ render sanitized to PG-13 (the
  N21 failure, §52/RATING_MAP §12). In R-tier NEGs the full block
  including «nipples visible through» stays — R is shape-level, the term
  correctly suppresses the detail jump there.
- Male guard (male, man, 1boy) — models genuinely hallucinate background
  males; cheap at 3 terms, real failure mode

TIER 2 — CHARACTER DRIFT SHIELD (0-10 terms). Only the drift risks that
are REAL for this character in this frame: wrong hair-color family
(white-haired girl → "silver hair, grey hair"), dropped signature anatomy
(ponytail → "hair down, loose unbound hair"; blindfolded girl → "visible
eyes, uncovered eyes"), wrong skin family, wrong horn type. Test per term:
"why would the model plausibly draw THIS here?" — if the answer is "it
wouldn't", the term is ether. Drop it.

TIER 3 — SCENE RISK (0-8 terms). What THIS scene actually invites:
a sheer-veil scene invites cover-loss (the C072 set does that work); a
mirror-heavy scene invites spawned text (text, letters, watermark,
signature); a bright pastel scene invites mood drift (dark, harsh
shadows); a beach scene invites swimwear-strip (bikini top removed).
The candle/lamp NEG block is SCENE-CONDITIONAL, not universal: it binds
where the theme could plausibly spawn one (dark ritual, night interior,
feast hall, gothic architecture). On a sunlit beach or a morning garden
it is dead weight — §40's POS-side word ban is what actually keeps the
lamps out of the prompt; the NEG block is a second lock for dark scenes
only.

What gets REMOVED (the ether categories — named so they stop coming back):
1. "No X" phrasings in NEG ("no tail", "missing tail", "no ribbon"). NEG
   reads tokens, not grammar — the token X is present either way, and a
   "no tail" entry feeds "tail" exactly as much as banning it would. Write
   the noun itself. (This was Sol's anti_shield bug: it carried "tail" AND
   "no tail, missing tail" simultaneously — fixed in OC_CANON v1.6.1.)
2. Armor against absent content: throne rooms, dungeons, gold armor,
   spears, staffs in a flower garden; neon guards on a sunlit beach beyond
   the palette's own forbidden list. If POS contains no trigger and the
   scene has no plausible drift path, the term does nothing.
3. Duplicate color soup: "saturated cyan, saturated-blue, cold blue light,
   pure-cold-white" is ONE guard written four ways. One strong phrasing
   per guarded axis.
4. The deformity zoo (bad anatomy, mutated hands, extra digits, long
   neck...) — the house never adopted quality-soup NEG, and this is the
   same failure in anatomical drag. Exception: when hands ARE the prompt's
   subject (a hand-bra, a shielding pose), hand-specific guards may enter
   TIER 3 — the failure mode is then specific and likely, not speculative.
5. Emotion/pose guards that fight POS content: a NEG "smiling" in a scene
   whose doll-copies smile blankly suppresses the composition itself
   (SP-03 case); NEG "standing" in a scene that stages a run does the
   same. This is the §4 contradiction check one layer up: NEG must not
   ban what POS stages on purpose.

Target size: 25-40 terms per prompt (SP and single orders); batch NEGs
hold the same economy plus the palette-forbidden tier. The §4 mandatory
contradiction check runs unchanged — and gets easier to run honestly on
a lean NEG.

Grandfathering: SP-01's 90-term NEG stays as delivered (it is the
author's record of a posted image). The doctrine binds forward from
2026-09-05; if SP-01 is ever re-rolled for regeneration, its NEG is
re-built under §49 first.

50. RATING HONESTY LAW (author directive 2026-09-09, evening — BINDING; legal
basis for RATING_MAP.md v1.0 and rating_gate_lint.py; v3.2-EXP-V10)
Author note (verbatim core): «Ты не выдерживаешь формат R, R+ — слишком
стерильно всё получается... Нужно пересмотреть то, как мы подходим к
цензуре промптов, а так же — заранее составлять карту степени цензуры,
чтобы учитывать её при составлении промпта. Тут должно было быть почти всё
R и R+... Ты непонятно чего боишься, потому что никто нам с тобой по
кумполу не надаёт.»

The honest re-audit that triggered this law (rating_gate_lint.py,
2026-09-09): N20's labels claimed R×9 / R+×10 / X×2; the payload earned
R+×1 (P05), X×2 (P04 full, P07 degree-thin), R×1-2, PG-13×16. SET5's Mab
claimed R+ and earned R. Of the era's ~17 R+ labels, 2-3 were real. The
«почти всё R и R+» order was violated in substance while satisfied on
paper — the system was grading its own intentions, not its output.

THE LAW (five clauses):

(1) THE LABEL IS EARNED. A prompt's Yodayo tier is min(state-allowed,
    degree-earned). Degree = carrier count × class diversity × payload
    share × framing compliance, measured by rating_gate_lint.py against
    the RATING_MAP lexicon. A label without its earned payload is a
    defect, not a judgment call.

(2) THE MAP IS THE PRE-FLIGHT. RATING_MAP.md is consulted BEFORE writing
    («заранее составлять карту»): tier → state combo → carriers (≥2
    classes, ≥1 flesh-detail for R+) → framing → theme wraps the
    armature. Themes that cannot host their tier's carriers are wrong
    themes, never a license to hedge.

(3) C074/X-TASTEFUL IS SCOPED TO X. The «exposure is state, never the
    subject» retreat register was written for the 2 X slots; it is hereby
    BANNED as a house style for R and R+ prose. R+ prose is arousal-first
    per the ladder's own definition («картинка уже явно сделана ради
    сексуального возбуждения»): the body is the sentence's subject, the
    poetry amplifies it. The hedge blacklist (RATING_MAP §5) is law.

(4) THE GATE IS A PIPELINE STAGE. From N21, every batch / OC SET / SP
    deliverable runs rating_gate_lint.py BEFORE kebab and simcheck. The
    footer audit reports claimed vs earned side by side. Shortfall → ADD
    CARRIERS (the author's standing greed directive; fix direction is
    always MORE heat — re-labeling down without an author order is the
    opposite failure and equally forbidden).

(5) THE ETERNAL LOCKS STAND. §4 genital lock, C072 POS literals, C073
    2-X default, TAPE platform empirics, OC canon locks, §49 NEG economy —
    the map amplifies WITHIN these borders; none of them move. The author's
    boundary is the ladder itself: R+ is fabric-over-the-point honesty,
    X is bare, XXX does not exist.

Relationship to §41: §41 remains the ladder definition (community tiers,
boundary rule, TAPE empirics, LLS mapping as the STATE axis). §50 adds
the DEGREE axis and the honesty enforcement. Where §41's prose examples
imply retreat styling for non-X tiers, §50 overrides. OC floor language
(«R+ minimum») now means R+ EARNED per the gate, not R+ labeled.

51. SATURATION DOCTRINE (author directive 2026-09-10 — «маска блеклости» fix;
BINDING from N21; the law behind the PALETTE_LIBRARY tail and §16's color
closer mandate; legal basis of the color gate in the batch lint)
Author complaint, verbatim: «Слегка попробуем поиграться с цветовой гаммой,
потому что иногда — слегка блекловато. Правда. Бывает, что сама палитра
хороша, а на картинках будто маска какой-то блеклости, попробуем решить
этот вопрос.»

Machine diagnosis (scripts/color_audit.py, 2026-09-10): N20 DESAT/SAT word
ratio 1.66 with 7/21 wash-risk prompts (worst of the series); N18 ~1.2;
N19 0.85. Three feeding layers: (1) the palette library's own vocabulary —
pale-/faint-/smoke-/ash-/fog-/worn- words are the NAMED colors C069 requires
in POS, and the model obeys them as global desaturation instructions;
(2) diffuse-dominant light choices (LQ02/LQ10 defaults) flatten contrast;
(3) the NEG side never carried a single anti-wash term (0-2 occurrences per
batch, whole files). The palette was never the disease. The REGISTER was.

THE FIVE LOCKS (each is a lint-checkable rule; family guidance in the
PALETTE_LIBRARY tail):

(1) DEEP-ANCHOR LOCK. The quality closer anchors the dominant as DEPTH,
    never as pallor: "deep-mist-grey depth", "smoke-deep-charcoal shadow" —
    never "pale-fog tones". Every pale-family word in the closer pairs with
    a depth-qualifier in the same phrase. A muted palette is rendered as
    DEEP-muted, not as milky-muted.

(2) SATURATED ANCHOR LOCK — one per prompt. Every prompt names ONE
    full-saturation element doing visible work: the vermilion stroke, the
    blood-edge, the coral anomaly, the gilt thread, the corona ring. This
    is the classic monochrome+1 punch-through: one honest saturated accent
    tears the milky film open. Even the foggiest composition carries its
    silver-edge at full polish.

(3) CONTRAST CARRIER LOCK. Every POS carries at least one light-contrast
    carrier — rim, specular, wet-highlight, hard shadow line, caustic,
    corona. Contrast reads as color: a flat frame is a washed frame
    regardless of hue. When the dominant is pale-family, prefer FR4 over
    FR1/FR2 and hard/rim LQ over flat diffuse.

(4) ANTI-WASH NEG LOCK (rides §49 TIER 3): base "washed-out, faded colors,
    low contrast" always; extended "desaturated palette, milky haze, grey
    overlay, flat lighting" when the palette dominant is a pale-family
    word. One guard per axis, no soup (§40C).

(5) COLOR GATE. The batch lint counts SAT vs DESAT carriers per prompt
    (the color_audit lexicon): DESAT/SAT ≤ 1.2 and SAT ≥ 3 per prompt,
    or the prompt fails. Sole exemption: the batch header declares
    MUTED-BY-ORDER — the author's explicit muted-theme order (N20's
    mono-no-aware would have carried it legitimately: muted BY ORDER,
    never by drift).

Relationship to §40B: §40B fixed the POS-side disease (banning the ban on
vivid). §51 completes the fix — it does not un-ban anything; it ADDS the
five locks so the chosen register renders at full value. §40C is §51's
NEG-side arm. The color closer pattern in §16 is §51's render anchor.

52. TAG-DELIVERY LAW (2026-09-10, author verdict on the N21 demonstration
run: «я бы с сильным трудом назвал увиденное R+... оно даже в PG 13
трудно умещается» — beauty PASS, rating FAIL). The image model speaks
tags; the house prose speaks poetry; the NEG speaks law. A payload that
exists only in the prose register is a payload the render never receives.
Four clauses:
(1) RAW TAG FLOOR — every R/R+/X POS carries platform-parseable tags in
    the tag-run (immediately after «1girl, solo, »): R ≥1 shape-safe,
    R+ ≥3, X ≥2 state anchors. Bank and matching law: RATING_MAP v2.0
    §4A. Tags mirror the prompt's OWN carrier stack — they deliver the
    payload, never invent a second one.
(2) NEG-PAYLOAD PARITY — NEG never bans the tier's/prompt's own payload.
    «nipples visible through» is banned from every R+ NEG (it IS the
    tier); the bare-forms trio guards the real boundary. A prompt's own
    raw tags never appear as whole NEG terms. Multi-word feature
    sculptors («tentacles with mouths») are legal.
(3) THE REGISTER BALANCE — direct physical statement (concrete noun +
    determiner) LEADS the payload clause; poetry wraps it, never
    replaces it. «The cold's two verdicts stand hard» without the tag
    floor beneath it is decoration, not delivery.
(4) GATE v2 — rating_gate_lint.py enforces both floors mechanically
    (exit code 1 on fail) on every batch, SET, and SP deliverable from
    N21 rev2 on. The §49 Tier-1 C072 bullet is amended accordingly.
    §50 (label honesty) and §10 eternal locks stand unchanged — §52
    changes the DELIVERY channel, not the boundary.

53. MATURITY & HELPER LAW (2026-09-11, the author's PH-off experiment on
Pixai DiT Tsubaki 2: «появилась проблема с телами - они весьма детские
(лоли) и с большой головой. с PH такой проблемы нет»). The platform's
Prompt Helper (PH) is a silent pipeline stage between this file and the
model — at once a normalizer and a sanitizer. Observed on the author's
specimen (spool prompt, PH rewrite 2026-09-11): PH preserves strong visual
anchors near-verbatim (black void, red thread, linen wrap, spool-case,
fist, rim light), strips meta-concept prose and trailing quality tags —
and sanitizes BOTH channels of heat: anatomy («camel-honest... the
mound's full shape printed» → «curves of her chest and thighs, emphasizing
her form») and arousal vocabulary («anguished and wanting» → «anguish and
longing»). A PH rewrite may also dissolve the §52 tag floors before the
parser ever weighs them (the specimen dropped even «Masterpiece, best
quality»). Four clauses:
(1) PH MODE — R/R+/X renders go out with Prompt Helper OFF: the helper
    rewrites heat down before the model reads it, so no R+ payload can
    survive the layer that made N21 render PG-13. PG-13 renders may
    keep PH ON — its normalization is harmless there and its silent
    adult anchoring is even useful.
(2) MATURITY ANCHOR FLOOR — with PH off, the anti-loli guard the helper
    was silently providing becomes OURS. Every POS carries: (a) the tag
    «mature female» in the tag-run immediately after «1girl, solo, »;
    (b) an adult anchor in prose — the face formula reads «Her grown
    woman's face is rendered in stylized 2D anime style:», or an
    equivalent explicit adult marker when the prompt's face treatment is
custom (P10-style). The chibi drift recipe is exactly «1girl» prose +
    large expressive eyes + small nose + small mouth with zero adult
    counter-signal — the author's specimen rendered it as childish
    bodies with oversized heads. «1girl» wording alone never ships
    without its anchor.
(3) ANTI-LOLI NEG FLOOR — every NEG carries «child, childish, chibi,
    young girl, immature body, oversized head» (after the base realism
    block). Tier-independent hygiene from PG-13 to X; never counted
    against §49's economy caps; never removable for style.
(4) GATE v3 — rating_gate_lint.py checks the POS anchor and the NEG
    floor mechanically (exit code on fail). Maturity tags are HYGIENE,
    not payload: «mature female» never counts toward the §4A tag floors
    and is not a tier-legal payload tag. §41/§50 boundaries and §10
    eternal locks stand unchanged — §53 changes WHO supplies the adult
    body (us, not the helper), not what the tiers mean.


54. RACE DELIVERY LAW (V14, 2026-09-12 — author directive: «маловато
девушек с расовыми фишечками» после N22; the N22 autopsy: 9 races
CAST and logged in TRACKER, 0-1 feature mentions in POS prose, zero
race tags in the tag-run — the features never reached the render; the
bookkeeping was dressed, the girl was not). Four clauses, binding:
(1) RACE TAGS — every racial girl carries her features as
    platform-parseable tags in the tag-run (elf ears / horns / tail /
    scales / bat ears / ball joints / fox ears / vines — the parser's
    own language, the §52 channel: PH-resistant, parse-weighted).
(2) PROSE ×2, ≥1 ACTIVE — every racial girl's features appear ≥2
    times in POS prose, at least once ACTIVE: the feature interacting
    with light, pose, or scene (the ear-rim taking the key first, the
    tail mid-curl around the jar, the bloom keeping its daylight) —
    the N21 precedent, not the N22 flat mention.
(3) WARDROBE NEGOTIATES ANATOMY — the atelier doctrine (POOLS §3)
    is mandatory prose for every racial girl: the garment acknowledges
    the anatomy (tail-hem, horn-aware drape, armholes cut around the
    ears, the slit the tail exits).
(4) NEG SHIELDS SCULPT, NEVER BAN — the NEG bans WRONG variants as
    multi-word sculptors («fox ears» for a cat-kin), never the girl's
    own cast feature, never «no X» forms.
The batch lint checks all four mechanically from N23.

55. FET SCENARIO HOOK FLOOR (V15 — author directive 2026-09-13; the
recommendation becomes a hard gate)
Every batch carries ≥2 SCENARIO-level FET hooks (the FET11-25 register:
swimwear malfunction, mirror voyeur, stuck, examination, library ladder,
pet-play and kin — the scenario codes, not the light-focus codes).
N19 proved the capacity (8/21 hooks, no diversity loss); the audit showed
the failure mode (0-1 hooks in N17/N18/N20 — the batch's best R+ fuel
left in the tank). The batch lint hard-fails on <2. Window law applies as
always (the hooks must be window-clean); focus codes (FET01-10 and the
high register) do NOT count toward this floor — scenario hooks only.

53A. MATURITY RANGE (V14, 2026-09-12 — amends §53 clause 2; author
directive: «Милфы — пусть остаются, как и все в пуле, кроме детей.
Mature/voluptuous оставить, + young adult, tall, long-limbed, slender,
young woman's build, там может быть студентки (не школьницы). Важно
было защититься от лоли и только от лоли»). The POS adult anchor is a
BANK matched to the girl's build, not a uniform:
- «mature female» — FAM-A builds (the milf register stays; the dairy
  farms are legal and loved);
- «adult woman» — FAM-B builds (the house default);
- «young woman» — FAM-C / college-age builds (студентки разрешены;
  школьницы — никогда; the «college age» tag may ride the run).
The grown-woman face formula and the anti-loli NEG floor are
UNCHANGED and universal — the enemy is the chibi, never the range.
The uniform «mature female» rendered one body type 21 times
(«собрание дойных мамочек»); the bank restores the A/B/C body-family
spread to the RENDER. Gate v4 accepts all three anchors.

53(1) PH MODE — AMENDED (V14, 2026-09-12 — author directive: «Да с
эротикой в этом батче вроде проблем не было. Генерим на PH и
дальше»): PH ON is the standing render mode. The N22 empirics closed
the loop: with §52 tag floors carrying the payload and §53 anchors
ours, the renders came back adult-bodied and R+-honest WITH PH ON
(author-confirmed, both modes tested on the cycle). PH OFF remains
the diagnostic arm, not the default. Consequence: the tag-run is the
PH-resistant channel of record — payload tags, race tags and the
maturity anchor all ride it; the prose carries the beauty past the
helper's rewrite. (The Self-PH skeleton of PH_MICROTEST arm C remains
the fallback protocol if a future cycle shows the helper dissolving
the tag floors.)
