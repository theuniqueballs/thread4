/**
 * THREAD 4 ENGINE — CODE-AS-CONFIG (deprecation of raw JSON specs).
 *
 * The canon below is the ONE source of truth for the engine core. It is
 * TypeScript, validated by Zod at boot (see ./schema.ts): a broken canon
 * kills the boot before the server accepts a single request. Values are
 * ported verbatim from the retired file-based pipeline:
 *   - law numbers:  thread4/specs/policy.json  (law.*)
 *   - floors:       thread4/specs/rating-recipes.json (eternal_floors)
 *   - palettes:     thread4/specs/palettes.json (fund / window / extension)
 *   - verdicts:     src/lib/t4/events.ts (VERDICT_SOURCES, CONFIDENCE_LEVELS)
 *   - event types:  src/lib/t4/events.ts (EVENT_TYPES)
 * History is law here: every constant cites its origin.
 */
import { z } from 'zod'

/* ------------------------------------------------------------------ */
/* Event identity — the chronicle vocabulary (ported, closed set)      */
/* ------------------------------------------------------------------ */

export const EVENT_TYPES = [
  'era.born',
  'spec.imported',
  'law.ratified',
  'law.amended',
  // Фаза 2, итерация 3 (2026-10-21): canon parity — bridge.compiled (TS
  // итерация 2, WRITE-мост) + consciousness.switched (квитанция осознанного
  // переключения источника сознания: file JSONL → живой движок).
  'consciousness.switched',
  'batch.compiled',
  'bridge.compiled',
  'batch.delivered',
  'batch.void',
  'gate.run',
  'fixpass.paid',
  'scribe.drafted',
  'render.verdict',
  'taste.datum',
  'experiment.logged',
  'oc.appeared',
  'external.review',
  'debt.paid',
  'author.pinned',
  'channel.retired',
  'scribe.objection',
  'oracle.spoke',
  'note',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

/** Verdict sources — enum instead of prose (Issue #1, 2026-09-26). */
export const VERDICT_SOURCES = [
  'vlm',
  'author',
  'author-batch',
  'author-verbatim',
  'author-oc',
] as const

export type VerdictSource = (typeof VERDICT_SOURCES)[number]

/** Confidence of author verdicts (Issue #4): direct | described. */
export const CONFIDENCE_LEVELS = ['direct', 'described'] as const

export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]

/* ------------------------------------------------------------------ */
/* The canon                                                            */
/* ------------------------------------------------------------------ */

export const RATINGS = ['PG-13', 'R', 'R+', 'X'] as const
export type Rating = (typeof RATINGS)[number]

export const REGISTERS = ['student', 'young', 'milf'] as const
export type Register = (typeof REGISTERS)[number]

export const SLOT_KINDS = ['OC', 'MAIN', 'NICHE', 'EXP'] as const
export type SlotKind = (typeof SLOT_KINDS)[number]

/** Engine rotation policies (policy.json engines.*). */
export const ENGINE_MODES = ['per-theme', 'per-theme raw-plus'] as const
export type EngineMode = (typeof ENGINE_MODES)[number]

export const CANON = {
  era: 'THREAD 4',
  /** Constitution + canon versions (canon v1.9.0 + FAM v2.3.0). */
  version: '1.9.0',
  fam: '2.3.0',
  constitution: { version: '1.0.0', doc: 'thread4/CONSTITUTION.md' },
  /** Ratified laws the engine enforces mechanically. */
  laws: [
    { n: 27, name: 'ТОН-НЕ-ЩИТ', note: 'тон несущей вещи на зоне заявки: through-заявка живёт только на dark' },
    { n: 28, name: 'ПРОСВЕТ-ЧЁТКОСТЬ', note: 'видимость окна палитр честна в квитанции' },
    { n: 29, name: 'ДРЕСС-КОД', note: 'дресс-код слота назначается контрактом' },
  ],
  /** Slot law (policy.json law.*): 24 core = 3 OC + 21 mains (7 NICHE + 14 R+ mains). */
  slots: {
    total: 24,
    ocSlots: 3,
    mainsTotal: 21,
    nicheCount: 7,
    rplusMains: 14,
    xSlots: 0,
    expMax: 9,
    expDefault: 8,
    interleave: true,
  },
  /** A/B pairs (policy.json ab.*): exactly one variable, 2..3 pairs. */
  ab: { min: 2, max: 3, oneVariable: true },
  /** Palette law (palettes.json): fund P01..P105, extension P106..P120
   *  reserved for the EXP budget so a zero-overlap window of 3 batches
   *  cannot starve 9 EXP slots; rotation without repetition in a batch. */
  palette: {
    fund: 105,
    firstId: 1,
    lastId: 105,
    extensionFirstId: 106,
    extensionLastId: 120,
    windowBatches: 3,
    distinctInBatch: true,
  },
  /** Batch verdict metric window: 24 core + EXP overlay = observable slots. */
  verdict: {
    slotsMetric: 32, // 24 + 8 (T4-34 author-batch verdict shape)
    singleRecord: true, // render.verdict · author-batch: одна запись на батч
  },
  /** Eternal floors (rating-recipes.json eternal_floors) — token bans. */
  floors: {
    anti_loli: [
      'child', 'children', 'childish', 'chibi', 'young girl',
      'immature body', 'oversized head', 'loli', 'shota',
    ],
    leak_guard: ['signature', 'watermark', 'artist name', 'logo'],
    candle_guard: [
      'candle', 'candles', 'candelabra', 'lamp', 'lantern',
      'torch', 'chandelier', 'brazier',
    ],
    face_guard: [
      'realistic facial structure', 'photorealistic facial proportions',
      'natural human nose bridge', 'realistic lip shape',
    ],
  },
  /** EXP program (batch verdict T4-34): machine stubs, zero scribe discretion.
   *  THESIS opens with the radar marker `EXP <letter>-<half> · hypothesis`. */
  expProgram: {
    letters: ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι'],
    hypothesisTemplates: [
      'проверка закона №27: тон несущей вещи против зоны заявки',
      'проверка закона №28: окно палитр против свежести EXP-бюджета',
      'проверка закона №29: дресс-код против категории сцены',
      'проверка A/B: ровно одна переменная решает кадр (T4-27.2)',
      'проверка флооров: вечные баны держат строку POS',
      'проверка ротации: палитры не повторяются в батче',
      'проверка каденса: слоты не эхо соседей',
      'проверка границ: NICHE-свидетель держит невозможное',
      'проверка чистоты: болванка без тема-слов (вердикт T4-34)',
    ],
  },
  /** Chain of custody (Залп 1 «Правда»): hash = sha256(prev + '|' + rawLine). */
  chain: { genesis: 'GENESIS', algorithm: 'sha256' },
  /** Engine serve binding — fixed port, loopback only (Caddy :81 forwards
   *  ?XTransformPort=3200). Never change to process.env.PORT: the gateway
   *  boundary is declared, not accidental. */
  serve: { port: 3200, hostname: '127.0.0.1', maxBodyBytes: 1_048_576 },
  /** Snapshot doctrine: state changes are git-committed (debounced). */
  persist: { debounceMs: 800, stagePath: 'mini-services/t4-engine' },
} as const

/* ------------------------------------------------------------------ */
/* Boot-time validation: the canon must parse or the engine refuses    */
/* to start. A config that does not typecheck is not a config.         */
/* ------------------------------------------------------------------ */

export const CanonSchema = z.object({
  era: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  fam: z.string().regex(/^\d+\.\d+\.\d+$/),
  constitution: z.object({ version: z.string(), doc: z.string() }),
  laws: z.array(z.object({ n: z.number().int().positive(), name: z.string(), note: z.string() })),
  slots: z.object({
    total: z.number().int().positive(),
    ocSlots: z.number().int().positive(),
    mainsTotal: z.number().int().positive(),
    nicheCount: z.number().int().nonnegative(),
    rplusMains: z.number().int().nonnegative(),
    xSlots: z.number().int().nonnegative(),
    expMax: z.number().int().nonnegative(),
    expDefault: z.number().int().nonnegative(),
    interleave: z.boolean(),
  }),
  ab: z.object({ min: z.number().int(), max: z.number().int(), oneVariable: z.boolean() }),
  palette: z.object({
    fund: z.number().int().positive(),
    firstId: z.number().int().positive(),
    lastId: z.number().int().positive(),
    extensionFirstId: z.number().int().positive(),
    extensionLastId: z.number().int().positive(),
    windowBatches: z.number().int().positive(),
    distinctInBatch: z.boolean(),
  }),
  verdict: z.object({ slotsMetric: z.number().int().positive(), singleRecord: z.boolean() }),
  floors: z.object({
    anti_loli: z.array(z.string()),
    leak_guard: z.array(z.string()),
    candle_guard: z.array(z.string()),
    face_guard: z.array(z.string()),
  }),
  expProgram: z.object({
    letters: z.array(z.string()),
    hypothesisTemplates: z.array(z.string()),
  }),
  chain: z.object({ genesis: z.string(), algorithm: z.literal('sha256') }),
  serve: z.object({
    port: z.number().int().min(1024).max(65535),
    hostname: z.string().min(1),
    maxBodyBytes: z.number().int().positive(),
  }),
  persist: z.object({ debounceMs: z.number().int().positive(), stagePath: z.string() }),
})

/** Canonical law arithmetic the whole engine agrees on (one truth). */
export function slotLawChecks(c: typeof CANON): string[] {
  const problems: string[] = []
  if (c.slots.ocSlots + c.slots.mainsTotal !== c.slots.total) {
    problems.push(`canon: ocSlots(${c.slots.ocSlots}) + mainsTotal(${c.slots.mainsTotal}) != slots.total(${c.slots.total})`)
  }
  if (c.slots.nicheCount + c.slots.rplusMains !== c.slots.mainsTotal) {
    problems.push(`canon: nicheCount + rplusMains != mainsTotal`)
  }
  if (c.palette.lastId - c.palette.firstId + 1 !== c.palette.fund) {
    problems.push(`canon: palette id span != fund`)
  }
  if (c.palette.extensionFirstId !== c.palette.lastId + 1) {
    problems.push(`canon: palette extension must start right after the fund`)
  }
  if (c.expProgram.letters.length < c.slots.expMax) {
    problems.push(`canon: exp letters must cover expMax slots`)
  }
  if (c.slots.expDefault > c.slots.expMax) {
    problems.push(`canon: expDefault > expMax`)
  }
  if (c.ab.min > c.ab.max) {
    problems.push(`canon: ab.min > ab.max`)
  }
  return problems
}

/** Full boot check: zod parse + arithmetic invariants. Throws on any drift. */
export function validateCanon(): { canon: typeof CANON } {
  const parsed = CanonSchema.safeParse(CANON)
  if (!parsed.success) {
    throw new Error(
      `canon invalid (Code-as-Config failed boot validation): ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`
    )
  }
  const arithmetic = slotLawChecks(CANON)
  if (arithmetic.length > 0) {
    throw new Error(`canon arithmetic broken: ${arithmetic.join('; ')}`)
  }
  return { canon: CANON }
}
