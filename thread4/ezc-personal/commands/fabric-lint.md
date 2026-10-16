---
description: Lint a Thread-4 batch against Law №28 (through-fabric = X-claim) — catches through-tags on R+ slots, bumps-hygiene (dark+dry only), light-cluster violations, and NEG-mechanics before delivery
allowed-tools: Read, Bash, Grep
---

# fabric-lint — линт батча против закона №28

Прогонять по собранному батчу (thread4/batches/T4-NN.md) ДО сдачи.
Каждое попадание — либо почини слот, либо обоснуй, либо понижай заявку.

## Steps

1. **Load the batch**: Read `thread4/batches/<slug>.md`.

2. **Through-tags on R+ slots** (BLOCKER): Grep слоты с заявкой R+,
   в POS-блоке которых встречаются:
   - `nipples through`, `visible nipples`, `pokies through`
   - `wet clothes`, `wet fabric`, `see-through`, `sheer`, `transparent`
   - `nothing underneath` + светлая/мокрая ткань в том же слоте
   Каждый hit = канал через-ткани на R+ → заявка обязана стать X
   (или канал убрать).

3. **Bumps-гигиена**: слоты R+ с lead chest/breasts обязаны содержать
   P30-коктейль — `dark garment`/`black`/тёмная ткань И отсутствие
   `wet`/`sweat` на ткани (sweat на коже — можно). Светлый верх + заявка
   бугорков = FAIL.

4. **Кластер светлых ≤ 3**: пройди по порядку слотов; 4+ подряд
   light/mid-верха (white, ivory, pastel, light pink, lavender…)
   → FAIL, вставь тёмный разрыв.

5. **Купальник-исключение**: swimsuit/bikini на R+ легален (P21-золото)
   — не флажить, но проверь, что это именно купальник, а не «мокрая
   ткань, похожая на купальник».

6. **NEG-механика**: в NEG-строке батча обязаны стоять блокеры
   просвета (`nipples through clothes` и пр.), если заявки X в батче
   нет вовсе; если X-слоты есть — NEG их не трогает, но R+ слоты
   прикрываются.

7. **Отчёт**: список нарушений по позициям (P01, P04…) с вердиктом
   каждого: FIX / JUSTIFY / DOWNGRADE. Если чисто — «fabric-lint: PASS»
   в квитанцию круга писца.
