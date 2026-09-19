# THREAD 4 — RULES_CORE
Engine: **Tsubaki.2, Pro mode** (PixAI). Supersedes THREAD 3.2-EXP entirely — clean
slate, not a patch.

**Engine history**: THREAD 4 was originally built against Tsubaki.3. After a direct
side-by-side test (same prompt, both models) on the first live batch, Tsubaki.3's
output was unusable — author's verdict, flatly: "полное говно," comparable to
Tsubaki.2 at its own launch. Everything built this session (VOLT/NICHE mechanics,
engines, OC canon, rating discipline, PH-shape) carries over unchanged — none of it
was Tsubaki.3-specific. The one section that WAS Tsubaki.3-specific (the chiaroscuro/
specular-highlight light module, §9) is now marked parked, not deleted — Tsubaki.3
may mature later and it can come back out. Default target is Tsubaki.2 Pro until
further notice.

## 0. Doctrine
- This file is *replaced*, never amended-in-place. No §-history inside the rulebook.
  Version bumps live in CHANGELOG.md (not written yet — start it when the first real
  revision happens). RULES_CORE always reflects current practice only.
- No fix-pass culture, no first-pass contract law, no ledger of errors. Write it right
  the first time by using this file; if something's wrong, fix it and move on — the
  correction itself is not a process.
- Token economy is the real constraint, not ceremony. Every mechanic below earns its
  place by having *worked* in a live test this session — nothing here is theoretical.

## 1. Batch skeleton
- **21 + 3 in one file.** The 3 are OC commissions — headline-tier, NOT bound to
  VOLT/NICHE axis; genre/rating follows the order itself.
- Split inside the 21: ~7 NICHE / ~14 VOLT, same ratio as 3.2. Not a hard quota.
- **EXQUISITE**: 1–2 slots per batch by vibe, not mandatory. If the batch theme is
  genuinely rich, go up to 4 — "по вайбу", not a rule to satisfy. One ultra-VOLT,
  one ultra-NICHE is the default target when used.
- Default VOLT slot with no special concept = plain exposure/ass-shot. This is a
  legitimate, unforced slot — not every VOLT needs a hook.
- One file, one pass, whole batch at once. No partial delivery by default.

## 2. Rating discipline
Per Yodayo's manual. **No genitals, ever** — hard floor, no exceptions, no ambiguity.
**XXX (an actual sexual act depicted) never happens** — hard ceiling, same status as
the genital floor.

**Working classifier** (author's own, use this to calibrate every VOLT slot's POS
tags — don't guess, hit the tier on purpose):

| Tier | Tag-level signal |
|---|---|
| PG-13 | sexy outfit, bikini, cleavage, thighs |
| R | lingerie, panties, bra, upskirt, an erotic pose |
| R+ | camel toe, nipples-through-clothing, extreme fanservice, near-nude body |
| X | nipples or genitals actually visible |
| XXX | a sexual act — **never used, ever** |

Taped nipples (the X-shaped tape carrier, see e.g. Vae's canon) = **R+**, not X — the
tape is what keeps it there.

**VOLT's floor is PG-13, not a ban on it.** A VOLT slot can sit anywhere PG-13
through R+; what makes it VOLT is the §5 mechanics (camera/behavior/gaze/exposure),
not automatically landing on a high tier. A batch's stated "dominant rating" (e.g.
"R+" on N31) means most VOLT slots should be *written to explicitly hit* R-tier or
R+-tier signal words from the table above — not vague implication that quietly reads
as PG-13 regardless of intent. Confirmed failure mode on N31 P01/P03: "off-shoulder,
bare shoulder" alone, however the prose frames it, is PG-13-tier signal — it doesn't
climb the ladder on its own. If the slot is meant to be R or R+, say so with R/R+-tier
tags, don't rely on narrative framing to imply a tier the tags don't back up.

Rating gate stays **advisory, not blocking**. If a render lands on X by accident,
that's the author's call to fix in-editor (tape/crop) or leave — not a pipeline halt.
Rationale: X-rated posts get algorithmically suppressed on Yodayo regardless of
quality, so the cost of an accidental X is the author's to manage, not the system's
to prevent at all costs.

## 3. Maturity — single floor, no banking
- One NEG line, always on: no children, no schoolgirls, no chibi/oversized-head coding.
  That's it. No age-register banking (young woman / adult woman / mature female as a
  tracked mechanic) — maturity in prose is free-form, whatever fits the character.
- **`adult woman` / `mature female` do NOT go in POS.** Tested on N30: putting either
  tag in the positive tag-block skews the model hard toward MILF-coded results across
  the board, batch after batch, not just when actually wanted. The anti-child NEG
  floor above is the only maturity mechanic that belongs in the prompt. If a specific
  slot genuinely wants an older/MILF register, say so narratively in the prose body
  (not as a POS tag) or use Sue's MILF-MODE (OC_CANON.md) for an OC order.

## 4. Race pool
Active, carried from 3.2 (validated, on-brand): elf, kitsune-kin, wolf-kin, ram-demon,
dragon-kin, serpent-kin, goat-kin, deer-folk, bat-kin, bunny, merfolk, dryad,
porcelain-doll, **jellyfish-kin, harpy-kin** (both confirmed gold by direct feedback —
formalized here, not just anecdotal).
Off-limits by author taste: dwarves, goblins, trolls, orcs — anything in the
"ugly fantasy creature" register. Open to new race proposals; no cap.
Race must **do physical work in the frame** (see §6 NICHE mechanics) — a species tag
without a mechanic is a costume, not a race.

## 5. VOLT mechanics
Derived empirically from direct author feedback on what actually earned "просто имба" /
"крутая физика" verdicts (VOID, BLASPHEMOUS, FLUERE batches). Four required axes —
not decoration, a checklist:

1. **Camera as participant, not observer.** Not front/left/right — a camera position
   that itself creates tension: low-angle up through the legs, over-the-shoulder in
   close, through a reflection/gap, floor-level. Never neutral framing on a VOLT slot.
2. **Behavior/pose in motion, not static display.** Body caught mid-action (arching,
   curling, settling) beats a held pose. Confirmed in testing: tagged physical state
   ("back arched", "one arm above head") renders reliably; narrated grace does not.
3. **Gaze as vector.** Direction/quality of eye contact sets the scene's charge —
   locked on camera = confrontation/invitation; averted = caught; half-lidded =
   surrendered to the moment. Treat as a deliberate choice per prompt, not filler.
4. **Exposure = explicit carrier tag + counter-NEG, never narrative tone alone.**
   Confirmed by direct A/B test: "robe slid off both shoulders" as pure prose under-
   delivered; the same intent as `off-shoulder, robe fallen open, cleavage` +
   counter-NEG (`sheet covering chest, blanket pulled up, clothed shoulders`)
   delivered exactly as intended. Narrative implication is a garnish, not the mechanism.

**Law**: a VOLT concept must sit ON the body/fabric — visible on the character, not
just implied by the scene around her. (Carried forward from 3.2's ENGINES principle —
this part of it was correct.)

## 6. NICHE mechanics
Derived from the same feedback corpus (N27, N15, VOID, BLASPHEMOUS, FLUERE) — pattern
that repeats across every "охуенная ниша" / gold-tier verdict, four moves, pick one:

1. **Reversal of one natural law, anchored to one small, specific point.** Not "the
   world is strange" — one concrete, checkable inversion, pointed at a single object
   (a palm, an ember, a letter), not smeared across the scene.
2. **Dissolution / negative space.** The subject isn't shown whole — she's read through
   a trace, a residue, a reflection, an absence. Structurally opposite to VOLT, where
   the body is the subject to be shown.
3. **Race as mechanism, not costume.** The species does physical work in the frame
   (a jellyfish-hood carrying light through itself; feathered forearms splitting an
   aurora) — never just "girl with X ears."
4. **A world with its own logic, independent of her.** She's a witness/passenger to
   it, not necessarily its carrier. This is where the author's stated rating-forgiveness
   rule lives: a strong NICHE concept earns slack on a rating miss.

**Law (deliberately opposite of VOLT)**: a NICHE concept does **not** need to live on
her body. It can live in an object, the environment, the world's own behavior. Forcing
VOLT's "must sit on the body" discipline onto NICHE slots was 3.2's actual bug — it
starved the exact idea-type the author values most in this genre. Do not re-import
that constraint here.

**Density floor**: one gold concept in 21 slots isn't enough — direct complaint on
record ("если бы ниша была богата концептами — было бы в разы лучше"). Every NICHE
slot should hit one of the four moves above, not just 1–2 per batch.

## 7. Engines — lean format
Core principle kept from 3.2: a world-law that manifests physically on the body/fabric,
never as inert scenery. Everything else — the generational lineage mythology, the
prose-essay-per-engine format — cut. New format per engine, three lines max:
- **Law**: the rule in one sentence.
- **On the body**: exactly how it sits on wardrobe/skin/hair — concrete, not poetic.
- **Failure mode**: the one way this reads as scenery instead of a worn law.

3.2's open "seeds" (custody, time-scarcity, glamour-tax, etc.) carry over as raw
material to reformat this way, not as finished engines. Formalize on demand, not
upfront — no need to pre-build a full roster before the first batch.

## 8. PH (Prompt Helper) — working model
- PH does **not** sanitize by format. Confirmed: prose input gets reshaped into
  PH's own tag-block → prose → quality-tag structure; content already in that shape
  passes through untouched, verbatim, no rewrite at all.
- **Write directly in PH's target shape**: tag block first, then prose body, then
  quality tags. This removes PH as an unpredictable variable — nothing left for it
  to rewrite.
- No mandatory PH-simulation/grinding step. ph_sim_gate-style tooling is optional
  insurance, never a required pipeline stage.
- PH trims verb-led poetic flourish with no visual payload ("the pool drew itself")
  and keeps noun-form, visually-loaded phrasing (a strap slipping, a specific color,
  a named texture). Write prose accordingly — concrete nouns survive, abstraction doesn't.
- The "does PH strip '2D hand-drawn anime illustration'" question is moot now — that
  finding was Tsubaki.3-specific and unconfirmed anyway (see §9). On Tsubaki.2, this
  phrase is the standard opener again, per 3.2 practice.

## 9. Style & light — Tsubaki.2 active defaults (+ Tsubaki.3 findings, PARKED)

### 9a. Face lock (restored from 3.2, one word trimmed)
Every prompt's prose body closes its character description with the 3.2 face-lock
sentence, unchanged in structure, with one deliberate word cut:

> Her face is rendered in stylized 2D anime style: anime eyes ([color/state]),
> small nose, small mouth [state], flat cel-shaded [skin tone] skin.

**Drop "expressive" AND "large"** — plain `anime eyes`, not `large expressive anime
eyes` or `large anime eyes`. No functional reason given beyond author preference
either round; treat as fixed.
Matching NEG (already in BASE_NEG, no change needed): `realistic facial structure,
photorealistic facial proportions, natural human nose bridge, realistic lip shape,
semi-realistic anime face, 2.5D face, 3D face`.

**Opener updated again, N31 live test**: `A 2D hand-drawn anime illustration` →
`anime style, ecchi anime style, hentai anime style`, and `flat cel-shaded [tone]
skin` dropped from the face-lock sentence (now just `...small mouth [state], [tone]
skin`). Tested as a bundled change on two prompts; the author's read was "wasn't the
actual fix for the rating problem [see §2], but the image came out relatively
better" — so it stays as the new default opener, but note the two changes
(style-tag swap, cel-shaded drop) weren't isolated from each other, so which one
did the "relatively better" work is still unconfirmed. Retest split if it matters later.

### 9b. Spurious light-source guard (restored from 3.2)
Add to every NEG unless the prompt's own concept explicitly calls for one of these
as a scene element: `candle, candles, candelabra, lamp, lantern, torch, chandelier,
brazier`. Without this, the model has a habit of inventing a light-source prop that
wasn't asked for. This folds into BASE_NEG going forward (see batch template).

### 9c. Tsubaki.3 chiaroscuro/highlight module — PARKED, not deleted
Everything below was developed and validated against Tsubaki.3 specifically, to fix
a "flat duotone wash" problem that Tsubaki.3 had and **Tsubaki.2 does not exhibit** —
confirmed by the N30 side-by-side (same prompt, both models; Tsubaki.2 output was
clean without any of this machinery). Do not apply this to Tsubaki.2 prompts by
default. Keep it on file for if/when Tsubaki.3 becomes usable:

- Default technique for moody/R+ scenes: `chiaroscuro lighting, single hard light
  source, deep black shadow`.
- Mandatory third layer: explicit specular highlights anchored to named points (wet
  hair strands, collarbone curve, nose bridge, lower lip, a bead of water).
- Do NOT force `flat cel shading / hard shadow edges / no gradient shading` in POS —
  it over-flattens and kills the highlight layer.
- Anti-bloom NEG block: `bloom, lens flare, soft focus, airbrushed, gradient shading
  across large areas, painterly, semi-realistic shading, blurry glow, soft light falloff`.
- Distant/ambient sources on bare skin were the risk zone — needed a physical contact
  carrier or explicit reflection point, never bare "wash/bleed" onto skin.
- Open/unsolved even within Tsubaki.3: duotone split needs an asymmetric seam, not
  50/50 through the face; rim-light shadow side resisted going fully neutral/cool.

### 9d. Tsubaki.2 lighting — no special discipline needed
This session's N30 comparison confirms Tsubaki.2 Pro handles rich, atmospheric,
cinematic light description natively (rim light, saturated color, dual-temperature
scenes, etc. — the same register 3.2's own example batches used successfully). Write
light the way 3.2 always did: descriptively, in prose, without the chiaroscuro/anti-
bloom scaffolding in §9c. That scaffolding was a Tsubaki.3 workaround, not a general
best practice.

## 10. Scripts
Only `rating_gate` survives from 3.2's 14-script arsenal (per author: it was the only
one that ever caught a real problem). Simplified, advisory (§2). Everything else —
house_lint, rhythm_lint, freq_lint, sp_lint, simcheck, ph_sim_gate as a required
stage — cut. See `rating_gate.py`.

Repeat-check: loose, vibe-level, few-batch window ("not the same girl same pose
different background within a couple batches"). No cosine-similarity infrastructure.

## 11. OC roster
10 active — full canon in `OC_CANON.md`, not duplicated here:
Sue, Miyu, Yui, Sol, Noa, Doe, Lua, Nix, Vae, Ash.
Reference-image consistency (`@image1`) was a Tsubaki.3 feature — **on hold along
with the rest of §9c** until Tsubaki.3 is back in play. Text canon in OC_CANON.md is
the only active system on Tsubaki.2.

## 12. Batch log
- **N30 "Someone Else's Dream"** — first live batch, written against Tsubaki.3,
  generated on both models side by side. Verdict: architecture holds up (author:
  "батч хороший, просто не для той модели"), engine switched to Tsubaki.2 as a
  result (see header). Specific carryover fixes from this round are folded into
  §3, §9a, §9b above. NICHE didn't get a fair read (rendered mostly on the bad
  model) — retry with real attention next time. Some VOLT slots ran simpler than
  the §5 checklist really wants — forgiven as a first test, not forgiven twice.
- **Next up**: re-run or extend "Someone Else's Dream" on Tsubaki.2 with the
  updated template (§9a/§9b applied, no §9c chiaroscuro scaffolding, no `adult
  woman`/`mature female` in POS) — worth doing before moving to a new theme, to
  get a clean read on NICHE this engine actually earned.
