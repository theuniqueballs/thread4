/**
 * THREAD 4 ENGINE — Zod schemas for every RPC payload.
 *
 * Rigid "Code-as-Config" boundary: requests that do not parse NEVER reach
 * the core. All objects are strict (unknown keys are rejected, not
 * ignored) — the failure mode of the file era (silent extra fields,
 * typos, prose where an enum belongs) is structurally impossible now.
 */
import { z } from 'zod'

import {
  CANON,
  CONFIDENCE_LEVELS,
  ENGINE_MODES,
  EVENT_TYPES,
  RATINGS,
  REGISTERS,
  SLOT_KINDS,
  VERDICT_SOURCES,
} from './canon'

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

/** Batch slug: T4-NN (two digits, historical) or T4-NNN going forward. */
export const SlugSchema = z
  .string()
  .regex(/^T4-\d{2,3}$/, 'slug must look like T4-34 / T4-105')
  .max(8)

const ThemeSchema = z.string().trim().min(1).max(120)
const NonEmptyLine = z.string().trim().min(1).max(4000)

/** Idempotency keys: opaque, bounded, no control chars. */
export const IdempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]{8,128}$/, 'Idempotency-Key must be 8..128 chars of [A-Za-z0-9._-]')

/** Race ids: R## (races.json vocabulary). */
const RaceIdSchema = z.string().regex(/^R\d{2}$/, 'race id must look like R37')

/* ------------------------------------------------------------------ */
/* POST /v1/compile — the compilation request                           */
/* ------------------------------------------------------------------ */

const OcThemeSchema = z.strictObject({
  theme: z.string().trim().min(1).max(120),
  rating: z.enum(RATINGS),
  wishes: z.string().max(600).optional(),
  position: z.number().int().min(1).max(CANON.slots.ocSlots),
})

export const CompileRequestSchema = z.strictObject({
  /** Optional override; omit to auto-assign the next free number. */
  slug: SlugSchema.optional(),
  theme: ThemeSchema,
  engine: z.enum(ENGINE_MODES).default('per-theme'),
  /** EXP overlay slots: 0 (explicit order) .. expMax. Default: expDefault. */
  exp: z
    .number()
    .int()
    .min(0)
    .max(CANON.slots.expMax)
    .default(CANON.slots.expDefault),
  abPairs: z
    .number()
    .int()
    .min(CANON.ab.min)
    .max(CANON.ab.max)
    .default(CANON.ab.min),
  species: z
    .strictObject({
      on: z.boolean(),
      count: z.number().int().min(0).max(CANON.slots.total),
      list: z.array(RaceIdSchema).max(CANON.slots.total),
    })
    .default({ on: false, count: 0, list: [] }),
  ocThemes: z.array(OcThemeSchema).min(1).max(CANON.slots.ocSlots),
  notes: z.string().max(2000).optional(),
})

export type CompileRequest = z.infer<typeof CompileRequestSchema>

/* ------------------------------------------------------------------ */
/* POST /v1/verdicts — batch verdicts (single record per batch+kind)    */
/* ------------------------------------------------------------------ */

export const VerdictRequestSchema = z.strictObject({
  slug: SlugSchema,
  verdict: z.enum(['PASS', 'FAIL', 'WARN']),
  /** Event identity (Issue #1): enum, never prose. */
  source: z.enum(VERDICT_SOURCES),
  /** author* sources must state confidence (Issue #4). */
  confidence: z.enum(CONFIDENCE_LEVELS).optional(),
  metrics: z
    .strictObject({
      slots: z.number().int().min(0).max(64).optional(),
      diffUp: z.number().int().min(0).max(64).optional(),
      diffDown: z.number().int().min(0).max(64).optional(),
    })
    .optional(),
  note: z.string().max(4000).optional(),
})

export type VerdictRequest = z.infer<typeof VerdictRequestSchema>

/* ------------------------------------------------------------------ */
/* POST /v1/events — generic chronicle append (note, oracle.spoke, …)   */
/* ------------------------------------------------------------------ */

export const AppendEventRequestSchema = z.strictObject({
  type: z.enum(EVENT_TYPES),
  summary: NonEmptyLine,
  data: z.record(z.string(), z.unknown()).optional(),
})

export type AppendEventRequest = z.infer<typeof AppendEventRequestSchema>

/* ------------------------------------------------------------------ */
/* GET /v1/events — query params                                        */
/* ------------------------------------------------------------------ */

export const EventsQuerySchema = z.strictObject({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  type: z.enum(EVENT_TYPES).optional(),
})

export type EventsQuery = z.infer<typeof EventsQuerySchema>

/* ------------------------------------------------------------------ */
/* Slot plan (compile output) — the machine half of the contract        */
/* ------------------------------------------------------------------ */

export const SlotPlanSchema = z.strictObject({
  position: z.number().int().min(1).max(CANON.slots.total + CANON.slots.expMax),
  kind: z.enum(SLOT_KINDS),
  rating: z.enum(RATINGS),
  register: z.enum(REGISTERS),
  ocTheme: z.string().max(120).optional(),
  race: RaceIdSchema.optional(),
  /** Fund palette (P001..P105) for core slots, extension (P106..P120) for EXP. */
  paletteId: z.string().regex(/^P\d{3}$/, 'palette id must look like P037'),
  /** A/B pair membership (exactly one variable per pair — law `ab`). */
  ab: z
    .strictObject({
      pair: z.number().int().min(1).max(CANON.ab.max),
      half: z.enum(['A', 'B']),
    })
    .optional(),
  /** EXP program (machine stub, verdict T4-34): marker + hypothesis. */
  exp: z
    .strictObject({
      letter: z.string().min(1).max(2),
      half: z.enum(['A', 'B']),
      pairWith: z.number().int().min(1).optional(),
      hypothesis: z.string().min(1).max(400),
    })
    .optional(),
})

export type SlotPlan = z.infer<typeof SlotPlanSchema>

export const BatchPlanSchema = z.strictObject({
  slug: SlugSchema,
  title: z.string().min(1).max(120),
  theme: z.string().min(1).max(120),
  engine: z.enum(ENGINE_MODES),
  seed: z.string().regex(/^[0-9a-f]{16}$/),
  slots: z.array(SlotPlanSchema).min(1).max(CANON.slots.total + CANON.slots.expMax),
  exp: z.number().int().min(0).max(CANON.slots.expMax),
  abPairs: z.number().int().min(0).max(CANON.ab.max),
  paletteWindow: z.strictObject({
    union: z.number().int().min(0),
    budget: z.number().int().min(0),
    extensionFree: z.number().int().min(0),
  }),
  receipts: z.array(
    z.strictObject({
      gate: z.string().min(1),
      level: z.enum(['hard', 'warn', 'advisory']),
      verdict: z.enum(['PASS', 'FAIL', 'WARN', 'REPORT']),
      findings: z.array(z.string().max(600)),
      notes: z.array(z.string().max(600)).optional(),
    })
  ),
  diff: z.strictObject({
    up: z.number().int().min(0),
    down: z.number().int().min(0),
    against: SlugSchema.nullable(),
  }),
  sha10: z.string().regex(/^[0-9a-f]{10}$/),
  createdAt: z.string().datetime(),
})

export type BatchPlan = z.infer<typeof BatchPlanSchema>
