'use client'

/**
 * THREAD 4 dashboard — spec renderers.
 * One specialized renderer per known spec id (carriers, poses, palettes,
 * pools, engines, oc-canon, races, rating-recipes, bans) + a generic
 * fallback that renders ANY json decently (sections / tables / chips).
 *
 * Every renderer is defensive: unknown field names or shapes fall through
 * to the generic view instead of crashing. `filter` is a lowercase
 * substring — items that do not contain it are hidden.
 */

import type { ReactNode } from 'react'

import {
  asArray,
  asRecord,
  asStr,
  humanizeKey,
  pickStr,
  pickStrArray,
} from './api'
import { Chip, DegreeBadge, EmptyState, RatingBadge } from './bits'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* Shared extraction helpers                                           */
/* ------------------------------------------------------------------ */

function matches(item: unknown, q: string): boolean {
  if (q === '') return true
  try {
    return JSON.stringify(item).toLowerCase().includes(q)
  } catch {
    return true
  }
}

function firstArray(spec: unknown, keys: string[]): unknown[] | null {
  const rec = asRecord(spec)
  for (const k of keys) {
    if (Array.isArray(rec[k])) return rec[k]
  }
  if (Array.isArray(spec)) return spec
  return null
}

/** Records from an array of objects or a keyed object of objects. */
function recordItems(v: unknown): { key: string; rec: Record<string, unknown> }[] {
  if (Array.isArray(v)) {
    return v
      .map((x, i) => ({ key: String(i), rec: asRecord(x) }))
      .filter((x) => Object.keys(x.rec).length > 0 || typeof v[x.rec ? 0 : 0] === 'object')
  }
  return Object.entries(asRecord(v)).map(([k, val]) => ({ key: k, rec: asRecord(val) }))
}

function normalizeDegree(v: unknown): string {
  const s = asStr(v).trim().toUpperCase()
  if (s === 'LOW') return 'L'
  if (s === 'MEDIUM' || s === 'MED') return 'M'
  if (s === 'HIGH') return 'H'
  if (s === 'L' || s === 'M' || s === 'H') return s
  return ''
}

const FILTER_EMPTY: Record<string, never> = {}

/* ------------------------------------------------------------------ */
/* Carriers — table grouped by class, degree badges                    */
/* ------------------------------------------------------------------ */

function CarriersView({ spec, filter }: { spec: unknown; filter: string }) {
  type Carrier = { name: string; cls: string; degree: string; mechanism: string; note: string; raw: unknown }
  const carriers: Carrier[] = []

  const push = (rec: Record<string, unknown>, raw: unknown, fallbackCls = '') => {
    const name = pickStr(rec, 'name', 'id', 'label', 'carrier', 'tag')
    if (!name) return
    carriers.push({
      name,
      cls: pickStr(rec, 'class', 'cls', 'code', 'carrier_class') || fallbackCls,
      degree: normalizeDegree(rec.degree ?? rec.deg ?? rec.level),
      mechanism: pickStr(rec, 'mechanism', 'mechanism_group', 'group', 'family', 'type'),
      note: pickStr(rec, 'note', 'description', 'desc', 'why', 'use', 'usage'),
      raw,
    })
  }

  const root = asRecord(spec)
  const direct = firstArray(spec, ['carriers', 'items'])
  if (direct) {
    for (const item of direct) {
      const rec = asRecord(item)
      if (Object.keys(rec).length === 0) {
        const s = asStr(item)
        if (s) carriers.push({ name: s, cls: '', degree: '', mechanism: '', note: '', raw: item })
      } else push(rec, item)
    }
  }
  // shape: { classes: [{ code, name, carriers: [...] }] }
  const classGroups = asArray(root.classes)
  if (classGroups.length > 0) {
    for (const g of classGroups) {
      const gRec = asRecord(g)
      const cls = pickStr(gRec, 'code', 'class', 'cls', 'id', 'name')
      for (const item of asArray(gRec.carriers ?? gRec.items)) {
        push(asRecord(item), item, cls)
      }
    }
  }
  // shape: keyed object of class → array
  if (carriers.length === 0) {
    for (const [k, v] of Object.entries(root)) {
      if (Array.isArray(v)) {
        for (const item of v) push(asRecord(item), item, k)
      }
    }
  }

  if (carriers.length === 0) return <GenericSpecView data={spec} filter={filter} />

  const filtered = carriers.filter((c) => matches(c.raw, filter))
  if (filtered.length === 0) return <FilterEmpty filter={filter} />

  const groups = new Map<string, Carrier[]>()
  for (const c of filtered) {
    const key = c.cls || '—'
    const list = groups.get(key)
    if (list) list.push(c)
    else groups.set(key, [c])
  }

  return (
    <div className="t4-scroll max-h-96 space-y-5 overflow-y-auto pr-1">
      {[...groups.entries()].map(([cls, items]) => (
        <div key={cls}>
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex size-6 items-center justify-center rounded-md border border-amber-500/40 bg-amber-500/10 font-mono text-xs font-semibold text-amber-400">
              {cls}
            </span>
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              {cls === '—' ? 'носители' : `класс ${cls}`} · {items.length}
            </span>
          </div>
          <div className="overflow-hidden rounded-lg border border-zinc-800">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-zinc-400">Носитель</TableHead>
                  <TableHead className="text-zinc-400">Степень</TableHead>
                  <TableHead className="text-zinc-400">Механизм</TableHead>
                  <TableHead className="text-zinc-400">Примечание</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((c, i) => (
                  <TableRow key={`${c.name}-${i}`} className="border-zinc-800/70">
                    <TableCell className="font-medium text-zinc-200">{c.name}</TableCell>
                    <TableCell>{c.degree ? <DegreeBadge degree={c.degree} /> : <span className="text-zinc-600">—</span>}</TableCell>
                    <TableCell className="text-zinc-400">{c.mechanism || '—'}</TableCell>
                    <TableCell className="max-w-xs whitespace-normal text-xs leading-relaxed text-zinc-500">{c.note || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Poses — table with category + risk badges                           */
/* ------------------------------------------------------------------ */

function riskTone(risk: string): string {
  const r = risk.toLowerCase()
  if (['safe', 'low', 'clean', 'ok'].includes(r)) return 'border-emerald-600/40 bg-emerald-600/10 text-emerald-400'
  if (['edge', 'risky', 'medium', 'med', 'warn', 'spicy'].includes(r)) return 'border-amber-500/40 bg-amber-500/10 text-amber-400'
  if (['banned', 'high', 'hard', 'danger'].includes(r)) return 'border-rose-500/40 bg-rose-500/10 text-rose-400'
  return 'border-zinc-700 bg-zinc-800/60 text-zinc-300'
}

function PosesView({ spec, filter }: { spec: unknown; filter: string }) {
  type Pose = { name: string; category: string; risk: string; note: string; raw: unknown }
  const poses: Pose[] = []
  const push = (item: unknown, fallbackCat = '') => {
    const rec = asRecord(item)
    const name = pickStr(rec, 'name', 'id', 'pose', 'tag') || asStr(item)
    if (!name || (Object.keys(rec).length === 0 && typeof item !== 'string')) return
    poses.push({
      name,
      category: pickStr(rec, 'category', 'type', 'family', 'group', 'class') || fallbackCat,
      risk: pickStr(rec, 'risk', 'risk_level', 'edge', 'safety', 'level'),
      note: pickStr(rec, 'note', 'description', 'desc', 'why', 'use'),
      raw: item,
    })
  }
  const direct = firstArray(spec, ['poses', 'items'])
  if (direct) for (const item of direct) push(item)
  const root = asRecord(spec)
  if (poses.length === 0) {
    for (const [k, v] of Object.entries(root)) {
      if (Array.isArray(v)) for (const item of v) push(item, k)
    }
  }
  if (poses.length === 0) return <GenericSpecView data={spec} filter={filter} />

  const filtered = poses.filter((p) => matches(p.raw, filter))
  if (filtered.length === 0) return <FilterEmpty filter={filter} />

  return (
    <div className="t4-scroll max-h-96 overflow-y-auto pr-1">
      <div className="overflow-hidden rounded-lg border border-zinc-800">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-zinc-400">Поза</TableHead>
              <TableHead className="text-zinc-400">Категория</TableHead>
              <TableHead className="text-zinc-400">Риск</TableHead>
              <TableHead className="text-zinc-400">Примечание</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((p, i) => (
              <TableRow key={`${p.name}-${i}`} className="border-zinc-800/70">
                <TableCell className="font-medium text-zinc-200">{p.name}</TableCell>
                <TableCell className="text-zinc-400">{p.category || '—'}</TableCell>
                <TableCell>
                  {p.risk ? (
                    <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium', riskTone(p.risk))}>
                      {p.risk}
                    </span>
                  ) : (
                    <span className="text-zinc-600">—</span>
                  )}
                </TableCell>
                <TableCell className="max-w-xs whitespace-normal text-xs leading-relaxed text-zinc-500">{p.note || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Palettes — color-swatch cards, color names as text chips            */
/* ------------------------------------------------------------------ */

const COLOR_HEX: Record<string, string> = {
  black: '#18181b', 'pitch black': '#0a0a0a', charcoal: '#36454f', white: '#f4f4f5',
  'off-white': '#ececea', ivory: '#fffff0', cream: '#fffdd0', beige: '#f5f5dc',
  gray: '#71717a', grey: '#71717a', silver: '#c0c0c0', ash: '#b2beb5', slate: '#708090',
  red: '#dc2626', crimson: '#dc143c', scarlet: '#ff2400', cherry: '#d2042d',
  oxblood: '#4a0000', burgundy: '#800020', wine: '#722f37', maroon: '#800000',
  ruby: '#e0115f', pink: '#ec4899', rose: '#f43f5e', blush: '#de5d83',
  salmon: '#fa8072', coral: '#ff7f50', peach: '#ffdab9', magenta: '#ff00ff',
  fuchsia: '#ff77ff', orange: '#f97316', tangerine: '#f28500', apricot: '#fbceb4',
  amber: '#f59e0b', gold: '#d4af37', yellow: '#eab308', lemon: '#fff44f',
  sand: '#e1c699', khaki: '#c3b091', tan: '#d2b48c', camel: '#c19a6b',
  caramel: '#af6e4d', bronze: '#cd7f32', copper: '#b87333', rust: '#b7410e',
  terracotta: '#e2725b', brown: '#8b4513', chocolate: '#d2691e', coffee: '#6f4e37',
  espresso: '#4b3621', mocha: '#967969', green: '#22c55e', emerald: '#10b981',
  jade: '#00a86b', mint: '#98ff98', sage: '#9caf88', olive: '#808000',
  moss: '#8a9a5b', 'forest green': '#228b22', 'hunter green': '#355e3b', lime: '#84cc16',
  chartreuse: '#7fff00', teal: '#14b8a6', turquoise: '#40e0d0', aqua: '#00ffff',
  cyan: '#22d3ee', blue: '#3b82f6', navy: '#1e3a5f', 'midnight blue': '#191970',
  sky: '#87ceeb', azure: '#007fff', cobalt: '#0047ab', cerulean: '#2a52be',
  indigo: '#4b0082', violet: '#8f00ff', purple: '#a855f7', lavender: '#e6e6fa',
  lilac: '#c8a2c8', mauve: '#e0b0ff', plum: '#8e4585', orchid: '#da70d6',
}

function hexOf(name: string, explicit?: string): string | null {
  const check = (s: string): string | null => {
    const t = s.trim()
    if (/^#?[0-9a-f]{3}$/.test(t)) return `#${t.replace('#', '')}`
    if (/^#?[0-9a-f]{6}$/.test(t)) return t.startsWith('#') ? t : `#${t}`
    return null
  }
  if (explicit) {
    const h = check(explicit)
    if (h) return h
  }
  const key = name.trim().toLowerCase().replace(/[_-]+/g, ' ')
  return COLOR_HEX[key] ?? null
}

function PalettesView({ spec, filter }: { spec: unknown; filter: string }) {
  type Swatch = { name: string; hex: string | null }
  type Palette = { name: string; note: string; colors: Swatch[]; raw: unknown }

  const toSwatches = (v: unknown): Swatch[] =>
    asArray(v)
      .map((c): Swatch | null => {
        if (typeof c === 'string') {
          const h = hexOf(c)
          return h || c.match(/^[a-z]/i) ? { name: c, hex: h } : null
        }
        const rec = asRecord(c)
        const name = pickStr(rec, 'name', 'label', 'color', 'title')
        const explicit = pickStr(rec, 'hex', 'value', 'color')
        if (!name && !explicit) return null
        const finalName = name || explicit
        return { name: finalName, hex: hexOf(finalName, explicit) }
      })
      .filter((s): s is Swatch => s != null)

  // keyed object { colorName: hex } → swatches
  const recSwatches = (rec: Record<string, unknown>): Swatch[] =>
    Object.entries(rec)
      .filter(([, v]) => typeof v === 'string' && (hexOf(v) || hexOf('', v) || /^#?[0-9a-f]{3,6}$/i.test(v)))
      .map(([k, v]) => ({ name: k, hex: hexOf(k, asStr(v)) }))

  const palettes: Palette[] = []
  const push = (item: unknown) => {
    const rec = asRecord(item)
    const name = pickStr(rec, 'name', 'id', 'palette', 'title')
    const colorVals = ['colors', 'swatches', 'palette', 'shades'].map((k) => rec[k]).find((v) => Array.isArray(v) || asRecord(v).constructor === Object)
    let colors: Swatch[] = []
    if (colorVals != null) colors = Array.isArray(colorVals) ? toSwatches(colorVals) : recSwatches(asRecord(colorVals))
    else colors = recSwatches(rec)
    if (!name && colors.length === 0) return
    palettes.push({
      name: name || 'Без имени',
      note: pickStr(rec, 'note', 'vibe', 'mood', 'description', 'use'),
      colors,
      raw: item,
    })
  }

  const direct = firstArray(spec, ['palettes', 'items'])
  if (direct) for (const item of direct) push(item)
  if (palettes.length === 0) {
    for (const v of Object.values(asRecord(spec))) {
      if (Array.isArray(v)) for (const item of v) push(item)
    }
  }
  if (palettes.length === 0 && asRecord(spec).constructor === Object && !Array.isArray(spec)) {
    // maybe the spec itself is one palette
    const rec = asRecord(spec)
    if (pickStr(rec, 'name', 'id') || Object.keys(rec).length > 0) push(spec)
  }

  if (palettes.length === 0 || palettes.every((p) => p.colors.length === 0 && !p.name)) {
    return <GenericSpecView data={spec} filter={filter} />
  }

  const filtered = palettes.filter((p) => matches(p.raw, filter))
  if (filtered.length === 0) return <FilterEmpty filter={filter} />

  return (
    <div className="t4-scroll max-h-96 space-y-4 overflow-y-auto pr-1">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((p, i) => (
          <div key={`${p.name}-${i}`} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="mb-1 text-sm font-semibold text-zinc-100">{p.name}</div>
            {p.note ? <div className="mb-3 text-xs leading-relaxed text-zinc-500">{p.note}</div> : null}
            <div className="flex flex-wrap gap-1.5">
              {p.colors.length === 0 ? <span className="text-xs text-zinc-600">нет данных</span> : null}
              {p.colors.map((c, j) => (
                <span
                  key={`${c.name}-${j}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700/70 bg-zinc-800/50 py-0.5 pl-0.5 pr-1.5"
                  title={c.hex ?? c.name}
                >
                  <span
                    className="size-4 rounded-[4px] border border-zinc-600/60"
                    style={c.hex ? { backgroundColor: c.hex } : { background: 'linear-gradient(135deg,#3f3f46 0%,#f59e0b 100%)' }}
                  />
                  <span className="text-[11px] text-zinc-300">{c.name}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Engines — cards (law / on_body / failure_modes)                     */
/* ------------------------------------------------------------------ */

function LabeledBlock({ label, children, tone }: { label: string; children: ReactNode; tone?: 'rose' | 'amber' }) {
  if (children == null) return null
  return (
    <div className="mt-3">
      <div className={cn('mb-1 text-[10px] font-semibold uppercase tracking-widest', tone === 'rose' ? 'text-rose-400/70' : tone === 'amber' ? 'text-amber-500/70' : 'text-zinc-500')}>
        {label}
      </div>
      <div className="text-xs leading-relaxed text-zinc-400">{children}</div>
    </div>
  )
}

function EnginesView({ spec, filter }: { spec: unknown; filter: string }) {
  const engines = recordItems(asRecord(spec).engines ?? spec)
  const usable = engines.filter((e) => Object.keys(e.rec).length > 0)
  if (usable.length === 0) return <GenericSpecView data={spec} filter={filter} />

  const filtered = usable.filter((e) => matches(e.rec, filter))
  if (filtered.length === 0) return <FilterEmpty filter={filter} />

  return (
    <div className="t4-scroll max-h-96 space-y-4 overflow-y-auto pr-1">
      <div className="grid gap-4 lg:grid-cols-2">
        {filtered.map((e) => {
          const name = pickStr(e.rec, 'name', 'id', 'title') || humanizeKey(e.key)
          const version = pickStr(e.rec, 'version', 'generation', 'gen')
          const law = pickStr(e.rec, 'law', 'law_summary', 'summary', 'description', 'rule', 'thesis')
          const onBody = pickStr(e.rec, 'on_body', 'body', 'notes', 'usage', 'use')
          const failures = pickStrArray(e.rec, 'failure_modes', 'failures', 'failure', 'anti_patterns', 'traps')
          const { name: _n, version: _v, law: _l, on_body: _o, failure_modes: _f, failures: _ff, ...rest } = e.rec
          const extra = Object.entries(rest).slice(0, 3)
          return (
            <div key={e.key} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-amber-200">{name}</div>
                {version ? <Chip>{version}</Chip> : null}
              </div>
              {law ? <LabeledBlock label="law">{law}</LabeledBlock> : null}
              {onBody ? <LabeledBlock label="on body">{onBody}</LabeledBlock> : null}
              {failures.length > 0 ? (
                <LabeledBlock label="failure modes" tone="rose">
                  <div className="flex flex-wrap gap-1.5">
                    {failures.map((f, i) => (
                      <Chip key={i} tone="rose">{f}</Chip>
                    ))}
                  </div>
                </LabeledBlock>
              ) : null}
              {extra.map(([k, v]) => {
                const s = asStr(v)
                if (!s) return null
                return (
                  <LabeledBlock key={k} label={humanizeKey(k)}>{s}</LabeledBlock>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* OC canon — card per OC with recursive field rendering               */
/* ------------------------------------------------------------------ */

function FieldValue({ value, depth }: { value: unknown; depth: number }): ReactNode {
  if (value == null) return <span className="text-zinc-600">—</span>
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <span className="text-zinc-300">{asStr(value)}</span>
  }
  if (Array.isArray(value)) {
    if (value.every((x) => typeof x === 'string' || typeof x === 'number')) {
      return (
        <span className="flex flex-wrap gap-1">
          {value.map((x, i) => (
            <Chip key={i}>{asStr(x)}</Chip>
          ))}
        </span>
      )
    }
    return (
      <span className="block space-y-1">
        {value.map((x, i) => (
          <span key={i} className="block text-zinc-400">
            <FieldValue value={x} depth={depth + 1} />
          </span>
        ))}
      </span>
    )
  }
  const rec = asRecord(value)
  const entries = Object.entries(rec).slice(0, 10)
  return (
    <span className={cn('block space-y-1', depth > 0 && 'border-l border-zinc-800 pl-3')}>
      {entries.map(([k, v]) => (
        <span key={k} className="block">
          <span className="text-[11px] uppercase tracking-wide text-zinc-600">{humanizeKey(k)}: </span>
          <FieldValue value={v} depth={depth + 1} />
        </span>
      ))}
    </span>
  )
}

function OcCanonView({ spec, filter }: { spec: unknown; filter: string }) {
  const root = asRecord(spec)
  const raw = root.ocs ?? root.oc ?? root.characters ?? root.canon ?? spec
  const ocs = recordItems(raw)
  const usable = ocs.filter((o) => Object.keys(o.rec).length > 0)
  if (usable.length === 0) return <GenericSpecView data={spec} filter={filter} />

  const filtered = usable.filter((o) => matches(o.rec, filter))
  if (filtered.length === 0) return <FilterEmpty filter={filter} />

  return (
    <div className="t4-scroll max-h-96 space-y-4 overflow-y-auto pr-1">
      <div className="grid gap-4 lg:grid-cols-2">
        {filtered.map((oc) => {
          const name = pickStr(oc.rec, 'name', 'id', 'title') || humanizeKey(oc.key)
          const role = pickStr(oc.rec, 'role', 'archetype', 'type', 'summary')
          const { name: _n, role: _r, ...fields } = oc.rec
          return (
            <div key={oc.key} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-sm font-semibold text-amber-200">{name}</div>
                {role ? <Chip>{role}</Chip> : null}
              </div>
              <dl className="mt-3 space-y-2.5">
                {Object.entries(fields).slice(0, 14).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">{humanizeKey(k)}</dt>
                    <dd className="mt-0.5 text-xs leading-relaxed">
                      <FieldValue value={v} depth={0} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Rating recipes — tier cards (signals / carriers / counter-NEG)      */
/* ------------------------------------------------------------------ */

const TIER_ORDER = ['PG13', 'R', 'RPLUS', 'X', 'XXX']

function tierTone(key: string): string {
  const k = key.toUpperCase()
  if (k === 'X') return 'border-rose-500/50 bg-rose-500/10 text-rose-300'
  if (k === 'XXX') return 'border-rose-600/60 bg-rose-600/15 text-rose-400'
  if (k === 'RPLUS') return 'border-amber-500/60 bg-amber-500/15 text-amber-300'
  if (k === 'R') return 'border-amber-500/40 bg-amber-500/10 text-amber-400'
  return 'border-zinc-700 bg-zinc-800/60 text-zinc-200'
}

function tierLabel(key: string): string {
  const k = key.toUpperCase()
  if (k === 'PG13') return 'PG-13'
  if (k === 'RPLUS') return 'R+'
  return key.toUpperCase()
}

function RatingRecipesView({ spec, filter }: { spec: unknown; filter: string }) {
  const root = asRecord(spec)
  const tiers = asRecord(root.tiers)
  if (Object.keys(tiers).length === 0) return <GenericSpecView data={spec} filter={filter} />

  const tierKeys = [...TIER_ORDER.filter((k) => k in tiers), ...Object.keys(tiers).filter((k) => !TIER_ORDER.includes(k.toUpperCase()))]
  const filteredKeys = tierKeys.filter((k) => matches({ [k]: tiers[k] }, filter))

  const floors = asRecord(root.eternal_floors ?? root.floors)
  const spread = asRecord(asRecord(root.default_spread).mains_21 ?? root.default_spread)
  const spreadNote = pickStr(asRecord(root.default_spread), 'note')

  if (filteredKeys.length === 0 && Object.keys(floors).length === 0) return <FilterEmpty filter={filter} />

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        {filteredKeys.map((key) => {
          const t = asRecord(tiers[key])
          const signals = pickStrArray(t, 'signals')
          const counterNeg = pickStrArray(t, 'counter_neg', 'counter-NEG', 'counter_negatives')
          const carrierClasses = pickStrArray(t, 'carrier_classes', 'classes')
          const signalMin = asStr(t.signal_min)
          const note = pickStr(t, 'note')
          const platformNote = pickStr(t, 'platform_note')
          const { signals: _s, counter_neg: _c, carrier_classes: _cc, signal_min: _sm, name: _n, ...rest } = t
          const extra = Object.entries(rest).filter(([, v]) => typeof v === 'string').slice(0, 6)
          return (
            <div key={key} className={cn('rounded-lg border bg-zinc-900/60 p-4', tierTone(key).split(' ').slice(0, 2).join(' '))}>
              <div className="flex items-center justify-between gap-2">
                <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-sm font-bold tracking-tight', tierTone(key))}>
                  {tierLabel(key)}
                </span>
                {pickStr(t, 'name') ? <span className="text-xs italic text-zinc-500">{pickStr(t, 'name')}</span> : null}
                {signalMin ? <Chip tone="amber">min {signalMin}</Chip> : null}
              </div>

              {note ? <p className="mt-3 text-xs leading-relaxed text-zinc-400">{note}</p> : null}

              {signals.length > 0 ? (
                <LabeledBlock label="signals">
                  <div className="flex flex-wrap gap-1">
                    {signals.map((s, i) => <Chip key={i} tone="amber">{s}</Chip>)}
                  </div>
                </LabeledBlock>
              ) : null}

              {carrierClasses.length > 0 ? (
                <LabeledBlock label="carrier classes">
                  <div className="flex flex-wrap gap-1">
                    {carrierClasses.map((c, i) => <Chip key={i}>{c}</Chip>)}
                  </div>
                </LabeledBlock>
              ) : null}
              {pickStr(t, 'carrier_note') ? (
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{pickStr(t, 'carrier_note')}</p>
              ) : null}

              {counterNeg.length > 0 ? (
                <LabeledBlock label="counter-NEG" tone="rose">
                  <div className="flex flex-wrap gap-1">
                    {counterNeg.map((s, i) => <Chip key={i} tone="rose">{s}</Chip>)}
                  </div>
                </LabeledBlock>
              ) : null}

              {extra.map(([k, v]) => (
                <LabeledBlock key={k} label={humanizeKey(k)}>{asStr(v)}</LabeledBlock>
              ))}
              {platformNote ? (
                <p className="mt-3 border-l-2 border-amber-500/40 pl-3 text-xs italic leading-relaxed text-amber-200/70">{platformNote}</p>
              ) : null}
            </div>
          )
        })}
      </div>

      {Object.keys(floors).length > 0 && matches(floors, filter) ? (
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">eternal floors</div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Object.entries(floors).map(([guard, terms]) => (
              <div key={guard} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                <div className="mb-2 font-mono text-xs text-zinc-300">{humanizeKey(guard)}</div>
                <div className="flex flex-wrap gap-1">
                  {pickStrArray({ v: terms }, 'v').map((s, i) => (
                    <Chip key={i} tone="rose">{s}</Chip>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {Object.keys(spread).length > 0 ? (
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">default spread · mains 21</div>
          <div className="flex flex-wrap items-center gap-2">
            {Object.entries(spread).map(([tier, n]) => (
              <span key={tier} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1">
                <RatingBadge rating={tier} />
                <span className="text-xs font-semibold tabular-nums text-zinc-200">{asStr(n)}</span>
              </span>
            ))}
          </div>
          {spreadNote ? <p className="mt-2 text-xs leading-relaxed text-zinc-500">{spreadNote}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Rating techniques — авторская таблица приёмов (PG-13 → R → R+ → X)  */
/* ------------------------------------------------------------------ */

function EffMark({ v }: { v: unknown }) {
  const s = asStr(v)
  if (s === '●') return <span className="inline-block text-center text-[13px] leading-none text-amber-300">●</span>
  if (s === '○') return <span className="inline-block text-center text-[13px] leading-none text-zinc-500">○</span>
  return <span className="inline-block text-center text-[13px] leading-none text-zinc-700">·</span>
}

function RatingTechniquesView({ spec, filter }: { spec: unknown; filter: string }) {
  const root = asRecord(spec)
  const techniques = asArray(root.techniques)
  if (techniques.length === 0) return <GenericSpecView data={spec} filter={filter} />

  const principle = asRecord(root.principle)
  const layers = asArray(principle.layers).map((l, i) => {
    const rec = asRecord(l) ?? {}
    return { n: i + 1, name: asStr(rec.name) || `слой ${i + 1}`, note: asStr(rec.note) || '' }
  })
  const blocks = asRecord(root.blocks)
  const sumRules = asRecord(root.sum_rules)
  const floor = asRecord(sumRules.rplus_floor)
  const sumRows = asArray(sumRules.rows)
  const xcut = asRecord(root.xcut_hold)
  const outside = asArray(asRecord(root.outside_prompt).factors)
  const cheat = asArray(asRecord(root.cheat_sheet).rows)

  const rows = techniques.map((t) => {
    const rec = asRecord(t) ?? {}
    return {
      tag: asStr(rec.tag),
      block: asStr(rec.block) || '?',
      layer: asStr(rec.layer) || '?',
      pg13: rec.pg13,
      r: rec.r,
      rplus: rec.rplus,
      x: rec.x,
      note: asStr(rec.note),
      trap: rec.trap === true,
      suppressor: rec.suppressor === true,
      bridge: rec.bridge === true,
      raw: t,
    }
  })
  const shown = rows.filter((r) => matches(r.raw, filter))
  const blockIds = [...new Set(rows.map((r) => r.block))]
  const trapCount = rows.filter((r) => r.trap).length
  const bridgeCount = rows.filter((r) => r.bridge).length

  if (shown.length === 0) return <FilterEmpty filter={filter} />

  return (
    <div className="space-y-6">
      {/* принцип «для идиота» */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-amber-300/80">
          принцип «для идиота» — {asStr(principle.for_idiots)}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {layers.map((l) => (
            <div key={l.n} className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2">
              <div className="text-xs font-semibold text-zinc-200">
                <span className="mr-1.5 font-mono text-amber-300">{l.n}</span>{l.name}
              </div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{l.note}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 border-l-2 border-amber-500/40 pl-3 text-xs italic leading-relaxed text-amber-200/80">
          {asStr(principle.x_cut_one_fact)}
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">{asStr(root.relation)}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-600">{asStr(root.source)}</p>
      </div>

      {/* таблица приёмов по блокам */}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            карта приёмов · {shown.length}/{rows.length} · ● обычно · ○ иногда · · нет
          </div>
          <div className="flex gap-1">
            <Chip tone="rose">ловушки {trapCount}</Chip>
            <Chip tone="emerald">мост рецепта {bridgeCount}</Chip>
          </div>
        </div>
        <div className="space-y-4">
          {blockIds.map((bid) => {
            const brows = shown.filter((r) => r.block === bid)
            if (brows.length === 0) return null
            return (
              <div key={bid} className="overflow-hidden rounded-lg border border-zinc-800">
                <div className="border-b border-zinc-800 bg-zinc-900/80 px-4 py-2 text-xs font-semibold text-zinc-300">
                  блок {bid} — {asStr(blocks[bid]) || ''}
                </div>
                <div className="max-h-96 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-800 hover:bg-transparent">
                        <TableHead className="h-8 w-[34%] text-[11px] text-zinc-500">приём / тег</TableHead>
                        <TableHead className="h-8 w-[7%] text-center text-[11px] text-zinc-500">PG-13</TableHead>
                        <TableHead className="h-8 w-[7%] text-center text-[11px] text-zinc-500">R</TableHead>
                        <TableHead className="h-8 w-[7%] text-center text-[11px] text-zinc-500">R+</TableHead>
                        <TableHead className="h-8 w-[7%] text-center text-[11px] text-zinc-500">X</TableHead>
                        <TableHead className="h-8 text-[11px] text-zinc-500">что происходит</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {brows.map((r, i) => (
                        <TableRow key={i} className="border-zinc-800/70">
                          <TableCell className="py-1.5 pr-2 font-mono text-[11px] text-zinc-200">
                            {r.tag}
                            {r.trap ? <span className="ml-1.5 rounded border border-rose-500/50 bg-rose-500/15 px-1 py-px text-[9px] font-sans font-semibold text-rose-400">ловушка</span> : null}
                            {r.suppressor ? <span className="ml-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-1 py-px text-[9px] font-sans font-semibold text-emerald-300">супрессор</span> : null}
                            {r.bridge ? <span className="ml-1.5 rounded border border-zinc-600 bg-zinc-800/60 px-1 py-px text-[9px] font-sans font-semibold text-zinc-400">мост v1.2.0</span> : null}
                          </TableCell>
                          <TableCell className="py-1.5 text-center"><EffMark v={r.pg13} /></TableCell>
                          <TableCell className="py-1.5 text-center"><EffMark v={r.r} /></TableCell>
                          <TableCell className="py-1.5 text-center"><EffMark v={r.rplus} /></TableCell>
                          <TableCell className="py-1.5 text-center"><EffMark v={r.x} /></TableCell>
                          <TableCell className="py-1.5 pl-2 text-[11px] leading-snug text-zinc-500">{r.note}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* блок 8 — сумма факторов */}
      {sumRows.length > 0 && matches(sumRules, filter) ? (
        <div className="rounded-lg border border-amber-500/30 bg-zinc-900/60 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-amber-300/80">
            блок 8 — сумма факторов: как получается R+
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Chip tone="amber">R+ = ≥{asStr(floor.signals_min) || 3} сигнала</Chip>
            <Chip tone="amber">через ≥{asStr(floor.layers_min) || 2} слоя</Chip>
          </div>
          <div className="mt-3 space-y-1.5">
            {sumRows.map((row, i) => {
              const rec = asRecord(row) ?? {}
              return (
                <div key={i} className="flex flex-col gap-0.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <span className="text-xs text-zinc-300">{asStr(rec.combo)}</span>
                  <span className="shrink-0 font-mono text-[11px] text-amber-200/80">{asStr(rec.tiers)}</span>
                </div>
              )
            })}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">{asStr(sumRules.note)}</p>
        </div>
      ) : null}

      {/* блок 9 — X Cut hold */}
      {Object.keys(xcut).length > 0 && matches(xcut, filter) ? (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-rose-300/80">
            блок 9 — X Cut hold: как удержать, не улетая дальше
          </div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-300">{asStr(xcut.definition)}</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="mb-1.5 font-mono text-[11px] text-zinc-400">кадрирование (низ вне кадра)</div>
              <div className="flex flex-wrap gap-1">{pickStrArray({ v: xcut.framing }, 'v').map((s, i) => <Chip key={i}>{s}</Chip>)}</div>
              <div className="mb-1.5 mt-3 font-mono text-[11px] text-zinc-400">низ в одежде</div>
              <div className="flex flex-wrap gap-1">{pickStrArray({ v: xcut.lower_cover }, 'v').map((s, i) => <Chip key={i}>{s}</Chip>)}</div>
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="mb-1.5 font-mono text-[11px] text-zinc-400">граничный NEG (рецепт v1.3.0 — hard)</div>
              <div className="flex flex-wrap gap-1">{pickStrArray({ v: xcut.neg_block }, 'v').map((s, i) => <Chip key={i} tone="rose">{s}</Chip>)}</div>
              <div className="mb-1.5 mt-3 font-mono text-[11px] text-zinc-400">позы без раскрытия ног</div>
              <div className="flex flex-wrap gap-1">{pickStrArray({ v: xcut.poses }, 'v').map((s, i) => <Chip key={i}>{s}</Chip>)}</div>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">{asStr(xcut.neg_block_note)}</p>
        </div>
      ) : null}

      {/* блок 10 — вне промпта */}
      {outside.length > 0 && matches(asRecord(root.outside_prompt), filter) ? (
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            блок 10 — что влияет вне самого промпта
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {outside.map((f, i) => {
              const rec = asRecord(f) ?? {}
              return (
                <div key={i} className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                  <div className="text-[11px] font-semibold text-zinc-200">{asStr(rec.factor)}</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{asStr(rec.effect)}</div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {/* шпаргалка */}
      {cheat.length > 0 && matches(asRecord(root.cheat_sheet), filter) ? (
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            шпаргалка — один кадр, четыре рейтинга
          </div>
          <div className="space-y-1.5">
            {cheat.map((row, i) => {
              const rec = asRecord(row) ?? {}
              return (
                <div key={i} className="flex flex-col gap-1 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
                  <RatingBadge rating={asStr(rec.tier)} />
                  <span className="font-mono text-[11px] leading-snug text-zinc-400">{asStr(rec.delta)}</span>
                </div>
              )
            })}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">{asStr(asRecord(root.cheat_sheet).note)}</p>
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Races — status badges (gold=amber, banned=red)                      */
/* ------------------------------------------------------------------ */

function statusTone(status: string): string {
  const s = status.toLowerCase()
  if (s === 'gold' || s === 'favorite' || s === 'beloved') return 'border-amber-500/60 bg-amber-500/15 text-amber-300'
  if (s === 'banned' || s === 'ban' || s === 'forbidden') return 'border-rose-500/50 bg-rose-500/15 text-rose-400'
  if (s === 'retired' || s === 'parked') return 'border-zinc-700 bg-zinc-800/40 text-zinc-500 line-through'
  return 'border-zinc-700 bg-zinc-800/60 text-zinc-300'
}

function RacesView({ spec, filter }: { spec: unknown; filter: string }) {
  type Race = { name: string; status: string; note: string; raw: unknown }
  const races: Race[] = []
  const push = (item: unknown, fallbackStatus = '') => {
    const rec = asRecord(item)
    const name = pickStr(rec, 'name', 'id', 'race', 'title') || (typeof item === 'string' ? item : '')
    if (!name) return
    races.push({
      name,
      status: pickStr(rec, 'status', 'standing', 'state', 'tier') || fallbackStatus,
      note: pickStr(rec, 'note', 'description', 'why', 'role', 'use'),
      raw: item,
    })
  }
  const direct = firstArray(spec, ['races', 'items'])
  if (direct) for (const item of direct) push(item)
  if (races.length === 0) {
    for (const [k, v] of Object.entries(asRecord(spec))) {
      if (Array.isArray(v)) for (const item of v) push(item)
      else if (typeof v === 'object' && v != null) push(v, asStr(asRecord(v).status))
    }
    if (races.length === 0) {
      for (const [k, v] of Object.entries(asRecord(spec))) {
        if (typeof v === 'string') races.push({ name: k, status: v, note: '', raw: { [k]: v } })
      }
    }
  }
  if (races.length === 0) return <GenericSpecView data={spec} filter={filter} />

  const filtered = races.filter((r) => matches(r.raw, filter))
  if (filtered.length === 0) return <FilterEmpty filter={filter} />

  return (
    <div className="t4-scroll max-h-96 overflow-y-auto pr-1">
      <div className="overflow-hidden rounded-lg border border-zinc-800">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-zinc-400">Раса</TableHead>
              <TableHead className="text-zinc-400">Статус</TableHead>
              <TableHead className="text-zinc-400">Примечание</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r, i) => (
              <TableRow key={`${r.name}-${i}`} className="border-zinc-800/70">
                <TableCell className="font-medium text-zinc-200">{r.name}</TableCell>
                <TableCell>
                  {r.status ? (
                    <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium', statusTone(r.status))}>
                      {r.status}
                    </span>
                  ) : (
                    <span className="text-zinc-600">—</span>
                  )}
                </TableCell>
                <TableCell className="max-w-md whitespace-normal text-xs leading-relaxed text-zinc-500">{r.note || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Pools — sections of chips                                           */
/* ------------------------------------------------------------------ */

function PoolsView({ spec, filter }: { spec: unknown; filter: string }) {
  const root = asRecord(spec)
  const raw = root.pools ?? (Object.keys(root).length > 0 ? root : spec)
  const sections: { name: string; items: string[]; raw: unknown }[] = []

  const pushSection = (name: string, v: unknown) => {
    if (Array.isArray(v)) {
      const strs = v.map(asStr).filter((s) => s !== '')
      if (strs.length > 0) sections.push({ name, items: strs, raw: v })
    } else if (typeof v === 'string' && v !== '') {
      sections.push({ name, items: [v], raw: v })
    } else {
      const rec = asRecord(v)
      const inner = pickStr(rec, 'items', 'concepts', 'values', 'pool')
      if (inner.length > 0) sections.push({ name: name || pickStr(rec, 'name', 'id'), items: [inner], raw: v })
    }
  }

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const rec = asRecord(item)
      const name = pickStr(rec, 'name', 'id', 'title')
      pushSection(name || 'Пул', rec.items ?? rec.concepts ?? rec.values ?? item)
    }
  } else {
    for (const [k, v] of Object.entries(asRecord(raw))) pushSection(k, v)
  }

  const filtered = sections.filter((s) => matches(s.raw, filter))
  if (filtered.length === 0) return <GenericSpecView data={spec} filter={filter} />

  return (
    <div className="t4-scroll max-h-96 space-y-5 overflow-y-auto pr-1">
      {filtered.map((s, i) => (
        <div key={`${s.name}-${i}`}>
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-300">{humanizeKey(s.name)}</span>
            <span className="text-[11px] text-zinc-600">{s.items.length}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {s.items.map((item, j) => (
              <Chip key={j}>{item}</Chip>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Bans — patterns table + rules                                       */
/* ------------------------------------------------------------------ */

function BansView({ spec, filter }: { spec: unknown; filter: string }) {
  const root = asRecord(spec)
  const patterns = asArray(root.banned_patterns ?? root.patterns ?? root.bans)
  const faceLock = pickStr(root, 'face_lock')
  const posShape = pickStrArray(root, 'pos_shape')
  const qualityTags = pickStr(root, 'quality_tags')
  const wordBudget = asRecord(root.word_budget)
  const hedgeBudget = asStr(root.hedge_budget)

  const patternRows = patterns
    .map((p) => {
      const rec = asRecord(p)
      return {
        pattern: pickStr(rec, 'pattern', 'ban', 'match'),
        replace: pickStr(rec, 'replace', 'replacement', 'with'),
        cap: asStr(rec.cap ?? rec.limit),
        raw: p,
      }
    })
    .filter((p) => p.pattern)

  if (patternRows.length === 0 && Object.keys(root).length === 0) return <GenericSpecView data={spec} filter={filter} />

  const filtered = patternRows.filter((p) => matches(p.raw, filter))

  return (
    <div className="space-y-6">
      {filtered.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-zinc-800">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-zinc-400">Паттерн (запрещён)</TableHead>
                <TableHead className="text-zinc-400">Замена</TableHead>
                <TableHead className="text-zinc-400">Cap</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p, i) => (
                <TableRow key={i} className="border-zinc-800/70">
                  <TableCell className="whitespace-normal font-mono text-xs text-rose-300/90">{p.pattern}</TableCell>
                  <TableCell className="max-w-xs whitespace-normal text-xs leading-relaxed text-zinc-300">{p.replace || '—'}</TableCell>
                  <TableCell>{p.cap && p.cap !== '' ? <Chip tone="amber">{p.cap}</Chip> : <span className="text-zinc-600">—</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : patternRows.length > 0 ? (
        <FilterEmpty filter={filter} />
      ) : null}

      {faceLock && matches(faceLock, filter) ? (
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">face lock</div>
          <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-amber-200/90">{faceLock}</pre>
        </div>
      ) : null}

      {posShape.length > 0 ? (
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">POS shape</div>
          <div className="flex flex-wrap gap-1.5">
            {posShape.map((s, i) => <Chip key={i} tone="amber">{s}</Chip>)}
          </div>
        </div>
      ) : null}

      {Object.keys(wordBudget).length > 0 ? (
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">word budget</div>
          <div className="flex flex-wrap items-center gap-2">
            {Object.entries(wordBudget).map(([k, v]) => {
              const s = asStr(v)
              if (!s) return null
              return (
                <span key={k} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs">
                  <span className="text-zinc-500">{humanizeKey(k)}</span>
                  <span className="font-semibold tabular-nums text-zinc-100">{s}</span>
                </span>
              )
            })}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-4 text-xs text-zinc-500">
        {hedgeBudget ? <span>hedge budget: <span className="font-semibold text-zinc-200">{hedgeBudget}</span></span> : null}
        {qualityTags && matches(qualityTags, filter) ? <span className="max-w-xl">quality tags: <span className="text-zinc-300">{qualityTags}</span></span> : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Generic fallback — renders any json                                 */
/* ------------------------------------------------------------------ */

function GenericValue({ value, depth }: { value: unknown; depth: number }): ReactNode {
  if (value == null) return <span className="text-zinc-600">—</span>
  if (typeof value !== 'object') return <span className="text-zinc-300">{asStr(value)}</span>

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-xs text-zinc-600">пусто</span>
    if (value.every((x) => typeof x !== 'object' || x === null)) {
      return (
        <span className="flex flex-wrap gap-1">
          {value.map((x, i) => <Chip key={i}>{asStr(x)}</Chip>)}
        </span>
      )
    }
    return <GenericTable items={value} depth={depth} />
  }

  const rec = asRecord(value)
  const entries = Object.entries(rec)
  if (entries.length === 0) return <span className="text-xs text-zinc-600">пусто</span>
  if (depth >= 3) {
    return <span className="font-mono text-[11px] text-zinc-500">{JSON.stringify(value)}</span>
  }
  return (
    <div className="space-y-2">
      {entries.map(([k, v]) => (
        <div key={k} className={cn(depth > 0 && 'border-l border-zinc-800 pl-3')}>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">{humanizeKey(k)}</div>
          <div className="mt-0.5 text-xs leading-relaxed">
            <GenericValue value={v} depth={depth + 1} />
          </div>
        </div>
      ))}
    </div>
  )
}

function GenericTable({ items, depth }: { items: unknown[]; depth: number }) {
  const cols: string[] = []
  for (const item of items.slice(0, 20)) {
    for (const k of Object.keys(asRecord(item))) {
      if (!cols.includes(k) && cols.length < 7) cols.push(k)
    }
  }
  if (cols.length === 0) {
    return (
      <div className="space-y-1">
        {items.map((x, i) => <GenericValue key={i} value={x} depth={depth + 1} />)}
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {cols.map((c) => (
              <TableHead key={c} className="text-zinc-400">{humanizeKey(c)}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, i) => (
            <TableRow key={i} className="border-zinc-800/70">
              {cols.map((c) => (
                <TableCell key={c} className="max-w-xs whitespace-normal text-xs text-zinc-400">
                  <GenericValue value={asRecord(item)[c]} depth={depth + 1} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function GenericSpecView({ data, filter }: { data: unknown; filter: string }) {
  if (Array.isArray(data)) {
    const filtered = data.filter((x) => matches(x, filter))
    if (filtered.length === 0) return <FilterEmpty filter={filter} />
    return <GenericTable items={filtered} depth={0} />
  }
  if (!matches(data, filter)) return <FilterEmpty filter={filter} />
  return <GenericValue value={data} depth={0} />
}

/* ------------------------------------------------------------------ */
/* Engine forge — the structure of building new, complex engines        */
/* ------------------------------------------------------------------ */

function ForgeView({ spec, filter }: { spec: unknown; filter: string }) {
  const rec = asRecord(spec)
  const what = asStr(rec.what)
  const ladder = asRecord(rec.complexity_ladder)
  const schema = asRecord(rec.schema)
  const components = asRecord(rec.components)
  const protocol = asArray(rec.assembly_protocol).map(asStr).filter(Boolean)
  const forged = asArray(rec.forged).map(asStr).filter(Boolean)
  const seeds = asArray(rec.open_seeds_waiting).map(asStr).filter(Boolean)

  if (!matches(rec, filter)) return <FilterEmpty filter={filter} />

  return (
    <div className="t4-scroll max-h-96 space-y-5 overflow-y-auto pr-1">
      {what ? (
        <p className="text-xs leading-relaxed text-zinc-400">{what}</p>
      ) : null}

      {forged.length > 0 ? (
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-amber-500/70">
            Кованая тройка · генерация 8
          </div>
          <div className="flex flex-wrap gap-1.5">
            {forged.map((f) => (
              <Chip key={f} tone="amber">{f}</Chip>
            ))}
          </div>
        </div>
      ) : null}

      {Object.keys(ladder).length > 0 ? (
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Лестница сложности
          </div>
          <div className="space-y-1.5">
            {Object.entries(ladder).map(([k, v]) => (
              <div key={k} className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                <span className="font-mono text-[11px] text-amber-300">{humanizeKey(k)}</span>
                <span className="ml-2 text-xs text-zinc-400">{asStr(v)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {protocol.length > 0 ? (
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Протокол сборки
          </div>
          <ol className="space-y-1">
            {protocol.map((p, i) => (
              <li key={i} className="text-xs leading-relaxed text-zinc-400">{p}</li>
            ))}
          </ol>
        </div>
      ) : null}

      {Object.keys(schema).length > 0 ? (
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Схема записи движка
          </div>
          <div className="space-y-1.5">
            {Object.entries(schema).map(([k, v]) => (
              <div key={k} className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                <div className="font-mono text-[11px] text-amber-200">{k}</div>
                <div className="mt-0.5 text-xs leading-relaxed text-zinc-400">{asStr(v)}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {Object.keys(components).length > 0 ? (
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Компоненты (только доказанные)
          </div>
          <div className="space-y-1.5">
            {Object.entries(components).map(([k, v]) => {
              const arr = asArray(v).map(asStr).filter(Boolean)
              return (
                <div key={k} className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                  <div className="font-mono text-[11px] text-amber-200">{humanizeKey(k)}</div>
                  {arr.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {arr.map((x, i) => (
                        <Chip key={i}>{x.length > 90 ? `${x.slice(0, 90)}…` : x}</Chip>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-0.5 text-xs text-zinc-400">{asStr(v)}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {seeds.length > 0 ? (
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Семена в ожидании
          </div>
          <div className="flex flex-wrap gap-1">
            {seeds.map((s, i) => (
              <Chip key={i} tone="rose">{s.length > 80 ? `${s.slice(0, 80)}…` : s}</Chip>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* delivery-stats (рекомендация Claude №2): каналы доставки рейтинга   */
/* ------------------------------------------------------------------ */

function statusChipTone(status: string): 'emerald' | 'rose' | 'amber' | 'zinc' {
  if (status === 'live') return 'emerald'
  if (status === 'dead') return 'rose'
  if (status === 'artifact') return 'amber'
  return 'zinc'
}

const STATUS_LABEL: Record<string, string> = {
  live: 'живой',
  dead: 'мёртвый',
  artifact: 'артефакт',
  special: 'особый',
}

function DeliveryStatsView({ spec, filter }: { spec: unknown; filter: string }) {
  const rec = asRecord(spec)
  const channels = asArray(rec.channels)
    .map(asRecord)
    .filter((c) => matches(c, filter))
  const law = asStr(rec.law)
  const chain = asStr(rec.chain)
  const directive = asStr(rec.compiler_directive)

  const groups: { status: string; label: string }[] = [
    { status: 'live', label: 'Живые — вердиктом доказано' },
    { status: 'dead', label: 'Мёртвые — вердиктом похоронены' },
    { status: 'artifact', label: 'Артефакты' },
    { status: 'special', label: 'Особые' },
  ]

  return (
    <div className="space-y-5">
      {law ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-xs leading-relaxed text-amber-200/90">{law}</p>
          {chain ? <p className="mt-1.5 font-mono text-[11px] text-zinc-400">{chain}</p> : null}
        </div>
      ) : null}

      {groups.map((g) => {
        const items = channels.filter((c) => asStr(c.status) === g.status)
        if (items.length === 0) return null
        return (
          <div key={g.status} className="space-y-2">
            <p className="text-[11px] uppercase tracking-wider text-zinc-500">
              {g.label} · {items.length}
            </p>
            <div className="space-y-2">
              {items.map((c, i) => {
                const attempts = Number(c.attempts ?? 0)
                const delivered = Number(c.delivered ?? 0)
                const pct = attempts > 0 ? Math.round((delivered / attempts) * 100) : null
                const status = asStr(c.status)
                return (
                  <div key={asStr(c.id) || i} className="rounded-md border border-zinc-800 bg-zinc-900/60 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-amber-200/90">{asStr(c.id)}</span>
                      <Chip tone={statusChipTone(status)}>{STATUS_LABEL[status] ?? status}</Chip>
                      {asStr(c.tier) && asStr(c.tier) !== 'any' ? <RatingBadge rating={asStr(c.tier)} /> : null}
                      {attempts > 0 ? (
                        <Chip tone={pct !== null && pct >= 50 ? 'emerald' : pct === 0 ? 'rose' : 'amber'}>
                          {delivered}/{attempts}{pct !== null ? ` · ${pct}%` : ''}
                        </Chip>
                      ) : null}
                    </div>
                    <p className="mt-1.5 text-sm text-zinc-200">{asStr(c.name)}</p>
                    {asStr(c.note) ? <p className="mt-1 text-xs leading-relaxed text-zinc-500">{asStr(c.note)}</p> : null}
                    {asArray(c.evidence).length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {asArray(c.evidence).map((e, j) => (
                          <Chip key={j}>{asStr(e)}</Chip>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {directive ? (
        <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500">Директива компилятору (§10-поправка)</p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">{directive}</p>
        </div>
      ) : null}
      {channels.length === 0 ? <FilterEmpty filter={filter} /> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Filter empty state + entry point                                    */
/* ------------------------------------------------------------------ */

function FilterEmpty({ filter }: { filter: string }) {
  return <EmptyState title={`Ничего не найдено по фильтру «${filter}»`} hint="Попробуйте другой запрос или очистите фильтр." />
}

export function SpecView({ id, spec, filter }: { id: string; spec: unknown; filter: string }) {
  switch (id) {
    case 'carriers':
      return <CarriersView spec={spec} filter={filter} />
    case 'poses':
      return <PosesView spec={spec} filter={filter} />
    case 'palettes':
      return <PalettesView spec={spec} filter={filter} />
    case 'engines':
      return <EnginesView spec={spec} filter={filter} />
    case 'engine-forge':
      return <ForgeView spec={spec} filter={filter} />
    case 'oc-canon':
      return <OcCanonView spec={spec} filter={filter} />
    case 'rating-recipes':
      return <RatingRecipesView spec={spec} filter={filter} />
    case 'rating-techniques':
      return <RatingTechniquesView spec={spec} filter={filter} />
    case 'delivery-stats':
      return <DeliveryStatsView spec={spec} filter={filter} />
    case 'races':
      return <RacesView spec={spec} filter={filter} />
    case 'pools':
      return <PoolsView spec={spec} filter={filter} />
    case 'bans':
      return <BansView spec={spec} filter={filter} />
    default:
      return <GenericSpecView data={spec} filter={filter} />
  }
}

export { FILTER_EMPTY }
