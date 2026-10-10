/**
 * T4-27.2-EXP «THE ART OF BEING EXTRAORDINARY» — генератор контракта из батча
 * (клон прецедента gen-t427-contract.ts; отличия: слаг T4-27.2-EXP, перестройка
 * T4-27 по фидбеку рендера — BODY-SPECTRUM слой, A/B-пары несут ОДИН план тела
 * в обеих половинках). Запуск: bun thread4/tools/gen-t4272-contract.ts
 */
import { parseBatch } from '../../src/lib/t4/gates'
import { writeJson, writeText } from '../../src/lib/t4/fsutil'
import fs from 'node:fs'
import path from 'node:path'

const slug = 'T4-27.2-EXP'
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
  25: { pair: 'κ', half: 'A', withSlot: 26, lead: 'H10 опорная геометрия (закон №24, кандидат): полные M18-теги опоры vs без них — тот же кадр фруктового ящика; план тела один в обеих половинках (curvy) — вторая переменная запрещена' },
  26: { pair: 'κ', half: 'B', withSlot: 25, lead: 'H10 опорная геометрия (закон №24, кандидат): полные M18-теги опоры vs без них — тот же кадр фруктового ящика; план тела один в обеих половинках (curvy) — вторая переменная запрещена' },
  27: { pair: 'λ', half: 'A', withSlot: 28, lead: 'H11 свет-на-зоне (закон №21, X-граница плоской натяжки): слабый просвет + свет на зоне vs сильный просвет без света — тот же кадр галереи; план тела один (slender)' },
  28: { pair: 'λ', half: 'B', withSlot: 27, lead: 'H11 свет-на-зоне (закон №21, X-граница плоской натяжки): слабый просвет + свет на зоне vs сильный просвет без света — тот же кадр галереи; план тела один (slender)' },
  29: { pair: 'μ', half: 'A', withSlot: 30, lead: 'H12 RAW+ против блеклости (закон №23, приказ-миграция): RAW+ сборка (палитра+лицо+квалити) vs голый RAW T4-26 — тот же кадр фонтана; план тела один (athletic+medium)' },
  30: { pair: 'μ', half: 'B', withSlot: 29, lead: 'H12 RAW+ против блеклости (закон №23, приказ-миграция): RAW+ сборка (палитра+лицо+квалити) vs голый RAW T4-26 — тот же кадр фонтана; план тела один (athletic+medium)' },
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
  engine: 'THE ART OF BEING EXTRAORDINARY (BODY-SPECTRUM)',
  engineLaw:
    'одноразовый движок T4-27 сохранён + новый слой BODY-SPECTRUM: план тела 3-5 тегами в идентификационном сегменте + NEG-защита от дрейфа в дефолт; регистр передаётся формой (petite/slender→студентка, athletic/curvy→молодая, full→милф), возраст не тегируется (N30); интерлив тел — соседние слоты разные планы; A/B-пары — один план в обеих половинках',
  engineWhy:
    'фидбек автора по рендеру T4-27 (2026-10-10): «тела у них относительно одинаковые» — при RAW-миграции №20 умер телесный слой прозы (регистры зрелости LEAD-строк, mature woman/full-figured/wide hips/soft waist T4-08, slim elegant/thick toned thighs T4-17, curvy build T4-21, канон body_type ОС); RAW+ №23 вернул палитры/лицо/свет, но не тела. Лечение — теги формы, не возраста (N30: взрослые теги перекашивают батч)',
  seed: Date.now(),
  createdAt: new Date().toISOString(),
  spread: [
    { rating: 'R+', count: slots.filter((s) => s.rating === 'R+').length },
    { rating: 'R', count: slots.filter((s) => s.rating === 'R').length },
  ],
  slots,
  ocRotation: {
    note: 'как в T4-27 (заказ автора): DEFEATED WARLORD (Vae) · BATTLE ANGELS — меха-мусуме (Sue) · CYBERPSYCHOSIS (Zia); НОВОЕ: канон-тела возвращены тегами (oc-canon body_type: Vae tall/curvy/hourglass/large/wide; Sue MILF-mode + soft waist + thick thighs; Zia FAM-A full-figured)',
    ocs: ['Vae', 'Sue', 'Zia'],
  },
  racialCount: { note: 'RAW+/данбуру: расовый каст не назначается (T4-23 ORDER)' },
  abPairs: [
    { pair: 'κ', a: 25, b: 26, lead: AB[25].lead },
    { pair: 'λ', a: 27, b: 28, lead: AB[27].lead },
    { pair: 'μ', a: 29, b: 30, lead: AB[29].lead },
  ],
  carrierStats: {
    note: 'стеки T4-27 сохранены (TRIAL-3 M15-M20); EXP-оверлей — 9 слотов поверх 24-слотового закона',
    wSharePct: Math.round((slots.flatMap((s) => s.carriers).filter((c) => c.cls === 'W').length / (33 * 4)) * 100),
  },
  windowSlugs: [],
  channelStats: {
    note: 'каналы T4-27 сохранены; единственная новая переменная батча — BODY-SPECTRUM (план тела тегами + NEG-защита)',
  },
  platform: 'yodayo',
  laws: [
    '24-слотовый закон (3 OC + 21 мейн) + EXP-оверлей ≤9 слотов ПОВЕРХ (law.expSlotsMax)',
    'Спред мейнов канона T4-23/policy: R+×14 · R×7 (12 VOLT R+ · 7 NICHE R · 2 EXQUISITE R+)',
    'TRIAL-3 (законы №20-24): M15 интерливинг · M16 палитры · M17 RAW+ сборка · M18 опорная геометрия · M19 X-граница · M20 NICHE-объект',
    'BODY-SPECTRUM (новый слой T4-27.2): план тела тегами в идентификационном сегменте + NEG-защита; регистр формой, не возрастом (N30); интерлив тел (№22 на тела); A/B-пары — один план в обеих половинках',
    'Закон №20 «чистых рук» (рецепт v1.6.0): braless-токен и NATURAL-кластер изъяты',
    'Milf-квота N30: по тегу 1/33 (Sue, канон); по форме full-план 4/33 + OC P02/P03',
  ],
}

writeJson(path.join('thread4/contracts', `${slug}.json`), contract)

/* Рукописный md по прецеденту T4-27.md */
const md = `# T4-27.2-EXP «THE ART OF BEING EXTRAORDINARY» — КОНТРАКТ (перестройка T4-27 + BODY-SPECTRUM)

**Составлен**: Фред, 2026-10-10 · **Приказ автора**: по ходу рендера T4-27 —
«тела у них относительно одинаковые»; «проверь что ещё мы потеряли из прозы
помимо того, что мы уже влили в Т4-27, именно — полезного, для диверсити
девчонок»; «построишь уже имеющийся Т4-27 заново, порядковый номер будет
T4-27.2 EXP».
**Формат**: RAW+ (как T4-27) + новый слой BODY-SPECTRUM — единственная
новая переменная. Темы, палитры, стеки, каналы, EXP-гипотезы — без изменений.

## Что было потеряно из прозы (добыча)

1. **Регистры зрелости** — жили в прозе/LEAD-строках («milf register» T4-02,
   «mature woman» T4-08). Возрастные теги запрещены (N30 — перекос всего
   батча в MILF). ⇒ регистр передаётся ФОРМОЙ.
2. **Телесный план** — full-figured/wide hips/full chest/soft waist (T4-08),
   slim elegant, thick toned thighs (T4-17), curvy build (T4-21), full/rounded
   hips, long legs, slim waist, soft chest (T4-20.1-EXP).
3. **Канон-тела ОС** (oc-canon body_type) — Vae и Zia в T4-27 шли без тегов
   (рендер брал дефолт); Sue единственная несла MILF-mode.
4. **Детали кожи** — collarbones (T4-02/19), tan lines, freckles (T4-04/05).

## BODY-SPECTRUM (новый слой)

| План | Слоты | Теги |
|---|---|---|
| OC-канон | P01 Vae · P02 Sue · P03 Zia | канон body_type возвращён тегами |
| PETITE (студентка) | P05 · P11 · P13 · P17 | petite, small breasts, narrow hips |
| SLENDER | P04 · P09 · P19 · P21 · P24 · P27/P28 | slender (+medium у P04/P24) |
| ATHLETIC (молодая-спорт) | P06 · P10 · P14 · P23 · P29/P30 · P32 | athletic, toned (+abs у лент/марафона) |
| CURVY (молодая женщина) | P07 · P12 · P15 · P18 · P22 · P25/P26 | curvy, large breasts, wide hips |
| FULL (милф формой) | P08 · P16 · P20 · P31 | full-figured, full chest, soft waist |

NEG-защита от дрейфа в дефолт: full/curvy слоты несут slender/petite/small
breasts в NEG; athletic — soft body; petite/slender — huge/large breasts.
Салиенс: вставки рассчитаны — заявки остались в пределах лимитов (прогноз
T4-27 «0/25 под угрозой» держится). Интерлив тел: соседние слоты — разные
планы. A/B-пары — один план в обеих половинках (κ/λ/μ без второй переменной).

## Гипотеза батча

**H13 (BODY-SPECTRUM)**: явный план тела тегами в RAW+ (без прозы) лечит
однообразие тел — рендер перестаёт брать дефолт, когда тело НАЗВАНО.
Проверка — глаз автора на рендере T4-27.2 против T4-27 (тот же состав,
отличие только в теле). Если работает — прорыв в промптостроении (заказ
автора): формула «назови тело — или рендер решит за тебя».

## Законы

- 24-слотовый (3 OC + 21 мейн) + EXP-оверлей ≤9 (law.expSlotsMax).
- TRIAL-3 (№20-24) в силе, как в T4-27.
- BODY-SPECTRUM — новый слой этого батча; в TASTE попадает только после
  вердикта автора (эксперимент, не закон).
- Milf-квота N30: по тегу 1/33; по форме 4/33 + OC.
`
writeText(path.join('thread4/contracts', `${slug}.md`), md)
console.log(`contract ${slug}: ${contract.slots.length} слотов, spread R+ ${contract.spread[0].count} / R ${contract.spread[1].count}`)
console.log('kinds:', JSON.stringify(slots.reduce((a, s) => ((a[s.kind] = (a[s.kind] ?? 0) + 1), a), {} as Record<string, number>)))
console.log('palettes in headers:', slots.filter((s) => s.palette).length)
