/**
 * T4-27 «THE ART OF BEING EXTRAORDINARY» — генератор контракта из батча
 * (прецедент T4-26: контракт собирается из распарсенного батча; новизна —
 * палитра каждого слота пишется в контракт для гейта raw-plus: B-половинки
 * A/B-пар наследуют палитру A по abPairs — specs/raw-plus.json v1.0.0).
 * Запуск: bun thread4/tools/gen-t427-contract.ts
 */
import { parseBatch } from '../../src/lib/t4/gates'
import { writeJson, writeText } from '../../src/lib/t4/fsutil'
import fs from 'node:fs'
import path from 'node:path'

const slug = 'T4-27'
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
const h1 = /^#\s*(.+)$/m.exec(text0)?.[1] ?? ''
const title = (/\u00AB(.+?)\u00BB/.exec(h1)?.[1]) ?? slug

const AB: Record<number, { pair: string; half: string; withSlot: number; lead: string }> = {
  25: { pair: 'κ', half: 'A', withSlot: 26, lead: 'H10 опорная геометрия (закон №24, кандидат): полные M18-теги опоры vs без них — тот же кадр фруктового ящика' },
  26: { pair: 'κ', half: 'B', withSlot: 25, lead: 'H10 опорная геометрия (закон №24, кандидат): полные M18-теги опоры vs без них — тот же кадр фруктового ящика' },
  27: { pair: 'λ', half: 'A', withSlot: 28, lead: 'H11 свет-на-зоне (закон №21, X-граница плоской натяжки): слабый просвет + свет на зоне vs сильный просвет без света — тот же кадр галереи' },
  28: { pair: 'λ', half: 'B', withSlot: 27, lead: 'H11 свет-на-зоне (закон №21, X-граница плоской натяжки): слабый просвет + свет на зоне vs сильный просвет без света — тот же кадр галереи' },
  29: { pair: 'μ', half: 'A', withSlot: 30, lead: 'H12 RAW+ против блеклости (закон №23, приказ-миграция): RAW+ сборка (палитра+лицо+квалити) vs голый RAW T4-26 — тот же кадр фонтана' },
  30: { pair: 'μ', half: 'B', withSlot: 29, lead: 'H12 RAW+ против блеклости (закон №23, приказ-миграция): RAW+ сборка (палитра+лицо+квалити) vs голый RAW T4-26 — тот же кадр фонтана' },
}

const slots = batch.slots.map((s) => {
  const isExp = s.genre === 'EXP'
  const palette = (/\b(P\d{1,3}_[A-Z_]+)\b/.exec(s.header) ?? [])[0] ?? ''
  return {
    position: s.position,
    kind: s.genre,
    oc: s.genre === 'OC' ? (s.meta.split('·')[1] ?? '').trim() : '',
    rating: s.meta.includes('R+') ? 'R+' : s.meta.includes('PG-13') ? 'PG-13' : /\bR\b/.test(s.meta) ? 'R' : s.meta.includes('X') ? 'X' : '',
    pose: '',
    poseName: s.anchor,
    poseRisk: '',
    palette,
    paletteName: palette,
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
  engine: 'THE ART OF BEING EXTRAORDINARY',
  engineLaw:
    'одноразовый движок: экстраординарность как ремесло — не дар, а поставленная рука; каждый кадр ловит секунду, когда обычное занятие доведено до невиданного; носитель закона — предмет её ремесла. После батча утилизируется',
  engineWhy:
    'тема автора 2026-10-10 (после вердикта T4-26 «тема не особо понравилась»): VOLT показывает мастерство телом в моменте (закон №17), NICHE — невозможным миром вокруг героини (№18 + M20)',
  seed: Date.now(),
  createdAt: new Date().toISOString(),
  spread: [
    { rating: 'R+', count: slots.filter((s) => s.rating === 'R+').length },
    { rating: 'R', count: slots.filter((s) => s.rating === 'R').length },
  ],
  slots,
  ocRotation: {
    note: 'заказ автора 2026-10-10: темы ОС — DEFEATED WARLORD (Vae) · BATTLE ANGELS — секси меха-мусуме с крыльями (Sue) · CYBERPSYCHOSIS (Zia); отдельны от основной темы; формула oc-rplus: OC-тема несёт канал-канон ПРОСТОЙ геометрии (Ц-7)',
    ocs: ['Vae', 'Sue', 'Zia'],
  },
  racialCount: { note: 'RAW+/данбуру: расовый каст не назначается (T4-23 ORDER) — слайс-жизненные мейны' },
  abPairs: [
    { pair: 'κ', a: 25, b: 26, lead: AB[25].lead },
    { pair: 'λ', a: 27, b: 28, lead: AB[27].lead },
    { pair: 'μ', a: 29, b: 30, lead: AB[29].lead },
  ],
  carrierStats: {
    note: 'стеки назначены вручную по TRIAL-3 (M15-M20): каждый R+ слот = 1 FABRIC(W) + 1 BODY + 1 POSITION + 1 PHYSICS; EXP-оверлей — 9 слотов поверх 24-слотового закона',
    wSharePct: Math.round((slots.flatMap((s) => s.carriers).filter((c) => c.cls === 'W').length / (33 * 4)) * 100),
  },
  windowSlugs: [],
  channelStats: {
    note: 'RAW+/данбуру: канал — тег-ран, проза отсутствует (T4-23 ORDER). R+ только на живых каналах (M13): tape ×3 (канон 4/4) · contact ×6 (67%) · handbra-семейство ×4 (4/4 live) · wet-sheer воскрешённая конфигурация ×2 · fabric-tension ×1 (свет-на-зоне обязателен, №21) · EXQ ×2 (церемониальная эстетика + контакт) · EXP: pantyline ξ полная цепь · dry-sheer ρ rehab полной цепью',
  },
  platform: 'yodayo',
  laws: [
    '24-слотовый закон (3 OC + 21 мейн, вердикт T4-02) + EXP-оверлей ≤9 слотов ПОВЕРХ, отдельно от мейнов (law.expSlotsMax — приказ 2026-10-08)',
    'Спред мейнов канона T4-23/policy: R+×14 · R×7 (12 VOLT R+ · 7 NICHE R · 2 EXQUISITE R+)',
    'TRIAL-3 (вердикт T4-26, законы №20-24): M15 интерливинг состава (№22) · M16 палитры в RAW+ (№23) · M17 RAW+ сборка (палитра+лицо+квалити, без прозы) · M18 опорная геометрия (№24 кандидат) · M19 X-граница на натяжке (№21) · M20 NICHE-объект ≥ трети кадра',
    'Закон №20 «чистых рук»: braless-токен и NATURAL-кластер изъяты (рецепт v1.6.0); заявка рулится сценой (контакт/геометрия/состояние/свет)',
    'Milf-квота N30: 1/33 (Sue, MILF-mode); X-слоты изъяты (вердикт «эччи > порно»)',
  ],
}

writeJson(path.join('thread4/contracts', `${slug}.json`), contract)

/* Рукописный md по прецеденту T4-26.md */
const md = `# T4-27 «THE ART OF BEING EXTRAORDINARY» — КОНТРАКТ (ручной, под RAW+ батч)

**Составлен**: Фред, 2026-10-10 · **Приказ автора**: 21 мейн по теме THE ART OF
BEING EXTRAORDINARY + 3 ОС из канона с темами DEFEATED WARLORD (Vae) ·
BATTLE ANGELS — секси меха-мусуме с крыльями (Sue) · CYBERPSYCHOSIS (Zia)
+ 9 EXP — «того, что хочешь проверить» (гипотезы из квитанций вердикта T4-26).
**Формат**: первый RAW+ батч — приказ-миграция №23 (палитры + аниме-лица +
квалити-цвет, без прозы; specs/raw-plus.json v1.0.0, гейт raw-plus).
**Анализ-основа**: док CAUSAL-MAP-T4-26-2026-10-09 — TRIAL-3 меры M15-M20
применены и перечислены в шапке батча; рецепт v1.6.0 (законы №20/№21).

## Движок (одноразовый)

**THE ART OF BEING EXTRAORDINARY** — экстраординарность как ремесло: не дар,
а поставленная рука. Каждый кадр ловит секунду, когда обычное занятие доведено
до невиданного. Носитель — предмет её ремесла. Утилизируется после батча.

## Структура (интерлив колодой — закон №22, приказ «Разбросай всё обратно»)

| Сегмент | Слоты | Заявки |
|---|---|---|
| OC (темы автора, из канона) | P01 Vae «DEFEATED WARLORD» · P02 Sue «BATTLE ANGELS» · P03 Zia «CYBERPSYCHOSIS» | R+ ×3 |
| Мейн VOLT (интерлив с NICHE) | P04 печатный станок · P06 лента-фехтование · P08 мука · P10 марафон · P12 теплица · P14 лента-черлидинг · P16 маски · P18 штандарт · P21 обсерватория · P22 холст · P23 онсен-забег · P24 пульт | R+ ×12 |
| Мейн NICHE (интерлив с VOLT) | P05 миграция-дом · P07 прилив-библиотека · P09 лифт-вбок · P13 зима-окно · P15 бельевые паруса · P17 рынок созвездий · P19 гравитационная скважина | R ×7 |
| Мейн EXQUISITE | P11 станок балета · P20 икэбана | R+ ×2 |
| EXP (оверлей, без темы) | P25-P33 | R+ ×8 · R ×1 |

Счёт заявок: **R+ 25 · R 8 · X 0** (мейны: R+×14 · R×7 — спред канона
T4-23/policy). Milf-квота: 1/33 (Sue, MILF-mode). Соседние слоты — разные
планы и механизмы (M15; T4-26 Ц-4 — «куч» больше нет).

## ОС-темы (заказ автора; формула oc-rplus: тема несёт канал-канон ПРОСТОЙ геометрии — Ц-7)

- **DEFEATED WARLORD R+** — Vae: проигранная война, тронный зал под чёрной
  смолой, корона в смоле; канонический X-tape несёт грудь — tape-канал (4/4
  канон), ELDRITCH-стейджинг (щупальца — архитектура, не касаются).
- **BATTLE ANGELS R+** — Sue: ветеран ангельского звена, меха-крылья, сломанное
  крыло; расколотый нагрудник — гаунтлеты как единственный лиф: handbra-семейство
  (4/4 live), MILF-mode (квота 1/33).
- **CYBERPSYCHOSIS R+** — Zia: приступ пойман на середине — хром шепчет, она
  смеётся; куртки нет (порты прожгли), грудь вжата в край holo-стола:
  contact-physics простая опора + through_fabric чистым NEG (№14).

## EXP-программа (9 слотов, оверлей — отдельно от мейнов, без темы)

| Слот | Гипотеза | Переменная |
|---|---|---|
| P25/P26 (пара κ) | H10 опорная геометрия (закон №24, кандидат): M18-теги опоры vs без них | блок опорных тегов |
| P27/P28 (пара λ) | H11 свет-на-зоне (закон №21): слабый просвет + свет vs сильный просвет без света (осознанный ⚗ нарушитель) | свет-на-зоне |
| P29/P30 (пара μ) | H12 RAW+ против блеклости (закон №23, приказ): RAW+ сборка vs голый RAW T4-26 (осознанный ⚗ нарушитель) | RAW+ надстройка |
| P31 | ν underwear-ДОБОР (θ-продолжение, n=1→3): гала-авария, честная заявка R | канал P32 T4-26 |
| P32 | ξ pantyline-ДОБОР (0/1): полная §9-цепь на нижней зоне — свет-на-зоне по бёдрам (чего не хватало P13 T4-26) | §9-цепь |
| P33 | ρ dry-sheer REHAB (rehab-список policy v1.5.0): только полной §9-цепью, dry без wet | полная цепь |

## Палитры (закон №23 — приказ-миграция, M16/M17)

31 уникальная палитра в шапках + 2 наследования по abPairs (P26←P25
P12_AUTUMN_RUST, P28←P27 P14_ROSE_GOLD; P30 — голый RAW, ⚗). Белый-кап 3
(P20 washi · P29/P30 белая футболка). Запреты палитр вычищены из POS
(C070), акцент accent1 — именованным цветом (C069), ANTI-WASH в каждом NEG
(Five Locks). SATURATED ANCHOR — один насыщенный акцент на кадр.

## Законы

- 24-слотовый (3 OC + 21 мейн) + EXP-оверлей ≤9 (law.expSlotsMax).
- TRIAL-3 (вердикт T4-26, законы №20-24): M15 интерливинг · M16 палитры ·
  M17 RAW+ сборка · M18 опорная геометрия · M19 X-граница на натяжке ·
  M20 NICHE-объект ≥ 1/3 кадра.
- Закон №20 «чистых рук» (рецепт v1.6.0): braless-токен и NATURAL-кластер
  изъяты; заявка рулится сценой.
- Milf-квота N30: 1/33. X изъяты («эччи > порно»).
`
writeText(path.join('thread4/contracts', `${slug}.md`), md)
console.log(`contract ${slug}: ${contract.slots.length} слотов, spread R+ ${contract.spread[0].count} / R ${contract.spread[1].count}`)
console.log('kinds:', JSON.stringify(slots.reduce((a, s) => ((a[s.kind] = (a[s.kind] ?? 0) + 1), a), {} as Record<string, number>)))
console.log('palettes in headers:', slots.filter((s) => s.palette).length)
