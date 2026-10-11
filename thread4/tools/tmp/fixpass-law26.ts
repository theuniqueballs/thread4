import { appendEvent } from '../../../src/lib/t4/events'

appendEvent(
  'fixpass.paid',
  'T4-28 ретро-фикс №2 (приказ автора «зачем ты в позитиве всегда пишешь название темы… буквально всё, что ты там пишешь, переходит на сам рендер»): из всех 24 POS удалено название темы «dead on the inside» и прозаические якоря-абстракции (phantom strain, caught changing, study weight, waltz decay, rain truth…) — тема доезжает только отрисуемым (staticky clothes, палитры, свет-на-зоне, выражения лиц). Ресёрч: тот же корень в T4-25 (no normal options ×21), T4-26 (the other version ×52), T4-27/27.2 (the extraordinary…) — история не переписывается, закон силён с T4-28. Пайплайн вылечен: писец (THEME AS DRAWABLES ONLY, золотой пример очищен), полировщик (№26), гейт raw-plus (тайтл в POS — full-фраза и пробег ≥3 слов, hard). Слоты/темы/акты/спайны/стеки/каноны без изменений. Прогоны: gate.run #5 hard PASS (sha 7fc06f1962) · selftest 96/96 · verify 286 ЦЕЛА · рендер-лист регенерирован.',
  {
    slug: 'T4-28',
    law: 26,
    fix: 'theme-title-removed-from-pos',
    slots: 24,
    gateRun: 5,
    sha10: '7fc06f1962',
  }
)
console.log('fixpass.paid OK')
