/**
 * THREAD 4 — THE AUTO-SCRIBE (по приказу автора 2026-09-20).
 *
 * Автоматизированный писец: машина пишет ЧЕРНОВИК батча по контракту.
 * Детерминированные части (Canon/Spine/Stack/NEG-флооры/шапки) собирает
 * код; LLM пишет то, что и есть писательство — ANCHOR, THESIS, POS
 * (тег-блок + проза + фейс-лок), NEG-экстра. Затем гейты гоняют файл
 * всухую; провалы возвращаются модели на ремонт (≤ maxRepairRounds).
 * Событие scribe.drafted фиксирует черновик; официальная сдача —
 * отдельный шаг (deliverBatch), first-run-clean семантика сохраняется.
 *
 * z-ai-web-dev-sdk — ТОЛЬКО бэкенд (сюда импортируется и из API-роута,
 * и из bun-CLI).
 */
import fs from 'node:fs'
import path from 'node:path'

import ZAI from 'z-ai-web-dev-sdk'

import { BATCHES_DIR, CONTRACTS_DIR, readJson, writeText } from './fsutil'
import { appendEvent, foldState, readEvents } from './events'
import { runGates, type GateReceipt, type GatesResult } from './gates'
import { TIER_RANK } from './verdicts'
import { type BatchContract, type SlotPlan } from './compiler'
import {
  getBans,
  getCarriers,
  getGoldenCorpus,
  getNicheArchetypes,
  getOCCanon,
  getPalettes,
  getPoses,
  getRatingRecipes,
  getRaces,
  type Carrier,
  type Palette,
  type Pose,
  type Race,
  type OCLocks,
  type TierRecipe,
} from './specs'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface ScribeSlotOutput {
  position: number
  anchor: string
  thesis: string
  pos: string
  negExtra: string
}

export interface ScribeResult {
  slug: string
  title: string
  rounds: number // repair rounds used (0 = clean first draft)
  hardPass: boolean
  firstRunClean: boolean
  sha10: string
  receipts: GateReceipt[]
  failedSlots: number[]
  log: string[]
  markdown: string
}

export interface ScribeOptions {
  maxRepairRounds?: number // default 2
  chunkSize?: number // default 6
  /** полирующий круг WARN-гейтов (noun-lock/claim-visibility/prop-geometry/
   *  simcheck) после hard PASS — качество черновика до сдачи; откат
   *  если полировка сломала hard (черновик важнее полировки) */
  polish?: boolean // default true
  onLog?: (line: string) => void // live progress (CLI prints as it goes)
}

interface ScribeCtx {
  contract: BatchContract
  carriers: Map<string, Carrier>
  poses: Map<string, Pose>
  palettes: Map<string, Palette>
  races: Map<string, Race>
  ocs: Record<string, OCLocks>
  recipes: Record<string, TierRecipe>
  floors: Record<string, string[]>
  kNames: Map<string, { name: string; light: string }>
  batchThesis: string
  acts: string[]
  /** Одноразовый движок (3.2-традиция): спайн изобретает под тему, утилизирует после батча */
  engineName: string
  engineLaw: string
  /** ТЕМА-СЛОВА (вердикт автора «тема не раскрывается»): слова, обязанные
   *  появляться в тег-ранах слотов — спайн выводит из темы. */
  themeKeywords: string[]
}

/* ------------------------------------------------------------------ */
/* The scribe identity (system prompt)                                 */
/* ------------------------------------------------------------------ */

/* Золото — слот, который глаз автора ОЦЕНИЛ в вердикте T4-28: P20 — единственный
 * R+-слот с формулой сосков («лучший способ отобразить соски… бугорок есть,
 * розового нет — да и сам промпт охуенный»). Тёмная ткань + through-заявка —
 * эталон закона №27. Канонизированы: half-lidded→half-closed, tight
 * clothes→tight (danbooru-канон, ресёрч 2026-10-11). */
const GOLD_EXAMPLE = `P20 — void-sidesaddle-glow (VOLT · Moth-kin · R+ · PL127 · P38_VOID_BLOOD_ACCENT) — автор: «лучший способ отобразить соски… сам промпт охуенный» (R+)
POS: anime style, ecchi anime style, original character, 1girl, solo, moth girl, feathered-curved antennae, dust-scales at the collarbone, small-dusted wings in cloak-fold, powder-pale skin, black hair, red eyes, sheer black crop top, see-through, nipples through clothing, clothed nipples, covered nipples, nothing underneath, extreme fanservice, tight, full-figured body, full chest, soft waist, staticky clothes, empty eyes, sitting on motorcycle, sidesaddle bike-sit, seat to the camera, close-up, void-deep jeans, absolute-black void with single blood-red accent, ivory-bone single light, charcoal-deep shadow, motorcycle headlamp light falling full on the sheer top, stylized 2D anime face, anime eyes (red, distant half-closed), small nose, small mouth, masterpiece, best quality, anime artstyle.`

const SYSTEM_PROMPT = `You are THE HOUSE SCRIBE of THREAD 4, an anime-art prompt pipeline (Tsubaki.2 Pro renderer → Yodayo). You write single-image ecchi prompts. Your output is assembled by a machine into the batch file; malformed output breaks the machine — follow the format EXACTLY.

THE DELIVERY SHAPE (RAW+, закон №23 — приказ-миграция 2026-10-09, канон батчей T4-27/27.2):
POS = ONE comma-separated TAG RUN ending with "masterpiece, best quality, anime artstyle."
1. OPENER: anime style, ecchi anime style, original character, 1girl, solo,
2. IDENTITY: race/species features (feature tags, not the race's name alone), hair, eyes, skin — canon colors VERBATIM in the first ~10 tokens; then BODY PLAN (3-5 form tags: petite/slender/athletic/curvy/full-figured family — registers are conveyed by FORM, never by age tags).
3. SCENE: the named thin garment (its TONE is assigned by FABRIC TONE below — law №27) + contact-geometry (закон №24: where the body presses, rests, strains) + fabric STATE (wet clothes / see-through / breast clinging) + the tier claim tags + bare-under PHRASE («nothing underneath» — never the «braless» token, ζ-ревизия №16) + pose + framing tag (cowboy shot / upper body / close-up) + the scene's physical objects (witness, props with hand/foot anchors).
4. PALETTE: the slot's sd_fragment VERBATIM (dominants + secondary + edge as color-word tags) + the ONE saturated accent as a named color — colored fabrics, never default white (вердикт автора: «делай разноцветно»).
5. FACE BLOCK as TAGS: stylized 2D anime face, anime eyes ([color], [expression]), small nose, small mouth,
6. LIGHT ON THE CLAIM ZONE (закон №21): one light source falling ON the garment/zone the claim lives on — a glow word + the target.
7. THEME AS DRAWABLES ONLY (закон №26): the theme reaches THIS frame ONLY through what a renderer can DRAW — the batch's physical-law tags, palette/light tags, scene objects, and the face's expression tags. The theme TITLE never appears in POS — not as a phrase, not as a word-run, not paraphrased (author's order, T4-28: «буквально всё, что в позитиве, уходит в рендер» — an abstract title tag poisons the picture). No poetic abstraction tags: «study weight», «waltz decay», «phantom strain» are prose, not drawables. Then close: masterpiece, best quality, anime artstyle.

NO PROSE. NO SENTENCES. NO DIALOGUE. NO MONOLOGUE. If it cannot be DRAWN as nouns in a tag, it does not exist in POS (author's order, T4-28 retro-fix: «неописуемая проза… ты нихуя не нарисуешь»). Phrase-tags ARE legal (contact geometry, light falls) — they are noun-led, verb-quiet, comma-joined, and every noun names a DRAWABLE thing. Exactly ONE period: the final one. No quotes, no colons after "rendered", no "she/her" pronouns — the tag run carries nouns only.

THE RATING IS EARNED BY TAGS. Each slot names its tier and the REQUIRED signal tags — include AT LEAST the stated minimum in the TAG RUN, and NEVER include signal tags of a higher tier (overclaim fails the gate).

THE DICE LAW (Ultimate Dice, A5P6 §3 — updated 2026-10-12): every slot carries a dice signature (A·B·C·D·E — the rolled SKELETON: identification order, clothing delivery, theme integration, light style, tag-run rhythm). OBEY it — it is the slot's structure, not a suggestion. Two slots of one batch NEVER share a skeleton: if your instinct writes the same opening/order/rhythm as a previous slot, the dice are there to break exactly that. Structural monotony is the mother of twins; the dice kill it at the root.

THE RENDER LAW v1.3.0 (render verdicts T4-03 + T4-05): the renderer obeys fabric-STATE tags and coverage NEGs; it IGNORES shape-name tags. cameltoe NEVER rendered (0 attempts) — it is flavor at most, NEVER the claim. The R+ edge reads through ONE thin garment (blouse / tee / shirt / knit / swimsuit / leotard / romper / slip — tone per FABRIC TONE, закон №27) tagged wet clothes AND/OR see-through, with NO underlayer on the zone: name a bra/camisole/bandeau under a sheer top and the renderer draws the UNDERLAYER and the tier dies to R. Opaque structured fabrics (jeans, denim, leather, velvet, sweatpants, breeches, suit) never carry an edge. Delivery is stochastic — build the best-odds frame; the claim tags sit before the environment tags. THE THREE §9-септима RULES (T4-05 verdict): (1) BARE-UNDER AS A POSITIVE — a NEG lock is NOT enough, the renderer draws the bra OVER it (P07 receipt): the POS itself must assert the bare underlayer in the TAG RUN («nothing underneath» / «worn without underlayer» — never the «braless» token, ζ-ревизия №16); (2) FRAMING AS A TAG — the claim's framing lives in the TAG BLOCK (close-up / cowboy shot / upper body / portrait), never only in prose; (3) NO DANBOORU HOMONYMS — words that are foreign character names (aurora → aurora_(arknights), P08 receipt: «пробежал персонаж») appear ONLY as compounds (aurora borealis sky), never standalone. POSE-RISK: R+/X slots carry only LOW/MID poses (HIGH × R+ = mutation amplifier: P04 drift, P22 mutation, P17 undershoot) — the contract assigns the pose, never override it toward acrobatics. NEVER close the claim zone: no shawl/scarf/arms crossed over the chest claim (P21 receipt: «the frame's one closed door» — a blocker kills the slot before render).

THE NIPPLE CHANNEL LAW (закон №27, вердикт T4-28 — авторское золото P20: «лучший способ отобразить соски: слегка видно, бугорок есть, розового цвета на кофте от них — нет»): the R+ edge is a BUMP WITHOUT COLOR. The renderer draws the NOUN a non-tag phrase leads with — «nipples through clothing» on a WET LIGHT/MID garment renders the pink THROUGH the fabric and the slot slides to X (7 receipts: P07/P09/P11/P14/P17/P19/P21, all X). RULES: (a) the through-claim («nipples through clothing» + «clothed nipples») rides ONLY a DARK garment (black / ink / midnight / charcoal / deep navy / oxblood — the color word IN the garment's tag; P08 ink-indigo and P20 black receipts, both R+); (b) on a LIGHT or MID garment (white / ash / rain-grey / moss / umber / prussian — anything not dark) the channel is «covered nipples» + «clothed nipples» + the fabric STATE (wet clothes / see-through / breast clinging) — the T4-26 formula that delivered 17/25: wet light cloth clinging, bump, no drawn nipple; (c) «light on chest» is FORBIDDEN on sheer or wet tops (P14/P17 receipts — X): the zone's light is a SCENE glow falling ON the garment, never a light «on the chest»; (d) fabric TONE rotates — never more than 3 light carrying tops per batch (T4-26 verdict: «белая рубашка… хламит»); the contract assigns this slot's garment tone — obey it.

CANONICAL TAGS (danbooru strict-list research 2026-10-11 — the renderer was TRAINED on these): covered nipples, see-through, wet clothes, breast clinging, no bra, half-closed eyes, swept bangs, bandaid, tight, close-up, upper body, empty eyes, parted lips. Non-tag phrases («nipples through clothing», «light on chest», «tight clothes», «half-lidded eyes») are raw words: the renderer draws their LEADING NOUN. Prefer the canonical form whenever a choice exists («half-closed eyes» over «half-lidded», «tight» over «tight clothes»).

THE SALIENCE LAW (§9-sexta, external verdict 2026-09-23): PRESENT is not VISIBLE is not LEGIBLE. A tier is delivered through the chain OBJECT (the named claim target) → EXPOSURE (zone open to camera) → CAMERA (participant angle/pose) → CONTRAST (light ON the claim zone — not in the scenery) → SALIENCE (claim early in the tag run) → INTERPRETATION (the show WHY: fanservice/intent tag). A broken link drops the tier. The two proven killers: wet DARK fabric without light on the zone renders as an ugly dark BLOTCH (T4-04 P05); LIGHT garment against a LIGHT background dissolves — no separation (T4-04 P03). Light the claim zone itself: glow on the fabric, pale garment against a dark or saturated field. The machine NEG-locks the underlayer (bra/camisole/bandeau/undershirt) under every through-fabric claim — never name an underlayer yourself.

NAMES NEVER ENTER POS (author's order, T4-04): no character names anywhere in POS — tags or prose. Names trigger the renderer's learned foreign characters. Describe her by species / anatomy / hair / eyes / skin descriptors only; the name lives in the slot header and Canon line, which the renderer never reads.

THE TECHNIQUE MAP (author's table, 2026-09-21 — full map: specs/rating-techniques.json): a tier is a SUM OF LAYERS. Four layers: (1) WHAT is shown — clothes / breast tags; (2) HOW it is shown — camera / pose tags; (3) WHY it is shown — face / mood / ecchi-intent tags; (4) WHAT the model draws itself — water / sheer / «accident» tags. R+ = 3+ R-ladder signals across 2+ layers (2 signals is the R/R+ border, 1 is PG-13/R). X Cut = ONE hard fact — a visible nipple or areola — never a sum of hints; the lower body stays out of frame (upper body / portrait / cowboy shot) or clothed (skirt / shorts / panties / pants), never spread legs. TRAPS (the model draws the X itself): covering breasts, hair covering breasts, almost naked, torn clothes, clothes pull, bath/bathhouse/onsen, undressing. SUPPRESSORS (hold a frame at PG-13): standing+shy, magazine cover, fashion editorial. An R+ frame spreads its signals across layers — the claim (1) + the fabric state (4) + at least one camera/pose/intent tag (2 or 3); «looks erotic but does nothing» is the failure this kills.

GENRES — the author must see the difference at a glance:
- OC: her canon locks exact; the batch law rides her assigned theme — and her theme-NAME never enters POS either: draw its meaning (scene, pose, light), never its title.
- NICHE: the IMPOSSIBLE image. The race's anatomy does PHYSICAL WORK in the frame (mechanism, not costume) — race tags in the tag block, the impossibility is the FIRST read of the silhouette, the witness object holds the frame.
- VOLT: FLESH. Camera as participant (low-angle, over-shoulder, through-gap), body in motion (tagged physical state), gaze a deliberate vector (locked/averted/half-lidded), exposure by explicit signal tag.
- EXQUISITE: the ultra of its genre — extremity with dignity.

HARD STYLE RULES:
- TITLE IS THEME (вердикт автора 2026-09-27): the batch title IS the author's theme — never rename, never re-brand. The machine derives acts and keywords FROM the theme, not around it.
- POSITIVE OC MARKER: every POS begins "anime style, original character, ..." — the original character tag defends against danbooru character drift (ram_(re:zero), aurora_(arknights) receipts).
- PROSE PEOPLE LAW (T4-11 P18 receipt): prose NEVER references other people — no his jacket, no someone's hands, no male silhouettes. Solo means ALONE; objects and the world are her only company.
- ARTIST BAN: never include artist names or "by <artist>" tags anywhere (T4-11 P06 receipt: artist tag ruined the render).
- POS budget: 90-140 tags/words, never above 300. Density, not sprawl. One tag run, one final period.
- Hedges (maybe, perhaps, slightly, almost, sort of, kind of, a bit): at most 2 per POS.
- Age/maturity tags are FORBIDDEN in POS: "adult woman", "mature female" — N30 (they skew the WHOLE batch to MILF, tested). The register is conveyed by BODY FORM tags (petite/slender → student · athletic/curvy → young · full-figured/full chest/soft waist → milf register — BODY-SPECTRUM, T4-27.2); "milf" itself is legal only for OC-canon slots that carry it.
- Forbidden words: "cel-shaded", "large expressive eyes".
- Complex props (wheel, ladder, railing, rope, stair): name where hands and feet are — every touching limb anchored ("hands at ten and two", "feet braced on the lower rung").
- Rotate strong words: never lean on one pet adjective; vary the saturation family (full-pigment / full-strength / undiluted / saturated).
- The batch law is the FIRST READ of every frame — visible in silhouette, not narrated. A girl standing in nice light is a tourist.
- §51: exactly ONE full-saturation non-family accent point per frame, outnumbered by the palette family.
- Weave ALL assigned carriers into the frame (they are listed per slot) — each carrier is a physical state of fabric/body/position/physics, noun-led.
- RATING EARNED IN FRAME (verdict T4-03 + render verdict): the tier's signal must be a RENDER-PROVEN claim on a NAMED TARGET the camera can see — visible pantyline through the tight thin bottom, nipples through the wet/sheer named top, tape on bare skin with the chest zone open. cameltoe is flavor, never the claim. Physics promises without the fabric state (wet clothes / see-through tags) render dry and safe. The claim zone is the lead zone and it stays OPEN, single-layer, NO underlayer: no skirts, cloaks or tied shirts over a lower claim, no buttoned tops or bras under a chest claim. "Looks erotic but does nothing" is the named failure.
- LAYER CLARITY (verdict T4-03): ≤2 garment layers per body zone; the claim zone carries ≤1 layer + the claim target; never stack 3 tops (the renderer swaps their order — stockings through jeans, tank over shirt); layer order, when layered, is stated top-to-bottom.
- OC slots: camera-facing poses — her claim faces the lens; no folds/prone/from-behind that hide the lead zone.

NEG-EXTRA line: comma-separated EXTRA negative terms ONLY — canon anti-drift (wrong hair/eye color, wrong ears, "no tail" when she has none, "single braid" against twin braids) and frame-specific bans. The machine already adds: face guards, anti-loli floor, leak guard, candle guard, solo lock, ANTI-WASH (washed-out, faded colors, low contrast), tier counter-negatives (through-fabric: bra/camisole/bandeau/undershirt) — do NOT repeat those. ЗАКОН №25 (авторский приказ 2026-10-12, «руинишь картинки»): NEVER put these in NEG-EXTRA (the machine rejects them): visible pantyline, topless, exposed breasts, naked, nude, bare breasts, nsfw, nipples through clothing, clothed nipples, extreme fanservice, exposed genitals, vulva, pubic hair, sex, sexual act. NEG locks the UNDERLAYER and canon drift ONLY — never the claim, never the tier above, never "no male"-style double negatives. Register protection goes by FORM (petite/slender/curvy/full-figured), never by age words.

GOLD STANDARD — a delivered, author-praised slot (the voice we write in):
${GOLD_EXAMPLE}
___GOLD_CORPUS___
OUTPUT FORMAT — for EACH slot, EXACTLY:
### P05
ANCHOR: three-word-hyphenated-anchor
THESIS: one line — this frame's law in one sentence
POS: <one comma-separated tag run, RAW+ shape, ending: masterpiece, best quality, anime artstyle.>
NEG-EXTRA: term, term, term

No commentary, no markdown fences, no numbering of your own. Every slot of the chunk, in order.`

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/* Залп 3 «Ученик»: golden corpus — few-shot из реальных PH-квитанций T4-04.
   Писец учится на отрендеренной реальности (что PH отправил → что увидел
   автор), а не на самооценке; берём один точный R+-попадок и один промах —
   и голос, и границу доставки. */
function goldenCorpusBlock(): string {
  const corpus = getGoldenCorpus()
  if (!corpus || corpus.entries.length === 0) return ''
  /* Issue #4 Кенни: не «сколько», а «какие» — писец должен видеть ОБЕ формы
     порчи (leak и reshape дают промахи разной глубины). 1 точный R+ +
     2 промаха с разными доставленными тирами. */
  const exactRplus = corpus.entries.find((e) => e.claim === e.delivered && e.delivered === 'R+')
  const misses = corpus.entries.filter((e) => e.claim !== e.delivered)
  const missA = misses.find((e) => e.delivered === 'R') ?? misses[0]
  const missB = misses.find((e) => e !== missA && e.delivered !== missA?.delivered)
  const picks = [exactRplus, missA, missB].filter((e): e is NonNullable<typeof e> => Boolean(e))
  if (picks.length === 0) return ''
  return (
    '\nREAL RENDER RECEIPTS — golden corpus (what PH actually sent, what the author SAW; learn the delivery logic and the verdict boundary, NEVER the prose form — these are PH-era texts: the modern scribe renders the same scene as a RAW+ TAG RUN, law №23; extract the claim/fabric/light logic only):\n' +
    picks
      .map(
        (e) =>
          `[${e.slot}] claim ${e.claim} → DELIVERED ${e.delivered}. Author's eye: ${e.author_note}\nPH TEXT (verbatim): ${e.ph_text}`
      )
      .join('\n---\n') +
    '\n'
  )
}

function systemPrompt(): string {
  return SYSTEM_PROMPT.replace('___GOLD_CORPUS___', goldenCorpusBlock())
}

function recipeKeyOf(tier: string): string {
  if (tier === 'PG-13') return 'PG13'
  if (tier === 'R+') return 'RPLUS'
  return tier
}

function recipeOpener(recipes: Record<string, TierRecipe>, tier: string): string {
  return recipes[recipeKeyOf(tier)]?.opener ?? 'anime style, ecchi anime style'
}

function stripRaceParens(race?: string): string {
  if (!race) return '—'
  return race.replace(/\s*\([^)]*\)/g, '').trim() || '—'
}

function canonLineOf(oc: OCLocks): string {
  const parts: string[] = []
  if (oc.hair) parts.push(String(oc.hair).split('(')[0].trim())
  if (oc.eyes) parts.push(String(oc.eyes).split('(')[0].trim())
  if (oc.skin) parts.push(`${String(oc.skin).split('(')[0].trim()} skin`)
  const marks = Array.isArray(oc.signature_marks) ? (oc.signature_marks as unknown[]).map(String) : []
  for (const m of marks.slice(0, 4)) parts.push(m.split('(')[0].trim())
  /* имя — тире — хвост: «Doe — лаванда…», не «Doe —, лаванда…» (пустой
   *  сегмент после тире рождает мусорную запятую в Canon-строке) */
  return `${oc.name} — ${parts.filter(Boolean).join(', ')}`
}

function canonTagHints(oc: OCLocks): string {
  const marks = Array.isArray(oc.signature_marks) ? (oc.signature_marks as unknown[]).map(String) : []
  const shield = Array.isArray(oc.anti_shield) ? (oc.anti_shield as unknown[]).map(String) : []
  return [
    `hair: ${String(oc.hair ?? '')} — VERBATIM into the first 10 tokens of the tag block (canon colors are law: no drift, no human defaults)`,
    `eyes: ${String(oc.eyes ?? '')} — VERBATIM into the tag block, same early position`,
    `skin: ${String(oc.skin ?? '')}`,
    marks.length ? `signature marks (carry as tags): ${marks.slice(0, 5).join(' | ')}` : '',
    shield.length ? `anti-drift (put these in NEG-EXTRA): ${shield.slice(0, 10).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function paletteLine(p: Palette | undefined): string {
  if (!p) return '—'
  const dom = (p.dominant ?? []).slice(0, 3).join(', ')
  const acc = [...(p.accent1 ?? []), ...(p.accent2 ?? []), ...(p.accent ?? [])].slice(0, 2).join(', ')
  return `${p.name} (dominants: ${dom}${acc ? `; §51 accent: ${acc}` : ''}${p.light_type ? `; light: ${p.light_type}` : ''}) — palette colors go into the garment/fabric tags VERBATIM (colored fabrics, never default white — вердикт автора: «делай разноцветно, раньше ж работало»)`
}

function raceLine(race: Race | undefined, raceFeature: string | undefined): string {
  if (!race) return 'Human (no race tags; memorability from pose and carriers)'
  const feats = (race.features ?? []).slice(0, 3).join(' | ')
  return `${race.name}${feats ? ` — features: ${feats}` : ''}${raceFeature ? ` · assigned feature: ${raceFeature}` : ''}`
}

function slotFrame(slot: SlotPlan, ctx: ScribeCtx): string {
  const lines: string[] = []
  const recipe = ctx.recipes[recipeKeyOf(slot.rating)]
  const carrier = ctx.carriers
  lines.push(`SLOT P${String(slot.position).padStart(2, '0')} · genre ${slot.kind}${slot.exploratory ? ' · EXPLORATORY (probe a non-floor law, name it in THESIS)' : ''} · rating ${slot.rating}`)
  if (slot.kind === 'OC' && slot.oc) {
    const oc = ctx.ocs[slot.oc]
    lines.push(`oc: ${slot.oc}${slot.ocTheme ? ` — author's theme for her: ${slot.ocTheme}` : ' — derive her theme from the batch law'}`)
    if (slot.ocTheme) {
      lines.push(
        `OC THEME = DRAWABLES (квитанция T4-28 P01 — автор: «не понял, каким боком ты интерпретировал микро-темы, которые я давал для ОС»): translate the theme's MEANING into 2-3 DRAWABLE tags IN THE TAG RUN — props, light, pose, garment details a renderer can draw from the theme's semantics (a theme «Phantom Assassin» → hooded cloak, smoke veil, blade held low, half-hidden face — never the title itself, закон №26). The author must SEE the theme at one glance.`
      )
    }
    lines.push(`NAME LAW: the name «${slot.oc}» NEVER appears in POS — not as a tag, not in prose (names trigger the renderer's foreign characters; author's order T4-04). Describe her by the descriptor tags below only.`)
    if (oc) lines.push(`canon (locks exact, as DESCRIPTOR tags — no name):\n${canonTagHints(oc)}`)
  } else {
    lines.push(`who: ${raceLine(ctx.races.get(slot.race ?? ''), slot.raceFeature)}`)
    /* кин-блок (закон №3): теги расы в POS + хук — из контракта
     * (раньше мёртвые поля: kinPos/kinHook не доходили до промпта) */
    if (slot.kinPos) lines.push(`kin tags (race feature tags for the TAG RUN): ${slot.kinPos}`)
    if (slot.kinHook) lines.push(`kin scene hook (race's light/wardrobe hook — use it if it serves the frame): ${slot.kinHook}`)
  }
  lines.push(`pose: ${slot.pose} ${slot.poseName} (risk ${slot.poseRisk}) — the pose is ASSIGNED, honor it, no standing default`)
  lines.push(`palette: ${paletteLine(ctx.palettes.get(slot.palette))}`)
  const carriers = slot.carriers
    .map((c) => {
      const full = carrier.get(c.id)
      return `  ${c.id} ${c.name} (deg ${c.deg})${full?.carrier ? ` — "${full.carrier}"` : ''}`
    })
    .join('\n')
  lines.push(`carriers — weave ALL of these into the frame, one per mechanism group:\n${carriers}`)
  const k = ctx.kNames.get(slot.kinetics[0] ?? '')
  lines.push(`kinetic: ${slot.kinetics[0] ?? '—'}${k ? ` ${k.name}${k.light ? ` (${k.light})` : ''}` : ''}`)
  lines.push(`lead zone (FIRST read of the silhouette): ${slot.lead}`)
  lines.push(`register: ${slot.register} — convey by BODY FORM TAGS (petite/slender → student · athletic/curvy → young · full-figured, full chest, soft waist → milf; N30: age words are forbidden); add the OPPOSITE form to NEG-EXTRA (body-plan protection, T4-27.2)`)
  lines.push(`closer (final beat of the tag run, NO prose — ${slot.closer}): ${closerHint(slot.closer)}`)
  if (slot.witness) lines.push(`witness: the ${slot.witness} — one object that holds the frame's law`)
  if (slot.kind === 'NICHE' && slot.arch) {
    const archMeta = getNicheArchetypes()?.archetypes.find((a) => a.id === slot.arch)
    lines.push(
      `ARCH (НИША): ${slot.arch} ${archMeta?.name ?? ''} — ${archMeta?.hint ?? ''}\n` +
      `NICHE LAW (Z User, вердикт T4-11 «ниша не вылечилась»): NICHE = THE WORLD DOES SOMETHING. Formula: обычный мир → одно невозможное правило → конкретное физическое проявление → она СВИДЕТЕЛЬ нарушения (не хозяйка, не жертва). THESIS MUST OPEN with "ARCH: ${slot.arch} · LAW: <world rule in one sentence> · PROOF: <what the frame physically shows as evidence>".\n` +
      `FIVE KILLERS (each = genre death, from the T4-11 verdict): (1) costume race — species = PHYSICS not appearance: if raced, ears/wings/tail/scales must DO work in the frame; (2) decoration world — the world must ACT and exist without her (test: remove the girl — if the world still happens, NICHE lives); (3) abstract words — dreamlike/ethereal/mysterious/magical banned, physical fact only; (4) erotic takeover — eroticism is a CONSEQUENCE of the law, never the payload; (5) prose-only legibility — if it is not VISIBLE in the frame, it does not exist.\n` +
      `WITNESS LAW: someone or something must DISCOVER the wrongness — «кто первый понял, что здесь что-то не так?» Small beats beat big magic: a drop hanging, a shadow arriving early, snow avoiding one object.`
    )
    /* Вердикт T4-28: «всё — волт разной степени» — 6/7 NICHE-слотов genreRead «no».
     * Ниша обязана читаться СИЛУЭТОМ — impossibility-first: механизм расы/мира
     * в ПЕРВЫХ 12 тегах, до одежды и заявки (паттерн T4-23 — единственный
     * ниш-успех: «весь батч как ниша вперемешку с волтом»). */
    lines.push(
      `IMPOSSIBILITY-FIRST (вердикт T4-28 — «всё — волт разной степени», 6/7 ниш genreRead «no»): the impossible mechanism tag(s) sit in the FIRST 12 TAGS of the POS — before the garment, before the claim. The FIRST READ of the silhouette must be the impossibility (race anatomy doing physical work / world law acting), not «девка в красивом белье» (T4-09: «нацепил белья и решил, что это ниша»). If the first 12 tags read as a girl + ears — the slot is dead as NICHE.`
    )
  }
  /* Fred (Agent), 2026-09-28: старый DEVICE-блок снят — формула вердикта T4-11
     (NICHE-LAW v2, «ARCH · LAW · PROOF» выше) канонизирована и доказана батчами
     T4-12/T4-13; дубль с формулой DEVICE противоречил ей в промпте писца
     (хвост патча 3e7aa87: новый блок дописан, старый не снят). Issue #13. */
  if (ctx.themeKeywords.length > 0) {
    const k1 = ctx.themeKeywords[slot.position % ctx.themeKeywords.length]
    const k2 = ctx.themeKeywords[(slot.position + Math.floor(ctx.themeKeywords.length / 2)) % ctx.themeKeywords.length]
    const words = k2 && k2 !== k1 ? `${k1} AND ${k2}` : k1
    lines.push(`theme words for THIS slot (weave into the TAG RUN as DRAWABLE tags/compounds — objects, materials, physical states; NEVER the theme title itself, NEVER abstract nouns): ${words}`)
  }
  if (recipe) {
    const hardSignals = recipe.signals_hard ?? []
    /* фильтр ловушек: в списке сигналов живут и X-● теги (almost naked,
    * torn clothes — карта-таблица) — предлагать их писцу как «REQUIRED
    * signals» значит приглашать в ловушку (9-b-аудит F19) */
    const TRAP_RE =
      /almost naked|torn clothes|clothes pull|covering breasts|hair covering|undressing|bath|onsen|braless|tight clothes/i
    const offerSignals = recipe.signals.filter((s) => !TRAP_RE.test(s))
    lines.push(`REQUIRED rating signals — include ≥${recipe.signal_min} of these IN THE TAG BLOCK (before the environment tags): ${offerSignals.slice(0, 14).join(', ')}`)
    if (hardSignals.length > 0) {
      lines.push(
        `HARD CLAIM (RENDER LAW v1.3.0, render verdicts T4-03 + T4-05): ≥${recipe.hard_min ?? 1} RENDER-PROVEN claim in the tag block — ${hardSignals.join(', ')}. cameltoe is NOT a claim (0 renders ever — flavor only). Through-fabric claims REQUIRE the fabric state tags (wet clothes / see-through / breast clinging) on ONE thin garment (tone per FABRIC TONE — закон №27), NO underlayer on the zone — and the POS must assert the bare underlayer POSITIVELY in the TAG RUN («nothing underneath» / «worn without underlayer» — never the «braless» token, ζ-ревизия №16: a NEG lock alone fails, the renderer draws the bra OVER it — P07 receipt). Frame the claim with a camera TAG (close-up / cowboy shot / upper body). Dead fabrics (jeans/denim/leather/velvet/sweatpants/breeches/suit) never carry the claim. NO danbooru homonyms standalone (aurora → aurora_(arknights) — only compounds). NEVER cross anything over the chest claim (shawl/arms = the frame's one closed door = dead slot, P21 receipt).`
      )
      lines.push(
        `CLAIM ZONE = the lead zone (${slot.lead}), OPEN TO CAMERA, single layer + the claim target. Delivery is stochastic (~1/8): build the best-odds frame — the claim and its fabric state EARLY in the tag run (≤16th tag for mains, ≤22nd for OC), the same named garment carrying the claim. «Looks erotic but does nothing» is the failure this law kills.`
      )
    }
    lines.push(`tier boundary: do NOT use higher-tier signals (${higherTierSignals(slot.rating, ctx.recipes).join(', ')}) — the counter-negatives are added by the machine`)
  }
  /* Закон №27 (вердикт T4-28 — X-слайды «слишком прорисованы соски»):
   * тон несущей вещи назначен контрактом; through-заявка — только dark.
   * Серо-семья (rain-grey/moss/umber/prussian) — СРЕДНЯЯ, не «тёмнеющая»:
   * «prussian-dark» как подсказка валила гейт (prussian — светлая семья
   * кластера, 5 из 7 X-слайдов T4-28 были серо-семейными) — средний тон
   * держит covered-канал без исключений. */
  if (slot.rating === 'R+' || slot.rating === 'X') {
    const tone = slot.fabricTone ?? 'mid'
    const toneLaw =
      tone === 'dark'
        ? 'DARK garment — the through-claim («nipples through clothing» + «clothed nipples») is ALLOWED here: the darkness kills the pink, keeps the bump (P08/P20 receipts, both R+). Name the dark color IN the garment tag.'
        : tone === 'light'
          ? 'LIGHT garment — the through-claim is FORBIDDEN (7 X-receipts T4-28): the channel is «covered nipples» + «clothed nipples» + the fabric STATE (wet clothes / see-through / breast clinging) — wet cloth clinging, bump, NO drawn nipple. Never «light on chest».'
          : 'MID garment — same as LIGHT, NO exceptions: «covered nipples» + «clothed nipples» + fabric state; the grey family (rain-grey/moss/umber/prussian/rose-grey) is MID, not dark-leaning — 5 of the 7 T4-28 X-slides wore grey-family mids. When in doubt, no «through».'
    lines.push(`FABRIC TONE (закон №27, вердикт T4-28): ${tone.toUpperCase()} — ${toneLaw}`)
  }
  /* EXP-слоты (вердикт T4-28: «не забывай про EXP промпты»): чистая болванка
   * без темы, гипотеза слота — в THESIS. Маркер — канон радара
   * (batch-md.ts HYPO_PAIR_RE): «EXP κ-A · H10 …» — греческая буква из
   * контракта, иначе гипотеза НЕ попадает в ТРИАЛ-радар дашборда. */
  if (slot.exp) {
    const letter = slot.exp.letter ?? 'α'
    lines.push(
      `EXP SLOT (вердикт T4-28 — «не забывай про EXP промпты»): чистая болванка БЕЗ темы батча — тема-слота и движок НЕ применяются. Гипотеза: ${slot.exp.hypothesis}${slot.exp.half ? ` (половина ${slot.exp.half}${slot.exp.pairWith ? `, пара с P${String(slot.exp.pairWith).padStart(2, '0')}` : ''})` : ''}. THESIS MUST OPEN with "EXP ${letter}-${slot.exp.half ?? 'A'} · ${slot.exp.hypothesis.slice(0, 80)}" — одна переменная отличает половины, всё остальное одинаково (канон T4-27.2: «план identical»).`
    )
  }
  if (slot.ab) {
    lines.push(
      `A/B-ПАРА ${slot.ab.pair} — половина ${slot.ab.half}, пара с P${String(slot.ab.withSlot).padStart(2, '0')} (§10-поправка): LEAD-зона одна (${slot.ab.lead}) — ЗАЯВКА ОДИНАКОВАЯ (тот же механизм доставки: wet/sheer через именованную тонкую вещь на этой зоне — тон каждой половины назначен её FABRIC TONE, канал по закону №27), ПОДАЧА РАЗНАЯ (поза/камера/свет назначены разные — не выравнивай их). Вердикт приёмника атрибутирует канал доставки, а не случай.`
    )
  }
  if (slot.dice) {
    lines.push(
      `DICE (Ultimate Dice, A5P6 §3 — скелет этого слота, ОБЯЗАТЕЛЕН; другой слот батча его не разделяет): ${slot.diceSig}
${slot.dice}`
    )
  }
  if (slot.targetChannel) {
    lines.push(
      `REHAB target channel: ${slot.targetChannel} (добор по вердикту автора — сделай заявку этого канала доставки главным сигналом кадра)${slot.targetChannelNote ? `\nREHAB CONFIG (проверенная конфигурация оживления — строй кадр ПО НЕЙ, не по голому имени канала): ${slot.targetChannelNote}` : ''}`
    )
  }
  if (slot.rating === 'R+') {
    lines.push(`TECHNIQUE MAP (блок 8 — сумма слоёв): 3+ R-сигнала через 2+ слоя — заявка (слой 1) + состояние ткани (слой 4) + ≥1 кадровый тег (слой 2: from below / close-up / bent over / back arch; или слой 3: seductive smile / bedroom eyes / fanservice). Ловушки — не пиши: covering breasts, hair covering breasts, almost naked, torn clothes, clothes pull, bath/onsen, undressing. Супрессоры — не пиши: standing+shy, magazine cover, fashion editorial.`)
  }
  if (slot.rating === 'X') {
    lines.push(`X CUT HOLD (блок 9): ОДИН жёсткий факт (видимый сосок/ареола), не сумма намёков; низ — вне кадра (upper body / portrait / cowboy shot) или в одежде (skirt / shorts / panties / pants); БЕЗ spread legs — машина ставит полный граничный NEG (включая penis, cum, uncensored, nude lower body).`)
  }
  return lines.join('\n')
}

function closerHint(closer: string): string {
  switch (closer) {
    case 'dialogue': return 'end with a mood-expression tag (murmuring lips, whispered sigh) — spoken lines are forbidden in RAW+'
    case 'long-fused': return 'end with one lingering visual detail tag (a stain keeping its shape, a light that stays)'
    case 'fragment-pair': return 'end with two paired detail tags, comma-joined'
    case 'image-close': return 'end with one settling still-image tag'
    case 'action-close': return 'end with the motion caught mid-beat as a tag (water dripping mid-air)'
    default: return 'end with one clean final image tag'
  }
}

function higherTierSignals(tier: string, recipes: Record<string, TierRecipe>): string[] {
  const order: Record<string, number> = TIER_RANK
  const mine = order[tier] ?? 0
  const out: string[] = []
  for (const [key, rec] of Object.entries(recipes)) {
    const t = key === 'PG13' ? 'PG-13' : key === 'RPLUS' ? 'R+' : key
    if ((order[t] ?? 0) > mine && t !== 'XXX') out.push(...(rec.signals ?? []).slice(0, 8))
  }
  return [...new Set(out)]
}

/* ------------------------------------------------------------------ */
/* NEG assembly (the machine half)                                     */
/* ------------------------------------------------------------------ */

function assembleNeg(slot: SlotPlan, out: ScribeSlotOutput, ctx: ScribeCtx): string {
  const f = ctx.floors
  const terms: string[] = []
  terms.push(...(f.face_guard ?? []))
  terms.push(...(f.anti_loli ?? []))
  /* закон №25 «NEG-гигиена» (авторский приказ 2026-10-12, ретро-фикс T4-28):
   * X-блок (exposed genitals, vulva, pubic hair, sex, sexual act) УДАЛЁН из
   * универсальной сборки — рендерер не рисует X из R+/R-промптов сам (X=0
   * всю RAW-эру), а nude-смежные термины гасят ecchi-энергию (δ T4-26:
   * жирный NEG подавляет смежные заявки — «руинишь картинки»). */
  terms.push(...(f.leak_guard ?? []))
  const posLower = out.pos.toLowerCase()
  if (!/candle|lantern|torch|chandelier|lamp|brazier/.test(posLower)) {
    terms.push(...(f.candle_guard ?? []))
  }
  terms.push('male', 'man', '1boy', '2girls')
  /* Five Locks (закон №23): ANTI-WASH — ВСЕГДА в NEG каждого слота.
   * Сдача T4-28 v1 его потеряла (гейт raw-plus молча спал без маркера). */
  terms.push('washed-out', 'faded colors', 'low contrast')
  const recipe = ctx.recipes[recipeKeyOf(slot.rating)]
  if (recipe) {
    // МЕХАНИЗМ-ОСОЗНАННЫЙ КОНТР-NEG (закон №14 «NEG-смежности» v1.7.0 +
    // закон №25): активный механизм диктует СВОЮ границу.
    //   on-skin (tape/handbra): nipples exposed, areola + подслой —
    //     «topless, naked breasts» подняты (иначе рендерер закрывает грудь).
    //   through_fabric: ТОЛЬКО подслой-лок (bra/camisole/bandeau/undershirt)
    //     — nipple-термины гасят clothed-заявку (P04 T4-25), nudity-термины
    //     гасят ecchi-энергию (автор, T4-28): X-граница держится
    //     конструктивно (закон №21 — свет-на-зоне), не негативно.
    let counter = [...(recipe.counter_neg ?? [])]
    for (const m of Object.values(recipe.mechanisms ?? {})) {
      const hard = m.hard ?? []
      const active = hard.some((h) => posLower.includes(h.toLowerCase()))
      if (active) {
        counter = counter.filter(
          (t) => !(m.counter_neg_lifted ?? []).some((x) => x.toLowerCase() === t.toLowerCase())
        )
        counter = [...new Set([...counter, ...(m.counter_neg ?? [])])]
      }
    }
    terms.push(...counter)
    // §10-поправка (noun-lock): подслой под сквозь-ткань заявку лочится
    // в NEG — тишина по подслою = дыра (рендерер дорисовывает bra/camisole
    // сам, тир падает в R — рендер-вердикт T4-03: P12 sports bra, P14 bra).
    // Границы слов: «brazier» свечной гарды ≠ «bra»
    const throughFabric = ['nipples through clothing', 'clothed nipples', 'see-through', 'visible pantyline'].some(
      (t) => posLower.includes(t)
    )
    if (throughFabric) {
      for (const t of ['bra', 'camisole', 'bandeau', 'undershirt']) {
        if (!new RegExp(`\\b${t}\\b`).test(posLower)) terms.push(t)
      }
    }
  }
  if (slot.kind === 'OC' && slot.oc) {
    const oc = ctx.ocs[slot.oc]
    if (oc && Array.isArray(oc.anti_shield)) {
      terms.push(...(oc.anti_shield as unknown[]).map(String))
    }
  }
  /* расовый anti-shield (kin-block, закон №3): kinNeg приходит с «no X»-
   * префиксом из старого ручного формата — NEG сам негативен, префикс
   * снимаем («no horns» → «horns»), иначе санитайзер выкинет весь щит */
  if (slot.kinNeg) {
    for (const t of slot.kinNeg.split(',')) {
      const x = t.trim().replace(/^no\s+/i, '').trim()
      if (x) terms.push(x)
    }
  }
  if (out.negExtra.trim()) {
    for (const t of out.negExtra.split(/[,;]+/)) {
      const x = t.trim()
      if (x) terms.push(x)
    }
  }
  // закон №25: санитайзер NEG-EXTRA — авторский бан-лист (руинит заявки),
  // «no X»-дубли (мужской лок уже в NEG), возрастные теги (N30).
  const NEG_BAN = new Set(
    [
      'visible pantyline', 'topless', 'exposed breasts', 'naked', 'nude',
      'bare breasts', 'nsfw', 'nipples through clothing', 'clothed nipples',
      'extreme fanservice', 'exposed genitals', 'vulva', 'pubic hair',
      'sex', 'sexual act',
    ].map((s) => s.toLowerCase())
  )
  const sanitized = terms.filter((t) => {
    const k = t.toLowerCase().replace(/^no\s+/i, '')
    if (NEG_BAN.has(k)) return false
    if (/^no\s+/i.test(t)) return false // «no male»-дубли — NEG уже негативен
    if (/^(adult woman|mature woman|mature female)$/i.test(t)) return false // N30
    return true
  })
  // dedupe (case-insensitive), keep first spelling
  const seen = new Set<string>()
  const final: string[] = []
  for (const t of sanitized) {
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    final.push(t)
  }
  return final.join(', ')
}

/* ------------------------------------------------------------------ */
/* POS normalization (safe, deterministic)                             */
/* ------------------------------------------------------------------ */

function normalizePos(pos: string, slot: SlotPlan, ctx: ScribeCtx): string {
  let p = pos.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()
  // strip accidental markdown fences
  p = p.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim()
  // ЗАПРЕТ ИМЁН (приказ автора, T4-04): имена ОС в POS — триггеры чужих
  // персонажей у рендерера. Кодовая гварда: имя вычищается из POS всегда,
  // даже если LLM его написал. Имена собственные, case-sensitive
  // («ash-grey» не трогаем)
  for (const name of Object.keys(ctx.ocs)) {
    p = p
      .replace(new RegExp(`\\b${name}\\b,\\s*`, 'g'), '') // «Miyu, tag» → «tag»
      .replace(new RegExp(`,\\s*\\b${name}\\b`, 'g'), '') // «tag, Miyu» → «tag»
      .replace(new RegExp(`\\s+\\b${name}\\b`, 'g'), '') // проза «… Miyu» → «…»
  }
  p = p
    .replace(/\s{2,}/g, ' ')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*\./g, '.')
    .replace(/^\s*,\s*/, '')
    .trim()
  // U1 (вердикт автора 2026-09-27): original character — в позитив каждого
  // слота. Рендерер не матчит данбуру-персонажей, когда тег заявляет
  // оригинальность (ram_(re:zero), aurora_(arknights) —receipts)
  if (!/(^|,\s*)original character/i.test(p)) {
    p = p.replace(/^([^,]+,\s*)/, '$1original character, ')
  }
  if (!/anime style/i.test(p)) {
    p = `${recipeOpener(ctx.recipes, slot.rating)}, ${p}`
  }
  if (!/masterpiece/i.test(p)) {
    p = `${p.replace(/[.\s]*$/, '')}. Masterpiece, best quality, anime artstyle.`
  }
  return p
}

/* ------------------------------------------------------------------ */
/* Batch file assembly                                                 */
/* ------------------------------------------------------------------ */

function assembleBatch(
  ctx: ScribeCtx,
  outputs: Map<number, ScribeSlotOutput>,
  title: string
): string {
  const c = ctx.contract
  const L: string[] = []
  /* закон №23: H1 несёт маркер RAW+ — гейт raw-plus читает его (урок T4-28
   * v1: батч без маркера молча прошёл без ANTI-WASH и face-блок проверок) */
  L.push(`# THREAD 4 — Batch ${c.slug}: "${title}" — БАТЧ (RAW+ / данбуру-формат)`)
  L.push('')
  if (c.authorWishes) {
    L.push(`**ПРИКАЗ АВТОРА** (draft → контракт, §10): ${c.authorWishes}`)
    L.push('')
  }
  L.push(ctx.batchThesis.trim())
  L.push('')
  if (ctx.themeKeywords.length > 0) {
    L.push(`ТЕМА-СЛОВА: ${ctx.themeKeywords.join(', ')}`)
    L.push('')
  }
  L.push(`ДВИЖОК (одноразовый): ${ctx.engineName} — ${ctx.engineLaw}`)
  L.push('')
  L.push('ЖАНРЫ (легенда — вердикт T4-02: жанр обязан быть виден): **OC** — канон-локи персонажа, тема в слоте; **NICHE** — невозможный образ: раса делает ФИЗИЧЕСКУЮ работу в кадре, свидетель держит кадр, невозможное — первое считывание силуэта; **VOLT** — плоть: камера-участник, тело в движении, взгляд-вектор, экспозиция тегом; **EXQUISITE** — ультра своего жанра.')
  const mains = c.slots.filter((s) => s.kind !== 'OC')
  const spread: Record<string, number> = {}
  for (const s of mains) spread[s.rating] = (spread[s.rating] ?? 0) + 1
  L.push(`СТРУКТУРА (закон 24): ${c.slots.length} промпта = ${c.slots.filter((s) => s.kind === 'OC').length} OC + ${c.slots.filter((s) => s.kind !== 'OC' && s.kind !== 'EXP').length} мейн${c.slots.some((s) => s.kind === 'EXP') ? ` + ${c.slots.filter((s) => s.kind === 'EXP').length} EXP-болванки (без темы)` : ''} · спред мейнов ${Object.entries(spread).map(([r, n]) => `${r}×${n}`).join(' · ')} · расовый каст ${c.racialCount}/${c.slots.filter((s) => s.kind !== 'OC').length} · регистры третями.`)
  L.push('RENDER PROTOCOL: RAW+ (закон №23) — чистые Danbooru-теги, БЕЗ прозы: палитра под каждый промпт + аниме-лицо тегом + квалити-цвет. Спайн назначен контрактом до первого слова; гейты читают те же числа.')
  L.push('')
  const acts = ctx.acts.length === 3 ? ctx.acts : ['ACT I', 'ACT II', 'ACT III']
  const actRanges: [number, number][] = [[1, 8], [9, 16], [17, 24]]
  for (let a = 0; a < 3; a++) {
    L.push('════════════════════════════════════════════════════════════════════════')
    L.push(`ACT ${['I', 'II', 'III'][a]} — ${acts[a].toUpperCase()}`)
    L.push('════════════════════════════════════════════════════════════════════════')
    L.push('')
    for (let pos = actRanges[a][0]; pos <= actRanges[a][1]; pos++) {
      const slot = c.slots[pos - 1]
      const out = outputs.get(pos)
      if (!slot || !out) continue
      const who = slot.kind === 'OC' ? slot.oc : stripRaceParens(slot.race)
      L.push(`P${String(pos).padStart(2, '0')} — ${out.anchor} (${slot.kind}${slot.exploratory ? ' ⚗' : ''} · ${who} · ${slot.rating} · ${slot.pose} · ${slot.palette})`)
      L.push(`THESIS: ${out.thesis}`)
      if (slot.kind === 'OC' && slot.oc && ctx.ocs[slot.oc]) {
        L.push(`Canon: ${canonLineOf(ctx.ocs[slot.oc])}`)
      }
      const k = ctx.kNames.get(slot.kinetics[0] ?? '')
      const spineParts = [
        `${slot.pose} ${slot.poseName}`,
        `${slot.kinetics[0] ?? '—'}${k ? ` ${k.name}` : ''}`,
        `LEAD ${slot.lead}`,
        `${slot.register} register`,
        `closer ${slot.closer}`,
      ]
      if (slot.dice) spineParts.push(`dice ${slot.diceSig}`)
  if (slot.witness) spineParts.push(`witness: ${slot.witness}`)
      if (slot.ocTheme && slot.kind === 'OC') spineParts.push(`OC theme: ${slot.ocTheme}`)
      if (slot.targetChannel) spineParts.push(`REHAB target channel: ${slot.targetChannel} (добор по вердикту автора — сделай заявку этого канала доставки главным сигналом кадра)`)
      L.push(`Spine: ${spineParts.join(' · ')}`)
      L.push(`Stack: ${slot.carriers.map((x) => x.id).join(' + ')}`)
      L.push('POS:')
      L.push('')
      L.push(normalizePos(out.pos, slot, ctx))
      L.push('')
      L.push('NEG:')
      L.push('')
      L.push(assembleNeg(slot, out, ctx))
      L.push('')
    }
  }
  /* EXP-оверлей (вердикт T4-28: «не забывай про EXP промпты»): болванки
   * поверх 24-слотового закона — отдельной секцией после актов, без
   * темы и движка батча (policy.exp_overlay_note, приказ 2026-10-08). */
  const expSlots = c.slots.filter((s) => s.kind === 'EXP')
  if (expSlots.length > 0) {
    L.push('════════════════════════════════════════════════════════════════════════')
    L.push(`EXP OVERLAY — ${expSlots.length} болванок (без темы; policy expSlotsMax, вердикт T4-28 «не забывай про EXP промпты»)`)
    L.push('════════════════════════════════════════════════════════════════════════')
    L.push('')
    for (const slot of expSlots) {
      const out = outputs.get(slot.position)
      if (!out) continue
      const who = stripRaceParens(slot.race)
      L.push(`P${String(slot.position).padStart(2, '0')} — ${out.anchor} (EXP · ${who} · ${slot.rating} · ${slot.pose} · ${slot.palette})`)
      L.push(`THESIS: ${out.thesis}`)
      const k = ctx.kNames.get(slot.kinetics[0] ?? '')
      const spineParts = [
        `${slot.pose} ${slot.poseName}`,
        `${slot.kinetics[0] ?? '—'}${k ? ` ${k.name}` : ''}`,
        `LEAD ${slot.lead}`,
        `${slot.register} register`,
        `closer ${slot.closer}`,
      ]
      if (slot.dice) spineParts.push(`dice ${slot.diceSig}`)
      if (slot.fabricTone) spineParts.push(`fabric tone ${slot.fabricTone} (закон №27)`)
      L.push(`Spine: ${spineParts.join(' · ')}`)
      L.push(`Stack: ${slot.carriers.map((x) => x.id).join(' + ')}`)
      L.push('POS:')
      L.push('')
      L.push(normalizePos(out.pos, slot, ctx))
      L.push('')
      L.push('NEG:')
      L.push('')
      L.push(assembleNeg(slot, out, ctx))
      L.push('')
    }
  }
  return L.join('\n').trimEnd() + '\n'
}

/* ------------------------------------------------------------------ */
/* LLM plumbing                                                        */
/* ------------------------------------------------------------------ */

type ZAiChat = Awaited<ReturnType<typeof ZAI.create>>

async function chat(zai: ZAiChat, system: string, user: string, log: string[], retries = 2): Promise<string> {
  let lastErr: unknown = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const completion = await zai.chat.completions.create({
        messages: [
          /* Залп 3: system — системной ролью (аудит v1 🟡); при капризах
             upstream первый ретрай откатывается на assistant-совместимость */
          { role: attempt === 0 ? 'system' : 'assistant', content: system },
          { role: 'user', content: user },
        ],
        thinking: { type: 'disabled' },
      })
      const content = completion.choices[0]?.message?.content ?? ''
      if (content.trim().length > 0) return content
      lastErr = new Error('empty completion')
    } catch (e) {
      lastErr = e
    }
    log.push(`  · LLM-вызов не удался (${attempt + 1}/${retries + 1})${attempt < retries ? ' — повтор' : ''}`)
  }
  throw lastErr instanceof Error ? lastErr : new Error('LLM failed')
}

function parseSlots(raw: string): Map<number, ScribeSlotOutput> {
  const out = new Map<number, ScribeSlotOutput>()
  const blocks = raw.split(/^###\s*P(\d{1,2})\s*$/m)
  // split with capture: [pre, n1, body1, n2, body2, ...]
  for (let i = 1; i + 1 < blocks.length + 1; i += 2) {
    const n = parseInt(blocks[i], 10)
    const body = blocks[i + 1] ?? ''
    if (!Number.isFinite(n)) continue
    const grab = (key: string): string => {
      const re = new RegExp(`^${key}:\\s*(.*)$`, 'm')
      const m = re.exec(body)
      if (m) return m[1].trim()
      // multiline POS: key: then lines until next KEY: line
      const reM = new RegExp(`^${key}:\\s*\\n([\\s\\S]*?)(?=\\n[A-Z-]+:|$)`, 'm')
      const mM = reM.exec(body)
      return mM ? mM[1].trim() : ''
    }
    const posSingle = grab('POS')
    const posMulti = (() => {
      const re = /^POS:\s*\n?([\s\S]*?)(?=\nNEG-EXTRA:|$)/m.exec(body)
      return re ? re[1].trim() : ''
    })()
    out.set(n, {
      position: n,
      anchor:
        grab('ANCHOR').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 60) ||
        grab('THESIS').split(/\s+/).slice(0, 3).join('-').toLowerCase().replace(/[^\w-]/g, '') ||
        'unnamed-frame',
      thesis: grab('THESIS'),
      pos: (posSingle && posSingle.length > posMulti.length ? posSingle : posMulti) || posSingle || posMulti,
      negExtra: grab('NEG-EXTRA'),
    })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* The scribe                                                          */
/* ------------------------------------------------------------------ */

export async function scribeBatch(
  slug: string,
  options: ScribeOptions = {}
): Promise<ScribeResult> {
  const log: string[] = []
  const maxRepairRounds = options.maxRepairRounds ?? 2
  const chunkSize = options.chunkSize ?? 6
  const say = (s: string) => {
    log.push(s)
    options.onLog?.(s)
  }

  /* contract + specs */
  const contract = readJson<BatchContract>(path.join(CONTRACTS_DIR, `${slug}.json`))
  if (!contract) throw new Error(`контракт ${slug} не найден — сначала сборка`)
  // guard: сданный батч не перезаписывается черновиком (first-run-clean свято)
  const allDelivered = readEvents()
    .filter((e) => e.type === 'batch.delivered')
    .map((e) => String(e.data?.slug ?? ''))
  if (allDelivered.includes(slug)) {
    throw new Error(`${slug} уже сдан — черновик не перезаписывает сданный батч`)
  }
  /* scribe.objection (Залп 3 «Ученик»): право писца возразить контракту
     официально — заявка мёртвых каналов без прицела автора = печать сомнения */
  const deadClaims = contract.channelStats?.deadClaims ?? []
  if (deadClaims.length > 0 && !contract.authorPin?.length) {
    appendEvent(
      'scribe.objection',
      `${slug}: писец возражает — контракт заявляет мёртвые каналы [${deadClaims.map((c) => c.channel).join(', ')}] без author_pin; исполняю приказ, но печать сомнения стоит`,
      { slug, channels: deadClaims.map((c) => c.channel) }
    )
  }
  const carriersSpec = getCarriers()
  const posesSpec = getPoses()
  const palettesSpec = getPalettes()
  const racesSpec = getRaces()
  const ocCanon = getOCCanon()
  const recipesSpec = getRatingRecipes()
  const bans = getBans()
  if (!carriersSpec || !posesSpec || !palettesSpec || !racesSpec || !ocCanon || !recipesSpec || !bans) {
    throw new Error('спеки не загружены')
  }
  const poolsSpec = readJson<{ sections: Record<string, { id: string; name?: string; light?: string }[]> }>(
    path.join(process.cwd(), 'thread4', 'specs', 'pools.json')
  )
  const kNames = new Map<string, { name: string; light: string }>()
  for (const k of poolsSpec?.sections?.kinetics_k ?? []) {
    kNames.set(k.id, { name: k.name ?? k.id, light: k.light ?? '' })
  }

  const ctx: ScribeCtx = {
    contract,
    carriers: new Map(Object.values(carriersSpec.classes).flat().map((c) => [c.id, c])),
    poses: new Map(posesSpec.poses.map((p) => [p.id, p])),
    palettes: new Map(palettesSpec.palettes.map((p) => [p.id, p])),
    races: new Map(racesSpec.races.map((r) => [r.name, r])),
    ocs: ocCanon.ocs,
    recipes: recipesSpec.tiers as unknown as Record<string, TierRecipe>,
    floors: recipesSpec.eternal_floors as unknown as Record<string, string[]>,
    kNames,
    batchThesis: '',
    acts: [],
    themeKeywords: [],
    engineName: '',
    engineLaw: '',
  }

  const engine = contract.engineLaw
  const theme = contract.theme

  say(`Писец: ${slug} «${theme}» · движок ${contract.engine} · ${contract.slots.length} слотов`)

  const zai = await ZAI.create()

  /* ---- call 0: batch spine (title, thesis, acts) ---- */
  say('Шаг 1/4: закон батча, название, три акта…')
  const wishesBlock = contract.authorWishes
    ? `\nAUTHOR'S WISHES (приказ автора этому батчу — закон энергии §10, виден в каждом кадре, не только в шапке): ${contract.authorWishes}`
    : ''
  const spineRaw = await chat(
    zai,
    systemPrompt(),
    `BATCH ${slug} «${theme}». THE THEME IS THE LAW.${wishesBlock}\n\nInvent a ONE-BATCH ENGINE for this theme (3.2-традиция, одноразовый): a physical law SPECIFIC to this theme that bends fabric, light, physics and wardrobe in every frame — not a generic style. The engine lives for this batch only. Return EXACTLY, nothing else:\nENGINE: <2-4 words, name of the engine>\nLAW: <1-2 sentences: the physical law and how the wardrobe obeys it>\nTHEME-KEYWORDS: <5-8 English tag-safe words from the THEME itself — drawable objects, places, materials, physical states that can appear INSIDE tags (NOT style words, NOT the theme title verbatim, NOT abstractions — only what a renderer can draw)>\nTHESIS: <one paragraph, 90-140 words: the batch's ONE law, physical and testable in-frame, how the THEME (not the engine) is delivered across the 24 frames, and how the three acts escalate it>\nACT I: <WIDE sub-theme name, 2-5 words — each act must hold VERY different pictures>\nACT II: <WIDE sub-theme name>\nACT III: <WIDE sub-theme name>`,
    log
  )
  const engineName = (/^ENGINE:\s*(.+)$/m.exec(spineRaw)?.[1] ?? 'per-theme').trim().slice(0, 60)
  const engineLawSpine = (/^LAW:\s*(.+)$/m.exec(spineRaw)?.[1] ?? '').trim().slice(0, 300)
  ctx.engineName = engineName
  ctx.engineLaw = engineLawSpine || contract.engineLaw
  /* утилизация: одноразовый движок уходит в архив вместе с батчем */
  try {
    fs.appendFileSync(
      path.join(process.cwd(), 'thread4', 'engines-archive.jsonl'),
      JSON.stringify({ slug, theme, engine: engineName, law: engineLawSpine, at: new Date().toISOString() }) + '\n',
      'utf-8'
    )
  } catch {
    /* архив не критичен для записи — движок живёт в шапке батча */
  }
  ctx.themeKeywords = (/^THEME-KEYWORDS:\s*(.+)$/m.exec(spineRaw)?.[1] ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8)
  /* TITLE IS THEME (вердикт автора 2026-09-27: «меняется название темы» —
     больше никогда): название батча = тема автора, без переименований */
  const title = theme
  const thesisP = (/^THESIS:\s*\n?([\s\S]*?)(?=\nACT I:|$)/m.exec(spineRaw)?.[1] ?? '').trim()
  ctx.batchThesis = thesisP || `The batch's law: ${ctx.engineLaw}`
  ctx.acts = [
    (/^ACT I:\s*(.+)$/m.exec(spineRaw)?.[1] ?? 'The Law Arrives').trim(),
    (/^ACT II:\s*(.+)$/m.exec(spineRaw)?.[1] ?? 'The Law Worn In').trim(),
    (/^ACT III:\s*(.+)$/m.exec(spineRaw)?.[1] ?? 'What the Law Keeps').trim(),
  ]
  say(`  · «${title}» · акты: ${ctx.acts.join(' / ')}`)

  /* ---- calls 1..N: slot chunks ---- */
  const outputs = new Map<number, ScribeSlotOutput>()
  const chunks: SlotPlan[][] = []
  for (let i = 0; i < contract.slots.length; i += chunkSize) {
    chunks.push(contract.slots.slice(i, i + chunkSize))
  }
    const batchLawBlock = `BATCH ${slug} «${title}» — theme: ${theme}${contract.authorWishes ? `\nAUTHOR'S WISHES (приказ автора — закон энергии этого батча): ${contract.authorWishes}` : ''}\nENGINE (одноразовый, ваш): ${ctx.engineName} — ${ctx.engineLaw}\nBATCH THESIS (yours, keep it): ${ctx.batchThesis}\nTHEME-KEYWORDS (weave ≥1 into EVERY slot's tags or prose — the theme must be VISIBLE in the frame, not in the header): ${ctx.themeKeywords.join(', ') || '—'}\nGENRE PLAN: ${contract.slots.filter((s) => s.kind === 'NICHE').length} NICHE (R) · ${contract.slots.filter((s) => s.kind === 'VOLT' || s.kind === 'EXQUISITE').length} VOLT/EXQUISITE (R+ incl. ${contract.slots.filter((s) => s.kind === 'OC' && s.rating === 'R+').length} OC) · ${contract.slots.filter((s) => s.rating === 'X').length} X${contract.slots.some((s) => s.kind === 'EXP') ? ` · ${contract.slots.filter((s) => s.kind === 'EXP').length} EXP (без темы)` : ''}`

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci]
    const positions = chunk.map((s) => `P${String(s.position).padStart(2, '0')}`).join(', ')
    say(`Шаг 2/4: пишу слоты ${positions} (чанк ${ci + 1}/${chunks.length})…`)
    const user = `${batchLawBlock}\n\nSLOTS (write ALL of them, in order):\n\n${chunk.map((s) => slotFrame(s, ctx)).join('\n\n')}`
    const raw = await chat(zai, systemPrompt(), user, log)
    const parsed = parseSlots(raw)
    let missing = chunk.filter((s) => !parsed.has(s.position) || !(parsed.get(s.position)?.pos ?? '').trim())
    if (missing.length > 0) {
      say(`  · чанк ${ci + 1}: пропущены ${missing.map((s) => s.position).join(', ')} — повтор`)
      const retry = await chat(
        zai,
        systemPrompt(),
        `${user}\n\nREMINDER: output EVERY slot above in the exact format. Do not skip any.`,
        log
      )
      for (const [n, o] of parseSlots(retry)) parsed.set(n, o)
      missing = chunk.filter((s) => !parsed.has(s.position) || !(parsed.get(s.position)?.pos ?? '').trim())
    }
    for (const s of chunk) {
      const o = parsed.get(s.position)
      if (o && o.pos.trim()) outputs.set(s.position, o)
    }
    if (missing.length > 0) {
      say(`  · чанк ${ci + 1}: НЕ написаны ${missing.map((s) => s.position).join(', ')} — уйдут в ремонт`)
    }
  }

  /* ---- assembly + gates + repair ---- */
  let markdown = assembleBatch(ctx, outputs, title)
  let result: GatesResult | null = null
  let rounds = 0
  const batchPath = path.join(BATCHES_DIR, `${slug}.md`)

  for (let round = 0; round <= maxRepairRounds; round++) {
    writeText(batchPath, markdown)
    say(`Шаг 3/4: гейты (сухой прогон, круг ${round + 1})…`)
    result = runGates(slug, true)
    if (!result) throw new Error('гейты не нашли файл батча')
    const hardFails = result.receipts.filter((r) => r.level === 'hard' && r.verdict === 'FAIL')
    const missingSlots = contract.slots.filter((s) => !outputs.has(s.position))
    if (hardFails.length === 0 && missingSlots.length === 0) {
      say(`  · круг ${round + 1}: hard PASS${round === 0 ? ' — чистый первый черновик' : ` — после ${round} круг(ов) ремонта`}`)
      break
    }
    if (round === maxRepairRounds) {
      say(`  · круг ${round + 1}: hard FAIL остался — сдача невозможна, черновик записан`)
      break
    }
    rounds = round + 1
    say(`  · круг ${round + 1}: hard FAIL — ремонт:`)
    for (const r of hardFails) {
      for (const fnd of r.findings.slice(0, 6)) say(`    [${r.gate}] ${fnd}`)
    }
    // failed positions from findings + missing slots
    const failed = new Set<number>(missingSlots.map((s) => s.position))
    for (const r of hardFails) {
      for (const fnd of r.findings) {
        /* только ВЕДУЩИЙ P-номер находки: квитанции цитируют чужие слоты
         * («P08/P20 — R+ только на тёмном») — они не SUBJECT ремонта */
        const m = /^P(\d{1,2})\b/.exec(fnd)
        if (m) {
          const p = parseInt(m[1], 10)
          if (p >= 1 && p <= contract.slots.length) failed.add(p)
        }
      }
    }
    if (failed.size === 0) break // nothing slot-specific to repair
    const repairSlots = contract.slots.filter((s) => failed.has(s.position))
    say(`  · ремонт слотов: ${[...failed].sort((a, b) => a - b).join(', ')}`)
    const repairUser = `${batchLawBlock}\n\nREWRITE THESE SLOTS — they failed the machine gates. Keep what worked, fix what is flagged. Same exact format.\n\n${repairSlots.map((s) => slotFrame(s, ctx)).join('\n\n')}\n\nGATE FAILURES TO FIX:\n${hardFails.flatMap((r) => r.findings.map((f) => `- [${r.gate}] ${f}`)).slice(0, 24).join('\n')}`
    const raw = await chat(zai, systemPrompt(), repairUser, log)
    for (const [n, o] of parseSlots(raw)) {
      if (o.pos.trim()) outputs.set(n, o)
    }
    markdown = assembleBatch(ctx, outputs, title)
  }

  if (!result) throw new Error('гейты не прогнались')

  /* ---- полирующий круг (качество до сдачи): WARN-гейты, которые чинятся
   *  переписыванием слота — noun-lock (заявка на ИМЕНОВАННОЙ вещи),
   *  claim-visibility (зона открыта камере, состояние ткани в начале рана),
   *  prop-geometry (якоря контакта), simcheck (близнецы внутри батча).
   *  Один круг; если полировка роняет hard — ОТКАТ: черновик важнее. ---- */
  let polished = 0
  if (options.polish !== false && result.hardPass) {
    /* полировка только поверх hard PASS: черновик с hard FAIL сначала
     * ремонтируется (или сдаётся автору с квитанциями), полировка
     * поверх поломанного — трата круга LLM впустую */
    const POLISH_GATES = new Set(['noun-lock', 'claim-visibility', 'prop-geometry', 'simcheck'])
    const warnFindings = result.receipts.filter(
      (r) => r.level === 'warn' && r.verdict === 'WARN' && POLISH_GATES.has(r.gate)
    )
    const failedPolish = new Set<number>()
    for (const r of warnFindings) {
      for (const fnd of r.findings) {
        const m = /P(\d{1,2})/.exec(fnd)
        if (m) {
          const p = parseInt(m[1], 10)
          if (p >= 1 && p <= contract.slots.length) failedPolish.add(p)
        }
      }
    }
    if (failedPolish.size > 0) {
      say(`Шаг 3.5/4: полировка качества — WARN-гейты: слоты ${[...failedPolish].sort((a, b) => a - b).join(', ')}`)
      const backup = markdown
      const backupOutputs = new Map(outputs)
      const repairSlots = contract.slots.filter((s) => failedPolish.has(s.position))
      const repairUser = `${batchLawBlock}\n\nREWRITE THESE SLOTS — they carry WARN-level QUALITY findings (the batch already passed all HARD gates — do NOT introduce any new fabric/claim/underlayer that could break them). Keep the same anchor, pose, palette, canon and stack. Keep what worked, fix what is flagged. Same exact format.\n\n${repairSlots.map((s) => slotFrame(s, ctx)).join('\n\n')}\n\nQUALITY FINDINGS TO FIX:\n${warnFindings.flatMap((r) => r.findings.map((f) => `- [${r.gate}] ${f}`)).slice(0, 24).join('\n')}`
      const raw = await chat(zai, systemPrompt(), repairUser, log)
      for (const [n, o] of parseSlots(raw)) {
        if (o.pos.trim()) outputs.set(n, o)
      }
      markdown = assembleBatch(ctx, outputs, title)
      writeText(batchPath, markdown)
      const after = runGates(slug, true)
      if (after && after.hardPass) {
        polished = failedPolish.size
        result = after
        say(`  · полировка: hard PASS удержан, WARN-слоты переписаны (${polished})`)
      } else {
        /* откат: полировка роняет hard — черновик до полировки сильнее */
        outputs.clear()
        for (const [k, v] of backupOutputs) outputs.set(k, v)
        markdown = backup
        writeText(batchPath, markdown)
        const restored = runGates(slug, true)
        if (restored) result = restored
        say('  · полировка сломала hard — ОТКАТ к черновику до полировки (WARN-квитанции остаются автору)')
      }
    }
  }

  /* ---- record + event ---- */
  say(`Шаг 4/4: черновик записан → batches/${slug}.md`)
  appendEvent(
    'scribe.drafted',
    `${slug} «${title}»: авто-писец написал черновик — ${outputs.size}/${contract.slots.length} слотов, ремонт ${rounds} круг(а), полировка ${polished} слот(ов), гейты dry ${result.hardPass ? 'PASS' : 'FAIL'} (sha ${result.sha10})`,
    {
      slug,
      title,
      slots: outputs.size,
      rounds,
      polished,
      hardPass: result.hardPass,
      sha10: result.sha10,
      engine: contract.engine,
    }
  )

  return {
    slug,
    title,
    rounds,
    hardPass: result.hardPass,
    firstRunClean: result.firstRunClean,
    sha10: result.sha10,
    receipts: result.receipts,
    failedSlots: contract.slots.filter((s) => !outputs.has(s.position)).map((s) => s.position),
    log,
    markdown,
  }
}
