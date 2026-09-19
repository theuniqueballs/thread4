# THREAD 4 — RENDERER_FACTS.md

Empirical facts about the rendering chain (PixAI / Tsubaki.2 Pro + Prompt
Helper / Yodayo). Every fact here is tested, with provenance. Facts feed
recipes, gates, and templates. A fact that fails retest gets amended via
event, never silently.

## ENGINE

- **Tsubaki.2 Pro** is the standing engine. **Tsubaki.3 tested side-by-side
  on N30 and rejected: «полное говно»** (comparable to Tsubaki.2 at its own
  launch). Everything parked for Tsubaki.3 (chiaroscuro/specular module,
  @image1 reference consistency) stays parked until it matures. [C-N30]

## PROMPT HELPER (PH)

- PH does NOT sanitize by format — it RESHAPES input into its own form:
  tag-block → prose → quality tags. Content already in that shape passes
  **verbatim, no rewrite at all**. ⇒ Write in the target shape. [C-N30]
- PH trims verb-led poetic flourish with no visual payload («the pool drew
  itself»); keeps noun-form visually-loaded phrasing (a strap slipping, a
  specific color, a named texture). ⇒ Nouns carry the claim; verbs are
  allowed to be boring. [C + RF-002: verb-led carriers eaten wholesale]
- The tag-run is NOT a PH-resistant channel — PH dissolves it into prose
  when it isn't already in PH shape. (RF-002: claimed R7/R+12/X2 rendered
  ≈ PG×13/PG-13×3/R×5/weak-R+×2/R+×1/X×1.)
- PH LEAKS: artist tokens self-inserted (stuart_pot ×3), character tokens
  (grey_wolf ×2). ⇒ Anti-leak NEG guard on every prompt. (RF-002)
- PH's own maturity layer is gone in the current mode; the anti-loli NEG
  floor is ours to carry. (3.2 §53 history.)

## TAG / RENDER BEHAVIOR (Tsubaki.2)

- `adult woman` / `mature female` in the POS tag block skew the WHOLE
  batch toward MILF-coded results — batch after batch, not only where
  wanted. Tested on N30. ⇒ Age registers live in prose narrative only. [C-N30]
- Tagged physical state renders reliably («back arched», «one arm above
  head»); narrated grace does not. [C]
- Exposure delivered via explicit signal tag + counter-NEG works exactly as
  intended; the same intent as pure prose under-delivers. A/B tested. ⇒
  counter-NEG is a required axis of every exposure claim. [C]
- «off-shoulder, bare shoulder» alone reads PG-13 regardless of prose
  framing. Tier signal must be explicit. (N31 P01/P03 failure.) [C-N31]
- Opener bundle (N31, tested together, split unconfirmed): `anime style,
  ecchi anime style, hentai anime style` opener + face-lock without
  `flat cel-shaded` («relatively better»). Adopted as tier-laddered default.
  [C-N31]
- Face lock form: drop «large expressive» — plain `anime eyes`. [C]
- Spurious light-source spawns (candle, lamp, lantern, torch, chandelier,
  brazier) without a NEG guard. ⇒ Spawn guard in BASE_NEG unless the
  concept calls for one. [C + 3.2 §40]
- Tsubaki.2 handles rich atmospheric/cinematic light natively — no
  chiaroscuro scaffolding needed (that was a Tsubaki.3 workaround). [C-N30]
- The X recipe of 3.2 (bare state doubled + fantasy anatomy + open mouth)
  held at render (RF-002 P14) — but is RETIRED as a general recipe; each
  tier now carries a full recipe (constitution §4, author 2026-09-19).
- Taped nipples (X-tape) render and classify R+ — the tape holds the tier.
  [C + 3.2 platform empirics]

## YOADAYO (platform)

- Community ladder: PG / PG-13 / R / R+ / X. XXX never (our floor, and
  platform-illegal content anyway).
- X-rated posts are algorithmically suppressed regardless of quality. The
  author manages accidental-X in-editor (tape/crop) — the rating gate is
  advisory-at-the-margin for X drift, HARD on the floors (genitals, XXX).
  [C]
- Author's own tier table (2026-09-19) — the classifier of record, see
  CONSTITUTION §4.

## MATURITY (author directive 2026-09-19)

- Loli → always NEG (child, childish, chibi, young girl, immature body,
  oversized head).
- Positive-side diversity as registers: студентки (college students),
  молодые (young women), милф (MILFs). **Бабулек не надо** (no grannies).
- No maturity protection needed in POS — no age tags at all (the N30
  MILF-skew receipt).

## OPEN QUESTIONS (retest when it matters)

- Opener bundle split: style-tag swap vs cel-shaded drop — which one did
  the «relatively better» work? [C-N31]
- Does `hentai anime style` on PG-13/NICHE slots push exposure? Current
  policy: tier-laddered opener (constitution §6).
- VLM render-reading: can uploaded renders be auto-graded? — attempt
  authorized by the author 2026-09-19 («если хочешь — можем попробовать»).
