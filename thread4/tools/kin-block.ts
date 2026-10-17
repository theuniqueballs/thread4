/**
 * kin-block.ts — расовый тег-блок для RAW/RAW+ сборки (возврат кинов, закон №3
 * «race as mechanism, not costume» — раса делает физическую работу в кадре).
 *
 * Контекст (2026-10-11, преемник Фреда): расовый каст потерян в RAW-миграции
 * с T4-23 — генераторы контрактов его не назначали. Данные целы (races.json,
 * 35 юзабельных: 34 active + 2 gold). Этот инструмент — механика тегового
 * возврата по паттерну 32-canon OC_CANON: раса несёт POS-теги + прицельный
 * anti-shield NEG; свет/гардеробные хуки из note — в подсказку писцу.
 *
 * Запуск (из корня репо):
 *   bun thread4/tools/kin-block.ts R03 R17          # блоки для выбранных рас
 *   bun thread4/tools/kin-block.ts R03 --json       # машиночитаемо (генератору)
 *   bun thread4/tools/kin-block.ts --list           # инвентарь с золотом
 *
 * Квота слотов и судьба рас в батче — приказ автора на сборку (§10):
 * инструмент назначение НЕ решает, только собирает блок.
 */
import fs from 'node:fs'

export interface RaceEntry {
  id: string
  name: string
  features: string[]
  status: string
  note?: string
}

/** Прицельный anti-shield NEG по семействам — доказанные NEG-сеты живых батчей
 *  (T4-15: fox/cat/elf/harpy) + консервативные расширения. Ключ — маркер
 *  семейства в имени расы.
 *
 *  Ревизия 2026-10-17 (аудит-находка №6, сдача T4-34): щит живёт в
 *  NEG-ЯЗЫКЕ — только реальные риски дрейфа рендера (что НЕЛЬЗЯ
 *  рисовать). Assert-токены «no X» («no horns» = рога обязаны быть)
 *  после среза префикса в scribe.ts превращались в запрет самой фичи:
 *  NEG суккуба запрещал рога/хвост, NEG медузы — змеи-волосы, NEG
 *  эльфа — ВСЕ уши. Renders спасал только перевес POS (T4-28..T4-33
 *  вердикты PASS), но каждый кин-слот нёс самострел. Assert-семантика
 *  удалена; где был реальный риск — заменён дрейф-гвардом. */
export const FAMILY_SHIELD: { marker: RegExp; neg: string[] }[] = [
  { marker: /kitsune|fox/i, neg: ['human ears', 'dog ears', 'cat ears', 'multiple tails'] },
  { marker: /cat/i, neg: ['human ears', 'dog ears', 'fox ears', 'round pupils'] },
  { marker: /wolf/i, neg: ['human ears', 'dog ears', 'fox ears'] },
  { marker: /bunny|rabbit/i, neg: ['human ears', 'cat ears'] },
  { marker: /elf/i, neg: ['human ears', 'drooping ears', 'fox ears'] },
  { marker: /harpy/i, neg: ['human arms', 'human hands'] },
  { marker: /dragon/i, neg: ['feathered wings', 'broken horns'] },
  { marker: /ram|demon|oni/i, neg: ['human ears'] },
  { marker: /serpent|lamia|naga/i, neg: ['human legs', 'legs'] },
  { marker: /merfolk|mermaid/i, neg: ['human legs', 'legs'] },
  { marker: /cecaelia|octop/i, neg: ['human legs'] },
  { marker: /moth|butterfly/i, neg: ['human arms'] },
  { marker: /bee/i, neg: ['human arms'] },
  { marker: /bat/i, neg: ['human arms'] },
  { marker: /jellyfish/i, neg: ['human ears'] },
  { marker: /shark/i, neg: ['human ears'] },
  { marker: /slime/i, neg: ['solid skin', 'opaque body'] },
  { marker: /frog/i, neg: ['human ears', 'separate fingers', 'normal eyes'] },
  { marker: /flower|petal|plant|vine/i, neg: ['plain human skin'] },
  { marker: /salamander|flame|ember/i, neg: ['normal skin texture'] },
  { marker: /porcelain|doll|bisque|ball-?joint/i, neg: ['normal human skin'] },
  /* R37-R41 (вердикт T4-33 2026-10-17 + приказ 2026-10-17 «циклопы
   * отстой»: R41 заняла Witch-kin): маркеры семей без общего корня —
   * щит по имени в NEG-языке; фичи новых кинов не покрываются
   * shieldFromFeatures (Vampire/Cyclops давали пустой NEG — selftest
   * поймал на живом прогоне). */
  { marker: /succub|incub/i, neg: ['plain human back', 'large demon wings', 'multiple tails'] },
  { marker: /vampir/i, neg: ['normal round pupils', 'warm tanned skin'] },
  { marker: /nephilim|angel|seraph/i, neg: ['black wings', 'dark halo'] },
  { marker: /medusa|gorgon/i, neg: ['human hair', 'round pupils'] },
  /* добор пустого щита (аудит-находка №6, selftest T4-98): расы без
   * маркера получали ПУСТОЙ NEG —Invariant «у каждого кина есть щит»
   * падал. Гварды в NEG-языке против реальных дрейфов рендера. */
  { marker: /deer/i, neg: ['branched antlers', 'animal muzzle', 'fur-covered body'] },
  { marker: /dryad/i, neg: ['bark-covered skin', 'tree-branch arms'] },
  { marker: /gargoyle/i, neg: ['bat wings', 'smooth skin'] },
  { marker: /mushroom|fungus|toadstool|spore/i, neg: ['gills', 'red toadstool cap with white dots'] },
  { marker: /golem/i, neg: ['robot parts', 'metal plating', 'rivets'] },
  { marker: /ghost|spirit|wraith|phantasm/i, neg: ['human legs'] },
  { marker: /phoenix/i, neg: ['beak', 'feathered legs', 'bird claws'] },
  { marker: /arachne|spider/i, neg: ['separate spider abdomen', 'mandibles'] },
  { marker: /witch/i, neg: ['green skin', 'warts', 'crooked hooked nose', 'halloween costume'] },
]

/** anti-shield, выведенный из features, когда семейство не опознано.
 *  Ревизия 2026-10-17 (аудит-находка №6): НИКОГДА не эмитим assert-токены
 *  «no X» — scribe срезает префикс, и NEG запрещает фичу самой расе
 *  (хвост кота, рога демона, крылья гарпии). Остаются только
 *  дрейф-гварды: что рендер НЕ должен подставить вместо фичи. */
export function shieldFromFeatures(features: string[]): string[] {
  const out: string[] = []
  const all = features.join(' ').toLowerCase()
  if (/ears?\b/.test(all)) out.push('human ears')
  if (/pupil/.test(all)) out.push('round pupils')
  if (/webbed/.test(all)) out.push('separate fingers')
  if (/glossy|wide eyes/.test(all)) out.push('normal eyes')
  return out
}

/** POS-токены вида из имени: «Kitsune (fox-kin)» → fox girl, kitsune. */
export function posTokensFromName(name: string): string[] {
  const paren = /\((.+?)\)/.exec(name)?.[1] ?? ''
  const core = name.replace(/\s*\(.*\)\s*/, '').trim()
  const out = new Set<string>()
  const pushKin = (s: string) => {
    const base = s.replace(/-?\s*kin/i, '').trim().toLowerCase()
    if (!base) return
    out.add(`${base} girl`)
    out.add(base)
  }
  if (/-kin/i.test(core)) pushKin(core)
  else out.add(core.toLowerCase())
  if (paren) {
    if (/-kin/i.test(paren)) pushKin(paren)
    else paren
      .split(/[,/]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .forEach((s) => out.add(s))
  }
  out.delete('human')
  return [...out]
}

export function buildBlock(r: RaceEntry) {
  const family = FAMILY_SHIELD.find((f) => f.marker.test(r.name))
  const shield = family ? family.neg : shieldFromFeatures(r.features)
  const tokens = posTokensFromName(r.name)
  const feats = r.features
    .filter((f) => !/sol|lock|forbid/i.test(f)) // SOL-LOCKED фичи — запреты, не POS
    .slice(0, 3)
    .map((f) => f.toLowerCase().split(' — ')[0].trim())
    .filter(Boolean)
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    pos: [...tokens, ...feats].join(', '),
    neg: [...new Set(shield)].join(', '),
    hook: r.note ?? '',
  }
}

/** Пул юзабельных рас из спеки (active + gold; баны и Human исключаются
 *  по месту). Экспорт — для RAW+ генератора (кины в конвейер, закон №3). */
export function loadRaces(specPath = 'thread4/specs/races.json'): RaceEntry[] {
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8')) as { races: RaceEntry[] }
  return spec.races.filter(
    (r) =>
      (r.status === 'active' || r.status === 'gold') &&
      r.name.toLowerCase() !== 'human'
  )
}

function main() {
  const args = process.argv.slice(2)
  const asJson = args.includes('--json')
  const ids = args.filter((a) => !a.startsWith('--'))
  const spec = { races: JSON.parse(fs.readFileSync('thread4/specs/races.json', 'utf-8')).races } as {
    races: RaceEntry[]
  }
  const pool = spec.races.filter((r) => r.status === 'active' || r.status === 'gold')

  if (ids.includes('--list') || ids.length === 0) {
    console.log(
      `Инвентарь: ${pool.length} юзабельных (${spec.races.filter((r) => r.status === 'active').length} active · ${spec.races.filter((r) => r.status === 'gold').length} gold)`
    )
    for (const r of pool) console.log(`  ${r.id}  ${r.status === 'gold' ? '★ ' : '  '}${r.name}`)
    console.log('\nИспользование: bun thread4/tools/kin-block.ts R03 R17 [--json]')
    return
  }

  const blocks: { id: string; name: string; status: string; pos: string; neg: string; hook: string }[] = []
  for (const id of ids) {
    const r = spec.races.find((x) => x.id === id)
    if (!r) {
      console.error(`Неизвестный ID: ${id} (см. --list)`)
      process.exit(1)
    }
    if (r.status === 'banned') {
      console.error(`${id} ${r.name} — ЗАБАНЕН автором, блок не собирается`)
      process.exit(1)
    }
    if (r.name.toLowerCase() === 'human') {
      console.error(`${id} Human — раса без признаков: слот не тратим (races.json R01, компилятор тоже исключал)`)
      process.exit(1)
    }
    blocks.push(buildBlock(r))
  }

  if (asJson) {
    console.log(JSON.stringify(blocks, null, 2))
    return
  }
  for (const b of blocks) {
    console.log(`\n${b.id} · ${b.name}${b.status === 'gold' ? '  ★ золото автора' : ''}`)
    console.log(`POS : ${b.pos}`)
    console.log(`NEG : ${b.neg}`)
    if (b.hook) console.log(`HOOK: ${b.hook}`)
  }
  console.log('\n(квота рас в батче — приказ автора на сборке, §10; блок = механика закона №3)')
}

if (import.meta.main) main()
