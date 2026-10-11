import { appendEvent } from '../../../src/lib/t4/events'

appendEvent(
  'law.ratified',
  'Закон №25 «NEG-гигиена» (авторский приказ из чата, ретро-фикс T4-28): в NEG слота R+/R/PG-13 запрещены 15 терминов — visible pantyline, topless, exposed breasts, naked, nude, bare breasts, nsfw, nipples through clothing, clothed nipples, extreme fanservice, exposed genitals, vulva, pubic hair, sex, sexual act. NEG лочит подслой и дрейф, никогда — заявку/ступень/слой; X-блок снят с universal сборки (X-граница — конструктивно, закон №21). Рецепт v1.7.0; ревизии: №23 enforcement (маркер RAW+ в H1 обязателен, вторая дверь — движок контракта), BODY-SPECTRUM обязателен (форма по регистрам, защита планов формой), якоря пропов, заявки ≤16-го тега. Ресёрч канона T4-25…T4-27.2.',
  { law: 25, source: 'author-chat-order', batch: 'T4-28', recipe: '1.7.0' }
)

appendEvent(
  'fixpass.paid',
  'T4-28 ретро-фикс (приказ автора «руинишь картинки»): 24 слота переписаны в чистый RAW+ — проза/диалоги/монологи из POS удалены (закон №23, face-блок тегом, палитры sd_fragment, свет-на-зоне, якоря пропов, body-планы по регистрам, волосы/глаза по контракту E3); NEG перестроен по канону (X-блок и NSFW-дамп сняты — закон №25, двойной замок заменён подслой-локом — закон №14 M9, ANTI-WASH добавлен — Five Locks); H1 несёт маркер RAW+ — гейт raw-plus активировался. Слоты/темы/акты/спайны/стеки/каноны/REHAB — без изменений. Прогоны: hard PASS, selftest 96/96, рендер-лист регенерирован. Салience-прогноз: под угрозой 3 слота (было 8 в v1).',
  { slug: 'T4-28', revision: 'rawplus-retrofix', runs: 4 }
)
console.log('events appended')
