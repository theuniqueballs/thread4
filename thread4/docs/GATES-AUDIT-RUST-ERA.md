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
