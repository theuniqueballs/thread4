'use client'

/**
 * THREAD 4 — ЕДИНЫЙ КОНВЕЙЕР (cutover-эра, приказ «МОЩНОСТЬ», 2026-10-20).
 *
 * Один экран — весь жизненный цикл батча, строго сверху вниз, БЕЗ вкладок:
 *
 *   1 · Приказ + Раскрытие темы   — тема/OC/EXP → якоря (правятся руками)
 *   2 · Компиляция                — реестр канона + бриф писца
 *   3 · Сборка                    — одноразовый движок (спайн)
 *   4 · Писец                     — черновик батча + батарея + ремонт
 *   5 · Сдача                     — финальные проверки + фиксация в цепи
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

/* ------------------------------------------------------------------ */
/* Канва этапов                                                        */
/* ------------------------------------------------------------------ */

const STAGE_KEYS = ['theme', 'compile', 'build', 'scribe', 'deliver'] as const
type StageKey = (typeof STAGE_KEYS)[number]
type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'stale'

const STAGE_TITLE: Record<StageKey, string> = {
  theme: 'Раскрытие темы',
  compile: 'Компиляция',
  build: 'Сборка',
  scribe: 'Писец',
  deliver: 'Сдача',
}

const STAGE_HINT: Record<StageKey, string> = {
  theme: 'Тема раскладывается на визуальные якоря — их можно править',
  compile: 'Канон собирает план слотов и бриф писца',
  build: 'Кузница изобретает одноразовый движок под тему',
  scribe: 'Пишец пишет промпты, проверки гоняют их по кругу',
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
/* Якоря темы                                                          */
/* ------------------------------------------------------------------ */

interface AnchorsState {
  locale?: string
  timeOfDay?: string
  light?: string
  paletteMood?: string
  wardrobeFamily?: string
  poseFamily?: string
  camera?: string
  seed?: string
  motifs?: string[]
  atmosphere?: string[]
  tokens?: string[]
  lexiconHits?: string[]
  minAdherence?: number
}

const ANCHOR_FIELDS: { key: keyof AnchorsState; label: string }[] = [
  { key: 'locale', label: 'Место' },
  { key: 'timeOfDay', label: 'Время' },
  { key: 'light', label: 'Свет' },
  { key: 'paletteMood', label: 'Палитра' },
  { key: 'wardrobeFamily', label: 'Гардероб' },
  { key: 'poseFamily', label: 'Позы' },
  { key: 'camera', label: 'Камера' },
]

/* ------------------------------------------------------------------ */
/* Черновик приказа (localStorage, миграция со старого воркфлоу)        */
/* ------------------------------------------------------------------ */

const DRAFT_KEY = 't4-pipeline-draft'
const DRAFT_VERSION = 2
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
  anchors: AnchorsState | null
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
    anchors: null,
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
    d.anchors == null &&
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
    anchors: null,
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
        anchors: asRecord(j.anchors).locale !== undefined || asArray(asRecord(j.anchors).motifs).length > 0
          ? (asRecord(j.anchors) as AnchorsState)
          : null,
      }
      const restored =
        draft.theme.trim() !== '' || oc.some((o) => o.theme.trim() !== '') || draft.anchors != null
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
      const anchorsRec = asRecord(j.anchors)
      if (Object.keys(anchorsRec).length > 0) draft.anchors = anchorsRec as AnchorsState
      window.localStorage.removeItem(LEGACY_KEY)
      const restored = draft.theme.trim() !== '' || draft.anchors != null
      return { draft, restored, migrated: true }
    }
    return { draft: fallback, restored: false, migrated: false }
  } catch {
    return { draft: fallback, restored: false, migrated: false }
  }
}

function parseAnchors(v: unknown): AnchorsState | null {
  const rec = asRecord(v)
  if (Object.keys(rec).length === 0) return null
  const a: AnchorsState = {
    locale: asStr(rec.locale),
    timeOfDay: asStr(rec.timeOfDay),
    light: asStr(rec.light),
    paletteMood: asStr(rec.paletteMood),
    wardrobeFamily: asStr(rec.wardrobeFamily),
    poseFamily: asStr(rec.poseFamily),
    camera: asStr(rec.camera),
    seed: asStr(rec.seed),
    motifs: asArray(rec.motifs).map(asStr).filter((s) => s !== ''),
    atmosphere: asArray(rec.atmosphere).map(asStr).filter((s) => s !== ''),
    tokens: asArray(rec.tokens).map(asStr).filter((s) => s !== ''),
    lexiconHits: asArray(rec.lexiconHits).map(asStr).filter((s) => s !== ''),
    minAdherence: asNum(rec.minAdherence) ?? undefined,
  }
  const meaningful = Object.values(a).some((v) => (Array.isArray(v) ? v.length > 0 : v != null && v !== ''))
  return meaningful ? a : null
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

export function PipelineScreen() {
  const reduce = useReducedMotion() ?? false

  /* ---- черновик (ленивая инициализация — localStorage читается раз) ---- */
  const [theme, setTheme] = useState(() => initialDraft().draft.theme)
  const [slug, setSlug] = useState(() => initialDraft().draft.slug)
  const [slugTouched, setSlugTouched] = useState(() => initialDraft().draft.slugTouched)
  const [exp, setExp] = useState(() => initialDraft().draft.exp)
  const [ab, setAb] = useState(() => initialDraft().draft.ab)
  const [engine, setEngine] = useState(() => initialDraft().draft.engine)
  const [speciesList, setSpeciesList] = useState(() => initialDraft().draft.speciesList)
  const [notes, setNotes] = useState(() => initialDraft().draft.notes)
  const [oc, setOc] = useState<OcInput[]>(() => initialDraft().draft.oc.map((o) => ({ ...o })))
  const [anchors, setAnchors] = useState<AnchorsState | null>(() =>
    initialDraft().draft.anchors != null ? { ...(initialDraft().draft.anchors as AnchorsState) } : null
  )
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
      ...(anchors != null && !isExp ? { themeAnchors: anchors, expandTheme: true } : {}),
    }),
    [theme, exp, ab, engine, speciesList, oc, notes, slug, slugTouched, anchors, isExp]
  )

  /* ---- персист черновика (debounce 250мс) ---- */
  useEffect(() => {
    const draft: Draft = { theme, slug, slugTouched, exp, ab, engine, speciesList, notes, oc, anchors }
    const timer = window.setTimeout(() => {
      try {
        if (draftEmpty(draft)) window.localStorage.removeItem(DRAFT_KEY)
        else window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ v: DRAFT_VERSION, ...draft }))
      } catch {
        /* приватный режим — не переживёт перезагрузку */
      }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [theme, slug, slugTouched, exp, ab, engine, speciesList, notes, oc, anchors])

  /* ---- тост восстановления/миграции ---- */
  useEffect(() => {
    const init = initialDraft()
    const title = init.migrated ? 'Черновик перенесён из старого воркфлоу' : 'Черновик восстановлен'
    if (init.restored || init.migrated) {
      const t = window.setTimeout(() => {
        toast({ title, description: init.migrated ? 'тема, OC-темы и якоря на месте' : 'приказ ждёт продолжения' })
      }, 300)
      return () => window.clearTimeout(t)
    }
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
      toast({ title: 'Конвейер запущен', description: 'машина ведёт 1 → 5, смотри консоль' })
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

  const expandPreview = useCallback(async () => {
    if (!briefReady) return
    try {
      const data = await postJson<{ anchors?: unknown; gate?: ReceiptView } & Record<string, unknown>>(
        '/api/t4/twin/theme/expand',
        {
          theme: theme.trim(),
          slug: slugTouched && slug ? slug : nextSlug || 'T4-00',
          exp,
          ocThemes: oc.filter((o) => o.theme.trim() !== '').map((o) => o.theme.trim()),
        }
      )
      const a = parseAnchors(data?.anchors)
      if (a != null) setAnchors(a)
      const gate = asRecord(data?.gate)
      if (asStr(gate.verdict) === 'FAIL') {
        toast({
          title: 'Гейт темы не прошёл',
          description: asArray(gate.findings).map(asStr).slice(0, 2).join(' · ') || 'правь якоря',
          variant: 'destructive',
        })
      } else {
        toast({ title: 'Якоря собраны', description: 'правь руками — все правки уйдут в конвейер' })
      }
    } catch (e) {
      toast({ title: 'Раскрытие не удалось', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    }
  }, [briefReady, theme, slug, slugTouched, nextSlug, exp, oc])

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
    setAnchors(null)
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
        errors: errorFrames().map((f) => ({ block: f.block, text: f.text })),
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

  const canRunManual = useCallback(
    (i: number): boolean => {
      if (running) return false
      if (!briefReady) return false
      if (i === 0) return true
      return stageDone(i - 1)
    },
    [running, briefReady, stageDone]
  )

  const failedStage = stages.find((s) => s.status === 'failed')
  const finishedOk = snapshot != null && snapshot.finished != null && snapshot.ok === true && !running
  const activeSlug = snapshot?.slug ?? null

  /* ---- главная кнопка: контекстный CTA (примитивы — без IIFE-объектов,
   * которые компилятор принимает за ref-значение) ---- */
  const ctaRunning = running
  const ctaFinished = !running && finishedOk
  const ctaFailedKey: StageKey | null = !running && !finishedOk && failedStage != null ? failedStage.key : null
  const ctaGo = !running && !finishedOk && ctaFailedKey == null

  /* ================= render ================= */

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* ── шапка ── */}
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

      {/* ── полотно конвейера ── */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-40 pt-6">
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
                1 · Приказ <span className="text-zinc-500">и</span> {STAGE_TITLE.theme}
              </h2>
              {stages[0].summary != null ? (
                <p className="mt-0.5 truncate text-xs text-zinc-400">{stages[0].summary}</p>
              ) : (
                <p className="mt-0.5 text-xs text-zinc-500">{STAGE_HINT.theme}</p>
              )}
            </div>
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

                  {isExp ? (
                    <p className="rounded-md border border-zinc-800/70 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400">
                      EXP-батч: раскрытие темы пропускается — болванки живут без темы (вердикт T4-34).
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void expandPreview()}
                        disabled={!briefReady}
                        className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Play className="size-3" />
                        Раскрыть тему
                      </button>
                      {anchors != null ? (
                        <button
                          type="button"
                          onClick={() => setAnchors(null)}
                          className="rounded-md border border-zinc-800 px-2.5 py-1.5 text-[11px] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
                        >
                          Сбросить якоря
                        </button>
                      ) : null}
                    </div>
                  )}

                  {/* якоря */}
                  <AnimatePresence initial={false}>
                    {anchors != null && !isExp ? (
                      <motion.div
                        key="anchors"
                        initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                        animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
                        exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                        transition={SPRING}
                        className="overflow-hidden"
                      >
                        <div className="rounded-lg border border-zinc-800/70 p-3">
                          <p className="mb-2 text-xs font-medium text-zinc-400">
                            Визуальные якоря <span className="text-zinc-600">— правь, всё уйдёт в конвейер</span>
                          </p>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {ANCHOR_FIELDS.map(({ key, label }) => (
                              <label key={key} className="block">
                                <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-zinc-600">
                                  {label}
                                </span>
                                <input
                                  value={anchors[key] ?? ''}
                                  onChange={(e) => setAnchors({ ...anchors, [key]: e.target.value.slice(0, 80) })}
                                  className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-600"
                                />
                              </label>
                            ))}
                            {(anchors.motifs ?? []).map((m, i) => (
                              <label key={`motif-${i}`} className="block">
                                <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-zinc-600">
                                  Мотив {i + 1}
                                </span>
                                <input
                                  value={m}
                                  onChange={(e) => {
                                    const motifs = [...(anchors.motifs ?? [])]
                                    motifs[i] = e.target.value.slice(0, 80)
                                    setAnchors({ ...anchors, motifs })
                                  }}
                                  className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-600"
                                />
                              </label>
                            ))}
                            {(anchors.atmosphere ?? []).map((a, i) => (
                              <label key={`atm-${i}`} className="block">
                                <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-zinc-600">
                                  Атмосфера {i + 1}
                                </span>
                                <input
                                  value={a}
                                  onChange={(e) => {
                                    const atmo = [...(anchors.atmosphere ?? [])]
                                    atmo[i] = e.target.value.slice(0, 80)
                                    setAnchors({ ...anchors, atmosphere: atmo })
                                  }}
                                  className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-zinc-600"
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </section>

        {/* рельс прогресса + этапы 2..5 */}
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
                        onClick={() => void runStage(stage.key)}
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
      </main>

      {/* ── шторка консоли ── */}
      <AnimatePresence initial={false}>
        {consoleOpen ? (
          <motion.div
            key="console"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: 'min(42vh, 380px)', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={SPRING}
            className="fixed inset-x-0 bottom-[64px] z-30 mx-auto w-full max-w-3xl overflow-hidden px-0 sm:px-4"
          >
            <div className="h-full px-0 pb-0 sm:px-0">
              <LiveConsole className="h-full rounded-none border-x-0 border-b-0 sm:rounded-xl sm:border-x" />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* ── нижняя панель: одна главная кнопка + консоль ── */}
      <footer className="sticky bottom-0 z-40 mt-auto border-t border-zinc-800/80 bg-zinc-950/95 backdrop-blur">
        <div
          className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <button
            type="button"
            onClick={ctaRunning ? stopRun : ctaFinished ? resetAll : ctaFailedKey != null ? () => void runStage(ctaFailedKey) : startAuto}
            disabled={ctaGo && !briefReady}
            className={cn(
              'flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors',
              ctaRunning && 'bg-rose-600 text-rose-50 hover:bg-rose-500',
              ctaFinished && 'border border-emerald-500/40 bg-transparent text-emerald-300 hover:bg-emerald-500/10',
              ctaFailedKey != null && 'bg-amber-500 text-amber-950 hover:bg-amber-400',
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
              {ctaRunning
                ? 'Остановить конвейер'
                : ctaFinished
                  ? 'Новый батч'
                  : ctaFailedKey != null
                    ? `Перезапустить «${STAGE_TITLE[ctaFailedKey]}»`
                    : 'Запустить конвейер'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setConsoleOpen((v) => {
                try {
                  window.localStorage.setItem(CONSOLE_KEY, v ? '0' : '1')
                } catch {}
                return !v
              })
            }}
            aria-expanded={consoleOpen}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2.5 text-xs transition-colors',
              ring.errors > 0
                ? 'border-rose-600/60 text-rose-300 hover:border-rose-500'
                : 'border-zinc-800 text-zinc-300 hover:border-zinc-600'
            )}
          >
            <Terminal className="size-4" />
            <span className="hidden sm:inline">{consoleOpen ? 'Скрыть' : 'Консоль'}</span>
            {ring.errors > 0 ? (
              <span className="flex items-center gap-0.5 font-term text-[10px] text-rose-300">
                <AlertTriangle className="size-3" />
                {ring.errors}
              </span>
            ) : null}
            <ChevronDown
              className={cn('hidden size-3 transition-transform sm:block', consoleOpen ? '' : 'rotate-180')}
            />
          </button>
        </div>
        <div className="pointer-events-none absolute inset-x-0 -top-6 flex justify-center">
          <span className="rounded-full bg-zinc-950/90 px-3 py-0.5 text-[10px] text-zinc-600 backdrop-blur">
            единый движок · rust :3201
          </span>
        </div>
      </footer>
      {/* тикер кольца — чтобы бейдж ошибок жил */}
      <span className="hidden">{ringTick}</span>
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
