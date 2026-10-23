import { planToContract } from '../../../src/lib/t4/write-bridge'
const mkPlan = () => ({ slug: 'T4-43', sha10: '96a88693e6', theme: 'MIDNIGHT PROBE', engine: 'probe', seed: '12345', slots: [
  { position: 1, kind: 'OC', rating: 'R+', register: 'student', ocTheme: 'Caught changing', paletteId: 'P089' },
  { position: 2, kind: 'OC', rating: 'R+', register: 'young', ocTheme: 'Executioner', paletteId: 'P052' },
  { position: 3, kind: 'OC', rating: 'R+', register: 'milf', ocTheme: 'Tentacles tease', paletteId: 'P074' },
  ...Array.from({ length: 14 }, (_, i) => ({ position: 4 + i, kind: 'MAIN', rating: 'R+', register: 'young', paletteId: `P0${(17 + i).toString().padStart(2, '0')}` })),
  ...Array.from({ length: 8 }, (_, i) => ({ position: 25 + i, kind: 'EXP', rating: 'R+', register: 'student', paletteId: `P1${(10 + i).toString().padStart(2, '0')}` })),
] as Parameters<typeof planToContract>[0]['slots'] })
const r = planToContract(mkPlan(), { slug: 'T4-43', state: { batches: [], windowSlugs: [], ocAppearances: {}, ocLastSeen: {}, voidedSlugs: [] }, cascade: null, usedExpLetters: [], now: '2026-10-20T12:00:00.000Z' })
for (const s of r.contract.slots.filter(x => x.dress?.channel === 'bumps')) {
  console.log(`P${s.position} ${s.kind} tone=${s.fabricTone} garment="${s.dress?.garment}"`)
}
