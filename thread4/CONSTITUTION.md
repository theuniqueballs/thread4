# THREAD 4 — CONSTITUTION

**Era born 2026-09-19. Supersedes THREAD 3.2-EXP entirely. Clean ledger, new
names (T4-01…). 3.2 stays untouched as the rollback point
(`../chemodan/CHEMODAN_THREAD_3.2-EXP_V21/`).**

Pipeline: author (theme order) → Super Z (compiler + writer + gates) →
one batch file (21 + 3 OC) → author renders on PixAI / **Tsubaki.2 Pro**
(Tsubaki.3 tested and rejected — «полное говно») → posts on Yodayo →
verdict feeds back as events.

This document is the whole system's law. Everything else is data (specs),
history (events), or tooling (compiler/gates/dashboard). When a spec, a
gate, or a habit disagrees with this file, this file wins — or gets amended
by the amendment protocol (§12).

---

## §1. THE AUTHOR OWNS TASTE. THE SYSTEM OWNS CONSISTENCY.

Every law, spec, and gate exists to serve the author's taste or gets
retired. Taste lives in `TASTE.md` (with receipts) and grows only from
verdict events. The system never argues with a verdict; it encodes it.

## §2. ONE SOURCE OF TRUTH PER FACT.

Specs are typed data (`specs/*.json`). State is DERIVED from the append-only
event log (`events/log.jsonl`) — never hand-maintained. Nothing true lives
in two places; a fact found in two places is a bug in one of them.

## §3. THE CONTRACT PRECEDES THE PROSE.

Diversity is **assigned at compile time**, not caught by lints afterwards
(the Verbalized Sampling inversion). Before any prose is written, the
compiler emits the batch contract: slot plan + assigned carriers/poses/
palettes/codes/races/registers + every mechanical law in operational form,
built from the same constants the gates check. **Lint == contract by
construction.** The writer (Super Z) writes against the contract and
nothing else; the reader (author) sees the contract as the batch's
structural exposition.

## §4. THE RATING IS EARNED, NOT CLAIMED.

Every slot's declared tier must carry its recipe (`specs/rating-recipes.json`):
signal tags present, carrier mechanisms of the recipe's classes, counter-NEG
guarding the tier boundary. The gate grades the claim against the recipe —
narrative framing never substitutes for tier signal (N31 receipt:
"off-shoulder" prose alone stays PG-13 no matter the prose).

The tier table (author's own, 2026-09-19):

| Tier | Tag-level signal |
|---|---|
| PG-13 | sexy outfit / bikini / cleavage / thighs |
| R | lingerie / panties / bra / upskirt / erotic pose |
| R+ | cameltoe / nipples through clothing / extreme fanservice / near-nude body |
| X | nipples or genitals visible |
| XXX | a sexual act — **never used, ever** |

Platform notes: taped nipples (X-tape) = R+. X-rated posts are
algorithmically suppressed on Yodayo — X slots are art-for-art, priced
accordingly. The old X stub (open mouth + bare state doubled + fantasy
anatomy) is RETIRED — each tier now has a full recipe.

**§4-поправка (таблица приёмов автора, 2026-09-21 — «PG-13 → R → R+ →
X Cut», буру-стиль для Tsubaki 2 / PixAI) — РЕЙТИНГ = СУММА СЛОЁВ,
X CUT = ОДИН ЖЁСТКИЙ ФАКТ.**
Таблица формализована как типизированный спек
`specs/rating-techniques.json` (карта: куда теги ●/○ попадают; закон:
сумма факторов; удержание: X Cut hold; факторы вне промпта) — рецепт
v1.3.0 навигирует по ней:
- **Принцип «для идиота» — четыре слоя**: (1) что видно (одежда/грудь);
  (2) как показано (камера/поза); (3) зачем показано (лицо/настроение/
  ecchi-подача); (4) что модель дорисовывает сама (вода/прозрачность/
  «случайные» оголения). Чем больше слоёв включено, тем выше рейтинг.
- **Закон суммы факторов (блок 8)**: 1 сигнал = PG-13/R; 2 R-сигнала =
  R/R+ граница; **3+ R-сигнала через 2+ слоя = R+**; 3+ сильных + ecchi =
  риск сорваться в X; R+ + мокрая ткань + просвечивание = очень высокий
  риск нечаянного X. Гейт `technique-layers` (warn) даёт квитанцию на
  каждый R+ кадр, не набравший сумму; advisory `technique-map` печатает
  карту слоёв каждого R+/X кадра.
- **X Cut = один жёсткий факт** (видимый сосок или ареола), не сумма
  намёков — всё остальное (R, R+) есть лестница к этому факту.
- **X Cut hold (блок 9)**: низ тела вне кадра (upper body / portrait /
  cowboy shot) или в одежде (skirt/shorts/panties/pants); позы без
  раскрытия ног; solo; полный граничный NEG (рецепт v1.3.0: + penis,
  cum, uncensored, spread legs, nude lower body) — hard-гейт (rating-
  recipe); кадрирование/закрытый низ — warn-квитанция (technique-layers).
- **Ловушки** (модель дорисовывает X сама): covering breasts, hair
  covering breasts, almost naked, torn clothes, clothes pull, bath/
  bathhouse/onsen, undressing, steam censor — квитанция при встрече в
  R+ тег-блоке. **Супрессоры** (держат PG-13): standing+shy, magazine
  cover, fashion editorial.
- **Факторы вне промпта (блок 10)**: модель/LoRA, веса тегов `(tag:1.2)`,
  CFG, sampler/steps, соотношение сторон, **порядок тегов (ранние весят
  больше — независимое подтверждение рендер-закона №5)**, правила
  платформы.
- Конфликт карта↔вердикт решает вердикт: cameltoe в таблице автора
  отсутствует (= рендер-мёртв, T4-03) — карта подтверждает закон, не
  оспаривая его.

## §5. VOLT LIVES ON THE BODY. NICHE LIVES ANYWHERE.

**VOLT** (the erotic genre) must sit on body/fabric — visible on the
character, not implied by scenery. Four required axes per VOLT slot
(N30/N31-tested):
1. Camera as participant (low-angle, over-shoulder, through-gap — never neutral).
2. Body in motion, not static display (tagged physical state renders; narrated grace does not).
3. Gaze as a deliberate vector (locked / averted / half-lidded — chosen, not filler).
4. Exposure = explicit signal tag + counter-NEG, never narrative tone alone.

**NICHE** (the wonder genre) does NOT need to live on her body — 3.2 forced
VOLT's body-discipline onto NICHE and starved the exact idea-type the author
values most. Four moves, every NICHE slot carries at least one (density
floor — one gold concept per batch is not enough):
1. One natural law reversed, anchored to one small specific point.
2. Dissolution / negative space — she is read through a trace, a residue, a reflection.
3. Race as mechanism, not costume — the species does physical work in-frame.
4. A world with its own logic independent of her — she witnesses it.

A strong NICHE concept earns rating-forgiveness (the standing doctrine).

**The genre must be VISIBLE** (T4-02 verdict receipt): every prompt's header
carries its genre token (OC/NICHE/VOLT/EXQUISITE) as a structural identity —
hard-gated; the batch opens with the genre legend. A NICHE the author cannot
see is a NICHE that does not exist: the race's physical work and the witness
are the first read, checked by the niche-legibility gate.

**EXQUISITE** rides by vibe, 1–2 slots (up to 4 when the theme is rich):
ultra-VOLT or ultra-NICHE — the extremity doctrine.

## §6. PH SHAPE IS THE DELIVERY SHAPE.

Prompt Helper reshapes prose into its own form (tag-block → prose → quality
tags) and passes content already in that shape **verbatim**. So we write in
the target shape directly:
1. Tag block (the claim: identity + signal tags + state tags).
2. Prose body (the payload: noun-led, visually-loaded; what PH keeps is what
   we rely on; verb-led flourish is garnish, never mechanism).
3. Quality tags (palette-specific, never generic).

Face lock (N31 form, one word trimmed): `Her face is rendered in stylized 2D
anime style: anime eyes ([color/state]), small nose, small mouth [state],
[tone] skin.` Default opener ladder by tier: PG-13 `anime style` → R/R+
`anime style, ecchi anime style` → X `+ hentai anime style` (the N31 bundle,
split unconfirmed — retest if it matters).

## §7. DIVERSITY IS A DIMENSION OF EVERY REQUIREMENT.

Any requirement without a diversity dimension optimizes into a stamp (N28:
15/15 sheer, the milf choir). Therefore the compiler assigns by rotation and
the gates cap monopoly:
- Carriers: core-4 per R+ slot (≥4 classes × all 4 mechanism groups);
  W-class ≤45% of batch carrier instances; sheer-family ≤2 carriers/prompt
  and ≤40% of R+ frames.
- Poses: 24 distinct per batch (21 mains + 3 OC — the T4-02 verdict receipt:
the batch is 21 MAIN prompts + 3 OC prompts, never 21 total); standing-default
retired («Охуенная поза решила всё» — the strongest lever the render data ever
named).
- Palettes: distinct per slot, window-checked against the last 3 batches.
- Maturity: voice diversity (students / young women / MILFs — no grannies)
  assigned as narrative registers at compile; **never** as POS tags
  (`adult woman` / `mature female` in POS skews the whole batch MILF — N30
  receipt). The anti-loli NEG floor is the only maturity mechanic in tags.
- Races: ~10/21 when cast, delivered through both channels (tag + active
  feature doing work in-frame).
- Registers: closers, openings, witness objects — rotated, capped.
- Complex props (wheel/ladder/railing/rope) carry named contact anchors for
every limb that touches them (T4-02 verdict receipt: the valve-wheel frame
rendered with broken geometry) — prop-geometry gate.

## §8. HARD FLOORS NEVER RELAX.

- Genital lock: exposed genitals / vulva / pubic hair in NEG of every
  prompt, unconditionally (X = nipples; genitals stay locked).
- XXX never.
- Anti-loli NEG floor: child, childish, chibi, young girl, immature body,
  oversized head — every prompt, no exceptions.
- OC canon locks (appearance exactly per `specs/oc-canon.json`).
- Leak guard: signature / watermark / artist name / logo in every NEG.
- Candle/lamp spawn guard in BASE_NEG (unless the concept calls for it).
- These floors hold in every mode, every experiment, every hurry. Only an
  explicit author order amends them.

## §9. FIRST RUN CLEAN IS THE DEFINITION OF DONE.

A batch is delivered when it passed every hard gate on the FIRST run.
A fix-pass is a defect: it costs a root-cause note in the batch worklog +
a contract item (the trap becomes a constant). The receipt ledger
(events: `gate.run`) is append-only; sha-delta between runs = fix-pass.

**§9-поправка (вердикт T4-03, 2026-09-21) — R+ ЗАРАБАТЫВАЕТСЯ В КАДРЕ.**
The edge tier is claimed by a NAMED OBJECT, not a physics promise:
- ≥1 hard signal per R+ slot: `cameltoe / camel toe / taped nipples /
  topless with tape / handbra / visible pantyline` — ON a named target
  (the leotard's seat, bare skin, the waistband's line).
- Amplifiers (`see-through`, `wet clothes`, `tight clothes`, `extreme
  fanservice`, `nipples through clothing`, `almost naked`) render safe on
  their own — the author reads the result as «только купальник».
- The claim zone is the slot's LEAD zone, OPEN TO CAMERA: no skirts,
  cloaks or shirts tied at the waist over a lower claim; no buttoned tops
  over a chest claim. «Выглядит эротично, но ничего эротического не
  делает» is the named failure (receipt: 14/15 R+ slots of T4-03).
- **Mechanism-aware counter-NEG**: through-fabric mechanisms keep the full
  chest boundary (`nipples exposed, naked breasts, topless` in NEG);
  on-skin mechanisms (tape, handbra) LIFT `topless, naked breasts` from
  NEG — the boundary that holds the tier must not mute its own signal.

**§9-терция (РЕNDER-вердикт T4-03, 2026-09-21 — 24 рендера, глаз автора:
R 7/7 ✅ · X 2/2 ✅ · R+ 1/15 ❌ · OC R+ 0/3 ❌) — R+ ДОСТАВЛЯЕТСЯ
СОСТОЯНИЕМ ТКАНИ.**
v1.1.0 сделала заявки честными на бумаге — и положила их на cameltoe и
tape, теги, которые рендерер не рисует. Рендер-доказанная механика:
- Hard-заявка = только рендер-доказанные сигналы: `visible pantyline /
  nipples through clothing / clothed nipples / see-through / taped
  nipples / topless with tape / handbra`. **cameltoe НЕ заявка** — тег
  рендер-мёртв (0 отрисовок из всех попыток), флэйвор максимум.
- Через-ткань заявка ТРЕБУЕТ состояния ткани (`wet clothes` / 
  `see-through`) на ОДНОЙ тонкой светлой вещи; сухая плотная ткань
  заявку не несёт (P13/P21 умерли сухими).
- **Подслой глушит чит**: bra/camisole/bandeau под sheer-верхом —
  рендерер рисует ПОДСЛОЙ, тир падает в R (P12 sports bra под sheer
  sweater → R; P14 bra под gauze tee → R).
- Мёртвые ткани (jeans/denim/leather/velvet/sweatpants/breeches/suit)
  заявку не несут никогда.
- Доставка стохастична (~1/8 даже при законе): гейт строит кадр лучшей
  вероятности; автор перекидывает, пока не ляжет.
- X-тир доказан 2/2: bare state удвоен (теги + проза) + блок покрытия в
  NEG (`covered breasts, bra, clothing on chest`) заставляет рендерер
  взять тир — NEG-блокировка покрытия есть инструмент доставки.
- Мета-закон: VLM-грейдинг edge-тира ЗАВЫШАЕТ (VLM: 8/12 R+; глаз автора:
  1/15) — вердикт по edge-тиру принадлежит только автору; VLM-петля
  проверяет сцену/структуру, не эротику.

**§9-кватерна (приказ автора, 2026-09-21, T4-04) — ИМЕНА ОС НИКОГДА
НЕ ВХОДЯТ В POS.**
Ни тегом, ни прозой: имена триггерят реально существующих персонажей у
рендерера. POS описывает персонажа дескрипторами (раса/анатомия/волосы/
глаза/кожа); имя живёт в шапке слота и Canon-строке, которые рендерер
не читает. Кодовая гварда в писце + hard-гейт в каноне.

**§7-поправка (вердикт T4-03) — СЛОЕВАЯ ЧЁТКОСТЬ.**
≤2 garment layers per body zone; the claim zone carries ≤1 layer + the
claim target; ≥3 stacked tops or ≥5 garments in a tag block break the
renderer's layer order («чулки сквозь джинсы, какая-то майка поверх
рубашки»). OC slots take camera-facing poses — folds/prone/from-behind
hide the claim from the lens.

## §10. FEEDBACK IS THE ONLY LAW-MAKER.

Laws, recipes, and specs change only through verdict events (author words,
render data) — never prophylactically. **Exploratory slots are legalized**:
1–2 slots per batch may carry a VIOLATION flag (an experiment against a
non-floor law), logged in the experiments ledger with justification and
risk; the verdict decides whether it becomes a recipe amendment or a
cautionary tale.

## §11. THE ARCHIVE IS SUBSTRATE, NOT SCRIPTURE.

N12–N29 (in `../chemodan/…/download/`) feed taste-mining and compile-time
concept-dedup. They bind nothing: the T4 ledger starts clean, the gate
window is T4 batches only.

## §12. EVERYTHING THE SYSTEM DOES IS VISIBLE.

The author receives, per cycle: the structural exposition BEFORE the batch
(the contract: what I decided, by which rating, and why) — then the batch
(21 + 3 OC, one file) — then the batch worklog (where anything went wrong,
what was paid). All ledgers and specs are browsable in the dashboard.
No silent machinery, no invisible state.

---

## AMENDMENT PROTOCOL

An amendment is an event (`law.amended`) with: the §, the change, the
verdict/authority that caused it, and the spec/gate diff it implies. The
constitution is replaced, never annotated in place — history lives in the
event log. A law that only ever blocks strong frames is a suspect law
(Retirement Council each era).

## THE CYCLE (operational order)

1. **ORDER** — author names the theme (or asks the house to choose).
2. **COMPILE** — `t4 compile`: slot plan + assigned diversity + contract.
3. **EXPOSITION** — the contract's human half goes to the author.
4. **WRITE** — the batch (21 mains + 3 OC, one file) against the contract.
5. **GATES** — hard must pass first-run; warns receipted; advisory reports.
6. **DELIVER** — batch file + batch worklog; events appended.
7. **RENDER** — author on Tsubaki.2 Pro; posts on Yodayo.
8. **VERDICT** — author's prose → structured events (+ optional VLM pass on
   uploaded renders).
9. **LEARN** — taste log / recipes / specs amended through events only.
