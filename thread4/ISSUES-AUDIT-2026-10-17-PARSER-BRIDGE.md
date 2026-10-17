# Аудит-раунд №9 — «Одна правда» парсера + жёсткий мост Z.ai

Дата: 2026-10-17 · Триггер: приказ автора — полный архитектурный аудит
(architecture flaws / race conditions / memory leaks / security risks /
Big-O bottlenecks), рефактор под строгую типизацию и производительность,
результаты — в гит.

Протокол раунда: скан ядра (persist/events/fsutil/apiguard/specs/scribe/
gates/batch-md/deliver/oracle/vlm/reaper/hygiene/variety/compiler + роуты +
UI-слой), эмпирическая верификация каждого подозрения на живых данных
(65 батчей, 886 слотов), фикс, самотест, браузер-QA. Аудит №1-№8 закрыли
persist-цепь, event-lock, кэши readEvents/chain/specs, LLM-таймауты,
OC-ротацию, EXP-чистоту; этот раунд нашёл два живых класса ниже.

## Находки (строгий формат)

- Bug/Bottleneck: ДВОЙНОЙ ПАРСЕР — гейты жили своим parseBatch
  (regex-грани `SLOT_SECTION_BOUNDARY`), радар дашборда — parseBatchMd
  (BOUNDARY_RE); на живых данных 65 файлов/886 слотов расхождение 55 NEG
  (42 с ═══-разделителями/ACT-хедерами/EXP OVERLAY-баннером, 13 с хвостовым
  «---») и 33 THESIS, обрезанных до первой строки (grab `^KEY:(.*)$` —
  однострочный): гейт-floors/exp-purity/counter_neg судили ЧУЖОЙ текст —
  мусор мог ложно удовлетворить обязательные counter_neg/анти-лоли проверки,
  обрезанный THESIS прятал маркеры программы от гейта, который их требовал
  -> src/lib/t4/gates.ts:173-221 (parseBatch + SLOT_SECTION_BOUNDARY)
  Refactored Code:
  ```ts
  export function parseBatch(slug: string, text: string): ParsedBatch {
    const title = extractBatchTitle(text)
    const parsed = parseBatchMd(text)
    if (parsed == null) return { slug, text, title, slots: [] }
    const slots: ParsedSlot[] = parsed.slots.map((s) => ({
      position: Number.parseInt(s.id.replace(/^P/i, ''), 10) || 0,
      header: s.rawHeader,
      anchor: s.slug,
      meta: s.rawMeta,
      genre: genreOf(s.rawMeta),
      thesis: s.thesis,
      canon: s.canon,
      spine: s.spine,
      stack: s.stack ? (s.stack.match(/CR-[A-Z]\d{2}/g) ?? []) : [],
      pos: s.pos,
      neg: s.neg,
    }))
    return { slug, text, title, slots }
  }
  ```
  SlotMd расширен rawHeader/rawMeta (шапка сырьём — маркеры ⚗/PL##/палитры
  читаются как раньше). Эмпирическая верификация после фикса: reprobe 886
  слотов — 0 diff POS/NEG/THESIS; вердикты-квитанции T4-33/T4-34 ИДЕНТИЧНЫ
  до/после (baseline-worktree 4796cba); инварианты «одна правда» в selftest
  (4 новых: мусор-фри NEG, ≡ радару, многострочный THESIS, сырая шапка).

- Bug/Bottleneck: Z.ai-мост — ДВЕ копии loadConfig+upstream-fetch
  (/api/zai/chat/completions и /vision), обе ходят к платному upstream
  БЕЗ таймаута и БЕЗ отмены: повисший провайдер держал роут бесконечно
  (maxDuration — serverless-понятие, dev-серверу не указ), клиентский
  withTimeout в scribe/oracle лишь переставал ЖДАТЬ — fetch моста продолжал
  гореть фоновым сокетом; конфиг reparse-ился с диска на каждый LLM-вызов
  -> src/app/api/zai/chat/completions/route.ts:62-69 +
  src/app/api/zai/chat/completions/vision/route.ts:58-66
  Refactored Code:
  ```ts
  /* src/lib/t4/zai-bridge.ts — общий слой (кэш size+mtime + дедлайн) */
  export async function postChatCompletion(
    cfg: ZaiBridgeConfig,
    body: Record<string, unknown>
  ): Promise<BridgeUpstreamResponse> {
    const res = await fetch(`${cfg.upstream}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS), // 300_000
    })
    return { status: res.status, text: await res.text() }
  }
  ```
  Роуты стали тонкими: loadZaiBridgeConfig(kind) (кэш по size+mtime — паттерн
  specs.ts, сбой чтения не кэшируется, правка конфига видна без рестарта) +
  isBridgeTimeout → 504 вместо вечного висячего роута. Ключ по-прежнему
  только в заголовке, .z-ai-config — вне репо.

- Bug/Bottleneck: мёртвая петля импорта LLM-гварда — роут оракула тянул
  withTimeout/isTransientLlmError из scribe (реэкспорт-штырь аудита №3
  «для совместимости» сам стал легаси): scribe нес чужой API, зависимости
  LLM-вызовов расходились по двум модулям -> src/app/api/t4/oracle/route.ts:28
  + src/lib/t4/scribe.ts:998
  Refactored Code:
  ```ts
  import { isTransientLlmError, withTimeout } from '@/lib/t4/llm-guard'
  ```
  Реэкспорт из scribe.ts удалён (потребителей нет — проверено грепом).

## Проверенные и НЕ признанные находками (честный отчёт)

- persist.ts: межпроцессная гонка snapshotNow(CLI) vs snapshotAsync(сервер)
  — ПРИНЯТА доктриной (git упал → тихий false → следующая запись повторит),
  задокументирована в шапке модуля; менять семантику = менять Залп 1.
- useApi: реальный network-abort не прокинут в fetchJson (abort гасит только
  подписку) — сдержанно in-flight dedupe (аудит №4) уже покрывает класс;
  прокид сигнала в дедуп-мапу ломал бы вторых подписантов — осознанно
  оставлено.
- reaper.ts: двойной проход readJson по контрактам сданных батчей —
  O(2×34) sync-чтений раз в запрос оракула; не горит.
- gates/спеки/летопись: O(n)-сканы по слотам (32) и спекам (≤280) —
  квадратов нет; кэши mtime+size на местах (№4, №8).

## Верификация

- tsc 0 · eslint 0 · selftest 157/157 (+4 инварианта «одна правда»)
- reprobe: 65 файлов, 886 слотов, 0 diff POS/NEG/THESIS (parseBatch ≡
  parseBatchMd)
- Вердикты гейтов до/после: receipts T4-33 и T4-34 идентичны (baseline
  worktree 4796cba vs живое дерево) — регрессий нет; hard FAIL истории
  (T4-05/27/33/34) существует и ДО фикса (ретроактивные гейты №8), летопись
  неприкосновенна
- Цепь: 394 события / 394 звена, head ca456109fe — ЦЕЛА
- Браузер-QA (agent-browser): дашборд «цепь цела» · T4-34 в фокусе ·
  радар TRIAL-3: 4 пары σνξρ · expProgram API: 8 слотов/4 пары ·
  мобайл 390×844 · консоль и errors пусты (скрины
  /tmp/t4-qa-audit9-radar.png, /tmp/t4-qa-audit9-dashboard.png)
