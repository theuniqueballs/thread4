'use client'

/**
 * ARS NOVEAU — панель Раскрывателя темы (смена 2026-10-24, исполнитель — Доу).
 *
 * Пайплайн: ТЕМА → EXPAND (LLM через мост) → ASSEMBLE (брикеты) → SCRIBE →
 * GATES (30) → FURNACE (честный репорт) → ПЕЧЬ. Стадии — async-задачи twin'а
 * (:3201): POST отвечает мгновенно, прогресс читается поллингом сессии.
 * Всё живёт в scratch-мире twin'а — прод неприкосновенен.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { fetchJson, postJson, useApi } from '@/components/t4/api'

type SessionCard = {
  id: string
  slug: string
  theme: string
  title: string | null
  stage: string
  busy: string | null
  hardPass: boolean | null
  furnaceVerdict: string | null
  updatedAt: string
}

type Dress = {
  channel: string
  category: string
  garment: string
  tone: string
  states: string[]
  underlayer: string
  claims: string[]
  negWeights: string
}

type ArsSlot = {
  pos: string
  act: string
  genre: string
  rating: string
  oc: string | null
  ocTheme: string | null
  anchor: string
  arch: string | null
  archName: string | null
  reveal: string
  scene: string
  envName: string
  envHint: string
  vibeName: string
  lightName: string
  lightRecipe: string
  poseId: string
  poseName: string
  raceName: string | null
  raceFeature: string | null
  register: string
  lead: string
  closer: string
  framing: string
  kId: number
  paletteId: string
  paletteSd: string
  diceSig: string
  diceInstr: string
  stack: string
  dress: Dress
  thesis: string
}

type ExpEntry = {
  letter: string
  kind: string
  hypothesis: string
  poseId: string
  channel: string
  register: string
  framing: string
}

type GateReceipt = {
  gate: string
  level: string
  verdict: string
  findings?: string[]
}

type FurnaceReport = {
  verdict: string
  revelationScore: number
  summary: string
  scribeDone: boolean
  scribeNotes: string
  problems: Array<{ slot: string; issue: string; severity: string }>
  strengths: string[]
  recommendations: string[]
  reportMd: string
}

type ArsSession = {
  id: string
  slug: string
  theme: string
  stage: string
  busy: string | null
  error: string | null
  title: string | null
  themeWords: string[]
  acts: string[]
  slots: ArsSlot[]
  expProgram: ExpEntry[]
  bricks: Array<{ pos: string; brick: string }>
  draftMd: string | null
  draftSha10: string | null
  gateReceipts: GateReceipt[]
  gateHardPass: boolean | null
  scribeLog: string[]
  furnace: FurnaceReport | null
  progress: Record<string, unknown>
}

const STAGES = ['expand', 'assemble', 'scribe', 'gates', 'furnace'] as const
type Stage = (typeof STAGES)[number]

const GENRE_STYLE: Record<string, string> = {
  VOLT: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  NICHE: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  EXQUISITE: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  OC: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300',
  EXP: 'border-zinc-600/60 bg-zinc-800/40 text-zinc-400',
}

function stageAvailable(stage: Stage, s: ArsSession | null): boolean {
  if (!s) return false
  switch (stage) {
    case 'expand':
      return true
    case 'assemble':
      return s.slots.length > 0
    case 'scribe':
      return s.bricks.length > 0 && !!s.draftMd
    case 'gates':
      return !!s.draftMd && !s.draftMd.includes('%%POS:')
    case 'furnace':
      return s.gateReceipts.length > 0
  }
}

function Chip({ tone, children }: { tone: 'ok' | 'warn' | 'err' | 'muted'; children: React.ReactNode }) {
  const cls =
    tone === 'ok'
      ? 'border-emerald-800/50 bg-emerald-500/5 text-emerald-300'
      : tone === 'warn'
        ? 'border-amber-800/50 bg-amber-500/5 text-amber-300'
        : tone === 'err'
          ? 'border-rose-800/50 bg-rose-500/5 text-rose-300'
          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400'
  return <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${cls}`}>{children}</span>
}

export function ArsNoveau() {
  const sessionsApi = useApi<{ data: { sessions: SessionCard[]; version: string } }>('/api/t4/twin/ars/sessions')
  const [selected, setSelected] = useState<string | null>(null)
  const [session, setSession] = useState<ArsSession | null>(null)
  const [theme, setTheme] = useState('')
  const [oc1, setOc1] = useState('')
  const [oc2, setOc2] = useState('')
  const [oc3, setOc3] = useState('')
  const [brickPos, setBrickPos] = useState<string | null>(null)
  const [acting, setActing] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const sessions = sessionsApi.data?.data?.sessions ?? []

  const refreshSession = useCallback(async (id: string) => {
    try {
      const res = await fetchJson<{ data: ArsSession }>(`/api/t4/twin/ars/session/${id}`)
      setSession(res.data)
    } catch {
      /* сессия могла исчезнуть — молча */
    }
  }, [])

  useEffect(() => {
    if (!selected) {
      setSession(null)
      return
    }
    void refreshSession(selected)
    if (timer.current) clearInterval(timer.current)
    timer.current = setInterval(() => void refreshSession(selected), 3000)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [selected, refreshSession])

  const busy = session?.busy ?? null

  const run = useCallback(
    async (stage: Stage, force = false) => {
      if (!selected) return
      setActing(stage)
      setActionErr(null)
      try {
        await postJson(`/api/t4/twin/ars/${stage}`, { id: selected, force })
      } catch (e) {
        setActionErr(e instanceof Error ? e.message : String(e))
      } finally {
        setActing(null)
        void refreshSession(selected)
        void sessionsApi.reload()
      }
    },
    [selected, refreshSession],
  )

  const create = useCallback(async () => {
    if (!theme.trim()) return
    setActing('new')
    setActionErr(null)
    try {
      const oc = [oc1, oc2, oc3].filter((t) => t.trim()).map((t) => ({ theme: t }))
      const res = await postJson<{ data: ArsSession }>('/api/t4/twin/ars/new', {
        theme: theme.trim(),
        ocThemes: oc,
      })
      setSelected(res.data.id)
      setTheme('')
      setOc1('')
      setOc2('')
      setOc3('')
      void sessionsApi.reload()
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e))
    } finally {
      setActing(null)
    }
  }, [theme, oc1, oc2, oc3, refreshSession])

  const hardFails = useMemo(
    () => (session?.gateReceipts ?? []).filter((r) => r.level === 'hard' && r.verdict === 'FAIL'),
    [session],
  )
  const warns = useMemo(
    () => (session?.gateReceipts ?? []).filter((r) => r.level === 'warn' && r.verdict === 'WARN'),
    [session],
  )
  const brick = useMemo(
    () => session?.bricks.find((b) => b.pos === brickPos) ?? null,
    [session, brickPos],
  )

  return (
    <div className="min-w-0 space-y-4">
      {/* шапка */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="bg-gradient-to-r from-amber-300 via-rose-300 to-fuchsia-300 bg-clip-text font-mono text-sm font-bold uppercase tracking-wider text-transparent">
              ARS NOVEAU
            </h2>
            <p className="mt-0.5 font-mono text-[10px] text-zinc-500">
              раскрыватель темы: тема → 21+3+EXP слоты → брикеты → писец → гейты → FURNACE → печь · мост llm-bridge :3202 · scratch-мир twin&apos;а
            </p>
          </div>
          {session && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip tone="muted">{session.slug}</Chip>
              <Chip tone="muted">{session.stage}</Chip>
              {busy && <Chip tone="warn">идёт: {busy}</Chip>}
              {session.gateHardPass === true && <Chip tone="ok">hard PASS</Chip>}
              {session.gateHardPass === false && <Chip tone="err">hard FAIL</Chip>}
              {session.furnace && (
                <Chip tone={session.furnace.verdict === 'SHIP' ? 'ok' : 'warn'}>
                  FURNACE: {session.furnace.verdict} · {session.furnace.revelationScore}/10
                </Chip>
              )}
            </div>
          )}
        </div>
      </div>

      {/* новая тема */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/60 p-4">
        <label className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">тема</label>
        <input
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          placeholder="Tide Altar — приливный алтарь: вода поднимается по ступеням святилища…"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900/70 px-3 py-2 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none"
        />
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {[oc1, oc2, oc3].map((v, i) => (
            <input
              key={i}
              value={v}
              onChange={(e) => [setOc1, setOc2, setOc3][i](e.target.value)}
              placeholder={`ОС-тема ${i + 1} (своя история)`}
              className="w-full rounded-md border border-zinc-800 bg-zinc-900/70 px-3 py-2 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-fuchsia-500/50 focus:outline-none"
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => void create()}
          disabled={!theme.trim() || acting !== null}
          className="mt-3 rounded-md bg-zinc-100 px-4 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wide text-zinc-950 transition-colors hover:bg-amber-300 disabled:opacity-40"
        >
          {acting === 'new' ? 'открываю…' : 'новая сессия'}
        </button>
        {actionErr && (
          <p className="mt-2 rounded border border-rose-800/50 bg-rose-500/5 px-2 py-1 font-mono text-[11px] text-rose-300">
            {actionErr}
          </p>
        )}
      </div>

      {/* список сессий */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/60 p-4">
        <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">сессии ({sessions.length})</p>
        <div className="mt-2 max-h-48 space-y-1 overflow-y-auto t4-scroll">
          {sessions.length === 0 && <p className="font-mono text-[11px] text-zinc-600">пусто — открой первую тему</p>}
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelected(s.id)}
              className={`flex w-full flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                selected === s.id
                  ? 'border-amber-500/50 bg-amber-500/5'
                  : 'border-zinc-800/60 bg-zinc-900/40 hover:border-zinc-700'
              }`}
            >
              <span className="font-mono text-[11px] font-bold text-zinc-200">{s.slug}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-400">
                {s.title ?? s.theme}
              </span>
              <Chip tone="muted">{s.stage}</Chip>
              {s.busy && <Chip tone="warn">{s.busy}</Chip>}
              {s.hardPass === true && <Chip tone="ok">hard PASS</Chip>}
              {s.hardPass === false && <Chip tone="err">hard FAIL</Chip>}
              {s.furnaceVerdict && (
                <Chip tone={s.furnaceVerdict === 'SHIP' ? 'ok' : 'warn'}>{s.furnaceVerdict}</Chip>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* стадии */}
      {session && (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/60 p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">стадии пайплайна</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {STAGES.map((st) => {
              const ok = stageAvailable(st, session)
              const isBusy = busy === st
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => void run(st)}
                  disabled={!ok || busy !== null || acting !== null}
                  title={ok ? `запустить ${st}` : 'недоступна из текущего состояния'}
                  className={`rounded-md border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide transition-colors disabled:opacity-30 ${
                    isBusy
                      ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                      : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-emerald-500/50 hover:text-emerald-300'
                  }`}
                >
                  {isBusy ? '…' : st}
                </button>
              )
            })}
            {busy && (
              <button
                type="button"
                onClick={() => void run(busy as Stage, true)}
                className="rounded-md border border-rose-800/60 bg-rose-500/5 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-rose-300 hover:bg-rose-500/10"
                title="форс-сброс залипшего воркера (после рестарта twin'а)"
              >
                force
              </button>
            )}
          </div>
          {session.error && (
            <p className="mt-2 rounded border border-rose-800/50 bg-rose-500/5 px-2 py-1 font-mono text-[11px] text-rose-300">
              ошибка: {session.error}
            </p>
          )}
          {session.themeWords.length > 0 && (
            <p className="mt-2 font-mono text-[11px] text-zinc-500">
              тема-слова: <span className="text-amber-300">{session.themeWords.join(', ')}</span>
            </p>
          )}
        </div>
      )}

      {/* слоты */}
      {session && session.slots.length > 0 && (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/60 p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            слот-карточки ({session.slots.length}) · EXP-программа ({session.expProgram.length})
          </p>
          <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {session.slots.map((s) => (
              <div key={s.pos} className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[11px] font-bold text-zinc-100">{s.pos}</span>
                  <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${GENRE_STYLE[s.genre] ?? GENRE_STYLE.EXP}`}>
                    {s.genre}
                  </span>
                  <Chip tone={s.rating === 'R+' ? 'warn' : s.rating === 'R' ? 'muted' : 'muted'}>{s.rating}</Chip>
                  <Chip tone="muted">{s.poseId}</Chip>
                  {s.arch && <Chip tone={s.genre === 'NICHE' ? 'ok' : 'warn'}>{s.arch}</Chip>}
                </div>
                <p className="mt-1.5 line-clamp-3 font-mono text-[11px] leading-snug text-zinc-300">{s.reveal}</p>
                <p className="mt-1 font-mono text-[10px] text-zinc-500">
                  {s.envName} · {s.lightName} · {s.vibeName} · {s.dress.channel} · {s.register}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-zinc-600">
                  {s.paletteId} · кость {s.diceSig} · {s.stack.split(' + ').length}×CR
                </p>
                {s.ocTheme && (
                  <p className="mt-1 font-mono text-[10px] text-fuchsia-300/80">ОС: {s.oc?.slice(0, 40)} — {s.ocTheme.slice(0, 60)}</p>
                )}
                <button
                  type="button"
                  onClick={() => setBrickPos(s.pos)}
                  className="mt-1.5 font-mono text-[10px] text-amber-400/80 underline-offset-2 hover:underline"
                >
                  брикет →
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {session.expProgram.map((e) => (
              <span key={e.letter} className="rounded border border-dashed border-zinc-700 bg-zinc-900/40 px-2 py-1 font-mono text-[10px] text-zinc-400">
                EXP {e.letter} · {e.kind} · {e.channel} · {e.poseId}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* брикет */}
      {brick && (
        <div className="rounded-xl border border-amber-800/40 bg-zinc-950/60 p-4">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-wider text-amber-400">брикет {brick.pos}</p>
            <button type="button" onClick={() => setBrickPos(null)} className="font-mono text-[10px] text-zinc-500 hover:text-zinc-300">
              закрыть
            </button>
          </div>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap font-term text-[11px] leading-relaxed text-zinc-300 t4-scroll">
            {brick.brick}
          </pre>
        </div>
      )}

      {/* гейты */}
      {session && session.gateReceipts.length > 0 && (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/60 p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            гейты ({session.gateReceipts.length}) · прогон #{session.gateReceipts.length > 0 ? '—' : '—'}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {session.gateReceipts.map((r) => (
              <span
                key={r.gate}
                title={(r.findings ?? []).slice(0, 4).join('\n')}
                className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                  r.verdict === 'PASS' || r.verdict === 'REPORT'
                    ? 'border-emerald-800/50 bg-emerald-500/5 text-emerald-300'
                    : r.verdict === 'WARN'
                      ? 'border-amber-800/50 bg-amber-500/5 text-amber-300'
                      : 'border-rose-800/50 bg-rose-500/5 text-rose-300'
                }`}
              >
                {r.gate} {r.verdict}
              </span>
            ))}
          </div>
          {hardFails.length > 0 && (
            <div className="mt-2 space-y-1">
              {hardFails.map((r) =>
                (r.findings ?? []).slice(0, 4).map((f, i) => (
                  <p key={`${r.gate}-${i}`} className="font-mono text-[10px] text-rose-300/90">
                    {r.gate}: {f.slice(0, 160)}
                  </p>
                )),
              )}
            </div>
          )}
          {warns.length > 0 && (
            <p className="mt-2 font-mono text-[10px] text-amber-400/80">
              warn&apos;ы: {warns.map((w) => w.gate).join(', ')} — квитанции в WORKLOG при сдаче
            </p>
          )}
        </div>
      )}

      {/* драфт */}
      {session?.draftMd && (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/60 p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            драфт {session.slug} · sha {session.draftSha10}
          </p>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap font-term text-[10.5px] leading-relaxed text-zinc-400 t4-scroll">
            {session.draftMd}
          </pre>
        </div>
      )}

      {/* FURNACE */}
      {session?.furnace && (
        <div className={`rounded-xl border p-4 ${session.furnace.verdict === 'SHIP' ? 'border-emerald-800/50' : 'border-amber-800/50'} bg-zinc-950/60`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">FURNACE — репорт без пиздежа</p>
            <div className="flex gap-1.5">
              <Chip tone={session.furnace.verdict === 'SHIP' ? 'ok' : 'warn'}>{session.furnace.verdict}</Chip>
              <Chip tone="muted">раскрытие {session.furnace.revelationScore}/10</Chip>
            </div>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-300">{session.furnace.summary}</p>
          <p className="mt-2 font-mono text-[11px] text-zinc-400">
            писец: {session.furnace.scribeDone ? 'справился' : 'НЕ справился'} — {session.furnace.scribeNotes}
          </p>
          {session.furnace.problems.length > 0 && (
            <div className="mt-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-rose-400">проблемы ({session.furnace.problems.length})</p>
              <div className="mt-1 max-h-48 space-y-1 overflow-y-auto t4-scroll">
                {session.furnace.problems.map((p, i) => (
                  <p key={i} className="font-mono text-[11px] text-zinc-300">
                    <span className={p.severity === 'high' ? 'text-rose-400' : p.severity === 'mid' ? 'text-amber-400' : 'text-zinc-500'}>
                      {p.slot} [{p.severity}]
                    </span>{' '}
                    {p.issue.slice(0, 200)}
                  </p>
                ))}
              </div>
            </div>
          )}
          {session.furnace.strengths.length > 0 && (
            <div className="mt-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-emerald-400">сильное</p>
              {session.furnace.strengths.slice(0, 5).map((s, i) => (
                <p key={i} className="font-mono text-[11px] text-zinc-400">+ {s.slice(0, 180)}</p>
              ))}
            </div>
          )}
          {session.furnace.recommendations.length > 0 && (
            <div className="mt-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-amber-400">рекомендации</p>
              {session.furnace.recommendations.slice(0, 6).map((r, i) => (
                <p key={i} className="font-mono text-[11px] text-zinc-400">&gt; {r.slice(0, 180)}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
