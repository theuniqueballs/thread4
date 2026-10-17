import { getOCCanon } from '../../src/lib/t4/specs'
import { foldState, readEvents } from '../../src/lib/t4/events'

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const canon = getOCCanon()
const ocNames = Object.keys(canon?.ocs ?? {})
console.log('порядок ключей канона (первые 6):', ocNames.slice(0, 6))
console.log('позиция Lucy в ключах канона:', ocNames.indexOf('Lucy'))

const state = foldState(readEvents())
const apps: Record<string, number> = state.ocAppearances ?? {}
console.log('ocAppearances сейчас:', JSON.stringify(Object.fromEntries(
  Object.entries(apps).sort((a, b) => a[1] - b[1]).slice(0, 6)
)))
console.log('served Lucy:', apps['Lucy'] ?? 0)

// симуляция: сортировка shuffle→stable sort ASC по served→slice(0,3)
let lucyFirst = 0, lucyInTrio = 0, N = 2000
for (let s = 0; s < N; s++) {
  const rand = mulberry32(Date.now() + s * 7919)
  const out = [...ocNames]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  const rest = out.sort((a, b) => (apps[a] ?? 0) - (apps[b] ?? 0))
  const trio = rest.slice(0, 3)
  if (trio[0] === 'Lucy') lucyFirst++
  if (trio.includes('Lucy')) lucyInTrio++
}
console.log(`\nсимуляция ${N} сидов: Lucy первая = ${lucyFirst} (${(100 * lucyFirst / N).toFixed(1)}%), Lucy в тройке = ${lucyInTrio} (${(100 * lucyInTrio / N).toFixed(1)}%)`)
