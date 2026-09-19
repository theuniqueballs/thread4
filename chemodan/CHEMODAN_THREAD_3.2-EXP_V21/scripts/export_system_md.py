#!/usr/bin/env python3
"""
Task 20 (2026-09-09) — author order: «сунь всё что мы используем в файлы .md».
Exports the whole THREAD 3.2-EXP-V13 working system into download/ as Markdown.
Source of truth stays /home/z/my-project/system/ — re-run after every cycle.
"""
from pathlib import Path

SYS = Path("/home/z/my-project/system")
DL = Path("/home/z/my-project/download")
STAMP = "2026-09-16"


def w(path: Path, text: str):
    path.write_text(text, encoding="utf-8")
    print(f"  {path.name:44s} {path.stat().st_size:>9,} bytes")


def esc(s: str) -> str:
    return s.replace("|", "\\|")


# ---- 1. faithful copies --------------------------------------------------
print("copies:")
for src, dst in [
    (SYS / "RULES.md", DL / "RULES.md"),
    (SYS / "RATING_MAP.md", DL / "RATING_MAP.md"),
    (SYS / "RULES_CORE.md", DL / "RULES_CORE.md"),
    (SYS / "RULES_HISTORY.md", DL / "RULES_HISTORY.md"),
    (SYS / "EXAMPLE_BATCH_GOD_LEFT_THE_LIGHTS_ON.md",
     DL / "EXAMPLE_BATCH_GOD_LEFT_THE_LIGHTS_ON.md"),
]:
    w(dst, src.read_text(encoding="utf-8"))

# ---- 2. YAML machinery -> fenced .md --------------------------------------
print("yaml exports:")
DESC = {
    "CONSTRAINTS": "Hard-constraint registry (C-codes) — the project's binding limits.",
    "TRACKER": "Rotation ledger. ACTIVE WINDOW = N22+N23+N24 (the N25 pre-flight lives here); history in TRACKER_ARCHIVE.yaml.",
    "MOTIF_LOG": "Motif usage counters + fossilization watch. ACTIVE WINDOW = N22+N23+N24; history moved to MOTIF_LOG_ARCHIVE.yaml.",
    "ONTOLOGY": "The house dictionaries: genres, states, NCS/LLS vocabulary, kebab taxonomy.",
    "PALETTE_LIBRARY": "Palettes P21-P88 (6 slots each; TINT family P83-P88) + the SATURATION DOCTRINE (the five locks).",
    "POOLS_V8": "Item pools v9.3.0: K158-174 (v7 coastal register + OC-exempt), mechanics-first families, H01-H20, GAR41-56 (v2 swimwear failure family), CAM13-18, ENV/OAS word law.",
    "POSE_LIBRARY": "Poses v2.0: PL01-PL60 incl. the EROTIC PRESENTATION family (PL49-60) + camera pairs.",
    "CARRIER_LIBRARY": "R/R+ delivery-mechanism pool v1.0.0 (V19): 280 positions × 14 classes × 4 mechanism groups — the core-4 vocabulary (RULES §61 / RATING_MAP §4E-§4G).",
    "SUCCESS_LOG": "Path B white list: canonizations + RF-001..003 render verdicts + violations/returns ledgers (RULES §56C).",
    "ENGINES": "The theme-engine library (BESPOKE/TINT/COUNTERFALL/CANTUS/LIMEN + seeds): law / on_body / strong_pairs / failure_modes per engine.",
}
for stem, desc in DESC.items():
    src = SYS / f"{stem}.yaml"
    body = src.read_text(encoding="utf-8").rstrip("\n")
    fence = "~~~" if "```" in body else "```"
    w(DL / f"{stem}.md",
      f"# {stem}\n\n{desc}\n\n"
      f"> Export {STAMP}. Source of truth: `/home/z/my-project/system/{stem}.yaml` "
      f"(refresh this .md after every cycle).\n\n{fence}yaml\n{body}\n{fence}\n")

# ---- 3. BATCH_HISTORY.tsv -> md -------------------------------------------
print("history:")
tsv = (SYS / "BATCH_HISTORY.tsv").read_text(encoding="utf-8").splitlines()
old_rows = [l.split("\t") for l in tsv if l and l[0].isdigit()]
tbl = ["| # | Theme | Spec | OC | Path |", "|---|-------|------|----|------|"]
for r in old_rows:
    r = (r + [""] * 6)[:6]
    tbl.append(f"| {esc(r[0])} | {esc(r[1])} | {esc(r[2])} | {esc(r[4])} | `{esc(r[5])}` |")

new_rows = [
    ("12", "EVERY BODY IS A PATTERN", "v3.2-EXP-V8",
     "Ash R+ / Sue R+ / Lua R", "download/BATCH_N12_EVERY_BODY_IS_A_PATTERN.md"),
    ("13", "Dernier Été", "v3.2-EXP-V8",
     "Lyn R+ / Rue R+ / Mab R+ (intro)", "download/BATCH_N13_DERNIER_ETE.md"),
    ("14", "TENCENCIES", "v3.2-EXP-V8",
     "Zia R+ / Rin R+ / Sue X (MILF-MODE)", "download/BATCH_N14_TENCENCIES.md"),
    ("15", "An Archive of Imaginary Memories", "v3.2-EXP-V8",
     "Lyn / Rue / Mab (tarot echoes)", "download/BATCH_N15_AN_ARCHIVE_OF_IMAGINARY_MEMORIES.md"),
    ("16", "AN ANATOMY OF A SYNTHETIC SOUL (re-themed, 2nd delivery)", "v3.2-EXP-V8",
     "none mounted — OC_ORDERS_N16 (SET1) + SET2 separate", "download/BATCH_N16_ANATOMY_OF_A_SYNTHETIC_SOUL.md"),
    ("17", "You Were Beautiful in the Wrong World", "v3.2-EXP-V8",
     "Zia / Rin / Una (tarot, R+)", "download/BATCH_N17_YOU_WERE_BEAUTIFUL_IN_THE_WRONG_WORLD.md"),
    ("18", "Too Much Feeling, Not Enough Time", "v3.2-EXP-V8",
     "none mounted — OC_ORDERS_N18 (SET3) separate", "download/BATCH_N18_TOO_MUCH_FEELING_NOT_ENOUGH_TIME.md"),
    ("19", "The Abyss Has a Memory", "v3.2-EXP-V9",
     "none mounted — OC_ORDERS_N19 (SET4: Miyu/Noa/Yui) separate",
     "download/BATCH_N19_THE_ABYSS_HAS_A_MEMORY.md"),
    ("20", "物の哀れ — Mono no Aware", "v3.2-EXP-V9",
     "none mounted — OC_ORDERS_N20 (SET5: Sol/Nix/Mab) separate + SP-05",
     "download/BATCH_N20_MONO_NO_AWARE.md"),
    ("21", "Perhaps We Were the Dream", "v3.2-EXP-V11 → V12 rev2 → V13 rev3 (tag-delivery + maturity)",
     "none mounted — OC_ORDERS_N21 (SET6: Lua/Vae/Zia) separate",
     "download/BATCH_N21_PERHAPS_WE_WERE_THE_DREAM.md"),
    ("22", "A World Slightly Out of Place", "v3.2-EXP-V14 (§53A/§54, PH ON)",
     "OC SET7 (Sue/Ash/Una R+) + SP-06 separate", "download/BATCH_N22_A_WORLD_SLIGHTLY_OUT_OF_PLACE.md"),
    ("23", "Sin Looks Good on You", "v3.2-EXP-V14 (BESPOKE debut)",
     "OC SET8 (Lyn/Rue/Rin R+) separate", "download/BATCH_N23_SIN_LOOKS_GOOD_ON_YOU.md"),
    ("24", "Blue Is the Loneliest Color", "v3.2-EXP-V15 (§17B freq, LEAD axis, K-RETURN)",
     "OC SET9 (Sol/Doe/Lua R+) separate", "download/BATCH_N24_BLUE_IS_THE_LONELIEST_COLOR.md"),
    ("25", "The Rain Fell Upward", "v3.2-EXP-V16 (COUNTERFALL, Path B)",
     "OC (color-inversion) separate", "download/BATCH_N25_THE_RAIN_FELL_UPWARD.md"),
    ("26", "Silence Is the Slowest Undressing", "v3.2-EXP-V16 (CANTUS debut)",
     "OC (the CANTUS trio) separate", "download/BATCH_N26_SILENCE_IS_THE_SLOWEST_UNDRESSING.md"),
    ("27", "Somewhere Between Here and Magic", "v3.2-EXP-V17 (LIMEN debut, §58 pose-decisive)",
     "OC SET2-era (Mab/Lyn/Ash) + EXQ-01 separate", "download/BATCH_N27_SOMEWHERE_BETWEEN_HERE_AND_MAGIC.md"),
    ("28", "Nobody Knows", "v3.2-EXP-V18 (ARCANA debut, §60 PH-proof)",
     "OC SET3 (Lua/Una/Yui R+) separate", "download/BATCH_N28_NOBODY_KNOWS.md"),
    ("29", "No One Wrote This Scene", "v3.2-EXP-V19 (APOCRYPHA debut, §61 first run)",
     "OC MERGED: Rue/Rin/Nix R+ ride the batch as P01-P03 (one file of 21 — the author's merge order)",
     "download/BATCH_N29_NO_ONE_WROTE_THIS_SCENE.md"),
]
for n, theme, spec, oc, path in new_rows:
    tbl.append(f"| {n} | {esc(theme)} | {esc(spec)} | {esc(oc)} | `{esc(path)}` |")

w(DL / "BATCH_HISTORY.md",
  "# BATCH HISTORY — N01 → N29\n\n"
  f"> Rows 1–11: faithful export of `system/BATCH_HISTORY.tsv` (predates N12).\n"
  f"> Rows 12-21: reconstructed from the delivered batch headers.\n"
  "> N19 ratings: PG 2 / PG-13 1 / R 5 / R+ 11 / X 2 · ladder v3.2-EXP-V9 + "
  "the 2026-09-09 platform-empirics amendment (Yodayo reads TAPE/pasties/maebari as R+).\n"
  "> N20 honest re-audit (2026-09-09 evening, rating_gate_lint.py / §50): labels claimed "
  "R 9 / R+ 10 / X 2; payload EARNED R+ 1 (P05) / X 2 / R 1-2 / PG-13 16 — the trigger for "
  "RATING_MAP v1.0. Labels from N21 on are contracts the gate enforces.\n"
  "> N21 rev2 (2026-09-10 evening, V12/§52 TAG-DELIVERY LAW): the author's verdict — beauty "
  "PASS, rating FAIL; 24 stack-matched raw-tag layers injected, 14 self-ban NEG terms removed; "
  "gate v2 (tag floor + NEG parity) now a mandatory stage with exit code.\n"
  "> N21 rev3 (2026-09-11, V13/§53 MATURITY & HELPER LAW): the author's PH-off experiment — "
  "renders drifted young without the Prompt Helper; 24 «mature female» tag anchors, 23 "
  "«grown woman» face anchors, 24 anti-loli NEG floors; render protocol R/R+/X with PH OFF.\n\n"
  + "\n".join(tbl) + "\n")

# ---- 4. README index --------------------------------------------------------
print("index:")
readme = f"""# THREAD 3.2-EXP-V14 — рабочие файлы (индекс обновлён {STAMP})

Всё, чем живёт проект. Источник правды — `/home/z/my-project/system/`; эта папка — выгрузка для скачивания, обновляется каждый цикл.

## Правила и системы
- **RULES.md** — v3.2-EXP-V13: правила конвейера (§1–§53).
- **RULES_CORE.md** — действующее право §1-§53 без changelog (быстрая загрузка) · **RULES_HISTORY.md** — changelog + карта суперцессий §41 — лестница рейтингов Yodayo (PG / PG-13 / R / R+ / X) + платформенная правка про tape. §50 — RATING HONESTY LAW: метка зарабатывается, гейт обязателен с N21. §51 — SATURATION DOCTRINE (2026-09-10): пять замков против «маски блеклости». §52 — TAG-DELIVERY LAW (2026-09-10, вечер): диффузия читает теги, а не поэзию — этаж сырых тегов + запрет NEG банить пейлоад собственного тира (N21 post-mortem). §53 — MATURITY & HELPER LAW (2026-09-11): R/R+/X рендерится с PH OFF; якорь взрослости (mature female + grown woman) и анти-лоли NEG-флор — наши, не хелпера (PH-эксперимент автора).
- **RATING_MAP.md** — v2.1 (2026-09-11): карта степени цензуры — тиры × носители (классы A–H + W) × доля payload × фрейминг; чёрный список хеджей; ритуал «тир-первым»; §4A ЗАКОН ДОСТАВКИ ТЕГОВ (этажи R≥1/R+≥3/X≥2 + банк); §4B NEG-PAYLOAD PARITY; §4C MATURITY FLOOR (анти-чиби); §12 пост-мортем N21; §13 вскрытие PH-слоя (специмен автора: PH — санитайзер и родной диалект модели разом). Консультируется ДО письма промпта.
- **SYSTEM_AUDIT.md** — НОВОЕ (2026-09-09): чистка системы (машинная утилизация пулов) + таблица развития: не хватает / не нравится / расширить.
 {STAMP}: генератор Yodayo читает tape / pasties / maebari как R+ (формальная лестница — учёт; платформа — что реально выходит).
- **CONSTRAINTS.md** — реестр жёстких ограничений (C-коды)
- **TRACKER.md** — окно ротации 3 батчей (N22+N23+N24, N25 pre-flight), ledger использования OC / пулов / палитр
- **MOTIF_LOG.md** — счётчики мотивов, fossilization watch
- **ONTOLOGY.md** — словари жанров, состояний, NCS/LLS-лексикон
- **PALETTE_LIBRARY.md** — палитры P21–P88 (6 слотов каждая; TINT-семья P83-P88 — синие, с одним тёплым свидетелем)
- **POSE_LIBRARY.md** — позы PL01–PL60 (вкл. EROTIC PRESENTATION PL49-60) + пары камер
- **POOLS_V8.md** — пулы предметов v9.3 (K158-174, GAR41-56, H01-H20, CAM13-18) · **POOLS_V8_EXPANSION.md** — человекочитаемое расширение
- **BATCH_HISTORY.md** — история батчей N01 → N24 (N21+ — claimed=earned эра гейта)

## Канон OC
- **OC_Canon.md** — v1.7.1: ростер OC, локи внешности, реестры, коллизии. Vae ELDRITCH-CONTACT mode (2026-09-10) — тентакельный контакт по прямому заказу автора.

## Батчи (по 21 main)
- **BATCH_N12_EVERY_BODY_IS_A_PATTERN.md** — ателье и крой
- **BATCH_N13_DERNIER_ETE.md** — последний август
- **BATCH_N14_TENCENCIES.md**
- **BATCH_N15_AN_ARCHIVE_OF_IMAGINARY_MEMORIES.md** — карточный формат автора
- **BATCH_N16_ANATOMY_OF_A_SYNTHETIC_SOUL.md** — ре-тема, вторая сдача
- **BATCH_N17_YOU_WERE_BEAUTIFUL_IN_THE_WRONG_WORLD.md** — таро-батч
- **BATCH_N18_TOO_MUCH_FEELING_NOT_ENOUGH_TIME.md**
- **BATCH_N19_THE_ABYSS_HAS_A_MEMORY.md** — 3 акта (What the Deep Was Given / What the Abyss Keeps / What the Tide Returns) · PG 2 / PG-13 1 / R 5 / R+ 11 / X 2 · лестница v9 · правка про pasties вписана в заголовок
- **BATCH_N21_PERHAPS_WE_WERE_THE_DREAM.md** — показательный прогон V11 → rev2 (V12) → rev3 (V13): R 7 / R+ 12 / X 2, claimed = earned · FET13/19/20 крюки · PL49-60 ×5 · CAM13-18 ×5 · H ×15 · GAR-F ×6 · K115-122 ×8 · цвет по §51 · §52 pass: 21 теговый слой по стеку, 14 само-запретов из NEG убраны · §53 pass: 21 mature female + 20 grown woman + 21 анти-лоли NEG-флор — рендер-протокол: R/R+/X с PH OFF
- **BATCH_N20_MONO_NO_AWARE.md** — 3 акта · БЕЗ PG-13 (заказ 2026-09-09): ярлыки R 9 / R+ 10 / X 2 · честный ре-аудит (2026-09-09): по контенту R+×1 (P05), X×2, PG-13×16 — триггер §50; калибровки переписанных P08/P05 — в RATING_MAP §8
- **BATCH_N22_A_WORLD_SLIGHTLY_OUT_OF_PLACE.md** — первый цикл, рождённый под V13: R6/R+13/X2 claimed=earned с первого буст-пасса; DRIFT-двигатель
- **BATCH_N23_SIN_LOOKS_GOOD_ON_YOU.md** — V14-born: §53A банк + §54 race delivery + PH ON; BESPOKE-двигатель (грех как пошитая вещь на девушке); R7/R+12/X2 claimed=earned — вердикт автора: «хороший батч, в меру эротический, идея была»
- **BATCH_N24_BLUE_IS_THE_LONELIEST_COLOR.md** — TINT-двигатель (синий, впитанный в девушку; второе поколение BESPOKE); §51 blue clause (один тёплый свидетель в кадре); TINT-палитры P83-P88 + K158-174 + GAR49-56; R7/R+12/X2 claimed=earned
- **EXAMPLE_BATCH_GOD_LEFT_THE_LIGHTS_ON.md** — эталонная сборка (образец стиля)

## OC Orders (сценарные заказы — SET-split precedent, отдельно от батчей)
- **OC_ORDERS_N16.md** — SET1
- **OC_ORDERS_N16_SET2.md** — SET2 (Una / Zia / Vae, incl. eldritch-Vae)
- **OC_ORDERS_N18.md** — SET3 (Una drunk-beach · Sol wrong-timing · Doe origami)
- **OC_ORDERS_N19.md** — SET4: Miyu «Under the Spell» (R+) · Noa «Wet!» (R+) · Yui «Stuck!» (X) — ротация: Una отдыхает (4 из последних 7), Noa и Yui — их первые заказы
- **OC_ORDERS_N20.md** — SET5: Sol «Mirror, Mirror» (X, зеркало-свидетель) · Nix «Stuck!» (R+, сally-port) · Mab «Don't Look!» (R+, шов)
- **OC_ORDERS_N22.md** — SET7: Sue «Look at Me» / Ash «Something's Under There» / Una «The Ocean Was Closer Yesterday» (3×R+)
- **OC_ORDERS_N23.md** — SET8: Lyn/Rue/Rin — три дебюта (Sloth/Envy/Lust по канону; 3×R+ earned)

## Спецзаказы
- **OC_ORDERS_N21.md** — SET6: Lua «Hands Everywhere» (R+, дебют) · Vae «Wrapped Up» (R+ 9.5 — ELDRITCH-CONTACT) · Zia «Outnumbered» (R+ 9.0)
- **OC_ORDERS_N24.md** — SET9: Sol «Sexy Swimsuit» (the-sun-keeps-blue-hours) · Doe «Stolen Bra» (the-gull-files-its-lien — руки-прикрытие, румянец на фарфоре) · Lua «Drunk on the Beach» (the-grief-keeps-day-hours — траур на берегу в синий час) — 3×R+ earned, каст по фиту, три уровня отдыха
- **SP_ORDERS.md** — реестр клиентов + SP-01—SP-06; SP-05 = аквапарк R+; SP-06 = Эрешкигаль спортзал R+ 9.5

## Открытые вето автора (на {STAMP})
- Sol X → strict R+ (один edit); X-версии Nix/Mab — по edit
- Una XI Justice — подтверждение таро-реестра (pending)
- X-версии N21-P05/P19 — по одному edit
- N22: «никогда не занятых» X-позиций больше нет — брать из истёкшего фоссил-сета (MOTIF_LOG watch); R7/R+12/X2 или жаднее — новый дефолт контракта
- kebab-концепт-хэш (D3) и NICHE-декогезия (D5) — на обсуждении
- SYSTEM_AUDIT v1.0 ПРИМЕНЁН полностью 2026-09-10: архивы, цензус, POOLS v9, POSE v2, H/GAR-F/CAM13-18, §51
- §52 применён к N21/SET6 2026-09-10 (вечер): теговые слои + хирургия NEG; повторная генерация N21 картинок с rev2 — на авторе (посмотреть, как теперь выходит R+)
- §53A/§54 (V14, 2026-09-12): банк зрелости mature/adult/young по типу тела + расовая доставка тегом и прозой — оба закреплены N23/N24
- РЕНДЕР-ПРОТОКОЛ V14: PH ON — рабочий режим («Генерим на PH и дальше»); tag-run — канал записи
- Вердикт N23 (2026-09-13): «хороший батч, в меру эротический, идея была» — V14-рецепт подтверждён, N24 пошёл тем же путём
"""
w(DL / "README.md", readme)

print("\ndone: system exported to download/ as .md")
