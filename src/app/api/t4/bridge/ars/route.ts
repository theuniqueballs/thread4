/**
 * THREAD 4 — BRIDGE · ARS NOVEAU (эра ARS, приказ автора 2026-10-23).
 *
 * Этап «Раскрытие» единого конвейера: LLM думает тему и строит
 * 21 ОТДЕЛЬНУЮ историю мейна (одна история = один слот = один способ
 * раскрытия темы) + 3 истории ОС + EXP-идеи ВНЕ темы + спайн батча
 * (движок/закон/теза/акты/тема-слова — отдельная «Сборка» упразднена).
 *
 * COMPUTE-ONLY: ни файлов, ни летописи (пишет только Rust). Провайдер —
 * единый писца (T4_SCRIBE_PROVIDER). Три вызова LLM: (A) спайн+ОС+EXP,
 * (B) истории 1–11, (C) истории 12–21 — чанки как у писца, надёжность
 * ответа важнее одного гигантского completion.
 */
import { NextResponse } from 'next/server'

import { clientErrorMessage, requireCommander } from '@/lib/t4/apiguard'
import { resolveLlmProvider } from '@/lib/t4/llm-provider'
import { chat } from '@/lib/t4/scribe'
import { getNicheArchetypes, getNicheDoors, getPolicy } from '@/lib/t4/specs'

import { bridgeSlug } from '@/lib/t4/bridge-serve'

export const dynamic = 'force-dynamic'
export const maxDuration = 600

/* ------------------------------------------------------------------ */
/* Жанровые доктрины (дистилляция CONSTITUTION §5 + законов писца)     */
/* ------------------------------------------------------------------ */

const SYSTEM = `You are ARS NOVEAU — the theme expander of THREAD 4, an anime-prompt batch pipeline (danbooru tag renderer). Your ONE job: take the author's theme and THINK it into SEPARATE STORIES — one story per slot, each a DIFFERENT way the theme reveals itself in that frame. You are the creative instance BEFORE the scribe: the scribe only translates your story into tags ("just add water").

LAWS OF EVERY STORY (hard):
- DRAWABLE ENGLISH ONLY. Every noun must be a thing a renderer can DRAW. Abstract words (dreamlike, ethereal, mysterious, magical, surreal) are GENRE DEATH — a physical fact instead, always.
- The theme TITLE never appears in a story verbatim (law №26) — reveal its MEANING through scene/objects/light.
- No character names, no artist names, no watermarks, no candles/lamps/lanterns (eternal bans), nothing age-coded.
- poseIdea is a DIRECTION (e.g. "seated contrapposto, chin lifted") — the compiler assigns the final pose from the library.
- outfit is a CONCEPT (garment + why it serves the story); fabric tone/channel/state are assigned later by the Dresser machine — never lock a rating claim inside the outfit.
- character: hair color/shape, body build words (slender/athletic/curvy/full-figured), skin tone, species mechanics if any — NO age words, NO names.
- thesis: the frame's law in ONE sentence — each story's thesis must be DIFFERENT (the theme told 21 ways, not one way 21 times).

GENRE DOCTRINE (CONSTITUTION §5):
- NICHE (the wonder genre): the world does something impossible — one natural law reversed anchored to a small specific point; race is MECHANISM not costume; she WITNESSES the wrongness. Test: remove the girl — the world still happens.
- VOLT (the erotic genre): the charge lives ON THE BODY — camera as participant, body in motion, gaze a deliberate vector, exposure by signal (never narrated).
- EXQUISITE: the ultra of its genre — extremity with dignity, 1-4 per batch.
- OC story: her canon locks are law (hair/eyes/skin/body given by the machine) — your story gives her SITUATION: how the batch theme meets HER this time; echo the author's OC-theme as drawables.

EXP IDEAS live OUTSIDE the theme entirely: only success-tests — a niche concept, a new VOLT pose, a garment piece, a new kin (species mechanic), or a new OC to validate. Each carries ONE A/B variable. Theme words NEVER enter an EXP idea (verdict T4-34).

ULTIMATE DICE (optional per story): if the story demands a specific tag-run rhythm/structure (e.g. "claim first, world later" / "environment opens, she closes it"), say so in one short line — the machine assigns the dice signature.

OUTPUT: STRICT JSON ONLY. No markdown fences, no commentary.`

/* ------------------------------------------------------------------ */
/* Промпты чанков                                                      */
/* ------------------------------------------------------------------ */

function mixOf(): { mains: number; ocs: number; nicheMin: number; nicheMax: number; exqMin: number; exqMax: number } {
  const p = getPolicy() as unknown as Record<string, unknown>
  const ars = (p['ars'] ?? {}) as Record<string, unknown>
  const m = (ars['mix'] ?? {}) as Record<string, unknown>
  const n = (k: string, d: number): number => (typeof m[k] === 'number' ? (m[k] as number) : d)
  return {
    mains: n('mains', 21),
    ocs: n('ocs', 3),
    nicheMin: n('niche_min', 5),
    nicheMax: n('niche_max', 8),
    exqMin: n('exquisite_min', 1),
    exqMax: n('exquisite_max', 4),
  }
}

function archetypeHint(): string {
  const a = getNicheArchetypes()
  const names = (a?.archetypes ?? []).slice(0, 12).map((x) => x.name).join('; ')
  const d = getNicheDoors()
  const doors = (d?.doors ?? []).slice(0, 8).map((x) => x.name).join(', ')
  const ops = (d?.operators ?? []).map((x) => x.name).join(', ')
  return `NICHE archetype pool (for inspiration, do NOT copy titles): ${names}\nNICHE doors (the moment we catch): ${doors} · camera operators: ${ops}`
}

const storySchema = `{"genre":"NICHE|VOLT|EXQUISITE","title":"2-4 words","reveal":"WHAT the theme reveals in THIS frame (1 sentence)","scene":"what happens in frame","environment":"place, objects, world physics","vibe":"mood as drawables (palette of feeling, not abstractions)","lighting":"source, direction, character of light","poseIdea":"pose direction (not final)","outfit":"garment concept + why it serves the story","character":"hair/build/skin/species mechanics","witness":"optional: the object that holds the frame","dice":"optional: tag-run rhythm this story demands","thesis":"the frame's law, one sentence, unique in batch"}`

function chunkA(
  theme: string,
  wishes: string,
  ocThemes: { theme: string; rating: string }[],
  expCount: number,
): string {
  const ocBlock = ocThemes
    .map((o, i) => `OC-${i + 1} (rating ${o.rating}): author's theme for her — «${o.theme}»`)
    .join('\n')
  return `BATCH THEME: «${theme}»${wishes ? `\nAUTHOR'S WISHES (закон энергии батча): ${wishes}` : ''}

STEP 1 — invent the ONE-BATCH ENGINE (spine): a physical law SPECIFIC to this theme that bends fabric/light/physics/wardrobe in every frame.
STEP 2 — write ${ocThemes.length} OC stories (her situation this batch; canon locks come from the machine later — story gives the SITUATION and how the OC-theme draws).
STEP 3 — invent ${expCount} EXP ideas OUTSIDE the theme (kinds: niche-concept|pose|garment|kin|oc; one A/B variable each).

Return STRICT JSON exactly:
{"engineName":"2-4 words","engineLaw":"1-2 sentences: the physical law and how wardrobe obeys","thesis":"90-140 words: the batch's one law, how the THEME delivers across the frames and how three acts escalate it","acts":["ACT I name","ACT II name","ACT III name"],"themeKeywords":["5-8 tag-safe drawable words FROM the theme"],"ocs":[{"position":1,"genre":"OC","title":"...","reveal":"...","scene":"...","environment":"...","vibe":"...","lighting":"...","poseIdea":"...","outfit":"...","character":"her draw beyond canon locks","thesis":"..."}],"exp":[{"id":1,"kind":"pose","hypothesis":"what to test, drawable","variables":"the single A/B variable"}]}

${archetypeHint()}`
}

function chunkMains(
  theme: string,
  engine: { name: string; law: string },
  actName: string,
  from: number,
  to: number,
  genres: string[],
): string {
  return `BATCH THEME: «${theme}» · ENGINE: ${engine.name} — ${engine.law} · ACT: ${actName}

Write stories ${from}..${to} (${to - from + 1} stories), positions and genres EXACTLY as assigned:
${genres.map((g, i) => `position ${from + i}: ${g}`).join('\n')}

Each story = ${storySchema}

RULES: every field non-empty (witness/dice optional); theses all different; scenes must differ WORLD-level (not just props); at least 2 of the stories put the engine's law visibly to work; the theme reveals itself DIFFERENTLY in each.

Return STRICT JSON exactly: {"mains":[...]}`
}

/* ------------------------------------------------------------------ */
/* JSON-экстрактор (модель любит заборы/преамбулы)                     */
/* ------------------------------------------------------------------ */

function extractJson(raw: string): Record<string, unknown> | null {
  const text = raw.replace(/```(?:json)?/gi, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const asStories = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v.filter((x) => x != null && typeof x === 'object') as Record<string, unknown>[]) : []

/* ------------------------------------------------------------------ */
/* Роут                                                                */
/* ------------------------------------------------------------------ */

export async function POST(req: Request) {
  const guard = requireCommander(req)
  if (!guard.ok) return guard.response
  let body: {
    slug?: unknown
    theme?: unknown
    ocThemes?: unknown
    expCount?: unknown
    authorWishes?: unknown
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }

  const slug = bridgeSlug(body.slug)
  if (slug == null) {
    return NextResponse.json({ error: 'slug expected: T4-NN[-suffix]' }, { status: 400 })
  }
  const theme = asStr(body.theme)
  if (theme === '') {
    return NextResponse.json({ error: 'theme expected' }, { status: 400 })
  }
  const ocThemes: { theme: string; rating: string }[] = Array.isArray(body.ocThemes)
    ? (body.ocThemes as unknown[])
        .map((o) => {
          const rec = (o ?? {}) as Record<string, unknown>
          return { theme: asStr(rec['theme']), rating: asStr(rec['rating']) || 'R+' }
        })
        .filter((o) => o.theme !== '')
        .slice(0, 3)
    : []
  const expCount =
    typeof body.expCount === 'number' && Number.isInteger(body.expCount) && body.expCount >= 0
      ? Math.min(body.expCount, 9)
      : 0
  const wishes = asStr(body.authorWishes)

  const mix = mixOf()
  const provider = resolveLlmProvider()
  const log: string[] = []

  try {
    /* A: спайн + ОС + EXP */
    const aRaw = await chat(provider, SYSTEM, chunkA(theme, wishes, ocThemes, expCount), log)
    const a = extractJson(aRaw)
    if (a == null) {
      return NextResponse.json(
        { error: `ARS: спайн-чанк не распарсился как JSON — сырой ответ (первые 300): ${aRaw.replace(/\s+/g, ' ').slice(0, 300)}` },
        { status: 502 },
      )
    }
    const engineName = asStr(a['engineName'])
    const engineLaw = asStr(a['engineLaw'])
    if (engineName === '' || engineLaw === '') {
      return NextResponse.json({ error: 'ARS: спайн без engineName/engineLaw' }, { status: 502 })
    }
    const acts = Array.isArray(a['acts'])
      ? (a['acts'] as unknown[]).map(asStr).filter(Boolean).slice(0, 3)
      : []
    while (acts.length < 3) acts.push(['The Law Arrives', 'The Law Worn In', 'What the Law Keeps'][acts.length])
    const themeKeywords = Array.isArray(a['themeKeywords'])
      ? (a['themeKeywords'] as unknown[]).map(asStr).filter(Boolean).slice(0, 8)
      : []
    const ocs = asStories(a['ocs']).slice(0, mix.ocs)
    const exp = asStories(a['exp'])
      .slice(0, Math.max(expCount, 9))
      .map((e, i) => ({
        id: typeof e['id'] === 'number' ? (e['id'] as number) : i + 1,
        kind: asStr(e['kind']) || 'pose',
        hypothesis: asStr(e['hypothesis']),
        variables: asStr(e['variables']),
      }))
      .filter((e) => e.hypothesis !== '')
      .slice(0, expCount)

    /* жанровый план историй: NICHE окно + EXQUISITE окно, остальное VOLT,
     * раскидано по батчу (не кучей), БЕЗ коллизий: каждый spread занимает
     * только VOLT-слоты (иначе EXQUISITE перезаписывал NICHE — ниш выходило
     * меньше окна, гейт плана на движке резал честно) */
    const genres: string[] = []
    const niche = Math.min(Math.max(mix.nicheMin, 6), mix.nicheMax)
    const exq = Math.min(Math.max(mix.exqMin, 2), mix.exqMax)
    for (let i = 0; i < mix.mains; i++) genres.push('VOLT')
    const spread = (count: number, tag: string): void => {
      const step = mix.mains / count
      let placed = 0
      for (let k = 0; k < count; k++) {
        const center = Math.floor(k * step + step / 2)
        let idx = Math.min(mix.mains - 1, center)
        let guard = 0
        while (idx < mix.mains && genres[idx] !== 'VOLT' && guard < mix.mains) {
          idx += 1
          guard += 1
        }
        if (idx >= mix.mains) idx = genres.indexOf('VOLT')
        if (idx >= 0) {
          genres[idx] = tag
          placed += 1
        }
      }
      if (placed < count) {
        // добор с хвоста (теоретически недостижимо при окнах policy)
        for (let i = genres.length - 1; i >= 0 && placed < count; i--) {
          if (genres[i] === 'VOLT') {
            genres[i] = tag
            placed += 1
          }
        }
      }
    }
    spread(niche, 'NICHE')
    spread(exq, 'EXQUISITE')

    /* B/C: истории мейнов двумя чанками, граница по акту II/III */
    const half = Math.floor(mix.mains / 2) // 21 → 10/11
    const acts3 = [acts[0], acts[1], acts[2]]
    const bRaw = await chat(
      provider,
      SYSTEM,
      chunkMains(theme, { name: engineName, law: engineLaw }, `${acts3[0]} → ${acts3[1]}`, 1, half, genres.slice(0, half)),
      log,
    )
    const cRaw = await chat(
      provider,
      SYSTEM,
      chunkMains(theme, { name: engineName, law: engineLaw }, acts3[2], half + 1, mix.mains, genres.slice(half)),
      log,
    )
    const mains = [...asStories((extractJson(bRaw) ?? {})['mains']), ...asStories((extractJson(cRaw) ?? {})['mains'])]
      .slice(0, mix.mains)
      .map((m, i) => ({ ...m, position: i + 1, genre: genres[i] }))

    if (mains.length < mix.mains) {
      return NextResponse.json(
        { error: `ARS: историй ${mains.length} < ${mix.mains} — чанки недописали, повтори этап` },
        { status: 502 },
      )
    }
    if (ocs.length < mix.ocs) {
      return NextResponse.json(
        { error: `ARS: историй ОС ${ocs.length} < ${mix.ocs} — повтори этап` },
        { status: 502 },
      )
    }

    const build = {
      module: 'ars-nouveau',
      slug,
      theme,
      engineName,
      engineLaw,
      thesis: asStr(a['thesis']),
      acts: acts3,
      themeKeywords,
      mains,
      ocs: ocs.map((o, i) => ({ ...o, position: i + 1, genre: 'OC' })),
      exp,
    }
    return NextResponse.json({ ok: true, data: { build } })
  } catch (e) {
    return NextResponse.json(
      { error: clientErrorMessage(e) || 'ars failed' },
      { status: 500 },
    )
  }
}
