# Запрос к Гроку — грязные приёмы для разнообразия картинок в THREAD 4

> Скопируй это Гроку целиком. Он разберётся по контексту и подкинет
> приёмы, которые можно слепить из того, что у нас уже есть.

---

## Привет, Грок. У меня есть pipeline для генерации аниме-промпт-батчей, и я хочу сделать картинки **сильно разными** — не просто варьировать теги, а разные подходы к кадру. Расскажи мне **грязные приёмы**, которые я могу собрать из того, что уже есть в системе. Не теорию — конкретные техники, которые можно запихнуть в промпт-генератор.

## Контекст системы

У меня есть **конвейер** (Tsubaki.2 Pro → Yodayo — аниме-рендер платформы):

1. **Контракт** (28 слотов на батч) — описывает каждый слот:
   - `kind`: OC (канон-персонаж) / NICHE (невозможное в кадре) / VOLT (плоть-движение) / EXQUISITE (ультра своего жанра) / EXP (болванка-гипотеза)
   - `rating`: PG-13 / R / R+ / X (заявка тира)
   - `pose`: PL### — идентификатор позы из библиотеки (240 поз)
   - `palette`: P##_NAME — палитра (105 палитр, 6-цветные)
   - `kinetics`: K### — кинетика (107 вариантов, что движется)
   - `carriers`: 4 носителя на слот (CR-XX, что контактирует с телом)
   - `lead`: зона铅ного считывания (shoulders/hips/nape/thighs/collarbone/seat/chest/...)
   - `register`: student / young / milf — через форму тела, не возраст
   - `closer`: fragment-pair / dialogue / action-close / image-close / question-close
   - `diceSig`: "A1·B1·C5·D5·E6" — сигнатура 5-осевого кубика
   - `dice`: инструкция кубиков (порядок тегов / подача одежды / тема / свет / ритм)
   - `fabricTone`: dark / mid / light (закон №28)
   - `dress`: {channel, channelName, category, tone, garment, state[], underlayer, weights[], negWeights[], law} — дресс-код слота
   - `bodyType`: (новое поле, Тур 4) — для OC-слотов, из oc-canon.json
   - `variety`: (новое поле, Тур 4) — {posOrder, register, lengthClass, styleAnchor, negVariant, seed}

2. **Каналы Дрессера** (по рейтингу × тону):
   - bumps (R+ dark — бугорки без цвета, covered nipples + dark garment + fabric clinging)
   - swim_wet (R+ вне-ткани — wet clothes + swimsuit, functional не сексуализировано)
   - on_skin (R+ tape/handbra)
   - pantyline (R+ нижняя заявка — visible pantyline + tight)
   - through (X — через-ткань цветом, nipples through clothing)
   - bare (X — topless)

3. **OC-канон** (20 персонажей): каждый имеет hair / eyes / skin / body_type / signature_marks / anti_shield (что НЕ должно быть) / register (milf/student/young)

4. **Палитры** (105): 6-цветные (3 dominants + 2 accents + 1 light_type). Имена вроде "VOID BLOOD ACCENT" / "PRUSSIAN BOTTLE" / "BLOOD MOON" / "INK AND GOLD"

5. **Позы** (240): каждая с poseRisk (LOW/MID/HIGH) и семейством. Примеры: "Knees-to-Chest Sit", "Platter Bow Serve", "Robe Slip", "Hip Shift Contrapposto", "Cross-Leg Sit", "Steam-Squint Emerge", "Couch-Overhang Recline", "Shades-Lowered Look", "Laugh Head-Back", "Waltz-Box Solo", "Backbend Underboob Display", "Kneel Arch Back"

6. **Carriers** (280 носителей в 14 классах): W (wardrobe/static-cling), A (anchor/pose), B (body-shift), C (contact/gaze), S (style/mood), E (energy/motion), L (light), U (underlayer), F (flow/drape), D (dress/garment), M (material), I (intimacy), G (gesture), H (held-object). 4 носителя на слот — по одному из каждой группы

7. **Кинетики** (107): что в кадре движется — mid_free_fall, mid_sweep_count, mid_late_catch, mid_hands_claim, mid_drop_climb, etc.

8. **Спека**:
   - `policy.json` — законы (24 слота, EXP-болванки, и т.д.)
   - `oc-canon.json` — 20 OC с лока
   - `poses.json` — 240 поз
   - `palettes.json` — 105 палитр
   - `pools.json` — пулы (K кинетики, FET фетиш-теги, H hands, GAR garments, B body, etc.)
   - `engines.json` — 7 движков (одноразовые per-theme)
   - `niche-archetypes.json` (50) — невозможное в кадре (race делает ФИЗИЧЕСКУЮ работу, свидетель держит кадр)
   - `niche-doors.json` — моменты входа (UNSEEN/AFTERMATH/THRESHOLD)
   - `facts.json` — факты рендера (что работает, что нет)

## Проблема

T4-32 (28 слотов) — автор дал вердикт: **R+ 9/21** (только 43% R+ заявок доехали), **17 слотов понижено**. Главная претензия: «**стерильно**» × 14, «**слабо**» × 2, «**боди не задан**» × 1. Модель играет безопасно — одна и та же подача на всех слотах. Исторически (5 батчей) R+ delivery = 42%.

Все 28 POS выглядят по одному шаблону:
```
anime style, ecchi anime style, original character, 1girl, solo, <body>, <hair>, <eyes>, <skin>, <pose>, <garment>, <state tags>, <kinetic>, <theme words>, <lead zone>, stylized 2D anime face, <eyes spec>, small nose, small mouth, masterpiece, best quality, anime artstyle.
```

Все 28 NEG — один boilerplate (photorealistic, child, loli, signature, ...).

## Что я уже пытаюсь (Тур 4 — Variety Engine)

Каждый слот получает пакет разнообразия (детерминированно по хешу slug+position):
- **posOrder**: body-first / pose-first / env-first / canon-first / claim-first
- **register**: casual / dramatic / exotic / tense
- **lengthClass**: short (18-24 тегов) / medium (25-35) / long (36-50)
- **styleAnchor**: watercolor / painterly / clean-lineart / sketch / detailed-ink / none
- **negVariant**: 4 разных NEG-шаблона (classic-anti-real / anatomy-precision / lighting-color / clothing-control)

Также добавил:
- **body_type** в контракт (для OC-слотов из канона) — писец вплетает в POS
- **negWeights** (веса 1.2/1.3 в NEG, не через PH) — photorealistic:1.3, child:1.2, loli:1.2, + канал-специфичные

## Что я хочу от тебя

**Грязные приёмы разнообразия**, которые я могу слепить из того, что есть. Не общие советы («делай разные позы»), а **конкретные техники**, которые впишутся в мою структуру (контракт → писец → рендер):

### 1. Приёмы для РАЗЛИЧНЫХ ПОДХОДОВ к кадру
Например:
- «На 1/4 слотов ставить НЕ-cowboy angle (close-up face only / full body / Dutch angle)»
- «Менять照明-source: rim light / spotlight / ambient / hard shadow — каждому слоту своё»
- «Witness-object (третий глаз кадра) делать ТОЛЬКО на 1/3 слотов, чтобы не повторяться»
- «Pacing: короткие dramatic слоты (20 тегов, dense) чередовать с длинными atmospheric (45 тегов, env-rich)»
- «Mood: 28 слотов = 7 moods × 4 слота (serene / unsettling / playful / menacing / nostalgic / electric / hazy)»

### 2. Приёмы для ПРОТИВО-СХОДИМОСТИ модели
Модель (Yodayo) имеет тенденцию играть безопасно — игнорирует рискованные теги, рисует «милую девочку». Что её ломает:
- **Перверсия порядка тегов** — поставь `wet clothes` ПЕРВЫМ тегом → модель не игнорирует
- **Веса 1.3 на ключевые** — `(covered nipples:1.3)` вместо `covered nipples`
- **NEG-ловушки для X-тегов на R+** — `(nipples through clothing:1.3)` в NEG блокирует апгрейд до X
- **Анти-дефолт теги в NEG** — `(standing pose:1.3)`, `(default pose:1.3)` — давит на дефолт
- **Style anchors** — `watercolor style` vs `clean lineart` vs `painterly` меняет весь look

### 3. Приёмы для РАЗЛИЧНЫХ ПОЛОТЕН (canvas styles)
Разные визуальные регистры в одном батче:
- 4 слота — pastel watercolor (мягкие цвета, акварель)
- 4 слота — high-contrast ink (тёмные линии, белые высветы)
- 4 слота — painterly oil (масляная текстура)
- 4 слота — clean anime lineart (плоские цвета, контур)
- и т.д.

### 4. Приёмы для РАЗЛИЧНЫХ КАМЕР И РАКУРСОВ
- Dutch angle (наклон 15-30°) — на tense-слоты
- Top-down (птичий полёт) — на serene
- Worm's eye (снизу) — на dramatic/power
- Close-up face only — на intimate
- Wide environmental — на NICHE
- Over-shoulder (через плечо) — на VOLT

### 5. Приёмы для РАЗЛИЧНЫХ ВРЕМЁН СУТОК / СВЕТА
- Dawn (тёплый, рассеянный)
- Noon (жёсткий, верхний)
- Dusk (тёплый, низкий)
- Night (контрастный, искусственный)
- Studio (контролируемый)
- Underwater (искажённый, синий)

### 6. Приёмы для КОМПОЗИЦИОННОЙ РАЗНОСТИ
- Rule of thirds vs centered vs diagonal vs golden ratio
- Negative space variations
- Foreground/background framing
- Mirror/water reflection
- Window/doorway framing

### 7. Приёмы для РАЗЛИЧНЫХ СЮЖЕТНЫХ БИТОВ (story beat)
- «Перед/после» — слот показывает момент до/после действия
- «Свидетель» — слот показывает реакцию, не само действие
- «Двойная экспозиция» — два образа в одном кадре
- «Подмена» — одна часть тела заменена другим (рука=крыло)
- «Застывший момент» — экшен в статике (капля висит)

### 8. Приёмы для РАЗЛИЧНЫХ ПЕРСОНАЖНЫХ АРХЕТИПОВ (для non-OC слотов)
- Инок (монахиня-воин)
- Куртизанка (придворная)
- Преступница (воровка)
- Жрица (храмовая)
- Курьер (городская)
- Кочевница (степная)
- Кукловод (театральная)
- и т.д.

### 9. Приёмы для РАЗЛИЧНЫХ ДВИЖКОВ (theme engines)
Не просто VOID GRAVITY (искажение-физика), а другие движки:
- FLORAL BLOOM — растения растут из тела
- LIQUID METAL — ткань=жидкий металл
- PHANTOM PHASE — части тела фазируются сквозь материю
- PUPPET JOINT — тело как марионетка (шарниры)
- GLASS FRACTURE — тело как разбитое стекло
- INK BLEED — контуры текут, акварельный эффект
- и т.д.

### 10. Конкретные «грязные» приёмы, которые работают на Yodayo
Это самое важное — что РЕАЛЬНО ломает модель из её safe-режима:
- Tags которые форсируют экшен (вместо позы-дефолта)
- Tags которые меняют палитру радикально (black-and-white / monochrome / duotone)
- Tags которые ломают композицию (asymmetric / off-center / dutch angle / extreme close-up)
- Tags которые форсируют материал (oil paint / watercolor / pencil sketch / 3D render)
- Tags которые меняют mood (foreboding / unsettling / melancholic / euphoric)

## Что я хочу получить от тебя

Список из **30-50 грязных приёмов**, каждый в формате:

```
### N. Название приёма
- **Что делает**: краткое описание
- **Как внедрить**: конкретные теги/значения для POS или NEG
- **На какие слоты**: рекомендация (1/4 всех / только tense / только NICHE / и т.д.)
- **Что ломает у модели**: что этот приём заставляет модель перестать делать (дефолт-позу, дефолт-палитру, и т.д.)
- **Риск**: что может пойти не так (стиль не доехал, цензура, и т.д.)
```

Чем грязнее — тем лучше. Я ищу техники, которыеBreak-the-model-out-of-its-safe-default. Не бойся предлагать радикальное — у меня есть гейты и проверка, я отфильтрую.

## Дополнительно

Если видишь, что из моего контракта можно собрать **архитектурно новую фичу** (не просто приём, а целую подсистему) — скажи. Например:
- «Заменить fixed spread (R+×21 + R×7) на adaptive spread по историческим delivery rates»
- «Перейти с 4 тиров на 6 (R++, R+, R, R-, PG-13, X) с разными правилами»
- «Сделать слоты с АВТО-МУТАЦИЕЙ (каждый N-ый слот наследует теги предыдущего + одну замену)»

Архитектурные идеи welcome, но **30-50 грязных приёмов** — приоритет.

Спасибо. Сделай это и я тебе еще принесу задач.

---

## Технические детали (если нужно)

- Yodayo рендерит аниме в стиле NovelAI/Danbooru (не SD)
- Теги — danbooru-style, разделены запятыми
- Веса — `(tag:1.3)` синтаксис
- Длина промпта: 18-50 тегов оптимально (короткие = dense, длинные = atmospheric)
- NEG — отдельный блок, теги rejection
- PH (placeholder) протокол — мы НЕ работаем через него, пишем сразу raw
- OC имена НЕ пишем в POS (триггерят foreign characters) — описываем дескрипторами
- Канон OC (hair/eyes/skin/body_type) — ВЕРБАТИМ в POS (можно weights 1.2 на канон-тегах)
