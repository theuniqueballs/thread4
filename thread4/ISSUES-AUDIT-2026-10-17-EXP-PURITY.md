# Аудит-раунд №8 — Вердикт T4-34 (author-batch): EXP-слоты как слоты темы

Дата: 2026-10-17 · Триггер: батч-вердикт T4-34 «WITCHCRAFT»
(32/32 · расхождения ↑1 ↓15 · «средненько, абсолютно средненько»):
«ты используешь EXP слоты как ещё слоты под тему, а не для проверки
чего-либо, из-за чего в рендере законов пишет, что в батче нет ехп слотов».

## Диагноз (по живым файлам T4-34, до фикса)

EXP-оверлей T4-34 — 8 болванок, 4 пары (ν ξ ρ σ по контракту):

- P25-P30: THESIS «In this EXP slot, a light garment displays covered
  nipples while **magical runes glow** on the fabric during
  **spellcasting**» — тема в тезисах И в POS («glowing runes, arcane
  energy, spellcasting» в тег-ранах). Маркер программы потерян.
- P31/P32: пара σ — маркер у P31 уцелел («EXP σ-A · закон №27»), но
  **σ не входит в алфавит радара** — пара всё равно невидима.
- Итог в дашборде: «В этом батче нет EXP-слотов» — при 8 EXP-слотах
  и 4-парной программе. То, что видел автор.

## Находки (строгий формат)

- Bug/Bottleneck: ТРИАЛ-радар принимал только буквы κλμνξρ (алфавит
  T4-27), а генераторы продолжали греческий ряд: T4-25/26 писали
  α-ι, EXP-оверлей — σ/τ; любой маркер вне κλμνξρ = «в батче нет
  EXP-слотов» при живой программе -> src/lib/t4/batch-md.ts:289-290
  (HYPO_PAIR_RE / HYPO_SINGLE_RE)
  Refactored Code:
  ```ts
  const GREEK = 'αβγδεζηθικλμνξοπρστυφχψω'
  const HYPO_PAIR_RE = new RegExp(`^EXP\\s+([${GREEK}])-(A|B)(?![A-Za-z0-9])\\s*·?\\s*(H\\d+)?\\s*(.*)$`, 'u')
  const HYPO_SINGLE_RE = new RegExp(`^EXP\\s+single\\s*·\\s+([${GREEK}])(?![A-Za-z0-9])\\s*(H\\d+)?\\s*(.*)$`, 'u')
  ```

- Bug/Bottleneck: приказ писцу «THEME-KEYWORDS (weave ≥1 into EVERY
  slot's tags or prose)» заражал EXP-болванки темой — EVERY включает
  слоты, которым пер-слотная инструкция запретила тему («чистая
  болванка БЕЗ темы»); батч-уровень побеждал слот-уровень, тема
  попадала в THESIS и POS болванок -> src/lib/t4/scribe.ts:1275
  (batchLawBlock)
  Refactored Code:
  ```ts
  THEME-KEYWORDS (weave ≥1 into every MAIN/OC slot's tags or prose —
  the theme must be VISIBLE in the frame, not in the header; EXP slots
  are theme-free test blanks — theme words NEVER enter them, вердикт
  T4-34): ${ctx.themeKeywords.join(', ') || '—'}
  ```

- Bug/Bottleneck: маркер THESIS и безтемность EXP-слота были
  поручениями без принуждения — гейт structure считал только
  количество EXP-слотов; T4-34 с 7 потерянными маркерами и темой в
  POS прошёл hard PASS #1 -> src/lib/t4/gates.ts:570 (structure) +
  src/lib/t4/scribe.ts:457 (slotFrame — «THESIS MUST OPEN…»)
  Refactored Code: новый hard гейт **exp-purity** (gates.ts, секция 1b)
  — три инварианта, все машинные:
  ```ts
  /* (1) маркер THESIS — буква/половина из контракта */
  if (ce && !new RegExp(`^EXP\\s+${esc}-${ce.half}(?![A-Za-z0-9])`, 'u').test(s.thesis))
    f.push(`P${s.position}: THESIS EXP-слота не открывается маркером «EXP ${ce.letter}-${ce.half} · …» …`)
  /* (2) тема-слова в POS болванки — предкомпилированный матчер */
  for (const token of s.pos.split(',')) {
    const hit = themeTokenHit(token.trim(), matcher)
    if (hit) hits.add(hit)
  }
  /* (3) A/B-пара делит план — поза общая (T4-27.2: одна переменная) */
  if (mine && theirs && mine !== theirs) f.push(`P${s.position}: пара делит план — поза ${mine} ≠ ${theirs} …`)
  ```
  Плюс механическая сборка EXP-секций писца (дискреция LLM — нулевая):
  THESIS из контракта дословно (`expThesisOf`), тема-слова вычищаются
  из POS (`expPosOf` → `stripThemeTokens`), якорь без темы
  (`expAnchorOf`: тон × поза) -> src/lib/t4/scribe.ts:829-854, 937-966.

- Bug/Bottleneck: радар не имел фолбэка — маркер, потерянный писцом,
  означал потерю гипотезы навсегда, хотя контракт хранил истину
  (letter/half/hypothesis/pairWith), и никто её не читал ->
  src/lib/t4/batch-md.ts:328 (extractHypotheses) +
  src/app/api/t4/batches/[slug]/route.ts:57
  Refactored Code:
  ```ts
  export function extractHypotheses(md: string, batch: BatchMd, contractExp?: ContractExpSlot[]): Hypothesis[] {
    /* …маркерный проход… */
    if (contractExp && contractExp.length > 0) {
      const byPos = new Map(contractExp.map((x) => [x.position, x]))
      for (const s of batch.slots) {
        if (s.kind !== 'EXP' || matched.has(s.id)) continue
        const ce = byPos.get(Number.parseInt(s.id.replace(/^P/i, ''), 10) || 0)
        if (!ce) continue
        /* половина из контракта, recovered: true — радар честен и про потерю */
      }
    }
  }
  ```
  Контракт открыт API: `GET /api/t4/batches/[slug]` → `expProgram`
  (contractExpProgram — робастная проекция slots[].exp); UI рисует
  ⚑ «из контракта» на восстановленных половинах; CLI trial-export
  джойнит тот же контракт — одна правда у экрана и у файла.

- Bug/Bottleneck (perf, пойман самотестом до коммита): перевод
  регекспов из литералов в `new RegExp` шаблонным литералом молча
  съедал бэкслеши (`\s` в шаблоне → `s`): радар матчил «EXPs+», а не
  «EXP\s+»; классика template-literal эскейпов — удвоение -> src/lib/t4/batch-md.ts:297-299
  Refactored Code:
  ```ts
  const HYPO_PAIR_RE = new RegExp(`^EXP\\s+([${GREEK}])-(A|B)(?![A-Za-z0-9])\\s*·?\\s*(H\\d+)?\\s*(.*)$`, 'u')
  ```

- Perf (микро): фильтр тема-слов компилируется ОДИН раз на прогон
  (`themeWordMatcher`: `(^|[\s_-])(w1|w2…)([\s_-]|$)` — слово целиком,
  не подстрокой: «energy» не режет «streetlamp_goldslice_hard»),
  а не per-токен×слово; восстановление контракта — Map по позиции,
  O(1) на слот.

## Что видит автор теперь (T4-34, как сдан — летопись неприкосновенна)

- Радар ТРИАЛ-3 на T4-34: **4 пары** (σ ν ξ ρ · закон №27), а не
  «нет EXP-слотов»; уцелевший маркер P31 — чистый, потерянные половины
  — ⚑ «из контракта» с тезисом как написан (честно про болезнь).
- CLI: `bun thread4/tools/trial-export.ts T4-34` → тот же файл.
- Будущие батчи: писец больше НЕ решает — THESIS/якорь/POS
  EXP-болванок собирает машина, гейт exp-purity валит сдачу при
  потере маркера / теме в болванке / рассинхроне пары.

## Верификация

- tsc 0 · eslint 0 · selftest **153/153** (+7 новых: σ-ряд, контрактное
  восстановление, stripThemeTokens, exp-purity ×3) · цепь 389/389 цела
  · браузер QA: радар T4-34 с программой, ⚑-бейджи, консоль чистая,
  мобайл 390×844 ок (скрин /tmp/t4-qa-exp-purity-radar.png).

## Долги автора (не блокеры)

- Вердикт T4-34 уже в летописи (author-batch, одна запись) — тела
  «свистоперделок» (20 каналов дрессера) отдельным приказом.
- Тема T4-35 (§10) — за автором.
