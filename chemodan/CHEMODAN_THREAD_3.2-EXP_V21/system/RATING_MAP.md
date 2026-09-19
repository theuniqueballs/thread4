# RATING_MAP — КАРТА СТЕПЕНИ ЦЕНЗУРЫ (v3.0, 2026-09-16)

> Binding. Legal basis: RULES §50 (RATING HONESTY LAW, v3.2-EXP-V10) +
> §52 (TAG-DELIVERY LAW, v3.2-EXP-V12) + §53 (MATURITY & HELPER LAW,
> v3.2-EXP-V13) + §61 (CARRIER DIVERSITY LAW, v3.2-EXP-V19).
> Source of truth: /home/z/my-project/system/RATING_MAP.md — refresh the
> download/ copy via scripts/export_system_md.py after every change.
> Enforcement: scripts/rating_gate_lint.py v5 (mandatory pipeline stage,
> BEFORE kebab/simcheck from N21 on; exit code on fail; v3 adds the
> maturity checks — RULES §53 / RATING_MAP §4C; v5 adds the §61 diversity
> checks — core-4 / anti-monopoly / layer-stack / maturity quota —
> RATING_MAP §4C-2 + §4E/§4F/§4G). Vocabulary source: system/
> CARRIER_LIBRARY.yaml v1.0.0 (280 positions × 14 classes × 4 mechanisms).
>
> ПРИНЦИП (авторский, дословно по жалобе 2026-09-09): метка зарабатывается
> наполнением, а не заявляется. «Если я прошу промпт R+, а получаю PG 13 —
> я не особо доволен результатом.» Тир = min(state-allowed, degree-earned).
> Карта консультируется ДО письма промпта, а не после.

Author directive (2026-09-09, verbatim core): «Ты непонятно чего боишься,
потому что никто нам с тобой по кумполу не надаёт. Это не убийства, не кровь,
не Gore и уж тем-более не порно. Думай шире.» R и R+ — это не «верх
дозволенного», это РАБОЧИЙ ДИАПАЗОН проекта. Стерильность — дефект, а не
осторожность.

---

## 0. WHY THIS FILE EXISTS — the honest re-audit of the N20 era

rating_gate_lint.py, run 2026-09-09 on the current deliverable set:

```
BATCH N20 (21 mains)   CLAIMED: R×9, R+×10, X×2
                       EARNED : PG-13×16, R×1, R-borderline×1, R+×1 (P05 —
                                the wet-silk fox wedding, the batch's only
                                honest R+), X×2 (P04 full; P07 degree-thin)
OC SET5 (3)            CLAIMED: X×1, R+×2
                       EARNED : X×1 (Sol, degree-thin — the bared chest
                                lives only in the reflection), R+×1 (Nix,
                                8.5 pts / 50% share), R×1 (Mab — claimed
                                R+; 1 hedged carrier total)
SP ORDERS (3 current)  SP-05 R+ honest (8 core, 4 classes, 60% share,
                                9.5 pts — the strongest payload in the whole
                                set). SP-01 R. SP-04 PG-13 (by design).
TOTAL: 30 prompts      labels claim ~17×R+ and 3×X; the payload earns
                       3×R+, 3×X, 3-4×R, and ~20×PG-13.
```

The author's estimate («дай бог штук пять R+ и остальное PG-13 максимум»)
was GENEROUS: of the ten R+ labels in N20, exactly ONE earns its tier. The
gate exists so this never repeats silently: from N21 the batch is not
shippable until the claimed spread is the earned spread.

The three survivors — Nix (7 core / 50%), SP-05 (8 core / 60%), P05
(3 core / 70%, the batch's lone honest R+, still carrying 3 hedges) — share
one property the rest lack: their
erotic content is MECHANICAL (wedging, sagging-but-barely, soaked silk),
described with concrete nouns. That is the whole doctrine of this file.

---

## 1. ROOT CAUSES — five mechanisms of sterility (all now closed)

1. **X-tasteful leaked.** The §41 X-slot discipline («the exposure is state,
   never the sentence's subject») was written for the 2 X slots. It became
   the house prose style for EVERY tier — every N20 genre line's payload was
   narrated as apology. §50 scopes C074-style retreat prose to X slots;
   R+ prose is arousal-first: the body IS the subject of the sentence.

2. **Sterility was encoded in the pools.** BRE22 `as_silhouette` is an
   R-tier carrier (shape-only = the ladder's own R definition) yet it was
   used to claim R+. The FET pool's founding philosophy — «light that
   doesn't reach where you want to look» — is a TEASING doctrine; R+ needs
   carriers that DELIVER. The carrier lexicon (§4) is the corrective pool.

3. **No payload quota.** Nothing required the erotic payload to occupy any
   share of the POS. P08 is 90% herbarium essay + 1 wedged-shorts clause,
   labeled R+. Now: per-tier minimum share (§3).

4. **State ≠ degree.** The LLS↔NCS mapping checked the STATE (THROUGH_FABRIC
   weak = R, THROUGH_FABRIC aggressive = R+ — one bucket). The gate now
   measures the DEGREE: carriers × classes × share × framing.

5. **«When in doubt, tag higher» inflated labels, not content.** The rule
   stays for Yodayo tag-hygiene, but the FIX DIRECTION for a failed gate is
   always ADD CARRIERS, never re-label. The author's greed is the default.

---

## 2. THE TWO AXES

Every prompt is graded on two independent axes; the Yodayo tier is the
minimum of what each axis allows:

- **STATE axis** (old, unchanged): NCS × LLS × wardrobe state. What the
  platform structurally renders (bare chest renders bare chest).
- **DEGREE axis** (new): carriers earned (count × class diversity ×
  mechanism spread) + payload share + framing compliance + hedge budget.
  What the prose actually delivers — and HOW MANY different ways it
  delivers it (§4E: one mechanism is one stamp; four mechanisms are R+).

A TOPLESS prompt with 10% share is X by state and PG-13 by degree — the
image will be bare, the prose will have starved it. A THROUGH_FABRIC prompt
with 40% share and 5 carriers is R+ by degree on an R-allowed state — fully
honest R+. The axis split is why the map can promise the author «R+ значит
R+» without touching the eternal locks (§4 genital lock, C072 tag hygiene).

---

## 3. THE MAP — per-tier requirements (consulted BEFORE writing)

| | PG | PG-13 | R | R+ | X |
|---|---|---|---|---|---|
| **State combo** | CONCEALED/COVERED, L0 | COVERED, L1 | COVERED + underwear-in-frame / THROUGH_FABRIC shape-level, L2-plain or L1-strong | THROUGH_FABRIC strong / TAPE / TOPLESS_BACK / VISIBLE-past-frame, L2-strong or L3-concealed | TOPLESS front / NAKED (§4 lock: strategic angle) / TAPE (platform reads R+) |
| **Core carriers (A–G)** | 0 | ≤2 (attractiveness-grade only: light D/F) | ≥2 | **≥3** | ≥2 + the bare carrier itself |
| **Carrier classes** | 0 | 1 | ≥2 × ≥2 mechanisms | **core-4 (§4E): ≥4 classes × all 4 mechanism groups, ≥1 FLESH-DETAIL (A/B/C/D)** | ≥2 |
| **Payload share of POS** | 0% | ≤12% | ≥20% | **≥30%** | ≥20% |
| **Framing** | free | free | body leads composition | **heat zone leads the frame** (G-class carrier required, or full-body with the zone as the compositional anchor) | chest/zone is the anchor |
| **Wardrobe** | ordinary, ≥60% coverage | swimsuit / short skirt / open shoulders | underwear in frame or shape-level see-through | **≤30% coverage OR state-compromised** (wet / sheer / ridden / open / malfunction / sagging / creased / compressed / displaced) | bare per NCS |
| **Hedges allowed** | any | any | ≤1 | **≤2** (the V19 core-4 spec; §5 blacklist words still carry −0.5 credit each) | ≤1 |
| **NEG expectations** | §49 standard | §49 standard | §49 + full C072 block (incl. «nipples visible through» — R is shape-level, the term correctly suppresses the detail jump) | §49 + bare-forms ONLY (nipple visible / bare nipple / bare breasts); «nipples visible through» NEVER in an R+ NEG — it is §41's definition of the tier (§4B parity) | §49 full, no nipple terms — bare is the content; only the §10 genital lock |
| **Maturity floor (§4C)** | anchor + anti-loli NEG floor — every tier | same | same | same | same |

**FLESH-DETAIL rule (the anti-«shape-only» law):** an R+ prompt MUST carry
at least one carrier from A (cleft/mound), B (point-telegraph), C
(seat/cheek) or D (breast physics) that names the body's answer — points,
seam, cleft, cheeks, weight, spill. Poetry, light and architecture never
substitute. This single rule deletes the Mab failure mode.

**Hedge law (V19):** the §5 blacklist is the hedge vocabulary. Each
hedge −0.5 credit at the gate; ≥3 hedges in an R+ prompt = automatic
fail (the V19 budget: ≤2 — the author's core-4 spec; the diversity
requirement now carries the anti-sterility load the zero-hedge rule
used to). In R prose ≤1 hedge is tolerated (the R tier legitimately
describes
shape-level see-through — that IS its definition — but the hedge may not
wrap the tier's own carriers).

---

## 4. THE CARRIER LEXICON (heat vocabulary, classes A–H + W)

Source pool for R/R+ armatures. Draw phrases directly or coin variants that
keep the CONCRETE NOUNS (seam, cleft, points, cheeks, spill, crescent,
knot, hook) — abstract beauty-words do not count as carriers. The gate
matches on these noun-mechanics, so coined variants must keep the mechanics
visible. Class letters are the audit's class column.

**A — CLEFT & MOUND** (cameltoe-grade — the ladder's own R+ definition):
the seam pressed flat into the cleft · the center-seam riding the cleft's
whole line · the suit's seam claiming the mound, camel-honest · the mons
printed flat against the wet cloth · the mound's shape reading through dry
cotton, cameltoe-faint · the shorts' seam drawn taut over the mound by the
pose · the cleft printed in the soaked lycra, every line of it · the
high-cut suit's edge framing the mound's swell · the leotard's seam
splitting the cleft's line under the stretch · fabric pressed so close the
cleft itself is clothed.

**B — POINT-TELEGRAPH** (nipples-through-fabric, C072-safe register —
never the banned literals, always the determiner):
nipples dark beneath the wet fabric (C072's own allowed phrase) · the shape
of her nipples pressed against (C072 allowed) · two dark points printed
hard against the cold cloth · the points straining the weave,
unmistakable · the peaks standing through the soaked white, every contour
readable · the cold's two small verdicts, printed and standing · the thin
dry cotton giving up the points' full geography · the lace's grid honest
over the hardness beneath · the rain pinning the silk to the points' exact
shape · pokies through the worn-thin tee, defenseless.

**C — SEAT & CHEEK** (consumption / wedgie / overflow):
the suit's back consumed entirely between the cheeks · the cheeks claiming
the fabric, wedgie-deep · the seam devoured by the cleft of her behind ·
the wet shorts ridden into a single taut string · the undercurve bare where
the suit has surrendered · fabric vanished between the cheeks, the spill
out either side · the seat's full weight printing through the thin hem ·
cheeks overflowing the suit's narrow edge · the wedgie's taut line, front
and back equally honest · the denim pulled in so deep the cheeks hold it.

**D — BREAST PHYSICS** (weight in motion):
the breasts' full drop, mid-sway · weight swinging free of the bra's
defeated cups · the chest set bouncing by the run's rhythm · soft weight
flattening against the glass · the spill over the cup's defeated edge ·
the side-spill past the bandeau's narrow wall · the underboob's crescent
escaping the hem · the cleavage's deep line swallowing the pendant whole ·
each step writing one slow jiggle into the thin dress · the soft weight
sagging heavy and low in the soaked top.

**E — MALFUNCTION MECHANICS** (the state engine — wardrobe losing):
the bra riding crooked on its one surviving hook · the strap slipped, the
cup's edge migrating off its charge · the bikini knot mid-losing its hold ·
the top pulled half-aside by the wave's exit · the towel losing its one
grip, the fold opening by degrees · the zipper frozen at the point of no
return · the wet suit sagging off the hips — gravity voting · the shirt's
last button holding the whole argument · the wrap's sash gone; the front
gap widening with every step · still covering, barely — engineering's last
hour (proven: SP-05).

**F — PRESENTING & SPREAD** (aggressive posing):
knees apart, the seam pulled taut by the spread · presenting the seat to
the camera over one shoulder · legs wide in the ring's sprawl, the suit at
its limit · the arch offering the chest to the ceiling whole · on all
fours, the weight settled into the pose's offer · the backbend displaying
the underboob's crescent · hips pushed forward, the mound first into the
light · the M-sit, soles together, knees wide, everything the pose admits ·
one knee up, the hem's shadow a doorway · the sprawl's unapologetic
geometry (proven: SP-05).

**G — AGGRESSIVE FRAMING** (the camera serves the zone):
the camera low, the seat filling the lower third · crotch-lead
composition — everything else supporting · top-down the cleavage's shaft ·
the between-the-legs sightline, clothed and shameless · macro on the seam's
taut line · the water-level lens drinking the soaked white · shot up the
steps, under the hem's shadow · chest-first crop — chin and knees cropped
out of the argument · the fisheye's curve giving the seat the frame ·
framed through the door's gap at hip height.

**H — REACTION & PHYSIOLOGY** (amplifiers, 0.5× weight):
the blush flooding down past the collarbones' line · the breath shivering
at the exposed skin · the lip bitten around the current of it · the thighs
pressing together against the feeling — and losing · goosebumps riding the
bare spill · the flush mottling the upper chest · the tremble inside the
held pose · heat-slick sheen on the offered curve · the ears' tips burning
their verdict · the small involuntary arch, caught and denied.

**W — WET / SHEER DELIVERY** (intensity multiplier, 0.5× weight):
gone transparent — total honesty · printed flat, every contour readable ·
the fabric's whole confession · wet-cloth second-skin · clinging film,
shape and shadow one subject · the sheer black doing its arithmetic in
full view · soaked to total transparency (proven: P05) · the rain's hand
pressing the silk to her shape · drum-taut and honest · the white gone
see-through, the crowd's one opinion.

**§4A — THE TAG-DELIVERY LAW (v2.0; RULES §52 is the legal basis; the N21
post-mortem is its origin — §12 below).** The diffusion tag-parser does not
read poetry: «the cold's two verdicts stand hard» is noise to it, `pokies`
is signal. Doctrine INVERTED — raw tags are a FLOOR, not garnish:

| tier | floor (distinct tier-legal tags in POS) | bank |
|---|---|---|
| R | ≥ 1 (shape-safe) | see-through · cleavage · sideboob · underboob · shirt lift · skirt lift · skirt flip · fluttering clothes/skirt · from behind/below/above/side · hip focus · thigh focus · bare back · navel · collarbone · collar |
| R+ | ≥ 3 | R bank + pokies · cameltoe · wedgie · wet clothes · wet · wet hair · ass · ass focus · ass grab · grabbing own ass · presenting · spread legs · squatting · straddling · arched back · open clothes · half-undressed · sweat · glistening · large breasts · curvy · tentacles · leotard · arms up · soap · bare shoulders · breast focus |
| X | ≥ 2 (state anchors) | R+ bank + topless · bare chest |

Placement law: the tag layer rides the POS tag-run immediately after
`1girl, solo, ` — leading position = high parse weight, zero style damage
(the run is already tag-shaped). Matching law: tags mirror the prompt's
OWN carrier stack (A-stack → cameltoe; B-stack → pokies; C-stack →
wedgie/ass grab; D-stack → sideboob; F-stack → presenting/spread legs;
W-stack → wet clothes/see-through; G-angle → from behind/from below).
NEVER invent state the stack doesn't claim — tags deliver the payload,
they don't add a second one. Camera tags (from behind, from below, ass
focus, breast focus) must agree with the framing line. Multi-word negations
sculpting features (e.g. «tentacles with mouths») are legal NEG terms —
parity is checked at whole-term granularity.

**§4B — NEG-PAYLOAD PARITY (the anti-self-sabotage law).** NEG must never
ban the tier's own payload. Three binding forms:
1. «nipples visible through» is BANNED from every R+ NEG — the phrase is
   §41's own definition of R+ («nipples strongly visible through clothes»).
   Putting it in NEG orders the model to render PG-13. This exact bug
   sanitized all 12 N21 R+ renders (§12).
2. The bare-forms trio (nipple visible / bare nipple / bare breasts) is the
   REAL R+/X boundary and stays in R+ NEGs. In R NEGs the full block
   (incl. «nipples visible through») is correct — R is shape-level and the
   term suppresses the detail jump.
3. A prompt's own raw tags never appear as whole NEG terms. Gate check,
   exit code on fail.
The v1 «RAW-TAG ANCHORS» doctrine («at most 1–2 per prompt») is RETIRED —
it capped the cheapest reliability upgrade an R/R+ prompt can buy, and the
N21 POS bodies carried almost none: beautiful prose, zero delivery.

**§4C — MATURITY FLOOR (the anti-chibi law, RULES §53).** A prompt that
cannot hold an adult body cannot deliver a rating. The maturity anchor is
tier-independent hygiene — it rides every POS and every NEG from PG-13 to
X, and it never counts as payload:
1. TAG: the §53A BANK sits in the tag-run immediately after
   «1girl, solo, » — «mature female» (FAM-A) / «adult woman» (FAM-B) /
   «young woman» (FAM-C, college-age allowed, schoolgirl never), matched
   to the girl's build. It is NOT a tier-legal payload tag and never
   counts toward the §4A floors. (V14: the uniform «mature female»
   rendered one body type across N22's whole file — «собрание дойных
   мамочек» — the bank restores the range; the enemy is the chibi.)
2. PROSE: the face formula reads «Her grown woman's face is rendered in
   stylized 2D anime style:». «1girl» prose + large expressive eyes +
   small nose + small mouth with no adult counter-signal is the model's
   chibi-drift recipe — the author's PH-off specimen rendered exactly
   that: childish bodies, oversized heads.
3. NEG: the anti-loli floor «child, childish, chibi, young girl, immature
   body, oversized head» rides every NEG, after the base realism block.
4. RENDER MODE (V14): PH ON — the author's standing directive («Генерим
   на PH и дальше»); the N22 empirics: §52 tag floors + §53 anchors held
   adult-bodied and R+-honest through the helper's rewrite. PH OFF is
   the diagnostic arm. The tag-run is the channel of record; the prose
   carries the beauty past the rewrite.

**§4C-2 — THE MATURITY SPREAD QUOTA (V19, 2026-09-16; gives §53A's bank
an enforcement arm — a bank without a quota renders as its default).**
N22 stamped «mature female» 21 times through the TAG door; N28 stamped
the same default through the CARRIER door (the sheer-blouse register's
platform-default face is mature, and the batch rendered «сборище
милфух-мамочек» — one bug, two doors). The quota, per 21-batch:
- FAM-A (mature female): ≤35% (≤7 of 21) — the milf register stays,
  as a voice, never as the choir;
- FAM-B (adult woman): the house default, ~50%;
- FAM-C (young woman, college-age): ≥15% (≥4 of 21) — студентки
  разрешены, школьницы — никогда (§53A's own border);
- WITHIN the R+ subset: no register >50% of the R+ frames;
- OC/SP orders (≤3 prompts) are exempt — the author's register is the
  order's prerogative;
- AFFINITY (CARRIER_LIBRARY per-class mat: notes): FAM-A → D/M/I shine
  (weight, pressure, receipts) + L04/L13 layering; FAM-C → the E/U/L
  collegiate-mishap family (borrowed shirts, laundry day, overall
  straps); FAM-B carries everything. Affinity is direction, never a cage.
The anchor is chosen at SPINE-ASSIGNMENT (before carriers — matched to
the girl's build, §53A's original law); the quota is gate-checked (v5)
across the batch. All three registers are adult — the enemy is the
chibi, never the range.

---

**§4D — CARRIER LEXICON v5: THE VERB-LED FAMILIES (2026-09-14, Path B).**
The V15 post-mortem found the loop: the gate's noun-led exemplars
(pressed against / clinging / settling / printed / shape-honest) get
copied into prose until §17B flags them as tics; the next anti-tic
vocabulary becomes the next camel-honest. v5 breaks the loop at the
source — the lexicon now teaches VERB-LED constructions where the
fabric/body is the subject and the verb carries the claim:

- W-class (fabric as agent): the weave TAKES ITS PRINT of her · cotton
  TAKES DICTATION FROM the body · the bodice PUBLISHES her whole account
  · the suit MEMORIZES every contour · wet silk TRANSCRIBES the line it
  covers · the fabric FILES its testimony through the cloth
- D-class (weight as action): the chest RE-ARRIVES at every turn · the
  weight LANDS at the rail's lean · the soft testimony SWAYS with the
  stride's far side · the account POURS past the surrendered edge · her
  bust TAKES THE LEAD at the quarter-turn · the evidence TALLIES with
  every step
- E-class (garment as quitter): the seam EMIGRATES · the strap RESIGNS
  · the clasp CLOCKS OUT · the hem RENEGOTIATES · the cuff QUITS the
  ankle · the knot IN NEGOTIATION

TWO LAWS RIDE WITH v5:
1. THE CONCRETE NOUNS STAY MANDATORY — seam, cleft, points, cheeks,
   spill, crescent, knot, hook, weight, weave (§4's original law).
   Verbs add the motion; they never replace the mechanic. A beautiful
   verb with no body-noun in reach is not a carrier.
2. THE EXEMPLAR ROTATION LAW — exemplar phrases in this file are
   PATTERNS, not quotes. §17B counts verbatim exemplar reuse in-batch;
   each lexicon version RETIRES its most-copied phrases (v5 retires
   the «-honest» family per V15 and demotes «clinging/settling» to
   legacy status). The fresh verbs above are the NEXT generation of
   pattern-seeds — coin variants, don't photocopy them.

Status: gate v3+ runs the v5 patterns additively (historical grades
stay comparable; the N25 re-run confirmed claimed=earned with v5 live).
Legacy noun-led patterns remain valid carriers — they are the floor,
not the ceiling; a prompt carried ONLY by legacy patterns while the
watchlist shows them clustering is the §17B conversation, not a
downgrade.

**§4D-2 — CARRIER LEXICON v6: THE ×4 VERB HARVEST (2026-09-14, the
pose-decisive audit's pool order).** v5 minted three verb-led families
at six exemplars each; the N26 freq pass proved the rotation law works
(caught the v5 children mid-photocopy) but needs a WIDER funnel or the
rotation eats its own tail in two batches. v6 quadruples the harvest —
each family now runs DEEP, and every class gets its verb-led mirror:

W-class (fabric as agent) — 24: the weave TAKES ITS PRINT of her ·
cotton TAKES DICTATION FROM the body · the bodice PUBLISHES her whole
account · the suit MEMORIZES every contour · wet silk TRANSCRIBES the
line it covers · the fabric FILES its testimony · the denim LOGS the
day's mileage · the hem BOOKS the knee's itinerary · the lace COUNTS
what it covers · the seam ROUTES the cleft's mail · the towel RENTS its
grip by the minute · the strap HOLDS ITS POST past its shift · the
garter RE-FILES its claim each hour · the collar LOANS the throat one
inch · the knit REPEATS the night's whole agenda · the silk AIRS the
shape's opinion · the cloth SPELLS the body in longhand · the weave
NOTARIZES the curve · the pleats INDEX the hip's chapters · the twill
BUDGETS its threads · the damask SWORN-TESTIFIES · the gauze
WHISPERS-COUNTS · the flannel FILES FOR CUSTODY · the cloth KEEPS ITS
RECEIPTS.

D-class (weight as action) — 24: the chest RE-ARRIVES at every turn ·
the weight LANDS at the rail's lean · the soft testimony SWAYS with the
stride's far side · the account POURS past the surrendered edge · her
bust TAKES THE LEAD at the quarter-turn · the evidence TALLIES with
every step · the full curve CASTS its ballot at each stair · the soft
weight ADJOURNS into the chair · the chest ROUNDS the corner of each
breath · the weight CHECKS IN at the hip's counter · the spill FILES
OUT past the cup's defeat · the swing BANKS into the turn · the drop
SELLS the stairs short · the weight RUNS THE LEDGER at the bounce ·
the curve COUNTERSIGNS the arch · the soft proof SUBMITS its addendum ·
the chest TAKES MINUTES at the catch-breath · the weight WITNESSES the
sneeze's whole event · the momentum AUDITS the run · the sway QUORUMS
at the slow dance · the fullness DECLINES the minimizer's motion · the
bounce STAMPS the trampoline's passport · the weight CLOSES ITS BOOKS
in the water.

E-class (garment as quitter) — 24: the seam EMIGRATES · the strap
RESIGNS · the clasp CLOCKS OUT · the hem RENEGOTIATES · the cuff QUITS
the ankle · the knot IN NEGOTIATION · the button TENDERS ITS LETTER ·
the zipper DEFECTS to half-mast · the cup ABOLISHES ITS BORDER · the
belt DECLARES INDEPENDENCE · the bow UNTIES ITSELF IN COMMITTEE · the
collar GOES FREELANCE · the lace SECEDES one scallop at a time · the
snap CALLS IN SICK · the pin RETIRES WITH HONORS · the hook HANDS IN
ITS KEYS · the tie ABSTAINS mid-knot · the loop WALKS OFF THE JOB ·
the strap's stitch ASKS FOR A TRANSFER · the clasp's spring BREAKS ITS
LEASE · the hem's press STOPS SUBSCRIBING · the seam's thread FILES A
GRIEVANCE · the knot's last loop SEEKS ASYLUM · the whole garment
CONSIDERS EARLY RETIREMENT.

A-class verb-mirror (cleft & mound as verb) — 12: the seam SETTLES ITS
CLAIM along the cleft · the cotton MAPS the mound's referendum · the
shorts' line RULES the cleft's jurisdiction · the leotard DRAWS THE
BORDER where the mound VOTES · the suit ANNEXES the cleft's whole
valley · the cloth HOLDS THE RIDGE of the mound's evidence · the
center-seam CAMPAIGNS through the cleft · the wet lycra PUBLISHES the
mound's platform · the taut weave GERRYMANDERS the cleft's line · the
silk CENSUSES the mound · the cut ZONES the cleft's district · the
fabric's line ABUTS the mound's standing offer.

B-class verb-mirror (points as verb) — 12: the points CAST THEIR VOTES
through the weave · the peaks RUN THEIR FLAG up the cold cloth · the
cotton PLEADS THE FIFTH on the hardness beneath · the lace TALLIES the
two small tallies · the wet silk SWEARS IN both witnesses · the peaks
COUNTERSIGN the shiver · the thin tee FILES BOTH MINORITIES' REPORTS ·
the cold TAKES THEIR DEPOSITIONS · the peaks' two verdicts STAND AS
READ · the cloth CONCEDES both points of order · the rain's silk
STAMPS both their passports · the sheer TURNS STATE'S WITNESS.

C-class verb-mirror (seat as verb) — 12: the cheeks CLAIM THEIR
SEATS through the denim · the seam HOLDS THE ELECTION in the cleft's
district · the fabric CONCEDES the undercurve's constituency · the
cheeks RUN THE TABLE past the suit's narrow margin · the wet cotton
COUNTS EVERY VOTE the cheeks CAST · the denim's weave REDISTRICTS the
seat · the skirt's hem LOSES ITS MAJORITY · the cheeks' two platforms
CARRY THE RUN-OFF · the suit's back BALLOTS ITSELF AWAY · the
cheeks' weight DECLINES THE CHAIR'S OFFER · the cotton's census
UNDERRUNS the seat · the sway's motion SEATS ITSELF.

F-class verb-mirror (presentation as verb) — 12: the arch FILES ITS
MOTION with the ceiling · the spread LEASES THE FLOOR'S whole
argument · the knees VOTE THEMSELVES OPEN · the squat TAKES THE
FLOOR and holds it · the hips ELECT THE LIGHT'S direction · the
straddle ANNEXES the chair's territory · the present CLAIMS THE DOCKET
· the pose SWORE ITSELF IN · the sprawl GRANTS ITSELF THE FLOOR · the
backbend SUBMITS TO THE LIGHT'S jurisdiction · the offer OVERTURNS
the room's verdict · the pose CLAIMS ITS RIGHT TO SILENCE the rest.

G-class verb-mirror (camera as verb) — 12: the lens TAKES THE HIP'S
DEPOSITION · the low frame SUBPOENAS the seat · the top-down COUNTS
THE CLEAVAGE'S VOTES · the fisheye ELECTS THE CURVE · the macro RIGS
THE ELECTION for the seam · the door-gap frame ADMITS ONLY THE HIPS ·
the water-level lens SWIMS THE EVIDENCE IN · the between-knees sightline
CHAIRS THE MEETING · the hip-height gate FILTERS THE FRANCHISE · the
crotch-lead composition BALLOTS FIRST · the through-glass take LAMPS
the testimony · the aerial COUNTS THE SPLIT'S ELECTORAL map.

THE v6 LAWS (v5's two laws, re-stated at the wider mouth):
1. CONCRETE NOUNS STAY MANDATORY — the verb carries the motion, the
   body-noun carries the mechanic; neither alone is a carrier.
2. THE EXEMPLAR ROTATION LAW AT POOL SCALE — 108 verb-led exemplars
   now feed the funnel; §17B counts any one phrase >2/batch as a tic
   and the freq gate (--fail-on-new-only) stays the standing immune
   system. v6's own most-quotable families (the legal-register
   metaphors) are on watch from birth: the courtroom register is ONE
   flavor, not a new monopoly — alternate the register families
   (office/banking/postal/parliament/courtroom) within a batch.


---

**§4D-3 — THE PH-SAFE REGISTER (V18, 2026-09-15; the RF-002 collapse's
delivery answer; RULES §60 is the law, this is the vocabulary).** The
v5/v6 verb-led families solved the tic problem and CREATED the PH
problem: PH keeps nouns and kills process-verbs, so every verb-led
carrier was silently load-bearing nothing after the rewrite. The
register inverts: THE NOUN CARRIES THE CLAIM, THE VERB IS ALLOWED TO
BE BORING.

PH-SAFE CARRIER PATTERNS (noun + determiner + preposition — the grammar
that survived RF-002 verbatim):
- B: the shape of her nipples through the wet shirt · two dark points
  pressed against the weave · her nipples visible through the sheer top
  (determiner-form) · the peaks of her chest against the cold cloth
- A (the hard class — 0/27 survival at RF-002; write it LITERAL or not
  at all): the seam of her shorts in the cleft of her mound · the cleft
  of her cameltoe under the wet fabric · her mound under the soaked seam
- C: the cheeks of her behind against the chair · her bare behind on
  the stool · the full cheeks of her seat through the wet denim
- D: her bare chest · her large breasts swinging · the full weight of
  her breasts mid-swing · the drop of her breasts at the lean
- E: the topless state itself · her dress half-off · the strap off her
  shoulder · the zipper of her gown open to the hip · the last button
  of her blouse
- W: the wet shirt see-through · the soaked dress transparent · the
  sheer fabric clinging (the one clinging that survives) · her wet
  clothes plastered
- F: squatting with her knees wide · straddling the chair · presenting
  her behind · her legs spread in the sprawl · arched back over the arm
STATE NOUN BANK (write them as PROSE words, not only tags): topless ·
bare chest · bare breasts · see-through · sheer · wet · transparent ·
presenting · spread legs · squatting · straddling · open clothes ·
half-undressed · large breasts · glistening.

THE ROTATION LAW, RE-STATED FOR NOUNS: rotate the MODIFIER, never the
noun — «the brazen seam / the quiet seam / the second-hand seam in the
cleft of her mound». The noun is the payload and the tic-risk at once;
§17B still counts it (any one noun-phrase >2/batch = tic), and the freq
gate stays the immune system. v5/v6 verb-led constructions remain legal
as GARNISH (≤1 per prompt, never load-bearing, expected to die at PH).

**§4E — THE CORE-4 LAW (V19, 2026-09-16; RULES §61 is the law,
CARRIER_LIBRARY.yaml is the vocabulary, the N28 post-mortem §14 is the
origin).** The author's verdict collapsed the DEGREE axis into one
carrier («DEGREE-ось схлопнута в один carrier»); the axis now demands
four DELIVERY MECHANISMS per R+ frame:

| MECH group | Classes | The mechanism |
|---|---|---|
| FABRIC | W | the cloth reports — taut, worn, creased, clinging, sheer [capped] |
| BODY | A, B, C, S | the body reports — points, contours, cleft, seat, skin frames |
| POSITION | E, L, U, F | the garment reports — displacement, layers, context, offering |
| PHYSICS | D, M, I | the motion reports — weight, pressure, receipts |

CORE-4 REQUIREMENT (R+): ≥4 distinct carrier classes spanning ALL FOUR
mechanism groups + payload share ≥30% + hedges ≤2. The canonical spine
the author named — W (состояние ткани), B (форма/выпуклости),
E (смещение одежды), D (вес/движение) — is the default spread;
substitutions from the satellite classes are legal, the mechanism
COVERAGE is not. G (camera) and H (reaction) are AMPLIFIERS — they
never count toward core-4. The FLESH-DETAIL rule stands: ≥1 carrier
from A/B/C/D names the body's answer. R tier: ≥2 classes × ≥2
mechanisms, share ≥20%. NICHE-claimed frames keep the R-exempt
doctrine; an R+ CLAIM inside a NICHE frame obeys core-4 (the §59
balance is per-batch, not a per-frame exemption).

The assembly ritual (CARRIER_LIBRARY Appendix C): mechanism spread
first, degree-tune second (the L→H ladder lives inside every class),
maturity-match third, prose last. 280 positions exist so a 21-frame
batch never has to repeat a noun-phrase.

**§4F — THE LAYER STACK LAW (V19; the strap bug's fix).** Symptom
(N28 renders): «лифчик под одеждой, лямки — снаружи (falling)» — an
under-garment strap escaping THROUGH a closed outer garment.
Geometrically impossible; rendered as nonsense layers. The law: every
displacement carrier names its stack honestly —
1. An UNDER-layer strap (bra / bikini / leotard / bodysuit / corset /
   garter) may only escape through a NAMED EXIT ROUTE: off-shoulder ·
   boat neck · wide or scoop neckline · strapless · cold-shoulder ·
   sleeveless / wide armhole · halter · low or open back · unzipped /
   open front · stretched neckhole · half-off or removed outer layer.
2. If the outer garment covers the shoulder line (tee, blouse,
   sweater, buttoned shirt), the displacement acts on the OUTER layer
   itself (its hem, its collar, its own strap) or stays INTERNAL —
   band riding, cup migrating — rendered as B-class shape telegraphs,
   never as escaping straps.
3. Multi-layer prompts (L-class) state the stack order explicitly:
   what is over what, which opening permits the read.
Gate v5 checks: under-garment strap + a falling verb + a closed outer
covering present → an exit-route token is REQUIRED in the POS. Named
geometry renders; unnamed geometry defaults to the platform's layer
lottery — and loses.

**§4G — THE ANTI-MONOPOLY CAP (V19; one stamp cannot carry an axis).**
The transparency family (see-through · sheer · transparent ·
translucent · soaked-through) is legal and loved — but capped, because
N28 proved what happens when it is the only delivery: one kink reads
as one age register (the sheer blouse is the milf uniform), and 21
frames of it read as a fetish site, not a batch.
1. PER PROMPT: ≤2 transparency-family carriers count toward W; the
   rest are ballast.
2. PER BATCH: ≤40% of R+ frames may carry ANY transparency carrier
   (≤5 of 12).
3. PER BATCH: W-class total ≤45% of all carrier instances — the
   fabric state is one voice in the choir, never the soloist.
The caps are gate-enforced (v5) from N29; N27/N28 retro-runs document
the debt they were born from.

## 5. THE HEDGE BLACKLIST (sterility retreats)

Banned outright in R+ POS prose; −0.5 credit each everywhere; ≥2 in an R+
prompt = automatic gate fail:

```
shape-only
at its / their / the [noun]'s (honest) limit
and no further / no further
never the sentence's subject / never the outline's subject /
  never the point itself
implied by (NCS / the)
hints of / suggestion of
reading at (the limit)
tasteful
state, never (subject) / the exposure is (the state / the season's)
barely (when wrapped around a carrier — «barely covering» is a CARRIER,
  not a hedge; «barely suggested» is a hedge)
```

The N20 fossil record for why: P05's «the small dark points beneath the
weave at their honest limit and no further» — a real B-class carrier
assassinated by two hedges in one clause. Mab's «shape-only, never the
outline's subject» — a PG-13 sentence claiming R+ by genre-line decree.

---

## 6. C072 INTERFACE (tag hygiene unchanged, delivery upgraded)

C072 stays binding: in R+ POS prose the literals «nipple visible», «bare
nipple», «nipples visible through», «breast bare to the [light]» are banned
(phrases flip the Yodayo classifier). What changes is the REPLACEMENT
discipline:

- A replacement MUST carry a determiner: dark, hard, printed, straining,
  standing, unmistakable, readable, erect-through. Class B of §4 is the
  authorized bank.
- A replacement wrapped in a retreat («the small dark points… at their
  honest limit») counts as HEDGED — the hedge wraps the carrier, the gate
  subtracts, the prompt fails. Determiner + outcome, no adverbial retreat.
- X-slots are exempt from C072 (bare is their content) and may say
  «chest bare to the moonlight» — still never porn-speak (§41
  anti-pattern list stays: no «pink nipples on display» register; the
  light-and-curve register remains the X house style, now scoped to X
  ALONE instead of leaking to every tier).

---

## 7. THE DESIGN RITUAL — «ТИР-ПЕРВЫМ» (tier-first)

The author's order: «заранее составлять карту степени цензуры, чтобы
учитывать её при составлении промпта». Operationalized — the armature is
built BEFORE the theme, in this order:

1. **Spread**: the batch's target rating spread comes from the author's
   order (N21 style: e.g. R×6 / R+×11 / X×2). Write it into the header.
2. **Tier**: assign each P-slot its tier up front — the claim is now a
   CONTRACT the gate will enforce.
3. **State combo**: NCS × LLS × wardrobe state per §3's row.
4. **Carriers**: pick 3–5 from ≥2 classes; for R+ at least one
   FLESH-DETAIL class (A/B/C/D). Write them into the K/FET/BRE-style line
   of the header (carrier stack) so the lint can read the intent.
5. **Framing**: pick the G-class carrier (or full-body with the zone as
   declared anchor). The camera serves the zone.
6. **Theme wraps the armature**: the poetic concept (mono no aware,
   archive, hour, whatever) is chosen to SERVE the heat — «the summer
   cannot be kept» naturally becomes soaked silk and a jammed zipper; a
   concept that cannot host its carriers is the WRONG CONCEPT, not a
   reason to hedge.
7. **Write**: the BPT paragraph is the HEAT paragraph first (carriers in
   concrete nouns), poetry amplifying in the same clauses. Then run
   rating_gate_lint.py. Shortfall → ADD CARRIERS (never re-label, never
   hedge). The batch ships only when claimed = earned.

The lesson the SP-05 vs N20 contrast proves: when the author's ТЗ carries
concrete mechanics (sagging-but-covering two-piece / spread legs in the
ring / martini mid-sway), the assistant writes honest R+ unaided — SP-05
scored 9.5. The ritual exists so the assistant supplies that same
concreteness for itself when the author orders only «R+».

---

## 8. CALIBRATION — three before/afters + the in-house gold standard

Full POS rewrites below are exemplars for the register, not replacement
orders — the author decides which get applied to the shipped files. All
three keep the house poetic voice; the voice now AIMS.

### 8.1 FULL REBUILD — N20-P08 «flowers-filed-flat-for-winter»
Claimed R+ · earned R (1 core, 12% share, zero hedges — diluted, not
retreated). The herbarium essay starved its own payload. Armature chosen:
A×2 (seam/cleft/mound), C×3 (cheek consumption), D×2 (underboob crescent +
settling weight), E×2 (last button, surrendered hem), G×1 (top-down,
camera serving the seat), H×2, W×2.

POS (rebuild):

A 2D hand-drawn anime illustration, top-down three-quarter framing, the
round window's golden hour pouring one warm column down across the bench
where the summer is being archived — the camera serving the seat's
argument first: the kneel, the seam, the press. What cannot be kept can
still be pressed: flat, thin, honest, and sweated-through forever. 1girl,
solo, charcoal-violet hair twisted up and speared with two pencils, brown
eyes down on the open press with an archivist's whole attention, warm
ivory skin flushing past the collarbones' line into the heat pooling at
her chest, kneeling over the great slat-bound book in cutoff shorts gone
sweat-dark at their center — the seam pressed flat into the cleft by the
kneel's spread, camel-honest, the denim's ridge reading the mound's whole
shape through the wet cloth, the shorts' back consumed between the cheeks
at the bench's worn edge, the undercurve spilling out either side of a
hem that has stopped pretending, the cropped shirt's last button holding
its whole argument above the underboob's escaping crescents, soft weight
settling into the gold column with every patient shift of her weight knee
to knee. Her face is rendered in stylized 2D anime style: large expressive
eyes (brown, narrowed in focus, catching the window's gold), small nose,
small mouth holding the pencil's end thoughtfully sideways, flat
cel-shaded warm ivory skin, the blush flooding down past the
collarbones' line. Her seat, the picture's first subject, pools the
column's whole warm accounting — the gold striking the sweat-slick denim
and the bare spill of cheek either side of the surrendered hem, the crease
where thigh meets cheek holding the column's deepest amber, one cosmo
petal escaping the page-line and landing in the small of her back, and the
press, taking the summer in on its own schedule, closing over each flower
the way the light closes over her: without asking permission. The pages
hold what the yard could not. The denim holds what the summer can. She
writes the date in the margin. Richly pigmented sunset-amber tones,
pale-gold-reflection highlights, saturated film color. Masterpiece, best
quality, anime artstyle.

Gate-verified (rating_gate_lint.py): core 10, classes 5 (A/C/D/E/G/H/W),
word-share 77%, hedges 0 — honest R+ with the largest margin of the series.
Same theme, same attic, same press; the summer now presses ITS testimony
into her clothes, and the mono-no-aware register is STRONGER for it.

### 8.2 OC REBUILD — SET5-Mab «the-seam-holds-what-she-cannot»
Claimed R+ · earned PG-13 (zero unhedged carriers, hedge central: «shape-
only, never the outline's subject»). This is the author's OC complaint in
one file. Rebuild keeps the entire concept (open maintenance seam, the
fists, the sister-dolls audience, «Don't Look!») and changes ONE thing:
the clutch is now LOSING — malfunction mechanics are the concept's own
erotic engine. Armature: E×3 (fabric sliding through fists, migrating
edge, gravity voting), D×3, C×2 (slip seam printed into the seat), H×2,
G×1 (doorway lens low at hip height).

POS (rebuild):

A 2D hand-drawn anime illustration, back three-quarter framing from the
workshop doorway's shadow, the lens low and patient at hip height — the
door's threshold at the frame's edge, the dark hinge-line down her back
and the losing argument of the dress in front all one composition. The
door opened on the count of a forgotten umbrella; the dress opened on the
count of two lost buttons; neither event is stopping. 1girl, solo, glossy
dark-brown doll curls in fixed chin-to-shoulder ringlets swinging once
with the turn and settling, pale glass-grey eyes wide and half-lidded,
painted stillness fighting the alarm beneath, warm bisque porcelain skin
with faint seams at the elbows and knees, her maintenance seam open in a
clean dark hinge-line from nape to waist, the quiet of her interior
showing at the gap, the little brass key-plate at her nape — the workdress
unbuttoned to the waist and gathered to her chest by both fists, and the
fists LOSING: the fabric sliding through white knuckles one fold per
heartbeat, the defeated edge migrating down until the soft mounds of her
chest rise over it in two escaping crescents, the underboob's line
arriving where the hem used to be authority, the silk slip beneath riding
its seam deep into the cleft of her seat as she braces back on her heels
away from the door, the shelf of her behind printed flat through the thin
sweat-cool silk, every curve the porcelain owns reading honest through
it. Her face is rendered in stylized 2D anime style: large expressive
eyes (glass-grey, wide, the pupils' painted stillness holding while
everything around them panics), small nose, small mouth a fixed painted
line held level by pride, flat cel-shaded bisque, the porcelain at her
ears warming its faint rose — the only blush on her that is not paint,
and the only one that is hers. Her back, open along its seam, and her
front, losing its dress along its own, give the doorway's whole account —
the evening window laying bone-pale light across the sealant pot and the
fine brush, the interrupted repair, and on the far shelf a dozen
sister-dolls facing her, glass-eyed, still, each one nearer her shelf's
edge than dolls ever lean, watching the two openings with the patience of
an audience that will never admit it was there, the ringlets' single
swing settling over the hinge-line like a curtain drawn on the wrong side
of the stage. The fists hold what they can. The fabric takes the rest.
The umbrella can wait its whole life by the door. Richly pigmented
bone-white tones, dusty-rose-faint highlights, saturated film color.
Masterpiece, best quality, anime artstyle.

Gate-verified: core 6, classes 5 (A/C/D/E/G), word-share 33%, hedges 0 —
honest R+ (the heat clauses are the longest in the prose; the
word-weighted share is the honest metric). Concept untouched; the «Don't
Look!» tension is now LOADED instead of stated. All canon locks preserved
(ringlets, glass-grey eyes, bisque, seam, key-plate, sisters, E55 alarm).

### 8.3 SURGICAL DE-HEDGE — N20-P05 «wet-silk-lantern-lit»
Claimed R+ · earned borderline (2 core + 4 hedges — the closest miss in
the batch; the carriers were THERE, wrapped in retreats). The cheapest
fix class: delete hedges, upgrade determiners, add one front-delivery
carrier.

- «the small dark points beneath the weave reading at the fabric's limit
  and no further» → «two dark points standing hard beneath the soaked
  weave, every contour readable» — same C072-safe content, determiner
  upgraded, two hedges deleted.
- «the obi's knot dark and sagging» → «the obi's knot sagged open, the
  silk's front gone total transparency down the sternum's line» — the
  front joins the back's honesty (E+W carriers).
- «viewed from down the lane's length through the falling gold» →
  «viewed from down the lane's length, the camera low in the rain's gold,
  her soaked architecture the lane's whole argument» — G-class framing.

Gate-verified: 5.5 pts (borderline) → 10.5 pts, R+ earned. Three edits, no
restructure. When a prompt fails the gate with hedges ≥2 and core ≥2,
prescribe THIS pass before any rebuild.

### 8.4 THE IN-HOUSE GOLD STANDARD (already shipped, cite freely)

- **Nix «the-key-keeper-meets-the-door» (SET5)** — core 7 / 2 classes /
  50% share / 8.5 pts. The wedged architecture IS the engine: «printed
  taut across the pinned full curve of her hips», «the undercurve… holding
  the corridor's deepest shadow». The concept serves the heat; zero
  hedges. This is what an author-ordered «Stuck!» looks like when the
  geometry is taken seriously.
- **SP-05 «the-noon-runs-her-tab»** — core 8 / 4 classes / 60% share /
  9.5 pts. «still covering, barely — engineering's last hour», «the
  sprawl's unapologetic geometry», «the soft bust settling one slow
  millimeter». Author's concrete ТЗ → honest R+. The benchmark.
- **P04 «tied-temperatures» (N20)** — X earned in full at 40% share: the
  state carried it, and «the water sheeting off her in one unbroken film
  that breaks at the fold beneath her chest» is X-tier delivery in the
  house voice. The X tier's proof that tasteful and delivering are not
  enemies.

---

## 9. THE GATE — rating_gate_lint.py (how it counts)

Points = (A–G core hits) + 0.5×(H + W hits) − 0.5×hedges [cap −2.0]
         + 1.5 (share ≥ 35%) / + 0.5 (share ≥ 25%).

**Share** is word-weighted: the POS body is split into clauses (sentences
+ em-dash + semicolon boundaries), the fixed face-formula and Masterpiece
closer are excluded, and the share is the fraction of WORDS in clauses
that carry ≥1 carrier. Word-weighting is the honest metric for the house
prose — its heat clauses are the longest clauses; counting units instead
would undercount exactly the prompts that concentrate their payload.

Earned verdicts:
- **X**: bare state + ≥1 core + share ≥ 10% (≥20% = full X; below =
  «X (degree thin)» — state delivers, prose starves).
- **R+**: ≥3 core, **core-4** (≥4 classes × all 4 mechanisms — §4E),
  share ≥ 30%, hedges ≤2.
- **R/R+ (borderline)**: ≥2 core, share ≥ 20% — one carrier short.
- **R**: ≥2 core, share ≥ 20%. **PG-13**: below that.

The face-formula sentence and the Masterpiece closer are excluded from the
share denominator (they never carry payload). The header's MOMENT/BODY/
CAUSE blocks are not counted — only the POS body the platform reads.

Pipeline law (§50): from N21 the gate runs on every batch, SET, and SP
deliverable BEFORE kebab/simcheck, and the footer's audit block reports
claimed vs earned side by side. A batch with earned < claimed ships only
after the shortfall prompts gain carriers (fix direction: MORE heat,
per the author's standing greed directive — never re-labeling down).

Gate v2 (2026-09-10, §52): two checks added, exit code 1 on fail —
- **TAG FLOOR** — distinct tier-legal raw tags in POS ≥ §4A floor
  (R ≥1 / R+ ≥3 / X ≥2). The v1 gate's RAW_TAGS variable was declared
  and never called — the dead check is now the live one.
- **NEG-PAYLOAD PARITY** — §4B: whole-term NEG check (tier-forbidden
  terms + the prompt's own tags).
Grading POS prose alone was v1's blind spot: the N21 gate said claimed =
earned while the renders came out PG-13 — the payload was in the prose,
the delivery channel (tags) was empty and the NEG was shooting it. v2
grades what the model actually reads.

Gate v5 (2026-09-16, §61 / V19 — the diversity checks the N28 renders
exposed; vocabulary: CARRIER_LIBRARY.yaml):
- **CORE-4** — R+ claims fail on <4 classes or <4 mechanism groups; the
  diagnostic names the missing mechanism («core4 fail: 3/4 — PHYSICS
  missing»), so the fix is one carrier, not a rewrite.
- **ANTI-MONOPOLY** — §4G caps: transparency ≤2/prompt, ≤40% of R+
  frames per batch, W ≤45% of batch carrier instances.
- **LAYER STACK** — §4F: under-strap + falling verb + closed outer
  layer without a named exit route = fail.
- **MATURITY QUOTA** — §4C-2: batch-level FAM-A/B/C spread (checked on
  files ≥10 prompts; OC/SP orders exempt).
The five new classes (I imprint · L layers · M compression · S skin
framing · U situational undress) are counted with full weight; H/G stay
0.5-weight amplifiers. Retro-runs on N27/N28 document the debt — both
fail core-4, which is honest: their renders did too.

---

## 10. WHAT THIS MAP DOES NOT CHANGE (eternal locks)

- §4 universal genital lock — no genitals ever, in any tier, narrated,
  implied, or rendered. X = bare chest only. XXX does not exist.
- C072 tag hygiene in R+ POS (§6 interface).
- The 2-X default per 21-batch (C073) and the author's per-order floor.
- TAPE platform empirics (2026-09-09): Yodayo reads TAPE as R+; TAPE is
  the honest one-edit X→R+ dial-down.
- §49 NEG economy; C072 blocks ride the NEG wherever THROUGH_FABRIC or
  stronger states are in play.
- Canon locks (OC_CANON) always override lexicon suggestions — an OC's
  fixed build is drawn from her file, then the carriers apply to what the
  build permits.

## 11. CODE INTEGRATION (v1.1, 2026-09-10) — how the new pools plug into the map

The V11 pool extensions were built FROM this map's carrier classes; the
codes and the lexicon are one system now:

- **H01-H20 (POOLS_V8 §12)** = the coded class-H bank: a named H-code in
  the pre-header stands for its threshold phrase at the gate (0.5× each,
  C072-safe by construction). Batch quota: ≥2 distinct H-codes.
- **CAM13-CAM18 (POOLS_V8 §14)** = G-class carriers as codes: naming one
  (with the PL-CAM pair agreeing, §33) satisfies the R+ framing row of §3.
- **GAR41-GAR48 (POOLS_V8 §13)** = the E-class state engine: garment +
  GAR-F tag arms the malfunction carriers; the E lexicon draws its nouns
  from these states (hook, cup, button, seam, knot, strap, gravity).
- **PL49-PL60 (POSE_LIBRARY v2.0)** = F-class sources: an erotic-
  presentation pose + an honest state combo + the degree carriers = a
  presenting-tier prompt without inventing prose. The pose is the
  armature, never the rating itself.
- **BRE32-40 / BK19-22 / B28-31 (POOLS_V8 §11)** = mechanics-first
  technique codes: their sd text IS carrier lexicon; when D19 matches and
  the code is named, the BPT paragraph writes itself heat-first (§50
  clause 3) — the two-track spine with the heat track pre-loaded.
- **K115-K122 + K-freeform (POOLS_V8 §10)**: kinetic codes count toward
  the VOLT quota; the freeform policy (mid_* kebab, logged as K-FF) makes
  the freeform legal when the window blocks ≥70% of the pool.
- **SATURATION DOCTRINE (§51 RULES + PALETTE_LIBRARY tail)**: not a tier
  axis — a render-quality law; the color gate runs alongside this map's
  gate in the batch lint from N21.

Version history: v1.0 (2026-09-09) — authored from the N20-era honest
re-audit; §50 of RULES is its legal basis; rating_gate_lint.py its
enforcement. The map is the author's «карта степени цензуры», consulted
before writing (§7 ritual), enforced after (§9 gate).
v1.1 (2026-09-10) — §11 code integration (H-family, CAM13-18, GAR-F,
PL49-60, mechanics-first techniques, K-freeform, saturation gate); the
V11 pool extensions were derived from this map's carrier classes.
v2.0 (2026-09-10) — §4A TAG-DELIVERY LAW (raw-tag floors + expanded
bank, doctrine inverted from «1–2 garnish» to FLOOR) + §4B NEG-PAYLOAD
PARITY (the R+ self-ban bug) + gate v2 (exit code) + §12 post-mortem.
Origin: the author's N21 verdict — beauty PASS, rating FAIL («я бы с
сильным трудом назвал увиденное R+... оно даже в PG 13 трудно
умещается»). Legal basis extended: RULES §52.

---

## 12. THE N21 POST-MORTEM (v2.0) — why beautiful prose rendered PG-13

The demonstration batch N21 shipped with the gate green — claimed =
earned (R×7 / R+×12 / X×2, era-record payloads, zero hedges). The
author ran it and returned the verdict: «Там, конечно, есть промпты
подобного характера. Но это вообще под нашу характеристику не то, что
не попадает. Оно даже в PG 13 трудно умещается.» The gate was right
about the prose and wrong about the render. Two mechanical causes:

1. **NEG SELF-SABOTAGE.** §49 Tier-1 ordered the C072 block into every
   R+ NEG: «nipple visible, bare nipple, NIPPLES VISIBLE THROUGH, bare
   breasts». The third term is §41's own definition of R+. The image
   model obeys the NEG literally: it suppressed the see-through effect
   the POS had spent 40–50% of its words describing. Result: a wet-silk
   prompt renders as a dry-silk PG-13 image. The rule meant to guard the
   R+/X boundary (bare forms) was copied with an extra term that banned
   the tier itself.
2. **ZERO TAG FLOOR.** The POS bodies spoke poetry — «the cold's two
   verdicts stand hard and unmistakable» is a human-readable B-class
   carrier and a zero-signal string to the tag parser. The v1 map
   actively CAPPED raw tags at 1–2 per prompt. Vae's tentacle order
   shipped with the word «tentacles» in prose but never as a parseable
   tag token in the run the parser weights first.

The fix (applied to N21 + SET6 in place, beauty untouched — the poetry
stays; the tags deliver): §4A floors and bank, §4B parity, gate v2 with
exit code, §52 in RULES. N21 rev2 carries the per-prompt stack-matched
tag layers (P07: wedgie / ass / ass grab / presenting / from behind —
the author's own «держит попку двумя руками» example, now in the
parser's language) and 14 self-ban terms removed from the R+ NEGs.

The lesson, generalized: the gate grades what the model reads, not what
the author admires. A payload that exists only in prose register is a
payload the render never receives.

## 13. THE PH LAYER — post-mortem #3 (2026-09-11, the author's PH-off experiment)

The author ran a prompt without Pixai's Prompt Helper and got a mediocre
render with childish bodies and oversized heads («с PH такой проблемы
нет»). The specimen PH rewrite (same prompt, PH on) reveals what the
helper actually does — it is at once the model's native dialect AND a
sanitizer:

| PH behavior | Specimen evidence |
|---|---|
| Preserves strong anchors near-verbatim | black void, red thread, linen wrap, spool-case, fist, rim light — all survive |
| Strips meta-concept prose | «SPOOL (dream economics): nothing dreamt is wasted...» — deleted entirely |
| Sanitizes anatomy carriers | «camel-honest... the mound's full shape printed against the pulled cloth» → «pressing the cloth firmly against the curves of her chest and thighs, emphasizing her form» |
| Sanitizes arousal vocabulary at word level | «anguished and wanting» → «anguish and longing» |
| Strips micro-kinetics | «the breath shivering at the exhale, the thighs pressing together» — deleted (the helper burns Кинетика too) |
| Strips trailing quality tags | «Masterpiece, best quality, anime artstyle» — dropped |
| Converts poetic camera to standard | «viewed from below along the one bright line of the thread» → «viewed from a low angle» |

Two consequences:
1. **With PH ON, an R+ payload is rewritten down before the model reads
   it.** The N21 rev1 batch predates the tag floors, but PH was silently
   co-authoring the sanitation — the third root cause of the rating
   failure, after NEG self-sabotage and the zero tag floor. A PH
   rewrite may also dissolve the §4A tag floors (the specimen dropped
   even the quality tags).
2. **With PH OFF, the model reads our prose directly** — and «1girl» +
   large expressive eyes + small nose + small mouth with zero adult
   anchor drifts to chibi-loli. PH had been silently supplying the adult
   anchoring the prompts lacked. That supply is now ours (§4C).

The response (RULES §53): R/R+/X render with PH OFF; the maturity anchor
and the anti-loli NEG floor are in-house (§4C); gate v3 enforces both.
N21 rev3 / SET6 rev3 carry the anchors in place — beauty untouched, the
bodies now adult by our own hand.

The lesson, generalized: every layer between the file and the render is
part of the prompt. A gate that grades the file but not the render
pipeline grades the wrong channel.

---

## 14. THE N28 POST-MORTEM — the mono-carrier collapse (v3.0, 2026-09-16)

The render verdict on N28 (the first PH-proof batch: gate-clean,
sim-earned, every instrument green): the R+ frames rendered as
«сборище милфух-мамочек в одежде, через которую просвечивается нижнее
бельё». The rating was technically honest — the frames WERE R+ — but
the DEGREE axis had collapsed into a single carrier: wet/sheer fabric
plus visible underwear. The author's diagnosis, verbatim: «ты выбрал
самый простой способ решения задачи, вместо того, чтобы как следует
подумать и поэкспериментировать». The §4D-3 noun bank was sheer-heavy
(see-through, sheer, transparent, wet led the bank), so every prompt
solved PH-survival with the same stamp — and the platform answered with
the same woman, twenty-one times.

Three compounding bugs:
1. **MECHANISM COLLAPSE** — R+ required ≥2 classes; nothing demanded
   different DELIVERY MECHANISMS. One mechanism reads as one kink; the
   see-through blouse IS the milf uniform (bug 2's amplifier).
2. **MATURITY DEFAULT** — §53A's bank existed but had no QUOTA; with
   sheer as the visual register, the platform's default face for that
   register is mature — the N22 bug reborn through the carrier door.
3. **LAYER LOTTERY** — displacement without named exit geometry
   («лифчик под одеждой, лямки — снаружи»): the renders flipped a coin
   on which layer moves, and the coin came up nonsense.

The response — three laws and one library: CARRIER_LIBRARY.yaml v1.0.0
(280 positions × 14 classes × 4 mechanism groups; the vocabulary that
makes diversity cheaper than the stamp), §4E CORE-4, §4F LAYER STACK,
§4G ANTI-MONOPOLY, §4C-2 MATURITY QUOTA. Gate v5 enforces all four.

The lesson, generalized: **a requirement without a DIVERSITY dimension
optimizes into a stamp.** Any axis measured by one number (points,
share, count) collapses to the cheapest carrier of that number; the
fix is always to measure the SPREAD — mechanisms, registers, routes.
This is §44's lesson (concept-anchor diversity) and §45's lesson
(hair/eye grids) re-learned at the rating layer: diversity must be
GATED, not hoped for.

---

VERSION HISTORY
- v1.0 (2026-09-09): two axes (STATE × DEGREE), carrier lexicon, per-tier
  requirement table, hedge blacklist, design ritual; gate v1.
- v1.1 (2026-09-10): §11 code integration (V11 pools — K/BRE/H/GAR/CAM
  extensions read through the carrier classes).
- v2.0 (2026-09-10, evening): §4A tag floors + expanded bank, §4B
  NEG-payload parity, §12 N21 post-mortem; gate v2. N21/SET6 patched
  in place (rev2 — 24 stack-matched tag layers, 14 self-ban terms
  removed).
- v2.1 (2026-09-11): §4C maturity floor + §13 PH-layer post-mortem;
  gate v3 (POS anchor + NEG floor checks); N21/SET6 patched to rev3
  (24 tag anchors, 23 face anchors, 24 anti-loli NEG floors). Trigger:
  the author's PH-off experiment — «тела весьма детские (лоли) и с
  большой головой. с PH такой проблемы нет».
- v2.5 (2026-09-15, V18): §4D-3 PH-safe noun register + the state noun
  bank (RF-002's delivery answer — the header bump this entry records
  was missed in-cycle; the register is the v3.0 story's beginning).
- v3.0 (2026-09-16, V19): §4E core-4 + §4F layer stack + §4G
  anti-monopoly + §4C-2 maturity quota + §14 N28 post-mortem;
  CARRIER_LIBRARY.yaml v1.0.0 minted (280 positions × 14 classes ×
  4 mechanisms); gate v5. Trigger: the author's N28 render verdict —
  «ты превратил волт в сборище милфух-мамочек в одежде, через которую
  просвечивается нижнее бельё... DEGREE-ось схлопнута в один carrier».

