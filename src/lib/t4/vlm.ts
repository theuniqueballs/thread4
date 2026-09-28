/**
 * THREAD 4 — слепой VLM-протокол (§10-поправка), единый для обоих роутов
 * (/api/t4/vlm и /api/t4/feedback?blind=true). Восстановление 2026-09-24
 * разъединило их: панель ждала структурную карточку, а feedback отвечал
 * старой 5-осевой анкетой без детекции фильтра — карточки были пустыми.
 * Один промпт, один парсер, одна детекция контент-фильтра.
 */

export interface BlindCard {
  scene: string
  character: string
  clothing: string
  fabric_state: string
  underlayer: string
  pose: string
  camera: string
  light: string
  signals: string[]
  nipple_read: string
  mutation_drift: string[]
  rating_hint: string
  notes: string
}

export const BLIND_PROMPT = `You are the blind structural first-pass auditor of an anime-art prompt pipeline. Analyze this rendered image honestly. You do NOT know and must NOT guess what was claimed — read only what is visible.

Answer in EXACTLY this format (plain text, no markdown):
SCENE: <one dense line: setting, lighting>
CHARACTER: <hair color+style; special anatomy (horns/ears/scales/tail/wings/seams); skin tone>
WEAR: <every visible garment, named, top-to-bottom>
FABRIC_STATE: <dry / damp / soaked-wet / sheer-see-through / opaque — the state that dominates the claim zones>
UNDERLAYER: <none | named garment — any underwear/underlayer visible or implied>
POSE: <body position, one line>
CAMERA: <angle/framing: close-up, cowboy shot, low-angle, etc.>
LIGHT: <where the light lands — on the body, on fabric, in scenery>
SIGNALS_SEEN: <comma list of erotic signals ACTUALLY visible, e.g. cleavage, panties, upskirt, pantyline, nipples through fabric, topless, bare breasts, none>
NIPPLE_READ: <visible | artifact | covered | none — distinguish anatomical signal from artifact/fold>
MUTATION_DRIFT: <comma list of anatomical/render mutations (extra fingers, fused limbs, warped garment), or none>
RATING_HINT: <PG13 | R | R+ | X — conservative hypothesis, NOT a verdict>
NOTES: <one short sentence, the most important structural fact>`

function field(raw: string, key: string): string {
  const m = new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, 'im').exec(raw)
  return m ? m[1].trim() : ''
}

function list(raw: string, key: string): string[] {
  return field(raw, key)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '' && s.toLowerCase() !== 'none')
}

/** Строгий разбор анкеты → BlindCard (поля совместимы с панелью «Куча»). */
export function parseBlindCard(raw: string): BlindCard {
  return {
    scene: field(raw, 'SCENE'),
    character: field(raw, 'CHARACTER'),
    clothing: field(raw, 'WEAR'),
    fabric_state: field(raw, 'FABRIC_STATE'),
    underlayer: field(raw, 'UNDERLAYER'),
    pose: field(raw, 'POSE'),
    camera: field(raw, 'CAMERA'),
    light: field(raw, 'LIGHT'),
    signals: list(raw, 'SIGNALS_SEEN'),
    nipple_read: field(raw, 'NIPPLE_READ'),
    mutation_drift: list(raw, 'MUTATION_DRIFT'),
    rating_hint: field(raw, 'RATING_HINT').toUpperCase().replace('RPLUS', 'R+'),
    notes: field(raw, 'NOTES'),
  }
}

/** Контент-фильтр провайдера: кадр не принят НА ВХОДЕ (X-кадры, 400/1301). */
export function isProviderBlocked(msg: string): boolean {
  return /contentFilter|1301|系统检测|unsafe|sensitive/i.test(msg)
}
