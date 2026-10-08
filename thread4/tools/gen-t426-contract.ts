/**
 * T4-26 «THE OTHER VERSION» — генератор контракта из батча (прецедент T4-25:
 * контракт собирается из распарсенного RAW-батча: стеки/шапки/тиры синхронны).
 * Запуск: bun thread4/tools/gen-t426-contract.ts
 */
import { parseBatch } from '../../src/lib/t4/gates'
import { contractMarkdown } from '../../src/lib/t4/compiler'
import { writeJson, writeText } from '../../src/lib/t4/fsutil'
import fs from 'node:fs'
import path from 'node:path'

const slug = 'T4-26'
const text0 = fs.readFileSync(`thread4/batches/${slug}.md`, 'utf-8')
const batch = parseBatch(slug, text0)
if (!batch || batch.slots.length !== 33) {
  console.error('parse failed or slots != 33:', batch?.slots.length)
  process.exit(1)
}

/* carriers.json: id → {name, cls} */
const carriersSpec = JSON.parse(fs.readFileSync('thread4/specs/carriers.json', 'utf-8'))
const carrierById: Record<string, { id: string; name: string; cls: string }> = {}
for (const list of Object.values(carriersSpec.classes as Record<string, unknown[]>)) {
  if (!Array.isArray(list)) continue
  for (const c of list as { id: string; name: string }[]) {
    carrierById[c.id] = { id: c.id, name: c.name, cls: /^CR-([A-Z])/.exec(c.id)?.[1] ?? '?' }
  }
}

/* H1 → title */
const text = fs.readFileSync(`thread4/batches/${slug}.md`, 'utf-8')
const h1 = /^#\s*(.+)$/m.exec(text)?.[1] ?? ''
const title = (/\u00AB(.+?)\u00BB/.exec(h1)?.[1]) ?? slug

const AB: Record<number, { pair: string; half: string; withSlot: number; lead: string }> = {
  25: { pair: 'δ', half: 'A', withSlot: 26, lead: 'H7 NEG-смежность (закон №14): старый NEG (nipples exposed, areola) vs v1.5.0-чистый — тот же кадр фонтана' },
  26: { pair: 'δ', half: 'B', withSlot: 25, lead: 'H7 NEG-смежность (закон №14): старый NEG (nipples exposed, areola) vs v1.5.0-чистый — тот же кадр фонтана' },
  27: { pair: 'ε', half: 'A', withSlot: 28, lead: 'H8 NATURAL-протокол (закон №15): кластер тегов веса/мягкости vs чистый пресс — тот же кадр багажника' },
  28: { pair: 'ε', half: 'B', withSlot: 27, lead: 'H8 NATURAL-протокол (закон №15): кластер тегов веса/мягкости vs чистый пресс — тот же кадр багажника' },
  29: { pair: 'ζ', half: 'A', withSlot: 30, lead: 'H9 braless-токен (закон №16): braless + nothing underneath vs только фраза — та же утренняя растяжка' },
  30: { pair: 'ζ', half: 'B', withSlot: 29, lead: 'H9 braless-токен (закон №16): braless + nothing underneath vs только фраза — та же утренняя растяжка' },
}

const slots = batch.slots.map((s) => {
  const isExp = s.genre === 'EXP'
  return {
    position: s.position,
    kind: s.genre,
    oc: s.oc ?? '',
    rating: s.meta.includes('R+') ? 'R+' : s.meta.includes('PG-13') ? 'PG-13' : /\bR\b/.test(s.meta) ? 'R' : s.meta.includes('X') ? 'X' : '',
    pose: '',
    poseName: s.anchor,
    poseRisk: '',
    palette: '',
    paletteName: '',
    kinetics: [],
    carriers: s.stack.map((id) => carrierById[id]).filter(Boolean),
    lead: '',
    register: s.genre === 'OC' ? 'oc' : isExp ? 'exp-blank' : 'student',
    closer: '',
    ...(isExp
      ? {
          exploratory: 'EXP-слот (болванка без темы): гипотеза названа в THESIS слота батча',
          ...(AB[s.position] ? { ab: AB[s.position] } : {}),
        }
      : {}),
  }
})

const contract = {
  slug,
  theme: title,
  engine: 'THE OTHER VERSION',
  engineLaw:
    'одноразовый движок: у всего в этом мире есть вторая версия — версия для своих, версия на скорость, версия навыворот; каждый кадр — момент, когда в объектив попала именно другая версия. Носитель закона — конкретный предмет кадра. После батча утилизируется',
  engineWhy:
    'тема-реакция (законы №17/№18 из манифеста автора P17 T4-25): VOLT-слоты показывают «другую версию» через тело в моменте, NICHE — через невозможный мир вокруг героини',
  seed: Date.now(),
  createdAt: new Date().toISOString(),
  spread: [
    { rating: 'R+', count: slots.filter((s) => s.rating === 'R+').length },
    { rating: 'R', count: slots.filter((s) => s.rating === 'R').length },
  ],
  slots,
  ocRotation: {
    note: 'заказ автора 2026-10-08: темы ОС — MEGAMARE (Lua), All for One из MHA (Ana), Spectre Ghost (Ash); отдельны от основной темы батча; каждая OC-тема несёт канал-канон (формула oc-rplus из карты T4-25)',
    ocs: ['Lua', 'Ana', 'Ash'],
  },
  racialCount: { note: 'RAW/данбуру: расовый каст не назначается (T4-23 ORDER) — слайс-жизненные мейны' },
  abPairs: [
    { pair: 'δ', a: 25, b: 26, lead: AB[25].lead },
    { pair: 'ε', a: 27, b: 28, lead: AB[27].lead },
    { pair: 'ζ', a: 29, b: 30, lead: AB[29].lead },
  ],
  carrierStats: {
    note: 'стеки назначены вручную по TRIAL-2 (M8-M14): каждый R+ слот = 1 FABRIC(W) + 1 BODY + 1 POSITION + 1 PHYSICS; EXP-оверлей — 9 слотов поверх 24-слотового закона',
    wSharePct: Math.round((slots.flatMap((s) => s.carriers).filter((c) => c.cls === 'W').length / (33 * 4)) * 100),
  },
  windowSlugs: [],
  channelStats: {
    note: 'RAW/данбуру: канал — тег-ран, проза отсутствует по приказу (T4-23 ORDER). R+ только на живых каналах (M13): tape ×2, contact ×7, натяжение ×2, handbra ×3, pantyline ×1, wet-sheer только EXP ι',
  },
  platform: 'yodayo',
  laws: [
    '24-слотовый закон (3 OC + 21 мейн, вердикт T4-02) + EXP-оверлей ≤9 слотов ПОВЕРХ, отдельно от мейнов (law.expSlotsMax — приказ-уточнение автора 2026-10-08)',
    'Спред мейнов канона T4-23/policy: R+×14 · R×7 (12 VOLT R+ · 7 NICHE R · 2 EXQUISITE R+)',
    'TRIAL-2 (вердикт T4-25, законы №13-19): M8 NATURAL · M9 NEG-гигиена (рецепт v1.5.0) · M10 braless-токен + паразит-гигиена · M11 VOLT-телесность · M12 NICHE-мир (быт запрещён) · M13 R+ только на живых каналах · M14 смерть гипотез H3/H4',
    'Milf-квота N30: 1/33 (Ana); X-слоты изъяты (вердикт «эччи > порно»)',
  ],
}

writeJson(path.join('thread4/contracts', `${slug}.json`), contract)

/* Рукописный md по прецеденту T4-25.md */
const md = `# T4-26 «THE OTHER VERSION» — КОНТРАКТ (ручной, под RAW-батч)

**Составлен**: Фред, 2026-10-08 · **Приказ автора**: 21 мейн по теме THE OTHER VERSION
+ 3 ОС из канона с темами MEGAMARE (Lua) · All for One — Supervillain из MHA (Ana) ·
Spectre Ghost (Ash) + 9 EXP — «только нормальные гипотезы» (без тупой хуйни: каждая
гипотеза растёт из квитанции вердикта T4-25).
**Анализ-основа**: док VERDICT-MAP-T4-25-2026-10-08 — TRIAL-2 меры M8-M14 применены
и перечислены в шапке батча; рецепт v1.5.0 (закон №14 NEG-смежности).

## Движок (одноразовый)

**THE OTHER VERSION** — у всего в этом мире есть вторая версия: версия для своих,
версия на скорость, версия навыворот. Публика видит первую; каждый кадр батча —
момент, когда в объектив попала другая версия. Носитель — конкретный предмет
кадра. Утилизируется после батча.

## Структура

| Сегмент | Слоты | Заявки |
|---|---|---|
| OC (темы автора, из канона) | P01 Lua «MEGAMARE» · P02 Ana «All for One» · P03 Ash «Spectre Ghost» | R+ ×3 |
| Мейн VOLT | P04 аквариум · P05 переноска-кот · P06 бильярд · P07 мото-бак · P08 саронг · P09 сцена-лента · P10 васи-решётка · P11 краска-джерси · P12 коробки · P13 белые леггинсы · P14 кимоно · P15 пилон | R+ ×12 |
| Мейн NICHE | P16 белье-дождь · P17 зеркало-спина · P18 боковая гравитация · P19 летающие книги · P20 лужа-город · P21 дверь-пляж · P22 луна-шарик | R ×7 |
| Мейн EXQUISITE | P23 живая Венера · P24 сараси-оби | R+ ×2 |
| EXP (оверлей, без темы) | P25-P33 | R+ ×8 · R ×1 |

Счёт заявок: **R+ 25 · R 8 · X 0** (мейны: R+×14 · R×7 — спред канона T4-23/policy).
Milf-квота: 1/33 (Ana). Салиенс-прогноз: 1/25 под угрозой (T4-25 нёс 11/20).

## ОС-темы (заказ автора, отдельно от основной; формула oc-rplus: тема несёт канал-канон)

- **MEGAMARE R+** — Lua: мега-кобыла из чёрной воды (конь в рост маяка) выносит её
  из ночного моря; грудь вжата в струящуюся гриву — контакт-канал + NATURAL.
- **All for One R+** — Ana: золотая суверен-злодейка; город отдал всё золото, на
  платье не хватило — оперные перчатки как единственный лиф: handbra-канал (H6).
- **Spectre Ghost R+** — Ash: призрак-хранительница наполовину в монастырской стене;
  грудь вжата в край кладки — контакт-канал + невозможная геометрия фазинга.

## EXP-программа (9 слотов, оверлей — отдельно от мейнов, без темы)

| Слот | Гипотеза | Переменная |
|---|---|---|
| P25/P26 (пара δ) | H7 NEG-смежность (закон №14): старый NEG vs v1.5.0-чистый | блок NEG |
| P27/P28 (пара ε) | H8 NATURAL-протокол (закон №15): кластер тегов тела vs чистый пресс | NATURAL-теги |
| P29/P30 (пара ζ) | H9 braless-токен (закон №16): braless+фраза vs только фраза | один токен |
| P31 | η handbra-ДОБОР (n=1→3): ладони в пене; суб-гипотеза субстанции | канал H6 |
| P32 | θ underwear-ДОБОР (P12 ↑1): конвент-авария, честная заявка R | канал P12 |
| P33 | ι wet-sheer ПОЛНАЯ §9-цепь (последняя sheer-попытка, M13) | свет+поза+вещь |

## Законы

- 24-слотовый (3 OC + 21 мейн) + EXP-оверлей ≤9 (law.expSlotsMax).
- TRIAL-2 (вердикт T4-25, законы №13-19): M8 NATURAL · M9 NEG-гигиена · M10
  braless+паразит-гигиена · M11 VOLT-телесность · M12 NICHE-мир · M13 R+ только на
  живых каналах · M14 смерть гипотез H3/H4.
- Milf-квота N30: 1/33. X изъяты («эччи > порно»).
`
writeText(path.join('thread4/contracts', `${slug}.md`), md)
console.log(`contract ${slug}: ${contract.slots.length} слотов, spread R+ ${contract.spread[0].count} / R ${contract.spread[1].count}`)
console.log('kinds:', JSON.stringify(slots.reduce((a, s) => ((a[s.kind] = (a[s.kind] ?? 0) + 1), a), {} as Record<string, number>)))
