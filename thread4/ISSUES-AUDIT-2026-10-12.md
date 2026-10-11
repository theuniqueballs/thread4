# ISSUES — аудит THREAD4 (t4-audit, 2026-10-11/12)

Источник: полный 7-фазный аудит конвейера (recon → baseline → ревью ядра/API/гейтов/
scribe/tools → воспроизведение → фиксы → реверификация). Baseline был зелёный
(selftest 100/100, verify 301/301 ЦЕЛА, tsc 0, lint 0). После фиксов: selftest
106/106, verify 301/301 ЦЕЛА, tsc 0, lint 0, build success, grep-gate чисто.
Все фиксы — атомарными коммитами в main (откат: git revert <hash>).

<!-- END -->
## ISSUE 01 · CRITICAL · security
**Заголовок:** [AUDIT T4-SEC-01] Командный замок стоял только на 2 из 26 хендлеров — 7 мутирующих роутов писали диск и летопись без ключа
**Лейблы:** security,audit,fixed

**Серьёзность:** CRITICAL

Дашборд достижимость снаружи через шлюз :81 (Caddyfile, платформенный wildcard
XTransformPort=* — Issue #5). При этом командный замок «Залпа 1» реально стоял
только на POST /api/t4/events и POST /api/t4/vault. БЕЗ ключа работали и писали:

- POST /api/t4/compile — контракты *.json+md на диск + событие batch.compiled в хеш-летопись;
- POST /api/t4/gates (deliver:true) — batches/*.md+json, batch.delivered, oc.appeared, git-снапшот;
- POST /api/t4/scribe — batches/*.md + scribe.drafted + расход LLM-квоты;
- POST+DELETE /api/t4/contract-draft — файлы черновиков + note-события;
- POST /api/t4/batch-verdict — render.verdict В ХЕШ-ЛЕТОПИСЬ (форж авторских вердиктов);
- POST /api/t4/feedback — render.verdict + платный VLM;
- POST /api/t4/vlm — платный VLM.

Репро (до фикса, на изолированной копии): `curl -X POST .../api/t4/compile -d '{"theme":"x"}'` → 200, контракт записан, летопись выросла.
Побочно: CSRF — req.json() игнорирует Content-Type, кастомный заголовок не требовался.

Фикс: 51209b4 — src/lib/t4/apiguard.ts (requireCommander, timing-safe сравнение
через sha256 обеих сторон), гвард на ВСЕ мутирующие хендлеры, клиент
(postJson/delJson) прикладывает x-commander-key по умолчанию — это же закрывает
CSRF. Верификация: 503 (нет ключа) / 403 (чужой) / 200 (с ключом) — воспроизведено
curl'ом на изолированной копии; летопись реального репо не тронута.

<!-- END -->
## ISSUE 02 · HIGH · security
**Заголовок:** [AUDIT T4-SEC-02] /api/zai/chat/completions и /vision — неаутентифицированный прокси к платному LLM с Bearer-ключом автора
**Лейблы:** security,audit,fixed

**Серьёзность:** HIGH

route.ts:55-67 (text) и vision/route.ts:54-61: тело клиента уходило upstream
as-is с `Authorization: Bearer <apiKey>` из .z-ai-config. Любой снаружи (через
:81) гонял модель за счёт автора, модель выбирал клиент.

Фикс: 51209b4 — requireCommander на оба роута (замок ДО проверки конфига:
403 вместо 503 при отсутствии ключа). Верифицировано curl'ом.

<!-- END -->
## ISSUE 03 · HIGH · security
**Заголовок:** [AUDIT T4-SEC-03] GET /api/t4/vault отдавал ПОЛНЫЙ бандл (батчи+контракты+спеки+log.jsonl) без ключа
**Лейблы:** security,audit,fixed

**Серьёзность:** HIGH

vault/route.ts GET собирал всё состояние THREAD4 и отдавал без проверки ключа
(Issue #2 был закрыт декларацией «внешний доступ = read-key», enforcement не
существовал). В бандле — вся летопись, все спеки, вся переписка гейтов.

Фикс: 51209b4 — vault GET лочен ключом командира (приравнен к записи); клиент
Стекла шлёт ключ на оба вызова. Верифицировано: 403 без ключа / 200 с ключом.

Остаток (открытый вопрос за автором): read-key для остальных GET-роутов
(см. ISSUE 15).

<!-- END -->
## ISSUE 04 · HIGH · bug
**Заголовок:** [AUDIT T4-BUG-01] Восстановление из браузерного vault никогда не работало — клиент не слал x-commander-key
**Лейблы:** bug,audit,fixed

**Серьёзность:** HIGH

vault POST залочен с «Залпа 1» (vault/route.ts:116 требовал ключ), но клиент
restoreSnapshot (src/components/t4/vault.ts:131-135) шлёл POST БЕЗ заголовка —
каждое восстановление из UI получало 403. Функциональный мёртвый путь в
инструменте аварийного восстановления — самом важном после сбоя контейнера.

Фикс: 51209b4 — клиент прикладывает commanderHeaders() на GET и POST vault.

<!-- END -->
## ISSUE 05 · HIGH · reliability
**Заголовок:** [AUDIT T4-REL-01] LLM-цепь писца без таймаутов; ретраились даже непереходящие 4xx
**Лейблы:** reliability,audit,fixed

**Серьёзность:** HIGH

scribe.ts chat(): ни AbortController, ни таймаута — повисший upstream держал
роут (maxDuration 600с) и CLI неограниченно; catch-ALL ретраил и 4xx-конфиг
(нет ключа / модели нет) так же, как 429; backoff отсутствовал.

Фикс: b0aa3b1 — withTimeout 180с на вызов, backoff 1.5с*2^n, ретрай только
переходящих (сеть/408/425/429/5xx; empty completion остаётся ретраибельным),
непереходящий 4xx падает сразу. Request после таймаута не отменяем (SDK не
несёт AbortSignal) — перестаём ждать, семантика честно задокументирована.

<!-- END -->
## ISSUE 06 · MEDIUM · core
**Заголовок:** [AUDIT T4-CORE-01] void-батч НЕ покидал окно ротации — код противоречил собственному тексту
**Лейблы:** core,rotation,audit,fixed

**Серьёзность:** MEDIUM

cli.ts void писал «в ротации не участвует», но foldState (events.ts) строил
windowSlugs = last-3-delivered БЕЗ фильтра voided: гейт window сверял позы/
палитры нового батча с закрытым батчем.

Фикс: 56d115b — фильтр voided в foldState.delivered. Регрессия в selftest
(синтетические события: void уходит из окна). Совпадение с текущими данными:
все 5 void (T4-06/10/14/16/17) вне хвоста — поведение на живом окне не изменилось.

<!-- END -->
## ISSUE 07 · MEDIUM · core
**Заголовок:** [AUDIT T4-CORE-02] nextBatchNumber переиспользовал номер void-батча — следующая компиляция молча перезаписала бы его контракт
**Лейблы:** core,rotation,audit,fixed

**Серьёзность:** MEDIUM

nextBatchNumber пропускал void-слаги (по прозе «в нумерации не участвует»):
после void ПОСЛЕДНЕГО батча следующая компиляция получала тот же номер и
writeText перезаписал бы contracts/T4-NN.json закрытого батча — провенанс
жил бы только в git-истории. Состояние на сегодня латентное (все void ниже
max), но сценарий пустить под поезд мог любой void свежего батча.

Фикс: 56d115b — void-номера НЕ переиспользуются (max+1 по всем слагам),
проза future void-событий обновлена, state/route согласован. ВНИМАНИЕ АВТОРА:
это изменение объявленной семантики нумерации — если нужен реюз номеров,
 revert 56d115b частично (функция изолирована). Регрессия в selftest.

<!-- END -->
## ISSUE 08 · MEDIUM · core
**Заголовок:** [AUDIT T4-CORE-03] parseBatch тихо обрезал многострочные POS/NEG до первой строки — ложный PASS floors
**Лейблы:** core,gates,audit,fixed

**Серьёзность:** MEDIUM

gates.ts:118-119: lookahead `\n[^ \n]` обрывал POS/NEG на первой строке без
отступа (а под флагом /m и `\n*$` совпадал в конце ЛЮБОЙ строки — тот же
эффект). Многострочные блоки теряли хвост: floors судил по неполным данным —
запрещённый тег на 2-й строке давал бы ложный PASS. Писец пишет однострочно,
но ручные/RAW-батчи и будущие правки — нет.

Фикс: 37653f4 — SLOT_SECTION_BOUNDARY: ключи секций (NEG/POS/THESIS/Canon/
Spine/Stack/ENGINE/KIN/PROTOCOL/HEROINE-BATCH), шапка следующего слота,
markdown-заголовок или абсолютный конец строки (?![\s\S]). Диф-тест: 100
квитанций на T4-27/T4-29/T4-23/T4-28 идентичны до/после. Регрессии в selftest
(многострочный читается целиком, однострочный — байт-в-байт как раньше).

<!-- END -->
## ISSUE 09 · LOW · security
**Заголовок:** [AUDIT T4-SEC-04] slug шёл в path.join без валидации в CLI и ядре — traversal на чтение и запись
**Лейблы:** security,audit,fixed

**Серьёзность:** LOW (CLI локален; API-край уже валидировал)

cli.ts check/gates/deliver не валидировали slug вообще (void/scribe/recompile
валили); ядро runGates/deliverBatch — тоже: `path.join(BATCHES_DIR, slug+'.md')`
на чтение, а deliver ещё и ПИШЕТ batches/${slug}.md+json.

Фикс: 5090325 — fsutil.isSafeSlug/assertSafeSlug (T4- + [A-Za-z0-9.-], без
разделителей пути, cap длины) на краю ядра + валидация в CLI с usage-ошибкой.
Бонус: API gates/scribe расширили регэксп до суффиксных слагов (T4-27.2-EXP
легальны — раньше API отбивал их 400-й). Регрессия в selftest.

<!-- END -->
## ISSUE 10 · MEDIUM · core
**Заголовок:** [AUDIT T4-ARCH-01] RAW-батчи без контрактов молча выпадают из окна ротации
**Лейблы:** core,rotation,audit,open

**Серьёзность:** MEDIUM

Окно строится из контрактов: гейт window (gates.ts:707 `&& contract`) и
compiler foldWindowUsage (`if (!c) continue`) молча пропускают члена окна без
contracts/T4-NN.json (RAW T4-23/T4-24 сдаются без контрактов). Ребилд может
переиспользовать позы/палитры RAW-батча, и гейт этого не увидит.

Рекомендация: fallback на шапки батчей (PL/P-коды парсятся из H1-строк —
тот же парсер, что tierOf). Требует решения автора: читаем ли RAW-шапки как
первоклассный источник окна. Не фиксил без вердикта (окно — закон ротации).

<!-- END -->
## ISSUE 11 · MEDIUM · core
**Заголовок:** [AUDIT T4-ARCH-02] Ретро-активация законов: перепрогон сданных батчей сегодня даёт hard FAIL
**Лейблы:** core,gates,audit,open,needs-author-verdict

**Серьёзность:** MEDIUM

Законы живут одной головной версией (policy.json): dry-прогон T4-27/T4-28
сегодня FAIL по counter_neg_lifted/№25/№26/№27 — против обещания «first run
always clean» (gates.ts:4-5). Сданный батч, перегнанный гейтами через год,
«проваливается» законами, которых не существовало при сдаче.

Рекомендация: версионировать пакеты законов (law.version в событии
batch.delivered уже есть sha10/рецепт v — но не полный снапшот), гейты
сверяются со снапшотом момента сдачи; head-версия — только для новых сборок.
Требует вердикта автора (§10: законы — авторская территория). Не фиксил.

<!-- END -->
## ISSUE 12 · MEDIUM · core
**Заголовок:** [AUDIT T4-ARCH-03] Компилятор принимает options.engine, но игнорирует — контракт всегда 'per-theme'
**Лейблы:** core,compiler,audit,open

**Серьёзность:** MEDIUM

CLI `compile "тема" [engine]` и API {engine} передают движок (cli.ts:88,113;
compile/route.ts:41), compiler.ts:316 жёстко ставит engineKey='per-theme' —
параметр мёртв, документация CLI вводит в заблуждение. Рядом мёртвая
ocPinnedChannels (compiler.ts:489).

Рекомендация: либо честно убрать параметр из usage (миграция CLI-документации),
либо читать (валидация по policy.engines). Не фиксил — движки и их судьба
(жнец, Issue #3) — авторская тема.

<!-- END -->
## ISSUE 13 · MEDIUM · reliability
**Заголовок:** [AUDIT T4-REL-02] appendEvent без межпроцессного лока: параллельные CLI и дашборд могут интерливить log/chain
**Лейблы:** reliability,ledger,audit,open

**Серьёзность:** MEDIUM (вероятность низкая — один оператор, но следствие — расхождение хеш-цепи)

appendEvent: appendFileSync log → extendChain перечитывает ОБА файла и
дописывает цепь. Два процесса в одном окне = interleaved JSONL или
двойное звено. Частично смягчается (достроение хвоста, verify --heal),
но тампер-тревога при гонке — ложная.

Рекомендация: lockfile вокруг appendEvent (open 'wx' + stale-timeout ~5с +
retry), БЕЗ новых зависимостей. Не фиксил: лок в Next.js-процессе без
осторожной семантики может дать дедлок похуже гонки — нужен изолированный
прогон. Отдельная задача с тестом на два процесса.

<!-- END -->
## ISSUE 14 · MEDIUM · reliability
**Заголовок:** [AUDIT T4-REL-03] Писец: throw посреди цикла оставляет batches/<slug>.md без scribe.drafted — тихий дрейф файл/летопись
**Лейблы:** reliability,scribe,audit,open

**Серьёзность:** MEDIUM

scribe.ts: writeText(batchPath) происходит до гейтов/ремонта, событие
scribe.drafted — только в самом конце. Throw между ними (сеть после
частичного ремонта, guard'ы) → файл на диске, летопись молчит. Сдать такой
батч нельзя (deliver требует hard PASS — защита есть), но дрейф не
регистрируется никем.

Рекомендация: catch на верхнем уровне scribeBatch → note-событие
«scribe.aborted (файл черновика остался)» + сохранение log'а. Не фиксил:
пишет в летопись на failure-пути — при ошибочной петле это шум в append-only;
нужно решение (может, 'scribe.objection' — тип уже объявлен и не используется).

<!-- END -->
## ISSUE 15 · MEDIUM · security
**Заголовок:** [AUDIT T4-SEC-05] Граница чтения: read-key не реализован (Issue #2 закрыт декларативно), CSP отсутствует, e.message наружу
**Лейблы:** security,audit,open

**Серьёзность:** MEDIUM

1) GET-роуты (state/events/batches/contracts/specs/docs/archive) открыты;
state/route.ts честно печатает «внешний доступ = read-key, не молчание» —
но read-key не реализован. Командный замок (ISSUE 01) снял остроту, но чтение
всё ещё открыто шлюзом :81.
2) Strict-CSP не настроен (нужен nonce-пайплайн для Next inline-скриптов);
базовые заголовки добавлены (bcdb868).
3) Несколько роутов отдают e.message наружу (внутренние пути/тексты
провайдера) — стектрейсов нет, статусы корректны; стоит нормализовать.

Рекомендация: read-key (отдельный файл ~/.t4/read.key, опционален: нет
файла — reads открыты, есть — требовать заголовок); CSP с nonce; маппинг
ошибок. Каждый пункт — малый PR.

<!-- END -->
## ISSUE 16 · LOW · gates
**Заголовок:** [AUDIT T4-GATE-01] Кириллица/типографика-слепота warn-гейтов + simcheck против rebuildOf
**Лейблы:** gates,audit,open

**Серьёзность:** LOW

- simcheck/freq-report матчят `[a-z']+` — кириллические дубли не видны;
- cadence не знает типографских кавычек « »;
- periodCount ловит десятичные «2.5» как границу предложения;
- theme-presence сравнивает includes() без нормализации дефисов/кавычек
  (character-collision уже нормализует — унифицировать);
- simcheck не исключает rebuildOf-source: повторный gates на ребилде ловит
  warn на задуманном переиспользовании (windowOthersFor применяется в window,
  но не в simcheck; воспроизведено: повторный check T4-27 после ребилда — hard
  FAIL по counter_neg_lifted — пересечение с ISSUE 11).

Рекомендация: точечные фиксы, каждый с квитанцией на живом батче. Не фиксил:
warn-политика вкуса — правки меняют квитанции, автору видеть диффы.

<!-- END -->
## ISSUE 17 · LOW · data
**Заголовок:** [AUDIT T4-DATA-01] Аномалия «T4-18 delivered» при физическом T4-17.md — переименование без алиаса в state
**Лейблы:** data,audit,open

**Серьёзность:** LOW

Летопись несёт batch.delivered slug=T4-18, на диске файлов T4-18 нет
(физическое переименование в T4-17.md, задокументировано в stack-report.ts:211
как skip с меткой). state/сводки считают T4-18 сданным батчем. Согласованность
держится на знании «в голове» — нужен явный алиас (event note с oldSlug/
newSlug + fold-правило или пере-запись события объявленной операцией rebase).

<!-- END -->
## ISSUE 18 · LOW · performance
**Заголовок:** [AUDIT T4-PERF-01] extendChain O(n²) на append + неатомарные записи в tools + selftest пишет tmp
**Лейблы:** performance,audit,open

**Серьёзность:** LOW (при 301 событиях незаметно; закладка на рост)

1) extendChain перечитывает весь лог+цепь на каждое событие (events.ts) —
O(n²) кумулятивно; при 10k+ событий пересмотреть (инкрементальный хвост по
last-link). 2) build-golden-corpus.ts:84 и polish-batch.ts пишут writeFileSync
вместо атомарного writeText. 3) selftest делает atomic-write тест
(.selftest-atomic-*.tmp) → scheduleSnapshot → exit-flush автокоммитит
ПОПОДЛЯК незакоммиченные правки под сообщением «persist: ...» — необычное
поведение для CI (в CI .git нет и это no-op; у автора — сюрприз). Рассмотреть
T4_PERSIST=off внутри selftest или писать tmp вне STAGE_PATHS.

<!-- END -->
## ISSUE 19 · INFO · ops
**Заголовок:** [AUDIT T4-OPS-01] Первый CI-конвейер, typecheck/selftest/verify скрипты, security-заголовки, loopback-бинд standalone — внедрены
**Лейблы:** ops,audit,fixed

**Серьёзность:** INFO (было: CI нет, typecheck-скрипта нет, standalone слушал все интерфейсы)

- a6d10f5: .github/workflows/ci.yml — lint/typecheck/selftest/verify/build,
  permissions: contents: read, bun --frozen-lockfile (на раннере не прогонялся —
  первый пуш покажет; локально все шаги зелёные).
- bcdb868: next.config headers (nosniff/DENY/no-referrer/permissions-policy);
  start: HOSTNAME=127.0.0.1 (dev и прод теперь симметрично loopback);
  scripts typecheck/selftest/verify в package.json.
- .gitignore: *.tmp-*, .qa-shots/, commander.key.
- gen-rawplus: seed по умолчанию Date.now() — ок для боевых сборок, для
  воспроизводимости использовать --seed (selftest уже фиксирует детерминизм).

<!-- END -->
