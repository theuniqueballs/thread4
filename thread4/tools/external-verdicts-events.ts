/**
 * Задача 7 (сессия 2026-09-23): запись внешних вердиктов как первоисточников
 * + законы + спек + ретроспектива — 9 событий. Одноразовый скрипт.
 */
import { appendEvent } from '../../src/lib/t4/events'
import { runGates } from '../../src/lib/t4/gates'

/* ---- 1. external.review — ChatGPT (первоисточник) ---- */
appendEvent(
  'external.review',
  'Внешний вердикт №1 (ChatGPT, доставлен автором в чат): ЗАКОН САЛИЕНСА — signal-tag ≠ visual salience; PRESENT ≠ VISIBLE ≠ LEGIBLE; цепочка OBJECT → EXPOSURE → CAMERA → CONTRAST → SALIENCE → INTERPRETATION (провал звена роняет тир); три failure modes; вердикты подходов PRACTICAL / UNCONVENTIONAL / ASYMMETRIC BET',
  {
    reviewer: 'ChatGPT',
    delivered_by: 'автор (чат, 2026-09-23)',
    kind: 'первоисточник',
    salience_law: {
      thesis: 'signal-tag ≠ visual salience: PRESENT ≠ VISIBLE ≠ LEGIBLE',
      chain: ['OBJECT (именованная заявка)', 'EXPOSURE (зона открыта камере)', 'CAMERA (камера-участник)', 'CONTRAST (свет НА зоне заявки)', 'SALIENCE (заявка рано в тег-ране)', 'INTERPRETATION (подача — зачем показано)'],
      rule: 'провал любого звена роняет тир',
      distinctions: 'анатомический сигнал ≠ артефакт ≠ складка; NICHE ИСПОЛЬЗУЕТ расу (механизм), а не надевает (костюм)',
      proven_killers: ['T4-04 P05 «dark» — мокрая тёмная ткань без света = «некрасивое пятно»', 'T4-04 P03 — светлое на светлом = слияние с фоном, мёртвый слот'],
    },
    failure_modes: {
      a: 'текст ≠ визуал — сигнал заявлен в промпте, визуально не читается',
      b: 'механика без следствия — состояние есть, edge нет',
      c: 'следствие без edge — «выглядит эротично, но ничего эротического не делает»',
    },
    ph_mutation_layer: 'PH = adversarial mutation layer: рендерер мутирует заявку (sheet→рубашка P03, леотард→халат P22, вышка→вагончик P24 — пойманы VLM 24/24); kill criterion — мутация заявки = слот мёртв',
    verdicts: {
      PRACTICAL: 'мокрая ткань / просвет / подача — единственный живой R+-канал (3/3 на T4-04)',
      UNCONVENTIONAL: 'NICHE с расой-механизмом — раса делает физическую работу в кадре',
      'ASYMMETRIC BET': 'X-слоты — площадка душит, но блок покрытия в NEG доставляет 4/4; art-for-art',
    },
    codified_as: ['CONSTITUTION §9-секста', 'гейт salience-chain (advisory)', 'ловушка T16 в контрактах'],
  }
)

/* ---- 2. external.review — Claude (первоисточник) ---- */
appendEvent(
  'external.review',
  'Внешний вердикт №2 (Claude, доставлен автором в чат): 5 рекомендаций — rating-delivery адаптер НАД движком · taste-стата доставки · институционализированный A/B · noun-lock · VLM-первый-проход',
  {
    reviewer: 'Claude',
    delivered_by: 'автор (чат, 2026-09-23)',
    kind: 'первоисточник',
    proposals: [
      { id: 1, name: 'rating-delivery adapter', essence: 'доставка рейтинга — адаптер НАД движком, не функция движка: иначе все 10 сойдутся в «мокрую ткань + подающую позу» и раскол NICHE/VOLT сотрётся; «переделать» = надеть адаптер и проверить доставку' },
      { id: 2, name: 'taste-стата доставки', essence: 'carrier × state × engine × pose-family → эмпирическая частота R+/R/PG-13 по вердиктам автора; гейт проверяет заявку, компилятор максимизирует ожидаемый тир' },
      { id: 3, name: 'институционализированный A/B', essence: '2-3 парных слота на батч — СИСТЕМНО, а не случайно как P10: один канал, разная подача; вердикт атрибутирует канал' },
      { id: 4, name: 'noun-lock', essence: 'заявка лочится существительным (именованная вещь + цель); тишина по подслою = дыра — подслой лочится в NEG' },
      { id: 5, name: 'VLM-первый-проход', essence: 'слепой структурный фильтр до глаза автора: машине не показывается заявка (иначе якорится), карточка читается фактом, сопоставление — работа автора; валидация 24/24 на T4-04' },
    ],
    codified_as: ['ENGINE_FORGE Кузница 2.0 (рекомендация 1)', 'specs/delivery-stats.json v0.1.0 (рекомендация 2)', 'CONSTITUTION §10-поправка + A/B в компиляторе (3)', 'гейт noun-lock + подслой-лок в писце (4)', 'слепой режим VLM + панель «VLM первый проход» (5)'],
  }
)

/* ---- 3. law.amended §9-секста ---- */
appendEvent(
  'law.amended',
  'Конституция §9-секста — ЗАКОН САЛИЕНСА (внешний вердикт ChatGPT): signal-tag ≠ visual salience; PRESENT ≠ VISIBLE ≠ LEGIBLE; рейтинг = цепочка OBJECT → EXPOSURE → CAMERA → CONTRAST → SALIENCE → INTERPRETATION, провал звена роняет тир; сигнал ≠ артефакт ≠ складка; NICHE ИСПОЛЬЗУЕТ расу; PH = adversarial mutation layer с kill criterion',
  {
    section: '§9-секста',
    authority: 'external.review №1 (ChatGPT), доставлен автором 2026-09-23',
    diff: ['+6 звеньев цепочки салиенса в конституцию', '+различение сигнал/артефакт/складка', '+3 failure modes канонизированы', '+ловушка T16 (свет на зоне заявки) в контракты', '+advisory-гейт salience-chain'],
  }
)

/* ---- 4. law.amended §10-поправка ---- */
appendEvent(
  'law.amended',
  'Конституция §10-поправка — ДИСЦИПЛИНА ИЗМЕРЕНИЯ (внешний вердикт Claude): A/B-дисциплина (2-3 пары на батч, назначает компилятор по LEAD-зоне — системно, не случайно как P10) · noun-lock (заявка существительным, подслой лочится в NEG — тишина = дыра) · VLM-первый-проход (слепой: машине не показывается заявка, тир — только глаз автора, X неверифицируем фильтром)',
  {
    section: '§10-поправка',
    authority: 'external.review №2 (Claude), доставлен автором 2026-09-23',
    diff: ['+A/B-пары в компиляторе (SlotPlan.ab, 2-3 пары R+ по LEAD-зоне)', '+A/B-строка в slotFrame писца', '+warn-гейт noun-lock', '+подслой-лок (bra/camisole/bandeau/undershirt) в assembleNeg автоматически', '+слепой режим VLM (feedback route)'],
  }
)

/* ---- 5. law.amended Кузница 2.0 ---- */
appendEvent(
  'law.amended',
  'Кузница 2.0 — ПОПРАВКА ОРТОГОНАЛЬНОСТИ (рекомендация Claude №1, без отмены приказа о движках): доставка рейтинга — адаптер НАД движком, не функция движка; иначе все 10 движков сойдутся в «мокрую ткань + подающую позу» и раскол NICHE/VOLT сотрётся. «Переделать» = надеть адаптер и проверить доставку. Движок = ось чуда, адаптер = ось плоти (delivery-stats)',
  {
    section: 'ENGINE_FORGE — Кузница 2.0',
    authority: 'external.review №2 (Claude), рекомендация №1',
    diff: ['+секция ортогональности в ENGINE_FORGE.md', 'движок остаётся мировым законом; рейтинг выбирается по стате доставки', 'примечание R+-жадности glamour-tax — историческая черта, не лицензия'],
  }
)

/* ---- 6. spec.imported delivery-stats ---- */
appendEvent(
  'spec.imported',
  'Спек delivery-stats.json v0.1.0 — 13 каналов доставки рейтинга с частотами из реальных вердиктов (рекомендация Claude №2): живые — wet-sheer+подача R+ 3/3, X-рецепт 4/4, геометрия R 13/14; мёртвые — wet-sheer без подачи 0/4, cameltoe 0/15, подслой 0/4, static cling, tape-only, dry-sheer, OC R+ 0/3; артефакты — пятно-без-контраста (P05/P03), name-mutation; особый — стохастика ~1/8. Закон: гейт проверяет заявку, компилятор максимизирует ожидаемый тир',
  {
    spec: 'delivery-stats',
    version: '0.1.0',
    channels: 13,
    live: ['wet-sheer-delivery 3/3', 'x-coverage-block 4/4', 'r-geometry 13/14'],
    dead: ['wet-sheer-flat 0/4', 'cameltoe 0/15', 'underlayer 0/4', 'static-cling 0/1', 'tape-only 0/2', 'dry-sheer 0/2', 'oc-rplus 0/3'],
    artifact: ['dark-spot (T4-04 P05/P03)', 'name-mutation (sheet→рубашка, леотард→халат, вышка→вагончик)'],
    special: ['stochastic-reroll ~1/8'],
  }
)

/* ---- 7. taste.datum ---- */
appendEvent(
  'taste.datum',
  'Вкус × внешние вердикты: PRACTICAL (мокрая ткань/просвет/подача — единственный живой R+-канал, 3/3) · UNCONVENTIONAL (NICHE использует расу-механизм, не надевает) · ASYMMETRIC BET (X: площадка душит, блок покрытия доставляет 4/4 — art-for-art). Три failure modes + PH как adversarial mutation layer с kill criterion записаны в TASTE.md (эвристики №12-13)',
  {
    verdicts: ['PRACTICAL', 'UNCONVENTIONAL', 'ASYMMETRIC BET'],
    heuristics_added: [12, 13],
    doc: 'thread4/TASTE.md (секция «Внешние вердикты 2026-09-23»)',
  }
)

/* ---- 8. note — ретроспектива T4-04 ---- */
{
  const r = runGates('T4-04', true) // сухой прогон: событие не пишется
  const sc = r?.receipts.find((x) => x.gate === 'salience-chain')
  const nl = r?.receipts.find((x) => x.gate === 'noun-lock')
  const header = sc?.findings[0] ?? ''
  appendEvent(
    'note',
    `Ретроспектива T4-04 (новые гейты всухую, до рендера-вердикта): salience-chain — ${header}; P05 предсказан «мокрая тёмная ткань без света — пятно-риск» (= «некрасивое пятно» вердикта), P03 предсказан «светлое на светлом — слияние» (= мёртвый слот), все три успеха (P10/P13/P16) — «цепочка цела». noun-lock — ${nl?.findings.length ?? 0} дыр: 11× тишина по подслою (NEG без bra/camisole) + P18 без именованной вещи. Батч сдан до закона — квитанции документируют дыру, T4-05+ пишет с подслой-локом автоматически`,
    {
      retro_of: 'T4-04',
      gates: ['salience-chain', 'noun-lock'],
      salience_header: header,
      predicted_failures: ['P05 пятно-риск', 'P03 слияние с фоном'],
      successes_clean: ['P10', 'P13', 'P16'],
      noun_lock_holes: nl?.findings.length ?? 0,
    }
  )
}

/* ---- 9. note — правоприменение/резюме ---- */
appendEvent(
  'note',
  'Правоприменение внешних вердиктов завершено: 16 → 18 гейтов (noun-lock warn, salience-chain advisory); писец ставит подслой-лок (bra/camisole/bandeau/undershirt) в NEG автоматически под сквозь-ткань заявки; компилятор назначает 2-3 A/B-пары R+-слотов по LEAD-зоне (системно, не случайно как P10); VLM переведён на слепой протокол (заявка слота машине не показывается); приёмник батча пишет весь батч одной записью render.verdict (slots + scoreboard)',
  {
    gates_total: 18,
    scribe: '+underlayer-lock, +A/B-строка, +SALIENCE LAW в системный промпт',
    compiler: '+abPairs (2-3 по LEAD-зоне), +abDiscipline/salienceLaw/underlayerLock в законы контракта',
    vlm: 'слепой режим — структурная карточка без заявок, фильтр 400/1301 = X неверифицируем',
    receiver: 'одна запись на батч (source=author-batch): slots + scoreboard + расхождения ↑↓',
  }
)

console.log('9 событий записано')
