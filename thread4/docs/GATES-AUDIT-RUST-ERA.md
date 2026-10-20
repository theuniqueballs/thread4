# GATES AUDIT — RUST-ERA (2026-10-19)

Приказ: «Аудит гейтов и правил: прогони трассировку. Найди мертвые правила,
объедини дубли (MERGE), удали мусор (PRUNE). Не ломай то, что работает (KEEP)».

Метод: инвентаризация `src/lib/t4/gates.ts` (2496 строк) построчно + сверка с
живыми прогонами самотеста + паритет Rust-ядра. Вердикты консервативны:
Конституция — текст автора, правки через AMENDMENT PROTOCOL (замена +
`law.amended`), не молчаливым редактированием.

## 1. Итог пересчёта

| Метрика | Легенда (было) | Факт | Вердикт |
|---|---|---|---|
| Безусловные гейты | «25» | **30** (7 hard + 20 warn + 3 advisory) | MERGE-фикс применён |
| Условные гейты | 3 | 3 (raw-plus, rating-recipe-exp, raw-plus-exp) | KEEP |
| GATES_TOTAL | 27 | **30** | FIX: константа+комментарий+selftest синхронизированы |
| Живой прогон | «27–29» | 30–33 квитанции | ловушка дрейфа в самотесте |

## 2. Таблица гейтов (30 безусловных)

| № | Гейт | Уровень | Где живёт | Статус в Rust-ядре | Аудит |
|---|---|---|---|---|---|
| 1 | structure | hard | planning (compile.ts) | **PORTED** (compile.rs, квитанции дословно) | KEEP |
| 2 | exp-purity | hard | planning | **PORTED** | KEEP |
| 3 | floors | hard | planning | **PORTED** | KEEP |
| 4 | window | hard | planning | **PORTED** | KEEP |
| 5 | rating-recipe | hard | scribe-time (№27/№28/X-Cut) | TS (порт — следующая фаза) | KEEP |
| 6 | canon | hard | scribe-time (OC-канон) | TS | KEEP |
| 7 | diversity | hard | scribe-time | TS | KEEP |
| 8 | dresser | warn | №29-когерентность | TS | KEEP |
| 9 | budget | warn | POS 300/400 + хеджы | TS | KEEP |
| 10 | cadence | warn | closer-формулы | TS | KEEP |
| 11 | niche-legibility | warn | | TS | KEEP |
| 12 | prop-geometry | warn | POLISH_GATES | TS | KEEP |
| 13 | claim-visibility | warn | POLISH_GATES | TS | KEEP |
| 14 | technique-layers | warn | | TS | KEEP |
| 15 | noun-lock | warn | POLISH_GATES | TS | KEEP |
| 16 | character-collision | warn | | TS | KEEP |
| 17 | ab-single-variable | warn | planning + scribe | **PORTED** (planning-уровень) | KEEP |
| 18 | theme-presence | warn | | TS | KEEP (не путать с гейтом №25 — см. §3) |
| 19 | original-character-coverage | warn | | TS | KEEP |
| 20 | artist-leak | warn | | TS | KEEP |
| 21 | garment-family | warn | | TS | KEEP |
| 22 | simcheck | warn | Jaccard>0.75 | TS | KEEP (пара с echo-window — задумано) |
| 23 | salience-chain | warn | §9-sexta | TS | KEEP |
| 24 | contract-fidelity | warn | POLISH_GATES | TS | KEEP |
| 25 | **theme (№25)** | hard | **NEW: Rust theme.rs** | **NATIVE RUST** (Фаза 2) | NEW — якоря+adherence, EXP-оф |
| 26 | one-hard-claim | warn | G20 | TS | KEEP |
| 27 | echo-window | warn | G33 ±2 | TS | KEEP |
| 28 | bumps-quota | warn | G17 | TS | KEEP |
| 29 | freq-report | advisory | | TS | KEEP |
| 30 | usage | advisory | | TS | KEEP |
| 31 | technique-map | advisory | | TS | KEEP |

Условные (вне базы): raw-plus (hard, RAW+-маркер), rating-recipe-exploratory
(warn, ⚗), raw-plus-exploratory (warn, ⚗) — KEEP, маркер-зависимость честная.

## 3. Гейт №25 «theme» — новый (Фаза 2, Rust-native)

- `theme.rs`: тема → визуальные якоря (JSON): locale / timeOfDay / light /
  paletteMood / motifs×3 / wardrobeFamily / poseFamily / camera /
  atmosphere×2 / tokens / minAdherence. Детерминизм: seed
  sha256(theme|slug|theme-expander/v1); лексикон RU+EN перехватывает
  измерение у кубика (слово автора весит больше).
- Гейт проверяет: якоря не проносят вечные флоры (баны §8), бюджет токенов
  6..12, OC-темы не спорят с якорями (лексикон), adherence текста ≥ 50%.
- **EXP-батчи: модуль и гейт ВЫКЛЮЧЕНЫ** (приказ автора, вердикт T4-34 —
  болванки без темы), квитанция честная: `verdict: "OFF"`.
- Якоря живут ВНЕ канонического плана: byte-parity sha10 с bun-движком
  неприкосновенна (якоря — в ответе RPC, в note-событии scratch-летописи и
  в live-консоли блоком «expand»).

## 4. MERGE / PRUNE / KEEP — вердикты

- **MERGE (применён)**: GATES_TOTAL 27→30 + пересчёт перечисления в
  комментарии + два новых чека самотеста (константа И живой прогон = 30).
  Дрейф ловится навсегда: счётчик и код не смогут разъехаться молча.
- **PRUNE (кандидаты, вердикт за автором — не тронуты)**:
  1. CONSTITUTION §9-терция («через-ткань заявка ТРЕБУЕТ одной светлой
     вещи») противоречит enforcement-закону №27/№28 (dark несущая,
     вердикт T4-34). Противоречие живое, правится §12-амендмантом.
  2. CONSTITUTION §11 и шапка указывают на
     `../chemodan/CHEMODAN_THREAD_3.2-EXP_V21/` — каталог съеден платформой
     (перенос в архив: legacy/). §11-ссылка протухла.
  3. DoD v1 п.1 («батч пишется вручную, авто-писец = low-trust») де-факто
     превзойдён: T4-41 сдана FIRST RUN CLEAN писцом (вердикт автора ждал
     именно этого доказательства).
  4. Косметика: `tools/trace-run.ts:227` «118 регрессий»,
     `tools/tmp/fixpass-law26.ts` «96/96» — tmp-скрипты, счётчики протухли
     (не мешают, чинить только при касании).
- **KEEP (осознанные дубли — НЕ сливать)**:
  1. rating-recipe №28 (per-slot, hard) и raw-plus №27 light-carrying-tops
     (batch-level, hard) — одна доктрина на двух уровнях гранулярности.
  2. simcheck (полные двойники J>0.75) и echo-window G33 (сигнатурное эхо
     ±2 соседа) — комплементарные детекторы (закомментировано в коде).
  3. exp-purity тема-слова и raw-plus полная фраза — разные маркеры.
- **Найденный нюанс паритета**: движок (compile.ts:332) РАЗРЕШАЕТ
  перекомпиляцию void-слага («existing.status !== 'void'»), при этом
  текст события void — «номер не переиспользуется». Движковая эра и
  файловая расходятся; Rust-ядро зеркалит ДВИЖОК (проверка в батарее:
  `void/recompile-allowed-engine-parity`). Разрешение противоречия —
  за автором.

## 5. Следующая фаза (кандидаты на порт в Rust)

Приоритет: rating-recipe (hard, №27/№28 — сердце PH-доктрины) → canon →
diversity → simcheck/echo-window (текстовые метрики). Сирота: `polish`
(писец-ремонт POLISH_GATES) — LLM-слой, остаётся в Node-мосту.

---

## 6. Дополнение 2026-10-20 (этап 1-бис, вердикт автора «приступай к фазе 1»)

Таблица §2 устарела относительно кода (сам док молчал о textgates —
находка фазы 0): этап 1 (2026-10-19) портировал 13 словарных гейтов
(BATTERY_RUST, паритет 65/65 клеток), этап 1-бис (2026-10-20, ветка
thread4.1) — сердце PH-доктрины:

- **rating-recipe (hard, №5 таблицы)** — ПОРТИРОВАН: сигналы/сигнал-мин,
  hard-claim (рендер-доказанные заявки), механизмы (required_state /
  underlayer / мёртвые ткани / контр-NEG±lifted), законы №27/№28 (DRY dark
  bumps, through/wet/sheer = X-каналы), counter-NEG, X Cut hold, overclaim
  с дедупом подстрок, ⚗-редирект в условный rating-recipe-exploratory.
- **canon (hard, №6)** — ПОРТИРОВАН: запрет имён OC в POS (§9-кватерна) +
  канон-локи волос/глаз по oc-canon.json (§8).
- **diversity (hard, №7)** — ПОРТИРОВАН: core-4, механо-группы/классы,
  sheer-квоты, моно-носитель ≤4, W ≤45%, sheer ≤40%, уникальность
  поз/палитр с EXP-исключением §10.

Батарея: **BATTERY_RUST 16 / BATTERY_TS 14** (30 базовых + условные).
Комментарий в textgates.rs «7 hard + 14 warn + 1 advisory» был
арифметически неверен — исправлен (4+9+1). Паритет доказан: cargo test
57/57, selftest 125/125, живой репроб Rust ↔ TS **20/20 клеток** (verdict +
findings дословно, 6 батчей, включая 190 находок T4-27 и 37 T4-31).
Нюанс: записанные слепки gate.run T4-27/28 несут PASS по СТАРОМУ рецепту
(ретроактивные гейты, аудит №9) — слепочное сравнение rating-recipe
заменено живыми sha-pinned пинами; летопись неприкосновенна.

Остаток фазы 1 (BATTERY_TS 14): structure, exp-purity, floors, dresser,
window, niche-legibility, claim-visibility, technique-layers,
ab-single-variable, simcheck, technique-map, salience-chain,
contract-fidelity, bumps-quota. Сирота WRITE-моста (движковый план →
богатый контракт для писца) — предмет фазы 2, блокирует сдачу T4-43.

## 7. Дополнение 2026-10-20 (этап 1-в, ветка thread4.1) — БАТАРЕЯ ЗАВЕРШЕНА

BATTERY_TS обнулён: все 30 базовых гейтов портированы в Rust
(`mini-services/t4-engine-rs/src/textgates.rs`), порядок квитанций — 1-в-1
с runGates. Док completing §2 и §5 (§5 «кандидаты на порт» исчерпан):

- **4 hard**: structure (закон 24+EXP/OC/мейн, поля, quality, фейс-лок,
  опенер, Canon у OC) · exp-purity (T4-34: маркер THESIS из контракта +
  фолбэк, тема-слова вне POS болванки, A/B-пара делит план) · floors
  (анти-лоли ≥4, лика/свечная/фейс-гарды, milf-квота N30, XXX левый-\\b) ·
  window (ретроактивное окно T4-31-ревизии, двусторонний rebuildOf №30).
- **9 warn**: dresser (№29, checkCoherence) · niche-legibility (T4-02) ·
  claim-visibility (T4-03) · technique-layers (таблица автора, сумма
  факторов/ловушки/супрессоры/X Cut hold) · ab-single-variable · simcheck
  (V8-Жаккар: порог целочисленным сравнением, toFixed(2) half-away на
  точной экспансии f64) · salience-chain v2 (9 звеньев §9-секста+
  §9-септима) · contract-fidelity (T4-30, kinTokensOf) · bumps-quota (G17).
- **3 advisory/report**: technique-map · freq-report/usage (были) ·
  условные raw-plus (hard) + raw-plus-exploratory +
  rating-recipe-exploratory (вне базы, 30–33 квитанции на прогон).

**Состояние twin'а**: состояние window/simcheck/runIndex — фолд
`thread4/events/log.jsonl` ( ChronState) — ТО ЖЕ, что читает эталон
runGates (readEvents). Прод-SQLite НЕ зеркало: миграция импортировала
399 из 421 звеньев (runIndex по SQLite занижен: T4-04 — 3 против 5;
окно для file-era слагов совпадает — T4-36/39/42 void'ы движковой эры
выдавлены с обеих сторон). Движковая эра (Фаза 2) переключит источник
сознательно, с квитанцией.

**Паритет (аудит №9, reprobe)**: 37 живых слагов × 5650 клеток
(gate/level/verdict/findings/notes, порядок массива) — **0 diff**
(ts: `thread4/tools/gates-dump-json.ts`, rs: `t4 gates <slug> --text
--json`). selftest twin'а 125/125 (+1 честный skip), cargo test 63/63,
TS selftest 174/174, tsc 0.
