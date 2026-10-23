'use client'

/**
 * THREAD 4 — ЕДИНЫЙ КОНВЕЙЕР (cutover-эра, приказ «МОЩНОСТЬ», 2026-10-20).
 *
 * Один экран — весь жизненный цикл батча, строго сверху вниз, БЕЗ вкладок:
 *
 *   1 · Приказ + ARS NOVEAU       — тема/OC/EXP → 21 история + 3 ОС +
 *                                   EXP-идеи (LLM-мост), спайн
 *   2 · Компиляция                — реестр канона + бриф писца
 *   3 · Сборщик                   — истории × механика → брикеты писца
 *   4 · Писец                     — черновик по брикетам + батарея + ремонт
 *   5 · Печь (FURNACE)            — LLM-оценщик: честный репорт
 *   6 · Сдача                     — финальные проверки + фиксация в цепи
 *
 * Эра ARS NOVEAU (приказ 2026-10-23, Доу): читальни-выдвижки (ars-reader)
 * несут экспозиции и репорты; FAIL Печи требует явного furnaceOverride.
 *
 * Правила интерфейса (приказ):
 *   · шаг N+1 не активен, пока не завершён шаг N (кроме ручного перезапуска);
 *   · ОДНА главная кнопка — «Запустить конвейер» (авто 1→5) — всегда на
 *     одном и том же месте (нижняя панель);
 *   · ручной override — маленькая «▶» на любом этапе: этап перезапускается,
 *     нижележащие помечаются устаревшими;
 *   · НИКАКОЙ бухгалтерии на карточках: ни номеров гейтов, ни sha, ни
 *     «24/30» — весь тех-мусор в «Подробностях» и в консоли;
 *   · консоль — выдвижная штора снизу, логи текущего шага + «Copy for AI».
 *
 * Бэкенд: ЕДИНЫЙ Rust-движок :3201 (прод RW, один писатель). UI — тонкая
 * обёртка: /api/t4/twin/* (allowlist-прокси) + SSE /api/t4/twin/live.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ClipboardCopy,
  Key,
  Loader2,
  Play,
  RotateCcw,
  SkipForward,
  Square,
  Terminal,
  XCircle,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import {
  ApiError,
  asArray,
  asNum,
  asRecord,
  asStr,
  commanderHeaders,
  getCommanderKey,
  postJson,
  probeCommanderKey,
  setCommanderKey,
  withGatewayPort,
} from '@/components/t4/api'
import { LiveConsole } from '@/components/t4/console/live-console'
import { errorFrames, recentFrames, ringStats } from '@/components/t4/console/frame-ring'
import { writeClipboard } from '@/components/t4/console/shared'
import {
  BriquetteList,
  FurnacePanel,
  ReaderDrawer,
  StoriesGrid,
  type ReaderState,
} from '@/components/t4/console/ars-reader'

/* ------------------------------------------------------------------ */
/* Канва этапов                                                        */
/* ------------------------------------------------------------------ */

const STAGE_KEYS = ['ars', 'compile', 'collector', 'scribe', 'furnace', 'deliver'] as const
type StageKey = (typeof STAGE_KEYS)[number]
type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'stale'

const STAGE_TITLE: Record<StageKey, string> = {
  ars: 'ARS NOVEAU · Раскрытие',
  compile: 'Компиляция',
  collector: 'Сборщик',
  scribe: 'Писец',
  furnace: 'Печь · FURNACE',
  deliver: 'Сдача',
}

const STAGE_HINT: Record<StageKey, string> = {
  ars: 'Тема думается в 21 историю + 3 истории ОС + EXP-идеи вне темы',
  compile: 'Канон собирает план слотов и бриф писца',
  collector: 'Истории × механика складываются в брикеты писца',
  scribe: 'Писец переводит брикеты в промпты, батарея гоняет по кругу',
  furnace: 'Оценщик смотрит, что налепили: честный репорт перед сдачей',
  deliver: 'Финальные проверки и фиксация в хеш-цепи',
}

interface StageView {
  key: StageKey
  status: StageStatus
  summary: string | null
  detail: unknown
}

interface PipelineSnapshot {
  running: boolean
  mode: 'auto' | 'manual' | null
  slug: string | null
  theme: string | null
  exp: number
  finished: string | null
  ok: boolean | null
  stages: StageView[]
}

interface ReceiptView {
  gate: string
  level: string
  verdict: string
  findings: string[]
}

const SPRING = { type: 'spring' as const, stiffness: 300, damping: 30 }

/* ------------------------------------------------------------------ */
/* ARS NOVEAU: правки автора (strict JSON артефакта раскрытия)          */
/* ------------------------------------------------------------------ */

/** Парс правок ARS: валидный JSON-объект или ничего (конвейер сам думает). */
function parseArsEdit(raw: string | null): Record<string, unknown> | null {
  if (raw == null || raw.trim() === '') return null
  try {
    const v = JSON.parse(raw) as unknown
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Черновик приказа (localStorage, миграция со старого воркфлоу)        */
/* ------------------------------------------------------------------ */

const DRAFT_KEY = 't4-pipeline-draft'
const DRAFT_VERSION = 3
const LEGACY_KEY = 't4-workflow-draft'
const CONSOLE_KEY = 't4-console-open'

interface OcInput {
  theme: string
  rating: 'PG-13' | 'R' | 'R+' | 'X'
}

const OC_RATINGS: OcInput['rating'][] = ['PG-13', 'R', 'R+', 'X']
const ENGINES = ['per-theme', 'per-theme raw-plus'] as const

interface Draft {
  theme: string
  slug: string
  slugTouched: boolean
  exp: number
  ab: number
  engine: string
  speciesList: string
  notes: string
  oc: OcInput[]
  /** Правленый артефакт ARS (JSON-текст) — strict на стороне движка. */
  arsEdit: string | null
  /** Явное решение автора сдать вопреки FAIL Печи (§1). */
  furnaceOverride: boolean
}

const EMPTY_OC: OcInput[] = [
  { theme: '', rating: 'R+' },
  { theme: '', rating: 'R+' },
  { theme: '', rating: 'R+' },
]

/** SSR-безопасный пустой черновик (window недоступен на сервере). */
function readDraftSafe(): Draft {
  return {
    theme: '',
    slug: '',
    slugTouched: false,
    exp: 0,
    ab: 2,
    engine: 'per-theme',
    speciesList: '',
    notes: '',
    oc: EMPTY_OC.map((o) => ({ ...o })),
    arsEdit: null,
    furnaceOverride: false,
  }
}

/** Инициализатор читает localStorage ОДИН раз на вкладку (модуль-кэш):
 * StrictMode-двойной рендер не мигрирует черновик дважды, ref.current
 * при рендере не читается — ленивые useState-инициализаторы вместо ref. */
let INIT_CACHE: { draft: Draft; restored: boolean; migrated: boolean } | null = null
function initialDraft(): { draft: Draft; restored: boolean; migrated: boolean } {
  if (INIT_CACHE == null) {
    INIT_CACHE =
      typeof window === 'undefined'
        ? { draft: readDraftSafe(), restored: false, migrated: false }
        : (() => {
            try {
              return readDraft()
            } catch {
              return { draft: readDraftSafe(), restored: false, migrated: false }
            }
          })()
  }
  return INIT_CACHE
}

function draftEmpty(d: Draft): boolean {
  return (
    d.theme.trim() === '' &&
    d.oc.every((o) => o.theme.trim() === '') &&
    d.arsEdit == null &&
    !d.slugTouched
  )
}

function readDraft(): { draft: Draft; restored: boolean; migrated: boolean } {
  const fallback: Draft = {
    theme: '',
    slug: '',
    slugTouched: false,
    exp: 0,
    ab: 2,
    engine: 'per-theme',
    speciesList: '',
    notes: '',
    oc: EMPTY_OC.map((o) => ({ ...o })),
    arsEdit: null,
    furnaceOverride: false,
  }
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    if (raw != null) {
      const j = asRecord(JSON.parse(raw))
      const oc: OcInput[] = []
      for (const r of asArray(j.oc).slice(0, 3)) {
        const rec = asRecord(r)
        const rating = asStr(rec.rating)
        oc.push({
          theme: asStr(rec.theme).slice(0, 120),
          rating: ((OC_RATINGS as string[]).includes(rating) ? rating : 'R+') as OcInput['rating'],
        })
      }
      while (oc.length < 3) oc.push({ theme: '', rating: 'R+' })
      const draft: Draft = {
        theme: asStr(j.theme).slice(0, 200),
        slug: asStr(j.slug).toUpperCase().slice(0, 8),
        slugTouched: j.slugTouched === true,
        exp: Math.max(0, Math.min(9, Math.round(asNum(j.exp) ?? 0))),
        ab: Math.max(2, Math.min(3, Math.round(asNum(j.ab) ?? 2))),
        engine: (ENGINES as readonly string[]).includes(asStr(j.engine)) ? asStr(j.engine) : 'per-theme',
        speciesList: asStr(j.speciesList).slice(0, 200),
        notes: asStr(j.notes).slice(0, 2000),
        oc,
        arsEdit: asStr(j.arsEdit).slice(0, 120_000) || null,
        furnaceOverride: j.furnaceOverride === true,
      }
      const restored =
        draft.theme.trim() !== '' || oc.some((o) => o.theme.trim() !== '') || draft.arsEdit != null
      return { draft, restored, migrated: false }
    }
    /* миграция со старого воркфлоу (Layout E): тема/OC/якоря/заметки */
    const legacyRaw = window.localStorage.getItem(LEGACY_KEY)
    if (legacyRaw != null) {
      const j = asRecord(JSON.parse(legacyRaw))
      const draft: Draft = { ...fallback }
      draft.theme = asStr(j.theme).slice(0, 200)
      const oc: OcInput[] = []
      for (const r of asArray(j.oc).slice(0, 3)) {
        const rec = asRecord(r)
        const rating = asStr(rec.rating)
        oc.push({
          theme: asStr(rec.theme).slice(0, 120),
          rating: ((OC_RATINGS as string[]).includes(rating) ? rating : 'R+') as OcInput['rating'],
        })
      }
      while (oc.length < 3) oc.push({ theme: '', rating: 'R+' })
      draft.oc = oc
      draft.exp = Math.max(0, Math.min(9, Math.round(asNum(j.exp) ?? 0)))
      draft.engine = (ENGINES as readonly string[]).includes(asStr(j.engine)) ? asStr(j.engine) : 'per-theme'
      draft.speciesList = asStr(j.speciesList).slice(0, 200)
      draft.notes = asStr(j.notes).slice(0, 2000)
      window.localStorage.removeItem(LEGACY_KEY)
      const restored = draft.theme.trim() !== ''
      return { draft, restored, migrated: true }
    }
    return { draft: fallback, restored: false, migrated: false }
  } catch {
    return { draft: fallback, restored: false, migrated: false }
  }
}



/** Репорт Печи → markdown для читальни (та же правда, что в артефакте). */
function furnaceReportMarkdown(report: unknown): string {
  const r = asRecord(report)
  const L: string[] = []
  L.push(`## Вердикт: ${asStr(r.verdict) || '—'}`)
  L.push('')
  L.push(asStr(r.summary) || '')
  for (const [k, t] of [
    ['themeRead', '### Тема: 21 история в кадрах'],
    ['scribeWork', '### Писец: регламент'],
    ['gatesEcho', '### Гейты: что поймали / что пропустили'],
  ] as const) {
    const v = asStr(r[k])
    if (v !== '') {
      L.push('')
      L.push(t)
      L.push('')
      L.push(v)
    }
  }
  const findings = asArray(r.findings).map(asRecord)
  if (findings.length > 0) {
    L.push('')
    L.push('### Находки')
    for (const f of findings) {
      L.push(
        `- **[${asStr(f.area)}${asStr(f.slot) !== '' ? ` ${asStr(f.slot)}` : ''}] (${asStr(f.severity) || 'note'})** — ${asStr(f.note)}`
      )
    }
  }
  const strengths = asArray(r.strengths).map(asStr).filter((x) => x !== '')
  if (strengths.length > 0) {
    L.push('')
    L.push('### Что получилось')
    for (const x of strengths) L.push(`- ${x}`)
  }
  L.push('')
  L.push('_Печь — оценка LLM до глаза автора: финальный вердикт всегда за автором (§1)._')
  return L.join('\n')
}

function parseReceipts(v: unknown): ReceiptView[] {
  return asArray(v)
    .map((r) => {
      const rec = asRecord(r)
      return {
        gate: asStr(rec.gate),
        level: asStr(rec.level),
        verdict: asStr(rec.verdict),
        findings: asArray(rec.findings).map(asStr).filter((s) => s !== ''),
      }
    })
    .filter((r) => r.gate !== '')
}

/* ------------------------------------------------------------------ */
/* Движок-клиент (тонкая обёртка над /api/t4/twin/*)                     */
/* ------------------------------------------------------------------ */

async function twinGet<T>(path: string): Promise<T> {
  const res = await fetch(withGatewayPort(`/api/t4/twin/${path}`), {
    cache: 'no-store',
    headers: commanderHeaders(),
  })
  const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; error?: { message?: unknown } } | null
  if (!res.ok || json == null || json.ok === false) {
    throw new ApiError(
      (json?.error != null ? asStr(asRecord(json.error).message) : '') || `движок: HTTP ${res.status}`,
      res.status
    )
  }
  return json.data as T
}

/* ------------------------------------------------------------------ */
/* Мелкие блоки                                                        */
/* ------------------------------------------------------------------ */

function statusIcon(status: StageStatus, running: boolean) {
  const cls = 'size-4 shrink-0'
  if (running) return <Loader2 className={cn(cls, 'animate-spin text-amber-400')} />
  switch (status) {
    case 'done':
      return <CheckCircle2 className={cn(cls, 'text-emerald-400')} />
    case 'failed':
      return <XCircle className={cn(cls, 'text-rose-500')} />
    case 'skipped':
      return <SkipForward className={cn(cls, 'text-zinc-500')} />
    case 'stale':
      return <RotateCcw className={cn(cls, 'text-zinc-600')} />
    case 'running':
      return <Loader2 className={cn(cls, 'animate-spin text-amber-400')} />
    default:
      return <span className={cn(cls, 'rounded-full border-2 border-zinc-700')} />
  }
}

function stageTone(status: StageStatus): string {
  switch (status) {
    case 'running':
      return 'border-amber-500/40 bg-amber-500/[0.04]'
    case 'done':
      return 'border-emerald-500/30'
    case 'failed':
      return 'border-rose-500/40 bg-rose-500/[0.04]'
    case 'skipped':
      return 'border-zinc-800'
    default:
      return 'border-zinc-800/70'
  }
}

function verdictChip(verdict: string): string {
  switch (verdict) {
    case 'PASS':
      return 'border-emerald-500/40 text-emerald-300'
    case 'FAIL':
      return 'border-rose-500/50 text-rose-300'
    case 'WARN':
      return 'border-amber-500/40 text-amber-300'
    case 'OFF':
      return 'border-zinc-700 text-zinc-400'
    case 'REPORT':
      return 'border-teal-500/40 text-teal-300'
    default:
      return 'border-zinc-700 text-zinc-300'
  }
}

function humanGate(gate: string): string {
  const map: Record<string, string> = {
    theme: 'тема',
    structure: 'структура плана',
    'exp-purity': 'чистота экспериментов',
    floors: 'вечные запреты',
    window: 'окно ротации',
    'ab-single-variable': 'A/B — одна переменная',
    budget: 'бюджет тегов',
    cadence: 'каденция',
    'prop-geometry': 'геометрия кадра',
    'noun-lock': 'именованные вещи',
    'character-collision': 'столкновение имён',
    'theme-presence': 'присутствие темы',
    'original-character-coverage': 'охват персонажей',
    'artist-leak': 'утечка художников',
    'garment-family': 'семейство одежды',
    'freq-report': 'частотный отчёт',
    usage: 'словарь',
    'one-hard-claim': 'одна главная заявка',
    'echo-window': 'эхо соседей',
    'rating-recipe': 'рецепт рейтинга',
    'rating-recipe-exploratory': 'рецепт рейтинга ⚗',
    canon: 'канон персонажей',
    diversity: 'разнообразие',
    dresser: 'дресс-код',
    'niche-legibility': 'читаемость ниши',
    'claim-visibility': 'видимость заявки',
    'technique-layers': 'слои техники',
    simcheck: 'близнецы кадров',
    'salience-chain': 'цепь салиенса',
    'contract-fidelity': 'верность контракту',
    'bumps-quota': 'квота акцентов',
    'technique-map': 'карта техник',
    'raw-plus': 'формат RAW+',
    'raw-plus-exploratory': 'формат RAW+ ⚗',
  }
  return map[gate] ?? gate
}

/* ------------------------------------------------------------------ */
/* Главный экран                                                       */
/* ------------------------------------------------------------------ */

export function PipelineScreen({ embed = false }: { embed?: boolean }) {
  const reduce = useReducedMotion() ?? false

  /* ---- черновик: ПУСТОЙ SSR-стейт (гидратация обязана совпасть с сервером);
   * localStorage восстанавливается mount-эффектом ниже — паттерн workflow.tsx ---- */
  const [theme, setTheme] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [exp, setExp] = useState(0)
  const [ab, setAb] = useState(2)
  const [engine, setEngine] = useState('per-theme')
  const [speciesList, setSpeciesList] = useState('')
  const [notes, setNotes] = useState('')
  const [oc, setOc] = useState<OcInput[]>(() => EMPTY_OC.map((o) => ({ ...o })))
  const [arsEdit, setArsEdit] = useState<string | null>(null)
  const [arsEditOpen, setArsEditOpen] = useState(false)
  const [furnaceOverride, setFurnaceOverride] = useState(false)
  const [reader, setReader] = useState<ReaderState | null>(null)
  const [briefOpen, setBriefOpen] = useState(true)

  /* ---- конвейер ---- */
  const [snapshot, setSnapshot] = useState<PipelineSnapshot | null>(null)
  const [snapError, setSnapError] = useState<string | null>(null)
  const [chainOk, setChainOk] = useState<boolean | null>(null)
  const [nextSlug, setNextSlug] = useState('')
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [keyOpen, setKeyOpen] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [keyState, setKeyState] = useState<'idle' | 'checking' | 'ok' | 'bad' | 'noserver'>('idle')
  const [ringTick, setRingTick] = useState(0)
  const notifiedRef = useRef<string>('')

  const ocFilled = oc.filter((o) => o.theme.trim().length > 0).length
  const briefReady = theme.trim().length >= 3 && ocFilled >= 1
  const isExp = exp > 0

  const draftBody = useMemo(
    () => ({
      theme: theme.trim(),
      exp,
      abPairs: ab,
      engine,
      species: {
        on: speciesList.trim() !== '',
        count: speciesList.split(/[\s,]+/).filter(Boolean).length,
        list: speciesList.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean),
      },
      ocThemes: oc
        .filter((o) => o.theme.trim() !== '')
        .map((o, i) => ({ theme: o.theme.trim(), rating: o.rating, position: i + 1 })),
      notes: notes.trim() !== '' ? notes.trim() : undefined,
      ...(slugTouched && /^T4-\d{2,3}$/.test(slug.trim().toUpperCase())
        ? { slug: slug.trim().toUpperCase() }
        : {}),
      ...(parseArsEdit(arsEdit) != null ? { arsBuild: parseArsEdit(arsEdit) } : {}),
      ...(furnaceOverride ? { furnaceOverride: true } : {}),
    }),
    [theme, exp, ab, engine, speciesList, oc, notes, slug, slugTouched, arsEdit, furnaceOverride]
  )

  /* ---- персист черновика (debounce 250мс) ---- */
  useEffect(() => {
    const draft: Draft = { theme, slug, slugTouched, exp, ab, engine, speciesList, notes, oc, arsEdit, furnaceOverride }
    const timer = window.setTimeout(() => {
      try {
        if (draftEmpty(draft)) window.localStorage.removeItem(DRAFT_KEY)
        else window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ v: DRAFT_VERSION, ...draft }))
      } catch {
        /* приватный режим — не переживёт перезагрузку */
      }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [theme, slug, slugTouched, exp, ab, engine, speciesList, notes, oc, arsEdit, furnaceOverride])

  /* ---- восстановление черновика: РОВНО один mount-эффект на вкладку.
   * Чтение localStorage при гидратации = hydration mismatch (инцидент
   * E2E 2026-10-20: кнопки «Запустить» были мертвы — клиент рендерился с
   * данными, сервер без). Здесь — внешняя система: читаем ПОСЛЕ маунта
   * (прецедент workflow.tsx / api.ts:333). ---- */
  useEffect(() => {
    const init = initialDraft()
    if (!init.restored && !init.migrated) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(init.draft.theme)
     
    setSlug(init.draft.slug)
     
    setSlugTouched(init.draft.slugTouched)
     
    setExp(init.draft.exp)
     
    setAb(init.draft.ab)
     
    setEngine(init.draft.engine)
     
    setSpeciesList(init.draft.speciesList)
     
    setNotes(init.draft.notes)
     
    setOc(init.draft.oc.map((o) => ({ ...o })))

    setArsEdit(init.draft.arsEdit)

    setFurnaceOverride(init.draft.furnaceOverride === true)
    const title = init.migrated ? 'Черновик перенесён из старого воркфлоу' : 'Черновик восстановлен'
    const timer = window.setTimeout(() => {
      toast({
        title,
        description: init.migrated ? 'тема, OC-темы и якоря на месте' : 'приказ ждёт продолжения',
      })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [])

  /* ---- чтение снимка конвейера ---- */
  const refresh = useCallback(async () => {
    try {
      const data = await twinGet<PipelineSnapshot>('pipeline')
      setSnapshot(data)
      setSnapError(null)
    } catch (e) {
      setSnapError(e instanceof Error ? e.message : 'движок молчит')
    }
  }, [])

  const running = snapshot?.running === true

  /* ---- опрос: часто при прогоне, редко в покое (первый кадр — таймером:
   * подписка на внешнюю систему, setState только в калбэках) ---- */
  useEffect(() => {
    const ms = running ? 1300 : 9000
    const kick = window.setTimeout(() => void refresh(), 0)
    const id = window.setInterval(() => void refresh(), ms)
    return () => {
      window.clearTimeout(kick)
      window.clearInterval(id)
    }
  }, [refresh, running])

  /* ---- цепь + подсказка номера ---- */
  useEffect(() => {
    let alive = true
    const pull = async () => {
      try {
        const [state, verify] = await Promise.all([
          twinGet<{ production?: { nextSlug?: string; chain?: { ok?: boolean } } }>('state'),
          twinGet<{ ok?: boolean }>('chain/verify'),
        ])
        if (!alive) return
        setNextSlug(asStr(state?.production?.nextSlug))
        setChainOk(verify?.ok === true)
      } catch {
        if (alive) setChainOk(null)
      }
    }
    void pull()
    const id = window.setInterval(() => void pull(), 20000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [snapshot?.finished])

  /* ---- шторка консоли: открывается в момент запуска (обработчик события,
   * не эффект — линтер прав, это реакция на действие оператора) ---- */
  const openConsole = useCallback(() => {
    setConsoleOpen(true)
    try {
      window.localStorage.setItem(CONSOLE_KEY, '1')
    } catch {}
  }, [])

  /* ---- восстановление шторки из localStorage — только на монтировании
   * (паттерн api.ts: hydration-безопасное чтение из effect) ---- */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConsoleOpen(window.localStorage.getItem(CONSOLE_KEY) === '1')
  }, [])

  /* ---- тосты переходов прогона ---- */
  useEffect(() => {
    if (snapshot == null) return
    const key = `${snapshot.finished ?? ''}|${snapshot.ok}`
    if (snapshot.finished != null && notifiedRef.current !== key) {
      notifiedRef.current = key
      if (snapshot.ok === true) {
        toast({
          title: 'Батч сдан',
          description: snapshot.finished ?? '',
        })
      } else if (snapshot.running === false) {
        toast({
          title: 'Конвейер остановлен',
          description: snapshot.finished ?? 'смотри карточку этапа и консоль',
          variant: 'destructive',
        })
      }
    }
  }, [snapshot])

  /* ---- кольцо кадров: тикер для бейджа ошибок ---- */
  useEffect(() => {
    const id = window.setInterval(() => setRingTick((t) => t + 1), 2500)
    return () => window.clearInterval(id)
  }, [])
  const ring = ringStats()

  /* ---- действия ---- */

  const startAuto = useCallback(async () => {
    if (!briefReady) {
      toast({
        title: 'Приказ не заполнен',
        description: 'нужны тема и хотя бы одна OC-тема',
        variant: 'destructive',
      })
      return
    }
    try {
      await postJson('/api/t4/twin/pipeline/auto', draftBody)
      toast({ title: 'Конвейер запущен', description: 'машина ведёт 1 → 6, смотри консоль' })
      openConsole()
      void refresh()
    } catch (e) {
      toast({
        title: 'Авто-запуск отклонён',
        description: e instanceof Error ? e.message : 'движок молчит',
        variant: 'destructive',
      })
    }
  }, [briefReady, draftBody, refresh, openConsole])

  const runStage = useCallback(
    async (stage: StageKey) => {
      if (!briefReady) {
        toast({ title: 'Приказ не заполнен', description: 'тема + OC-темы', variant: 'destructive' })
        return
      }
      try {
        await postJson(`/api/t4/twin/pipeline/stage/${stage}`, draftBody)
        toast({ title: `Этап «${STAGE_TITLE[stage]}» — старт`, description: 'ручной прогон, нижележащие устареют' })
        openConsole()
        void refresh()
      } catch (e) {
        toast({
          title: 'Этап отклонён',
          description: e instanceof Error ? e.message : 'движок молчит',
          variant: 'destructive',
        })
      }
    },
    [briefReady, draftBody, refresh, openConsole]
  )

  const stopRun = useCallback(async () => {
    try {
      await postJson('/api/t4/twin/pipeline/abort', {})
      toast({ title: 'Стоп принят', description: 'конвейер прервётся на границе шага' })
    } catch (e) {
      toast({ title: 'Стоп не прошёл', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    }
  }, [])

  const resetAll = useCallback(() => {
    setTheme('')
    setSlug('')
    setSlugTouched(false)
    setExp(0)
    setAb(2)
    setEngine('per-theme')
    setSpeciesList('')
    setNotes('')
    setOc(EMPTY_OC.map((o) => ({ ...o })))
    setArsEdit(null)
    setFurnaceOverride(false)
    setReader(null)
    setBriefOpen(true)
    setSnapshot(null)
    notifiedRef.current = ''
    try {
      window.localStorage.removeItem(DRAFT_KEY)
    } catch {}
    toast({ title: 'Новый батч', description: 'впиши тему — конвейер готов' })
  }, [])

  /* ---- Copy for AI (провал этапа) ---- */
  const copyStageForAi = useCallback(
    (stage: StageView) => {
      const payload = {
        tool: 't4-pipeline',
        at: new Date().toISOString(),
        stage: stage.key,
        stageTitle: STAGE_TITLE[stage.key],
        slug: snapshot?.slug ?? slug ?? nextSlug,
        mode: snapshot?.mode ?? null,
        error: stage.summary,
        stageDetail: stage.detail,
        errors: errorFrames().map((f) => ({ seq: f.seq, at: f.at, block: f.block, text: f.text })),
        recent: recentFrames(24).map((f) => ({ seq: f.seq, block: f.block, level: f.level, text: f.text })),
        note: 'THREAD 4 unified pipeline dump — errors first, stage detail included',
      }
      void writeClipboard(JSON.stringify(payload, null, 2)).then((ok) =>
        ok
          ? toast({ title: 'Copy for AI', description: 'структурированный лог скопирован' })
          : toast({ title: 'Копирование не удалось', variant: 'destructive' })
      )
    },
    [snapshot, slug, nextSlug]
  )

  /* ---- ключ командира ---- */
  const probeKey = useCallback(async () => {
    setKeyState('checking')
    try {
      const probe = await probeCommanderKey()
      if (!probe.serverKey) setKeyState('noserver')
      else if (probe.keyOk) setKeyState('ok')
      else setKeyState('bad')
    } catch {
      setKeyState('bad')
    }
  }, [])
  const saveKey = useCallback(() => {
    setCommanderKey(keyDraft)
    setKeyDraft('')
    setKeyOpen(false)
    toast({ title: 'Ключ сохранён', description: 'живёт в памяти вкладки' })
    void probeKey()
  }, [keyDraft, probeKey])

  /* ---- вычисляемое ---- */
  const stages: StageView[] = useMemo(() => {
    const map = new Map<StageKey, StageView>()
    for (const s of asArray(snapshot?.stages)) {
      const rec = asRecord(s)
      const key = asStr(rec.key) as StageKey
      if ((STAGE_KEYS as readonly string[]).includes(key)) {
        map.set(key, {
          key,
          status: asStr(rec.status) as StageStatus,
          summary: asStr(rec.summary) || null,
          detail: rec.detail,
        })
      }
    }
    return STAGE_KEYS.map((key) => map.get(key) ?? { key, status: 'pending' as StageStatus, summary: null, detail: null })
  }, [snapshot])

  const stageDone = useCallback(
    (i: number): boolean => stages[i].status === 'done' || stages[i].status === 'skipped',
    [stages]
  )

  /* Долг T4-45 (3): ▶ на этапе после провала предыдущего — путь «правь
   * руками и сдавай» обязан жить без заколоченных дверей. confirm —
   * честный, автор видит цену (нижележащие пересоберутся). */
  const canRunManual = useCallback(
    (i: number): boolean => {
      if (running) return false
      if (!briefReady) return false
      if (i === 0) return true
      return stageDone(i - 1) || stages[i - 1].status === 'failed'
    },
    [running, briefReady, stageDone, stages]
  )

  const askRunStage = useCallback(
    (i: number, key: StageKey): void => {
      if (i > 0 && stages[i - 1].status === 'failed') {
        const ok = window.confirm(
          `Предыдущий этап («${STAGE_TITLE[stages[i - 1].key]}») провален. Запустить «${STAGE_TITLE[key]}» всё равно?`
        )
        if (!ok) return
      }
      void runStage(key)
    },
    [stages, runStage]
  )

  /* детали новых этапов: истории (этап 1), брикеты (этап 3), печь (этап 5) */
  const arsDetail = stages[0].status === 'done' ? asRecord(stages[0].detail) : null
  const collectorDetail = stages[2].status === 'done' ? asRecord(stages[2].detail) : null
  const furnaceDetail = stages[4].status === 'done' ? asRecord(stages[4].detail) : null
  const furnaceFailed = asStr(asRecord(furnaceDetail?.report).verdict) === 'FAIL'
  const failedStage = stages.find((s) => s.status === 'failed')
  const finishedOk = snapshot != null && snapshot.finished != null && snapshot.ok === true && !running
  const activeSlug = snapshot?.slug ?? null

  /* ---- главная кнопка: контекстный CTA (примитивы — без IIFE-объектов,
   * которые компилятор принимает за ref-значение). После провала — снова
   * полный запуск: ручной override живёт на самой карточке этапа ---- */
  const ctaRunning = running
  const ctaFinished = !running && finishedOk
  const ctaGo = !running && !finishedOk

  /* ================= render ================= */

  /* embed: <div> вместо <main> — внутри консоли уже есть свой <main>,
   * вложенная main-роль невалидна (a11y). Одинаковая разметка — оба режима. */
  const CanvasTag: 'div' | 'main' = embed ? 'div' : 'main'

  return (
    <div
      className={cn(
        'flex flex-col text-zinc-100',
        embed ? '' : 'min-h-screen bg-zinc-950'
      )}
    >
      {/* ── шапка ── (в embed-режиме конвейер живёт внутри консоли «МОЩНОСТЬ»:
       *     своя шапка не нужна — статус/ключ/цепь прода уже в шапке консоли;
       *     остаётся компактный заголовок секции + честные пилюли twin-цепи
       *     и активного слага) ── */}
      {!embed ? (
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3">
          <span className="font-semibold tracking-tight">
            THREAD 4 <span className="text-zinc-500">·</span>{' '}
            <span className="text-zinc-400">конвейер</span>
          </span>
          {/* цепь: статус без бухгалтерии */}
          <span
            className="flex items-center gap-1.5 rounded-full border border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400"
            title={chainOk == null ? 'движок не отвечает' : chainOk ? 'хеш-цепь цела' : 'цепь не сходится — смотри консоль'}
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                chainOk === true && 'bg-emerald-400',
                chainOk === false && 'bg-rose-500',
                chainOk == null && 'animate-pulse bg-zinc-500'
              )}
            />
            {chainOk == null ? 'движок…' : chainOk ? 'цепь цела' : 'цепь: проблемы'}
          </span>
          {activeSlug != null ? (
            <span className="rounded-full border border-zinc-800 px-2 py-0.5 font-term text-[11px] text-zinc-500">
              {activeSlug}
            </span>
          ) : null}
          <span className="ml-auto" />
          <button
            type="button"
            onClick={() => {
              setKeyOpen((v) => !v)
              if (!keyOpen && getCommanderKey() === '') setKeyState('idle')
            }}
            className={cn(
              'flex items-center gap-1.5 rounded-md border p-1.5 transition-colors',
              getCommanderKey() === ''
                ? 'border-amber-600/50 text-amber-300 hover:border-amber-500'
                : 'border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
            )}
            title="Ключ командира — мутации конвейера"
            aria-label="ключ командира"
          >
            <Key className="size-3.5" />
          </button>
        </div>
        <AnimatePresence initial={false}>
          {keyOpen ? (
            <motion.div
              initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
              animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={SPRING}
              className="overflow-hidden border-t border-zinc-800/60 bg-zinc-900/40"
            >
              <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 px-4 py-2.5">
                <input
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder="ключ командира (из ~/.t4/commander.key)"
                  type="password"
                  className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-term text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
                />
                <button
                  type="button"
                  onClick={saveKey}
                  className="rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-200 transition-colors hover:border-zinc-500"
                >
                  Сохранить
                </button>
                <button
                  type="button"
                  onClick={() => void probeKey()}
                  className="rounded-md border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
                >
                  Проверить
                </button>
                <span
                  className={cn(
                    'text-[11px]',
                    keyState === 'ok' && 'text-emerald-300',
                    keyState === 'bad' && 'text-rose-300',
                    keyState === 'noserver' && 'text-amber-300',
                    (keyState === 'idle' || keyState === 'checking') && 'text-zinc-500'
                  )}
                >
                  {keyState === 'ok'
                    ? 'ключ принят'
                    : keyState === 'bad'
                      ? 'ключ не совпал'
                      : keyState === 'noserver'
                        ? 'серверного замка нет'
                        : keyState === 'checking'
                          ? 'проверяю…'
                          : 'проверь перед запуском'}
                </span>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </header>
      ) : (
      <header className="mb-3 flex flex-wrap items-center gap-2 px-1">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-200">
          Конвейер <span className="font-normal text-zinc-500">· от темы до сдачи</span>
        </h2>
        <span
          className="flex items-center gap-1.5 rounded-full border border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400"
          title={chainOk == null ? 'движок не отвечает' : chainOk ? 'хеш-цепь цела' : 'цепь не сходится — смотри консоль'}
        >
          <span
            className={cn(
              'size-1.5 rounded-full',
              chainOk === true && 'bg-emerald-400',
              chainOk === false && 'bg-rose-500',
              chainOk == null && 'animate-pulse bg-zinc-500'
            )}
          />
          {chainOk == null ? 'движок…' : chainOk ? 'цепь цела' : 'цепь: проблемы'}
        </span>
        {activeSlug != null ? (
          <span className="rounded-full border border-zinc-800 px-2 py-0.5 font-term text-[11px] text-zinc-500">
            {activeSlug}
          </span>
        ) : null}
        <span className="ml-auto hidden font-mono text-[10px] text-zinc-600 sm:inline">
          репетиции · rust :3201
        </span>
      </header>
      )}

      {/* ── полотно конвейера ──
       * embed: <div> вместо <main> — внутри консоли уже есть свой <main>,
       * вложенная main-роль невалидна (a11y); разметка одна на оба режима */}
      <CanvasTag className={cn('mx-auto w-full max-w-3xl flex-1 px-4 pt-0', embed ? 'pb-2' : 'pb-40 pt-6')}>
        {/* финальный баннер */}
        <AnimatePresence>
          {finishedOk && snapshot != null ? (
            <motion.div
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={SPRING}
              className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/[0.06] px-4 py-3"
              role="status"
            >
              <div className="flex flex-wrap items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-400" />
                <span className="text-sm font-medium text-emerald-200">
                  Батч сдан — промпты готовы
                </span>
                <span className="text-xs text-zinc-400">{snapshot.finished}</span>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* этап 1 — приказ + якоря (развёрнутая карточка) */}
        <section
          aria-label="этап 1 · приказ и раскрытие темы"
          className={cn(
            'rounded-xl border bg-zinc-950/60 p-4 transition-colors sm:p-5',
            stages[0].status === 'running' && 'border-amber-500/40 bg-amber-500/[0.03]',
            stages[0].status === 'done' && 'border-emerald-500/30',
            stages[0].status === 'failed' && 'border-rose-500/40 bg-rose-500/[0.03]',
            (stages[0].status === 'pending' || stages[0].status === 'stale') && 'border-zinc-800/70'
          )}
        >
          <div className="flex items-center gap-3">
            {statusIcon(stages[0].status, stages[0].status === 'running')}
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold tracking-tight">
                1 · Приказ <span className="text-zinc-500">и</span>&nbsp;{STAGE_TITLE.ars}
              </h2>
              {stages[0].summary != null ? (
                <p className="mt-0.5 truncate text-xs text-zinc-400">{stages[0].summary}</p>
              ) : (
                <p className="mt-0.5 text-xs text-zinc-500">{STAGE_HINT.ars}</p>
              )}
            </div>
            {/* Ручной запуск этапа 1 — тот же ▶, что у этапов 2–6: без него
             * ручной режим мёртв (□ «забыли ручной запуск», Фаза 3 приказа
             * «ВОССТАНОВИТЬ РАБОЧЕЕ»: авторан один, этап 1 без кнопки = ручной
             * прогон не начинался никогда). Запуск берёт правки ARS из приказа. */}
            {!running && briefReady ? (
              <button
                type="button"
                onClick={() => void runStage('ars')}
                title={
                  stages[0].status === 'done'
                    ? `Перезапустить «${STAGE_TITLE.ars}» (нижележащие устареют)`
                    : `Выполнить «${STAGE_TITLE.ars}» — истории в консоли`
                }
                aria-label={`выполнить этап ${STAGE_TITLE.ars}`}
                className="flex shrink-0 items-center gap-1 rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-100"
              >
                <Play className="size-3" />
                {stages[0].status === 'done' ? 'заново' : 'этап'}
              </button>
            ) : null}
            {!running ? (
              <button
                type="button"
                onClick={() => setBriefOpen((v) => !v)}
                aria-expanded={briefOpen}
                className="flex items-center gap-1 rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
              >
                {briefOpen ? 'Свернуть' : 'Править приказ'}
                <ChevronDown className={cn('size-3 transition-transform', !briefOpen && 'rotate-180')} />
              </button>
            ) : null}
          </div>

          <AnimatePresence initial={false}>
            {briefOpen && !running ? (
              <motion.div
                key="brief"
                initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
                exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                transition={SPRING}
                className="overflow-hidden"
              >
                <div className="space-y-4 pt-4">
                  {/* тема */}
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-zinc-400">Тема батча</span>
                    <input
                      value={theme}
                      onChange={(e) => setTheme(e.target.value.slice(0, 200))}
                      placeholder="например: гроза над ночным вокзалом"
                      className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
                    />
                  </label>

                  {/* OC-темы */}
                  <div>
                    <span className="mb-1 block text-xs font-medium text-zinc-400">
                      Темы персонажей <span className="text-zinc-600">(минимум одна)</span>
                    </span>
                    <div className="space-y-1.5">
                      {oc.map((o, i) => (
                        <div key={i} className="flex gap-1.5">
                          <input
                            value={o.theme}
                            onChange={(e) => {
                              const next = [...oc]
                              next[i] = { ...o, theme: e.target.value.slice(0, 120) }
                              setOc(next)
                            }}
                            placeholder={i === 0 ? 'угол первой OC — например: дождь застал в библиотеке' : `угол ${i + 1}-й OC (необязательно)`}
                            className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
                          />
                          <select
                            value={o.rating}
                            onChange={(e) => {
                              const next = [...oc]
                              next[i] = { ...o, rating: e.target.value as OcInput['rating'] }
                              setOc(next)
                            }}
                            aria-label={`рейтинг ${i + 1}-й OC`}
                            className="rounded-md border border-zinc-800 bg-zinc-950 px-1.5 py-1.5 text-xs text-zinc-300 outline-none focus:border-zinc-600"
                          >
                            {OC_RATINGS.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* EXP + движок */}
                  <div className="flex flex-wrap gap-3">
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-zinc-400">
                        Экспериментальные слоты{' '}
                        <span className="text-zinc-600">(без темы, болванки-программы)</span>
                      </span>
                      <select
                        value={exp}
                        onChange={(e) => setExp(Number(e.target.value))}
                        className="rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                      >
                        {Array.from({ length: 10 }, (_, n) => (
                          <option key={n} value={n}>
                            {n === 0 ? 'нет' : n}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-zinc-400">Движок</span>
                      <select
                        value={engine}
                        onChange={(e) => setEngine(e.target.value)}
                        className="rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                      >
                        {ENGINES.map((m) => (
                          <option key={m} value={m}>
                            {m === 'per-theme' ? 'под тему' : 'под темы, RAW+'}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {/* детали приказа */}
                  <details className="group rounded-lg border border-zinc-800/70 px-3 py-2">
                    <summary className="cursor-pointer list-none text-xs text-zinc-400 transition-colors hover:text-zinc-200">
                      <span className="inline-flex items-center gap-1.5">
                        <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
                        Детали приказа — кины, пожелания, свой номер
                      </span>
                    </summary>
                    <div className="mt-3 space-y-3">
                      <label className="block">
                        <span className="mb-1 block text-xs text-zinc-500">
                          Кин-лист <span className="text-zinc-600">(например: R12, R37 — через запятую)</span>
                        </span>
                        <input
                          value={speciesList}
                          onChange={(e) => setSpeciesList(e.target.value.slice(0, 200))}
                          placeholder="пусто = без кинов"
                          className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs text-zinc-500">
                          Пожелания к мейнам <span className="text-zinc-600">(закон энергии батча)</span>
                        </span>
                        <textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value.slice(0, 2000))}
                          placeholder="что должно быть видно в каждом кадре"
                          rows={2}
                          className="w-full resize-none rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs text-zinc-500">
                          Свой номер батча <span className="text-zinc-600">(пусто — движок возьмёт следующий: {nextSlug || '…'})</span>
                        </span>
                        <input
                          value={slugTouched ? slug : ''}
                          onChange={(e) => {
                            setSlug(e.target.value.toUpperCase().slice(0, 6))
                            setSlugTouched(e.target.value.trim() !== '')
                          }}
                          placeholder="T4-NN"
                          className="w-28 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-term text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
                        />
                      </label>
                      <label className="flex items-center gap-2 text-xs text-zinc-500">
                        <span>A/B-пары</span>
                        <select
                          value={ab}
                          onChange={(e) => setAb(Number(e.target.value))}
                          className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-zinc-600"
                        >
                          {[2, 3].map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </details>

                  {exp > 0 ? (
                    <p className="rounded-md border border-zinc-800/70 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400">
                      EXP {exp} — идеи ВНЕ темы (концепт/поза/одежда/кин/новая ОС на подтверждение);
                      21 история + 3 ОС раскрываются как обычно (доктрина ARS, приказ 2026-10-23).
                    </p>
                  ) : null}

                  {/* правки ARS: строгий JSON артефакта раскрытия */}
                  <details
                    className="group rounded-lg border border-zinc-800/70 px-3 py-2"
                    open={arsEditOpen}
                    onToggle={(e) => setArsEditOpen((e.target as HTMLDetailsElement).open)}
                  >
                    <summary className="cursor-pointer list-none text-xs text-zinc-400 transition-colors hover:text-zinc-200">
                      <span className="inline-flex items-center gap-1.5">
                        <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
                        Правки ARS NOVEAU <span className="text-zinc-600">— strict JSON артефакта (пусто = думает мост)</span>
                      </span>
                    </summary>
                    <div className="mt-3 space-y-2">
                      <textarea
                        value={arsEdit ?? ''}
                        onChange={(e) => setArsEdit(e.target.value.slice(0, 120_000))}
                        placeholder={'{"engineName":…, "mains":[21 истории], "ocs":[3], "exp":[идеи]} — вставь артефакт из детали этапа и правь'}
                        rows={5}
                        spellCheck={false}
                        className="t4-scroll w-full resize-y rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-term text-[11px] leading-relaxed text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-zinc-600"
                      />
                      <div className="flex items-center gap-2">
                        {arsEdit != null && parseArsEdit(arsEdit) == null ? (
                          <span className="text-[11px] text-rose-300">JSON не парсится — конвейер пойдёт без правок</span>
                        ) : arsEdit != null ? (
                          <span className="text-[11px] text-emerald-300">JSON валиден — strict-проверка на движке</span>
                        ) : (
                          <span className="text-[11px] text-zinc-600">правок нет — раскрытие делает LLM-мост</span>
                        )}
                        {arsEdit != null ? (
                          <button
                            type="button"
                            onClick={() => setArsEdit(null)}
                            className="ml-auto rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
                          >
                            Сбросить правки
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </details>

                  {/* furnaceOverride: решение автора при FAIL Печи */}
                  {furnaceFailed ? (
                    <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/[0.06] px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={furnaceOverride}
                        onChange={(e) => setFurnaceOverride(e.target.checked)}
                        className="mt-0.5 size-3.5 accent-rose-400"
                      />
                      <span className="text-xs leading-relaxed text-rose-100">
                        <span className="font-semibold">Сдать вопреки FAIL Печи.</span> Решение автора (§1):
                        репорт в читальне этапа 5, событие сдачи зафиксирует override.
                      </span>
                    </label>
                  ) : null}

                  {/* результат этапа 1: 21 история + 3 ОС + EXP-идеи */}
                  {arsDetail != null ? (
                    <div className="rounded-lg border border-zinc-800/70 p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <p className="text-xs font-medium text-zinc-400">
                          Истории раскрыты <span className="text-zinc-600">— клик по карточке разворачивает поля</span>
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            setReader({
                              title: `ARS NOVEAU — ${snapshot?.slug ?? ''} «${theme.trim()}»`,
                              badge: 'экспозиция',
                              markdown: asStr(asRecord(arsDetail).exposition) || '',
                            })
                          }
                          className="ml-auto flex items-center gap-1.5 rounded-md border border-amber-600/50 px-2.5 py-1 text-[11px] font-medium text-amber-200 transition-colors hover:border-amber-500"
                        >
                          <BookOpen className="size-3" />
                          Читать экспозицию
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const build = asRecord(asRecord(arsDetail).ars)
                            setArsEdit(JSON.stringify(build, null, 1))
                            setArsEditOpen(true)
                          }}
                          className="rounded-md border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
                        >
                          Править JSON
                        </button>
                      </div>
                      <StoriesGrid ars={asRecord(arsDetail).ars} />
                    </div>
                  ) : null}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </section>

        {/* рельс прогресса + этапы 2..6 */}
        <ol className="relative mt-4 space-y-3" aria-label="этапы конвейера">
          {stages.slice(1).map((stage, i) => {
            const idx = i + 1
            const isRunning = stage.status === 'running'
            const done = stageDone(idx)
            return (
              <li key={stage.key}>
                <section
                  aria-label={`этап ${idx + 1} · ${STAGE_TITLE[stage.key]}`}
                  className={cn(
                    'rounded-xl border p-4 transition-colors',
                    stageTone(stage.status),
                    stage.status === 'pending' && 'opacity-70',
                    stage.status === 'stale' && 'opacity-55'
                  )}
                >
                  <div className="flex items-center gap-3">
                    {statusIcon(stage.status, isRunning)}
                    <div className="min-w-0 flex-1">
                      <h2 className="text-sm font-semibold tracking-tight">
                        {idx + 1} · {STAGE_TITLE[stage.key]}
                      </h2>
                      {stage.summary != null ? (
                        <p className="mt-0.5 truncate text-xs text-zinc-400">{stage.summary}</p>
                      ) : (
                        <p className="mt-0.5 text-xs text-zinc-500">{STAGE_HINT[stage.key]}</p>
                      )}
                    </div>
                    {!running && (done || stage.status === 'failed' || canRunManual(idx)) ? (
                      <button
                        type="button"
                        onClick={() => askRunStage(idx, stage.key)}
                        title={
                          done
                            ? `Перезапустить «${STAGE_TITLE[stage.key]}» (нижележащие устареют)`
                            : `Выполнить «${STAGE_TITLE[stage.key]}»`
                        }
                        aria-label={`выполнить этап ${STAGE_TITLE[stage.key]}`}
                        className="flex shrink-0 items-center gap-1 rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-100"
                      >
                        <Play className="size-3" />
                        {done ? 'заново' : 'этап'}
                      </button>
                    ) : null}
                    <StageDetails stage={stage} onCopy={() => copyStageForAi(stage)} />
                  </div>
                  {stage.status === 'failed' && stage.summary != null ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2">
                      <AlertTriangle className="size-3.5 shrink-0 text-rose-400" />
                      <span className="min-w-0 flex-1 text-xs text-rose-200">{stage.summary}</span>
                      <button
                        type="button"
                        onClick={() => copyStageForAi(stage)}
                        className="flex items-center gap-1 rounded-md border border-rose-600/50 px-2 py-1 text-[11px] text-rose-200 transition-colors hover:border-rose-500"
                      >
                        <ClipboardCopy className="size-3" /> copy for ai
                      </button>
                    </div>
                  ) : null}

                  {/* ── тела этапов эры ARS ── */}
                  {stage.key === 'collector' && stage.status === 'done' && collectorDetail != null ? (
                    <div className="mt-3 space-y-2">
                      <BriquetteList briquettes={collectorDetail.briquettes} />
                      <button
                        type="button"
                        onClick={() =>
                          setReader({
                            title: `Сборщик — ${snapshot?.slug ?? ''}`,
                            badge: 'брикеты',
                            markdown: asStr(collectorDetail.exposition) || '',
                          })
                        }
                        className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition-colors hover:border-zinc-500"
                      >
                        <BookOpen className="size-3" />
                        Читать брикеты
                      </button>
                    </div>
                  ) : null}

                  {stage.key === 'furnace' && stage.status === 'done' && furnaceDetail != null ? (
                    <div className="mt-3 space-y-2">
                      <FurnacePanel report={furnaceDetail.report} />
                      <button
                        type="button"
                        onClick={() =>
                          setReader({
                            title: `Печь — ${snapshot?.slug ?? ''}`,
                            badge: asStr(asRecord(furnaceDetail.report).verdict) || 'репорт',
                            markdown: furnaceReportMarkdown(furnaceDetail.report),
                          })
                        }
                        className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition-colors hover:border-zinc-500"
                      >
                        <BookOpen className="size-3" />
                        Читать репорт Печи
                      </button>
                    </div>
                  ) : null}
                </section>
              </li>
            )
          })}
        </ol>

        {snapError != null ? (
          <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/[0.05] px-3 py-2 text-xs text-rose-200">
            движок не отвечает: {snapError} — подними t4-engine-rs (bun run dev в mini-services/t4-engine-rs)
          </p>
        ) : null}
      </CanvasTag>

      {/* ── читальня ARS-эры: выдвижная панель «посмотреть почитать» ── */}
      <ReaderDrawer state={reader} onClose={() => setReader(null)} />

      {/* ── шторка консоли ── */}
      <AnimatePresence initial={false}>
        {consoleOpen ? (
          <motion.div
            key="console"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: 'min(42vh, 380px)', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={SPRING}
            className={cn(
              'fixed inset-x-0 z-30 mx-auto w-full max-w-3xl overflow-hidden px-0 sm:px-4',
              embed ? 'bottom-0' : 'bottom-[64px]'
            )}
          >
            <div className="h-full px-0 pb-0 sm:px-0">
              <LiveConsole className="h-full rounded-none border-x-0 border-b-0 sm:rounded-xl sm:border-x" />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* ── нижняя панель: одна главная кнопка + консоль ──
       * embed: панель — обычная карточка в конце секции (статичная, не липнет
       * к вьюпорту поверх консоли «МОЩНОСТЬ»); отдельный экран — sticky bottom. */}
      {embed ? (
        <div className="relative mt-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
          <CTABar
            ctaRunning={ctaRunning}
            ctaFinished={ctaFinished}
            ctaGo={ctaGo}
            briefReady={briefReady}
            consoleOpen={consoleOpen}
            errors={ring.errors}
            onStop={stopRun}
            onReset={resetAll}
            onStart={startAuto}
            onToggleConsole={() =>
              setConsoleOpen((v) => {
                try {
                  window.localStorage.setItem(CONSOLE_KEY, v ? '0' : '1')
                } catch {}
                return !v
              })
            }
          />
          <span className="pointer-events-none absolute -top-2.5 left-4 rounded-full border border-zinc-800 bg-zinc-950 px-2 py-px font-mono text-[9px] text-zinc-600">
            репетиции · rust :3201
          </span>
        </div>
      ) : (
        <footer className="sticky bottom-0 z-40 mt-auto border-t border-zinc-800/80 bg-zinc-950/95 backdrop-blur">
          <CTABar
            ctaRunning={ctaRunning}
            ctaFinished={ctaFinished}
            ctaGo={ctaGo}
            briefReady={briefReady}
            consoleOpen={consoleOpen}
            errors={ring.errors}
            onStop={stopRun}
            onReset={resetAll}
            onStart={startAuto}
            onToggleConsole={() =>
              setConsoleOpen((v) => {
                try {
                  window.localStorage.setItem(CONSOLE_KEY, v ? '0' : '1')
                } catch {}
                return !v
              })
            }
          />
          <div className="pointer-events-none absolute inset-x-0 -top-6 flex justify-center">
            <span className="rounded-full bg-zinc-950/90 px-3 py-0.5 text-[10px] text-zinc-600 backdrop-blur">
              единый движок · rust :3201
            </span>
          </div>
        </footer>
      )}
      {/* тикер кольца — чтобы бейдж ошибок жил */}
      <span className="hidden">{ringTick}</span>
    </div>
  )
}

/* Панель управления конвейером: главная кнопка (авто 1→5 / стоп / новый
 * батч) + шторка живой консоли. Одна разметка — два режима размещения
 * (embed-карточка внутри консоли или sticky-панель отдельного экрана). */
interface CTABarProps {
  ctaRunning: boolean
  ctaFinished: boolean
  ctaGo: boolean
  briefReady: boolean
  consoleOpen: boolean
  errors: number
  onStop: () => void
  onReset: () => void
  onStart: () => void
  onToggleConsole: () => void
}

function CTABar({
  ctaRunning,
  ctaFinished,
  ctaGo,
  briefReady,
  consoleOpen,
  errors,
  onStop,
  onReset,
  onStart,
  onToggleConsole,
}: CTABarProps) {
  return (
    <div
      className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <button
        type="button"
        onClick={ctaRunning ? onStop : ctaFinished ? onReset : onStart}
        disabled={ctaGo && !briefReady}
        className={cn(
          'flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors',
          ctaRunning && 'bg-rose-600 text-rose-50 hover:bg-rose-500',
          ctaFinished && 'border border-emerald-500/40 bg-transparent text-emerald-300 hover:bg-emerald-500/10',
          ctaGo &&
            'bg-emerald-500 text-emerald-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500'
        )}
      >
        {ctaRunning ? (
          <Square className="size-4" />
        ) : ctaFinished ? (
          <RotateCcw className="size-4" />
        ) : (
          <Play className="size-4" />
        )}
        <span className="truncate">
          {ctaRunning ? 'Остановить конвейер' : ctaFinished ? 'Новый батч' : 'Запустить конвейер'}
        </span>
      </button>
      <button
        type="button"
        onClick={onToggleConsole}
        aria-expanded={consoleOpen}
        className={cn(
          'flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2.5 text-xs transition-colors',
          errors > 0
            ? 'border-rose-600/60 text-rose-300 hover:border-rose-500'
            : 'border-zinc-800 text-zinc-300 hover:border-zinc-600'
        )}
      >
        <Terminal className="size-4" />
        <span className="hidden sm:inline">{consoleOpen ? 'Скрыть' : 'Консоль'}</span>
        {errors > 0 ? (
          <span className="flex items-center gap-0.5 font-term text-[10px] text-rose-300">
            <AlertTriangle className="size-3" />
            {errors}
          </span>
        ) : null}
        <ChevronDown
          className={cn('hidden size-3 transition-transform sm:block', consoleOpen ? '' : 'rotate-180')}
        />
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Подробности этапа (аккордеон): квитанции + тех-JSON — весь мусор тут  */
/* ------------------------------------------------------------------ */

function StageDetails({ stage, onCopy }: { stage: StageView; onCopy: () => void }) {
  const [open, setOpen] = useState(false)
  const detail = asRecord(stage.detail)
  const receipts = useMemo<ReceiptView[]>(
    () => parseReceipts(detail.receipts ?? detail.gate),
    [detail]
  )
  const hasDetail = Object.keys(detail).length > 0
  if (!hasDetail) return null

  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-300"
      >
        Подробности
        <ChevronDown className={cn('size-3 transition-transform', !open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING}
            className="absolute inset-x-0 top-full z-20 overflow-hidden px-4 sm:px-5"
          >
            <div className="mt-1 max-h-96 overflow-y-auto t4-live-scroll rounded-xl border border-zinc-800 bg-zinc-950/95 p-4 text-xs shadow-2xl backdrop-blur">
              {receipts.length > 0 ? (
                <ul className="space-y-1.5">
                  {receipts.map((r) => (
                    <li key={r.gate} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className={cn('rounded border px-1.5 py-px text-[10px]', verdictChip(r.verdict))}>
                        {r.verdict}
                      </span>
                      <span className="text-zinc-300">{humanGate(r.gate)}</span>
                      {r.findings.slice(0, 3).map((f, fi) => (
                        <span key={fi} className="min-w-0 basis-full pl-1 text-[11px] text-zinc-500">
                          · {f}
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              ) : null}
              <details className="mt-3">
                <summary className="cursor-pointer list-none text-[11px] text-zinc-500 hover:text-zinc-300">
                  технический JSON (для разбора)
                </summary>
                <pre className="mt-1.5 max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-800/70 bg-zinc-900/50 p-2 font-term text-[10px] leading-relaxed text-zinc-400">
                  {JSON.stringify(stage.detail, null, 2)}
                </pre>
              </details>
              <button
                type="button"
                onClick={onCopy}
                className="mt-3 flex items-center gap-1.5 rounded-md border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
              >
                <ClipboardCopy className="size-3" /> copy for ai
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
