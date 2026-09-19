#!/usr/bin/env python3
"""
HOUSE_LINT — P3: единое домашнее ядро (V20 build, 2026-09-16).

Поглощает зоопарк пер-батчевых линтов (W4 аудита V17): каждая проверка,
которая является домашним законом, живёт здесь ОДИН раз; батч приносит
только тонкий конфиг в scripts/house_configs.yaml. Рейтинговый слой
(§4E core-4 / §4F layer stack / §4G капы / §4C-2 квоты) остаётся в
rating_gate_lint.py — один рейтинговый орган, один домашний орган,
дверей больше не плодим.

Слои:
  ядро (константы-законы) → конфиг (дельты батча) → прогон.
Окно (3 прошедших батча) выводится АВТОМАТИЧЕСКИ по номерам сданных
файлов — TRACKER не источник, а объект сверки.

CLI:
  python3 scripts/house_lint.py --slug n28           # прогон по конфигу
  python3 scripts/house_lint.py --slug n28 --file F  # подмена главного файла (мутационный тест)
  python3 scripts/house_lint.py --selftest           # чеки: ретро + мутация + контракт
  python3 scripts/house_lint.py --contract n29       # §62: контракт писца (законы + конфиг)

Каждый настоящий прогон пишет рецепт в system/LINT_RECEIPTS.tsv (§62
ledger: first-run вердикт / счёт фикс-пассов по sha-дельтам; селфтесты
и мутации ничего не пишут).

Покрытие домашнего слоя:
  §16 доставка + спайн-поля · §40/§43 баны · §41 лестница NCS/LLS/Yodayo ·
  §45 сетка hair/eyes · расовый банд + §54 расовая доставка · §58 позовый
  леджер · LEAD-ось · K/FET/BRE/BK/B/H/GAR-F окно + бюджеты · палитры:
  окно + сетка · кебаб-оверлап (§44) · те же-позиции туплы · §49 NEG-
  экономика + паритет тиров · §52 теговые этажи + §53A анкеры · §51
  цвет · §17B капы · закон хеджей · §60 PH-пруф (state nouns / длина /
  анти-лик / гарниш).
"""
import glob
import io
import re
import sys
from collections import Counter
from pathlib import Path

import yaml

ROOT = Path("/home/z/my-project")
SC = ROOT / "scripts"
DL = ROOT / "download"
CFG_PATH = SC / "house_configs.yaml"

# ── ДОМАШНИЕ КОНСТАНТЫ (законы, не меняющиеся от батча) ──────────────────

BAN_RX = (r"\bcandle(s)?\b|\blamp\b|lantern|torch|chandelier|brazier|"
          r"vertebra|spinal column|camera \[|camera a|camera at")

HEDGES = ["shape-only", "at its limit", "at their limit", "no further",
          "never the sentence's subject", "never the point itself",
          "implied by", "hints of", "suggestion of", "tasteful"]

SPINE_FIELDS = ("Verb:", "CLO:", "OPN:", "LEAD:", "THESIS:", "SIG:",
                "Interaction type:", "GEAR:")

STATIC_POSES = {"PL01", "PL02", "PL06", "PL08", "PL19", "PL29"}
EROTIC_RANGES = list(range(49, 61)) + list(range(181, 205))   # PL49-60 + PL181-204
ECCHI_RANGES = list(range(61, 85))                            # PL61-84

STATE_NOUNS = ["topless", "bare chest", "bare breasts", "see-through", "sheer",
               "wet", "transparent", "translucent", "presenting", "spread legs",
               "squatting", "straddling", "open clothes", "half-undressed",
               "large breasts", "glistening", "cameltoe", "bare shoulders",
               "her bare", "nipples", "bared", "soaked", "plastered",
               "clinging", "clings"]
TAGRUN_RX = re.compile(r"1girl, solo, [^.\n]+\.?", re.I)

R_BANK = {"see-through", "cleavage", "sideboob", "underboob", "shirt lift",
          "skirt lift", "skirt flip", "fluttering clothes", "from behind",
          "from below", "from above", "from side", "hip focus", "thigh focus",
          "bare back", "navel", "collarbone", "collar", "bare shoulders",
          "sleeveless"}
RP_BANK = R_BANK | {"pokies", "cameltoe", "wedgie", "wet clothes", "wet",
                    "wet hair", "ass", "ass focus", "ass grab",
                    "grabbing own ass", "presenting", "spread legs",
                    "squatting", "straddling", "arched back", "open clothes",
                    "half-undressed", "sweat", "glistening", "large breasts",
                    "curvy", "leotard", "arms up", "soap", "breast focus",
                    "apron", "no bra", "mesh"}
X_BANK = RP_BANK | {"topless", "bare chest"}
MAT_ANCHORS = ("mature female", "adult woman", "young woman")

RACE_TAG = {"R02-elf": ("elf ears", "long ears"),
            "R03-kitsune-kin": ("fox ears", "tail"),
            "R04-cat-kin": ("cat ears", "cat tail"),
            "R05-wolf-kin": ("wolf ears", "tail"),
            "R06-ram-demon": ("ram horns", "horn"),
            "R07-dragon-kin": ("horns",),
            "R08-serpent-kin": ("serpent tail", "slit pupils"),
            "R09-goat-kin": ("goat horns", "goat"),
            "R11-bat-kin": ("bat ears", "bat wings"),
            "R12-bunny-kin": ("bunny ears", "animal ears"),
            "R14-dryad": ("dryad vines", "vines"),
            "R16-moth-kin": ("moth antennae", "antennae"),
            "R17-jellyfish-kin": ("jellyfish hood", "jellyfish"),
            "R22-flame-salamander": ("salamander crest", "ember freckles")}
RACE_FEAT_RX = (r"ear|horn|tail|wing|scale|seam|joint|vine|bloom|slit pupil|"
                r"antler|hoof|carapace|tine|membrane|antenna|frill|spore|hood|"
                r"mast|mantle|feather|sucker")

DESAT_RX = (r"pale|muted|faint|washed|milky|hazy|soft grey|ash grey|"
            r"grey overlay|desaturated|smoke-grey|dust")
SAT_RX = (r"saturated|vermilion|gold|brass|honey|amber|gilt|gilded|silver|"
          r"copper|bright red|burning|ember|teal|plum|ivory|scarlet|crimson|"
          r"burgundy|wine|oxblood|cherry|mahogany|henna|flax|edelweiss|"
          r"ultramarine|cobalt|prussian|cerulean|glacier|gentian|sapphire|"
          r"indigo|neon-teal|sepia|fawn|clover|champagne|ingot|vermeil|"
          r"lacquer|coral|lantern|phosphor|aurora|nacre|pearl")

ANTI_LOLI = ("child", "childish", "chibi", "young girl", "immature body",
             "oversized head")

NEG_REQUIRED_BASE = ["child", "chibi", "washed-out", "male", "exposed genitals"]

# Дефолты домашней политики (эра V18/V19); конфиг может перекрыть всё.
DEFAULTS = {
    "files": [],
    "rating_spread": {"R": 7, "R+": 12, "X": 2},
    "x_positions": None,          # None = взять из файла как есть, сверить со спредом
    "mint_head": None,            # None = K158+ считается минтом (legacy)
    "neg_band": (38, 52),
    "neg_required_extra": [],
    "niche_count": None,          # None = §59 не проверяется
    "niche_ok_ncs": ["CONCEALED", "COVERED"],
    "lead_mandates": {},
    "garf_family": (41, 48),
    "racial_band": (9, 11),
    "caps": {},
    "require_in_pos": [],
    "x_recipe": {},
    "verb_garnish_rx": None,
    "pos_len_hard": 400,
    "pos_len_warn": 320,
}

# ── ИМЕНОВАННЫЕ ЧИСЛА ЗАКОНОВ (§62: контракт и чек делят одно число) ────
# Раньше эти числа жили инлайн в проверках; теперь они константы — писец
# видит их в writer_contract, ядро проверяет ими. Дрейф невозможен по
# построению: контракт строится ИЗ этих констант.
PROMPT_COUNT = 21
SAT_MIN = 3                       # §51
DESAT_MAX_RATIO = 1.2             # §51
STATE_FLOOR = {"X": 4, "R+": 3}   # §60(2) прозаические state-ноуны
TAG_FLOOR = {"R": 1, "R+": 3, "X": 2}   # §52
HAIR_DISTINCT_MIN = 15            # §45
EYES_DISTINCT_MIN = 10            # §45
HAIR_EYE_REPEAT_MAX = 3           # §45
RACE_FEAT_MIN = 3                 # §54
KEBAB_OVERLAP_MAX = 0.34          # §44
SAME_TUPLE_MAX = 3                # §44 (4/4 совпадений с окном = фейл)
K_MINT_BUDGET = 8                 # POOLS §10
K_RETURNS_MIN = 10                # POOLS §10
K_DISTINCT_MIN = 5
K_REPEAT_MAX = 3
FET_HOOKS_MIN = 2                 # §55
BRE_DISTINCT_MIN = 3              # §37
BK_DISTINCT_MIN = 2               # §37
B_DISTINCT_MIN = 2                # §37
H_DISTINCT_MIN = 2
GARF_DISTINCT_MIN = 2
PALETTES_DISTINCT_MIN = 19        # §42
PALETTE_REPEAT_MAX = 2            # §42
LEAD_DISTINCT_MIN = 8             # LEAD-ось (§28+§29)
LEAD_REPEAT_MAX = 4
EROTIC_MIN = 4                    # §58(c)
ECCHI_MIN = 3                     # §58(d)
STATIC_MAX = 2                    # §58(b)
ANTI_LOLI_MIN = 3                 # §53
DOES_NOT_MAX = 1                  # §3

# ── §62 FIRST-PASS TRAPS — полевые заметки N29, оплаченные 4 фикс-пассами ──
# Каждая ловушка уже куплена один раз; §62(3) запрещает покупать её снова.
FIRST_PASS_TRAPS = {
    "T1": "имена спайн-полей дословны: 'GEAR:' — не 'GEAR (LABEL):' (§16-парсер)",
    "T2": "код техники, названный в прозе, обязан стоять в K:/SIG строке — гейт считает КОДЫ, не прозу",
    "T3": "state-ноуны в POS буквально словами банка (nipples/glistening/clinging/taut…); эвфемизм ('the small points') не считается",
    "T4": "SAT ≥3 считай ДО сдачи, без учёта регистра — каптал ловится тем же re.I",
    "T5": "POS ≤400 слов — черновик режется до первого прогона, не после",
    "T6": "NEG 38-52 терма + 5 базовых + анти-лоли ≥3 — термы считаются до сдачи",
    "T7": "носители в POS причастиями/пассивами (printing/riding/tracking/pressed); голый глагол (print/rides/track) не матчится паттернами гейта",
    "T8": "стек-строки гейтом не читаются: носитель обязан жить в POS прозе (ловушка первого вхождения — гейт берёт POS)",
    "T9": "предложение без ≥2 KEEP-ноунов умирает в PH-симуляции — тело/ткань/механизм в каждом предложении",
    "T10": "кебаб-якорь ≤34% word-overlap с каждым якорем окна — проверяется до сдачи",
    "T11": "тики caps: конфига — тема-существительные считаются до сдачи",
    "T12": "расовых признаков ≥3 в POS (не-human слоты)",
    "T13": "POS:/NEG: блоки разделены пустой строкой — склейка ломает парсер",
    "T14": "'does not' ≤1 на батч — активная альтернатива",
}

# ── ОКНО И ФАЙЛЫ ──────────────────────────────────────────────────────────

def delivered_batches():
    files = {}
    for m in glob.glob(str(DL / "BATCH_N*.md")):
        mm = re.search(r"BATCH_N(\d+)_", Path(m).name)
        if mm:
            files[int(mm.group(1))] = Path(m)
    return files


def window_for(n):
    nums = sorted(k for k in delivered_batches() if k < n)
    return {f"N{k}": delivered_batches()[k] for k in nums[-3:]}


def parse_window(path):
    w = {}
    wt = io.open(path, encoding="utf-8").read()
    for m in re.finditer(r"(?m)^P(\d\d) — (.*?)(?=\nPOS:|\n\nPOS:|\Z)", wt, re.S):
        pid, rest = "P" + m.group(1), m.group(2)
        gm = re.search(r"Genre: (\w+) · NCS: (\w+) · LLS: (L\d)", rest)
        dm = re.search(r"D19: ([\w_]+)", rest) or re.search(r"LEAD: ([\w-]+)", rest)
        hm = re.search(r"Hair/Eyes: (.*?)(?: ·|$)", rest)
        rm = re.search(r"Race: ([\w-]+)", rest)
        if gm:
            w[pid] = dict(genre=gm.group(1), ncs=gm.group(2), lls=gm.group(3),
                          d19=dm.group(1) if dm else "?",
                          hair=(hm.group(1).split("/")[0].strip() if hm else "?"),
                          race=rm.group(1) if rm else "human")
    return w


# ── ЯДРО ПРОГОНА ──────────────────────────────────────────────────────────

def run_lint(slug, file_override=None, receipt=True):
    cfg_all = yaml.safe_load(io.open(CFG_PATH, encoding="utf-8")) or {}
    if slug not in cfg_all:
        print(f"HOUSE LINT: NO CONFIG for '{slug}' — add a block to "
              f"scripts/house_configs.yaml")
        return None
    cfg = dict(DEFAULTS)
    cfg.update(cfg_all[slug])
    if file_override:
        cfg["files"] = [file_override]

    n = int(slug[1:])
    WIN_FILES = window_for(n)
    if len(WIN_FILES) != 3:
        print(f"  [warn] window incomplete: {list(WIN_FILES)} (need 3)")

    errors, warns = [], []

    def err(m): errors.append(m)

    def warn(m): warns.append(m)

    # главный файл (override может быть абсолютным путём — мутационный тест)
    main = Path(cfg["files"][0])
    if not main.is_absolute():
        cand = main if main.exists() else DL / main
        main = cand
    t = io.open(main, encoding="utf-8").read()

    WIN = {tag: parse_window(p) for tag, p in WIN_FILES.items()}
    win_text = "".join(io.open(p, encoding="utf-8").read() for p in WIN_FILES.values())
    BLOCK_K = set(re.findall(r"\bK\d{2,3}\b", win_text))
    BLOCK_FET = set(re.findall(r"\bFET\d+\b", win_text))
    BLOCK_GARF = set(re.findall(r"\bGAR\d+\b", win_text))
    BLOCK_PAL_PREFIX = {p.split("_")[0] + "_"
                        for p in re.findall(r"\b(P\d{2,3}_[A-Z_]+)\b", win_text)}

    # разбор промптов (§16)
    blocks = re.split(r"\n(?=P\d\d — )", t)
    prompts = {}
    for b in blocks:
        m = re.match(r"(P\d\d) — ", b)
        if not m:
            continue
        pm = re.search(r"(?m)^POS:\s*\n\s*\n(.*?)(?=^NEG:|\Z)", b, re.S)
        nm = re.search(r"(?m)^NEG:\s*\n\s*\n(.*?)(?=^P\d\d|^═|^SELF-CHECK|^── |\Z)",
                       b, re.M | re.S)
        if not pm:
            err(f"{m.group(1)}: no POS block")
            continue
        prompts[m.group(1)] = {"pos": pm.group(1).strip(),
                               "neg": (nm.group(1).strip() if nm else ""), "raw": b}
    if len(prompts) != PROMPT_COUNT:
        err(f"prompt count {len(prompts)} != {PROMPT_COUNT}")
    order = [f"P{n:02d}" for n in range(1, 22)]
    for pid in order:
        if pid not in prompts:
            err(f"{pid}: missing")

    ratings, genres, ncs_map, lls_map, lead_map = {}, {}, {}, {}, {}
    for pid, p in prompts.items():
        gm = re.search(r"Genre: (\w+) · NCS: (\w+) · LLS: (L\d)", p["raw"])
        if not gm:
            err(f"{pid}: no Genre/NCS/LLS line")
            continue
        genres[pid], ncs_map[pid], lls_map[pid] = gm.group(1), gm.group(2), gm.group(3)
        ym = re.search(r"Yodayo: (\S+)", p["raw"])
        if not ym:
            err(f"{pid}: no Yodayo tag")
            continue
        ratings[pid] = ym.group(1)
        lm = re.search(r"LEAD: ([\w-]+)", p["raw"])
        lead_map[pid] = lm.group(1) if lm else "?"
        if "BPT:" in p["raw"]:
            err(f"{pid}: retired BPT field still present")

    rc = Counter(ratings.values())
    spread = {k: v for k, v in cfg["rating_spread"].items()}
    if dict(rc) != spread:
        err(f"rating spread {dict(rc)} != {spread}")

    xp = sorted(pid for pid in order if ratings.get(pid) == "X")
    want_xp = cfg["x_positions"]
    if want_xp and xp != want_xp:
        err(f"X positions {xp} != {want_xp}")

    # §41 лестница
    for pid in order:
        nc, l, y = ncs_map.get(pid), lls_map.get(pid), ratings.get(pid)
        if nc == "THROUGH_FABRIC" and l not in ("L1", "L2"): err(f"{pid}: TF with {l}")
        if nc == "VISIBLE" and l != "L2": err(f"{pid}: VISIBLE with {l}")
        if nc == "TOPLESS_BACK" and l not in ("L2", "L3"): err(f"{pid}: TB with {l}")
        if nc == "TOPLESS" and l not in ("L2", "L3"): err(f"{pid}: TOPLESS with {l}")
        if nc == "NAKED" and l != "L3": err(f"{pid}: NAKED with {l}")
        if y == "X" and nc not in ("TOPLESS", "NAKED", "VISIBLE"): err(f"{pid}: X with {nc}")
        if y == "R" and l not in ("L1", "L2"): err(f"{pid}: R with {l}")
        if y == "R+" and l not in ("L2", "L3"): err(f"{pid}: R+ with {l}")

    # те же-позиции туплы vs окно
    for pid in order:
        for tag, w in WIN.items():
            row = w.get(pid)
            if not row:
                continue
            fields = [genres[pid] == row["genre"], lead_map[pid] == row["d19"],
                      ncs_map[pid] == row["ncs"], lls_map[pid] == row["lls"]]
            if sum(fields) > SAME_TUPLE_MAX:
                err(f"{pid}: same-position tuple {sum(fields)}/4 vs {tag}")

    # сетка hair/eye/race (§45)
    hair_map, eye_map, race_map = {}, {}, {}
    for pid in order:
        hm = re.search(r"Hair/Eyes: (.*?)\n", prompts[pid]["raw"])
        if not hm:
            err(f"{pid}: no Hair/Eyes spine")
            continue
        hair_map[pid] = hm.group(1).split("/")[0].strip()
        eye_map[pid] = hm.group(1).split("/")[1].split("·")[0].strip()
        rm = re.search(r"Race: ([\w-]+)", prompts[pid]["raw"])
        race_map[pid] = rm.group(1) if rm else "human"

    hc = Counter(hair_map.values()); ec = Counter(eye_map.values())
    if len(hc) < HAIR_DISTINCT_MIN: err(f"hair distinct {len(hc)} < {HAIR_DISTINCT_MIN}")
    if len(ec) < EYES_DISTINCT_MIN: err(f"eyes distinct {len(ec)} < {EYES_DISTINCT_MIN}")
    for c, k in hc.items():
        if k > HAIR_EYE_REPEAT_MAX: err(f"hair '{c}' x{k} > {HAIR_EYE_REPEAT_MAX}")
    for c, k in ec.items():
        if k > HAIR_EYE_REPEAT_MAX: err(f"eyes '{c}' x{k} > {HAIR_EYE_REPEAT_MAX}")
    for pid in order:
        for tag, w in WIN.items():
            row = w.get(pid)
            if not row:
                continue
            if hair_map[pid].split()[0].lower() == row["hair"].split()[0].lower():
                err(f"{pid}: same-position hair '{hair_map[pid]}' vs {tag}")
            if race_map[pid] == row["race"] and race_map[pid] != "human":
                err(f"{pid}: same-position race '{race_map[pid]}' vs {tag}")

    lo, hi = cfg["racial_band"]
    nr = sum(1 for pid in order if race_map[pid] != "human")
    if not (lo <= nr <= hi):
        err(f"racial girls {nr} outside {lo}-{hi}")

    # §59 NICHE
    niche_ids = [pid for pid in order if genres.get(pid) == "NICHE"]
    if cfg["niche_count"] is not None:
        if len(niche_ids) != cfg["niche_count"]:
            err(f"NICHE count {len(niche_ids)} != {cfg['niche_count']}")
        for pid in niche_ids:
            if ncs_map.get(pid) not in cfg["niche_ok_ncs"]:
                err(f"{pid}: §59 NICHE with NCS {ncs_map.get(pid)} — auto-VOLT violation")
            if "ARCH:" not in prompts[pid]["raw"] or "DEVICE:" not in prompts[pid]["raw"]:
                err(f"{pid}: §59 archetype/device not named in pre-header")
        archs = [re.search(r"ARCH: (\w[\w-]*)", prompts[p]["raw"]).group(1)
                 for p in niche_ids
                 if re.search(r"ARCH: (\w[\w-]*)", prompts[p]["raw"])]
        if len(set(archs)) != len(archs):
            err(f"§59 archetype repeat: {archs}")

    # §58 позовый леджер
    pl_map = {}
    for pid in order:
        pm = re.search(r"-PL(\d{2,3})-", prompts[pid]["raw"])
        pl_map[pid] = "PL" + pm.group(1) if pm else None
        if not pm:
            err(f"{pid}: no PL code in SIG")
    plc = Counter(v for v in pl_map.values() if v)
    for v, k in plc.items():
        if k > 1:
            err(f"§58(e): pose code {v} used {k}x — 21-distinct law")
    statics = [p for p in order if pl_map.get(p) in STATIC_POSES]
    if len(statics) > STATIC_MAX:
        err(f"§58(b): static verticals {len(statics)} > {STATIC_MAX}")
    for pid in order:
        if ratings.get(pid) == "X" and pl_map.get(pid) in STATIC_POSES:
            err(f"{pid}: §58(b) static vertical in X slot")
    erotic = [p for p in order
              if pl_map.get(p) and int(pl_map[p][2:]) in EROTIC_RANGES]
    if len(erotic) < EROTIC_MIN:
        err(f"§58(c): erotic-presentation codes {len(erotic)} < {EROTIC_MIN}")
    ecchi = [p for p in order
             if pl_map.get(p) and int(pl_map[p][2:]) in ECCHI_RANGES]
    if len(ecchi) < ECCHI_MIN:
        err(f"§58(d): ecchi-classic codes {len(ecchi)} < {ECCHI_MIN}")

    # LEAD-ось
    leadc = Counter(lead_map.values())
    for z, need in cfg["lead_mandates"].items():
        if leadc.get(z, 0) < need:
            err(f"LEAD mandate {z} = {leadc.get(z, 0)} < {need}")
    for z, k in leadc.items():
        if k > LEAD_REPEAT_MAX:
            err(f"LEAD {z} x{k} > {LEAD_REPEAT_MAX}")
    if len(leadc) < LEAD_DISTINCT_MIN:
        err(f"LEAD distinct zones {len(leadc)} < {LEAD_DISTINCT_MIN}")

    # K-коды: окно + бюджет + минты
    spines = "".join(p["raw"] for p in prompts.values())
    all_k = set(re.findall(r"\bK\d{2,3}\b", spines))
    if all_k & BLOCK_K:
        err(f"window-blocked K used: {sorted(all_k & BLOCK_K)}")
    head = cfg["mint_head"] if cfg["mint_head"] is not None else 158
    mints = {k for k in all_k if int(k[1:]) >= head}
    returns = all_k - mints
    if len(mints) > K_MINT_BUDGET:
        err(f"K mint budget {len(mints)} > {K_MINT_BUDGET}")
    if len(returns) < K_RETURNS_MIN:
        err(f"K returns {len(returns)} < {K_RETURNS_MIN}")
    kc = Counter(re.findall(r"\bK\d{2,3}\b", spines))
    if len(kc) < K_DISTINCT_MIN:
        err(f"distinct K codes {len(kc)} < {K_DISTINCT_MIN}")
    for k, c in kc.items():
        if c > K_REPEAT_MAX:
            err(f"{k} x{c} > {K_REPEAT_MAX}")

    # FET: окно + §55 сценарный пол
    used_f = set(re.findall(r"\bFET\d+\b", spines))
    if used_f & BLOCK_FET:
        err(f"window-blocked FET used: {sorted(used_f & BLOCK_FET)}")
    SCEN = {f"FET{i}" for i in range(11, 26)}
    hooks = used_f & SCEN
    if len(hooks) < FET_HOOKS_MIN:
        err(f"§55 scenario hooks < {FET_HOOKS_MIN} ({sorted(hooks)})")

    # BRE/BK/B
    used_bre = set(re.findall(r"\bBRE\d+\b", spines))
    used_bk = set(re.findall(r"\bBK\d+\b", spines))
    used_b = set(re.findall(r"\bB(?!RE|K)\d{2,}\b", spines)) - used_bk
    win_bre = set(re.findall(r"\bBRE\d+\b", win_text))
    win_bk = set(re.findall(r"\bBK\d+\b", win_text))
    win_b = set(re.findall(r"\bB(?!RE|K)\d{2,}\b", win_text))
    if used_bre & win_bre: err(f"window-blocked BRE: {sorted(used_bre & win_bre)}")
    if used_bk & win_bk: err(f"window-blocked BK: {sorted(used_bk & win_bk)}")
    if used_b & win_b: err(f"window-blocked B: {sorted(used_b & win_b)}")
    if len(used_bre) < BRE_DISTINCT_MIN: err(f"BRE distinct {len(used_bre)} < {BRE_DISTINCT_MIN}")
    if len(used_bk) < BK_DISTINCT_MIN: err(f"BK distinct {len(used_bk)} < {BK_DISTINCT_MIN}")
    if len(used_b) < B_DISTINCT_MIN: err(f"B distinct {len(used_b)} < {B_DISTINCT_MIN}")

    # H + GAR-F
    used_h = set(re.findall(r"\bH\d{2}\b", spines))
    win_h = set(re.findall(r"\bH\d{2}\b", win_text))
    if used_h & win_h: err(f"window-blocked H: {sorted(used_h & win_h)}")
    if len(used_h) < H_DISTINCT_MIN: err(f"H codes {len(used_h)} < {H_DISTINCT_MIN}")
    g_lo, g_hi = cfg["garf_family"]
    g_rx = rf"\bGAR({str(g_lo)[0]}[{str(g_lo)[1]}-{str(g_hi)[1]}])\b"
    garf = {"GAR" + g for g in re.findall(g_rx, spines)}
    if len(garf) < GARF_DISTINCT_MIN:
        err(f"GAR-F v1 returns {len(garf)} < {GARF_DISTINCT_MIN} (GAR{g_lo}-{g_hi} family)")
    if BLOCK_GARF & garf:
        err(f"window-blocked GAR-F cited: {sorted(BLOCK_GARF & garf)}")

    # палитры
    pals = Counter(re.findall(r"((?:P\d{2,3})_[A-Z_]+)", spines))
    bad_pal = {p for p in pals if p.startswith(tuple(BLOCK_PAL_PREFIX))}
    if bad_pal:
        err(f"window-blocked palettes: {sorted(bad_pal)}")
    pids_only = Counter(re.findall(r"-((?:P\d{2,3})_[A-Z_]+)-ENV", spines))
    for k, c in pids_only.items():
        if c > PALETTE_REPEAT_MAX:
            err(f"palette {k} x{c} > {PALETTE_REPEAT_MAX}")
    if len(pids_only) < PALETTES_DISTINCT_MIN:
        err(f"distinct palettes {len(pids_only)} < {PALETTES_DISTINCT_MIN}")

    # кебаб-якоря vs окно (§44)
    new_anchors = [m.group(1) for m in re.finditer(r"(?m)^P\d\d — ([a-z0-9-]+) ", t)]
    if len(new_anchors) != 21:
        err(f"anchors found {len(new_anchors)} != 21")
    if len(set(new_anchors)) != len(new_anchors):
        err("duplicate anchors in batch")
    win_all = []
    for p in WIN_FILES.values():
        win_all += re.findall(r"(?m)^P\d\d — ([a-z0-9-]+) ",
                              io.open(p, encoding="utf-8").read())

    def word_overlap(a, b):
        sa, sb = set(a.split("-")), set(b.split("-"))
        if len(sa) < 2 or len(sb) < 2:
            return 0.0
        return len(sa & sb) / len(sa | sb)

    for a in new_anchors:
        for w in win_all:
            if word_overlap(a, w) > KEBAB_OVERLAP_MAX:
                err(f"kebab '{a}' ~ window '{w}' "
                    f"(word overlap {word_overlap(a, w):.0%} > {KEBAB_OVERLAP_MAX:.0%})")

    # §40/§43 баны
    for pid in order:
        pos = prompts[pid]["pos"]
        for m in re.finditer(BAN_RX, pos, re.I):
            err(f"{pid}: §40 banned word in POS: '{m.group(0)}'")
    dn = len(re.findall(r"does not", " ".join(prompts[p]["pos"] for p in order)))
    if dn > DOES_NOT_MAX:
        err(f"'does not' count {dn} > {DOES_NOT_MAX}")

    # §17B капы (конфиг)
    pos_all = " ".join(prompts[p]["pos"] for p in order)
    low = pos_all.lower()
    for phrase, cap in cfg["caps"].items():
        c = len(re.findall(r"(?<![a-z-])" + re.escape(phrase) + r"(?![a-z-])", low))
        if c > cap:
            err(f"§17B cap '{phrase}' = {c} > {cap}")

    # хеджи в R+ POS
    for pid in order:
        if ratings.get(pid) != "R+":
            continue
        pos = prompts[pid]["pos"].lower()
        for h in HEDGES:
            if h in pos:
                err(f"{pid}: hedge '{h}' in R+ POS")

    # §49 NEG-экономика
    nlo, nhi = cfg["neg_band"]
    for pid in order:
        neg = prompts[pid]["neg"]
        terms = [x.strip() for x in neg.split(",") if x.strip()]
        if not (nlo <= len(terms) <= nhi):
            err(f"{pid}: NEG terms {len(terms)} outside {nlo}-{nhi}")
        if re.search(r"\bno [a-z]", neg, re.I):
            err(f"{pid}: 'no X' phrasing in NEG")
        for need in NEG_REQUIRED_BASE + list(cfg["neg_required_extra"]):
            if need not in neg:
                err(f"{pid}: NEG missing '{need}'")
        lol = sum(1 for x in ANTI_LOLI if x in neg)
        if lol < ANTI_LOLI_MIN:
            err(f"{pid}: anti-loli floor {lol} < {ANTI_LOLI_MIN}")
        if ratings.get(pid) == "R":
            if "nipples visible through" not in neg:
                warn(f"{pid}: R NEG missing 'nipples visible through' (full block per §49)")
        if ratings.get(pid) == "R+":
            if "nipples visible through" in neg:
                err(f"{pid}: 'nipples visible through' in R+ NEG — §4B violation")
            for bare in ("nipple visible", "bare nipple", "bare breasts"):
                if bare not in neg:
                    err(f"{pid}: R+ NEG missing bare-form '{bare}'")
        if ratings.get(pid) == "X":
            for bad in ("nipple visible", "bare nipple", "bare breasts",
                        "nipples visible through"):
                if bad in neg:
                    err(f"{pid}: X NEG carries nipple term '{bad}' (bare is the content)")

    # §52 теговые этажи + §53A
    for pid in order:
        pos = prompts[pid]["pos"]
        m = re.search(r"1girl, solo, ([^,]+(?:, [^,]+){0,8}), ", pos)
        tagrun = m.group(1).lower() if m else ""
        r = ratings.get(pid)
        bank = {"R": R_BANK, "R+": RP_BANK, "X": X_BANK}.get(r, set())
        hits = sum(1 for tg in bank if tg in tagrun)
        need = TAG_FLOOR.get(r, 0)
        if hits < need:
            err(f"{pid}: §52 tag floor {hits} < {need} (tag-run: …{tagrun[:80]})")
        if not any(a in tagrun for a in MAT_ANCHORS):
            err(f"{pid}: §53A maturity anchor missing")
        if "grown woman's face" not in pos:
            err(f"{pid}: grown-woman face formula missing")
        neg_terms = [x.strip().lower() for x in prompts[pid]["neg"].split(",")]
        for tg in [x.strip() for x in tagrun.split(",")]:
            if tg and len(tg) > 3 and tg in neg_terms:
                err(f"{pid}: own tag '{tg}' appears as WHOLE NEG term")

    # §54 расовая доставка
    for pid in order:
        race = race_map[pid]
        if race == "human":
            continue
        pos = prompts[pid]["pos"]
        m = re.search(r"1girl, solo, ([^,]+(?:, [^,]+){0,8}), ", pos)
        tagrun = m.group(1).lower() if m else ""
        if not any(tt in tagrun for tt in RACE_TAG.get(race, ())):
            err(f"{pid}: §54 race tag missing for {race}")
        feats = re.findall(RACE_FEAT_RX, pos, re.I)
        if len(feats) < RACE_FEAT_MIN:
            err(f"{pid}: §54 prose feature mentions {len(feats)} < {RACE_FEAT_MIN} ({race})")

    # §51 цвет
    for pid in order:
        pos = prompts[pid]["pos"]
        d = len(re.findall(DESAT_RX, pos, re.I))
        s = len(re.findall(SAT_RX, pos, re.I))
        if s < SAT_MIN:
            err(f"{pid}: SAT carriers {s} < {SAT_MIN}")
        if d and d / max(s, 1) > DESAT_MAX_RATIO:
            err(f"{pid}: DESAT/SAT {d}/{s} > {DESAT_MAX_RATIO}")
        if "Richly pigmented" not in pos or "saturated film color" not in pos:
            err(f"{pid}: §16 color closer missing")

    # спайн-поля
    for pid in order:
        for field in SPINE_FIELDS:
            if field not in prompts[pid]["raw"]:
                err(f"{pid}: spine line missing '{field}'")

    # §60 PH-пруф
    for pid in order:
        pos = prompts[pid]["pos"]
        r = ratings.get(pid)
        no_tags = TAGRUN_RX.sub(" ", pos).lower()
        states = {s_ for s_ in STATE_NOUNS if s_ in no_tags}
        need = STATE_FLOOR.get(r, 0)
        if len(states) < need:
            err(f"{pid}: §60 prose state nouns {len(states)} < {need} (PH-proof floor)")
        w = len(pos.split())
        if w > cfg["pos_len_hard"]:
            err(f"{pid}: §60 POS length {w} > {cfg['pos_len_hard']}")
        if w > cfg["pos_len_warn"]:
            warn(f"{pid}: §60 POS length {w} > {cfg['pos_len_warn']} (WARN)")
        neg = prompts[pid]["neg"]
        for guard in ("signature", "watermark"):
            if guard not in neg:
                err(f"{pid}: §60 anti-leak guard missing '{guard}'")

    # кляузы движка / батча (require_in_pos)
    for pid in order:
        for clause in cfg["require_in_pos"]:
            if clause not in prompts[pid]["pos"].lower():
                err(f"{pid}: engine clause '{clause}' missing")

    # X-рецепт
    for pid, marker in cfg["x_recipe"].items():
        pos = prompts.get(pid, {}).get("pos", "")
        if marker not in pos.lower():
            err(f"{pid}: X-recipe marker '{marker}' missing")

    # verb-led гарниш (PH-хрупкость)
    if cfg["verb_garnish_rx"]:
        for pid in order:
            v56 = len(re.findall(cfg["verb_garnish_rx"],
                                 prompts[pid]["pos"], re.I))
            if v56 > 3:
                err(f"{pid}: §60 verb-led carrier garnish {v56} > 3 "
                    f"(PH-fragile load-bearing)")

    # ── отчёт ──
    print(f"HOUSE LINT — {slug}  (P3 core; window: {list(WIN_FILES)})")
    print(f"  prompts: {len(prompts)} | "
          f"R {rc.get('R', 0)} / R+ {rc.get('R+', 0)} / X {rc.get('X', 0)}")
    print(f"  hair distinct: {len(hc)} | eye distinct: {len(ec)} | racial: {nr}")
    print(f"  K: {len(kc)} distinct (mints {len(mints)} ≤8, "
          f"returns {len(returns)}) | FET hooks: {sorted(hooks)}")
    print(f"  BRE: {sorted(used_bre)} | BK: {sorted(used_bk)} | "
          f"B: {sorted(used_b)} | GAR-F: {sorted(garf)}")
    print(f"  palettes distinct: {len(pids_only)} | H: {sorted(used_h)}")
    print(f"  LEAD: {dict(leadc)}")
    print(f"  §58 poses: {len(plc)} distinct | erotic {len(erotic)} | "
          f"ecchi {len(ecchi)} | static {len(statics)}")
    if errors:
        print(f"\nERRORS ({len(errors)}):")
        for e in errors:
            print("  ✗", e)
    else:
        print("\nPASS — 0 errors")
    if warns:
        print(f"warnings ({len(warns)}):")
        for w_ in warns:
            print("  ⚠", w_)
    if receipt and not file_override:
        write_receipt(slug, main, errors, warns)
    return errors


# ── §62 FIRST-PASS: РЕЦЕПТЫ + КОНТРАКТ ПИСЦА ─────────────────────────────

RECEIPTS = ROOT / "system" / "LINT_RECEIPTS.tsv"
RECEIPTS_HEADER = (
    "# LINT_RECEIPTS.tsv — §62 FIRST-PASS ledger. Каждый настоящий прогон\n"
    "# house_lint пишет рецепт; sha-дельта между соседними прогонами слага =\n"
    "# фикс-пасс (требуется оплата: root-cause + пункт контракта, §62(3)).\n"
    "# Селфтесты и мутации ничего не пишут. Колонки:\n"
    "date\tslug\trun\tsha10\terrors\twarns\tnote")


def _receipt_rows():
    if not RECEIPTS.exists():
        return []
    return [l.split("\t") for l in
            io.open(RECEIPTS, encoding="utf-8").read().splitlines()
            if l and not l.startswith("#") and not l.startswith("date\t")]


def write_receipt(slug, main_path, errors, warns, note=""):
    """Append-only §62 ledger (телеметрия, не закон: свидетельствует,
    не связывает). run=0 / sha=retro-seed — ретро-базлайны, в счётчик
    прогонов не входят."""
    import datetime
    import hashlib
    try:
        sha = hashlib.sha1(Path(main_path).read_bytes()).hexdigest()[:10]
    except OSError:
        sha = "nofile"
    live = [r for r in _receipt_rows()
            if len(r) >= 4 and r[1] == slug and r[3] not in ("retro-seed",)]
    row = [datetime.date.today().isoformat(), slug, str(len(live) + 1), sha,
           str(len(errors)), str(len(warns)), note]
    new_file = not RECEIPTS.exists()
    with io.open(RECEIPTS, "a", encoding="utf-8") as f:
        if new_file:
            f.write(RECEIPTS_HEADER + "\n")
        f.write("\t".join(row) + "\n")


def first_pass_stats(slug):
    """§62 метрика слага: (прогонов, вердикт первого прогона, фикс-пассов)."""
    rows = [r for r in _receipt_rows() if len(r) >= 4 and r[1] == slug]
    if not rows:
        return 0, "нет рецептов (первый прогон ещё не случался)", 0
    first = rows[0]
    if first[3] == "retro-seed":
        verdict = f"ретро-базлайн: {first[4]} ошибок (эра фикс-пассов)"
    else:
        verdict = "CLEAN" if first[4] == "0" else f"DIRTY ({first[4]} err)"
    live = [r for r in rows if r[3] not in ("retro-seed",)]
    fixp = sum(1 for i in range(1, len(live)) if live[i][3] != live[i - 1][3])
    return len(live), verdict, fixp


def writer_contract(cfg=None):
    """§62 THE WRITER'S CONTRACT — все механические законы трёх органов
    (домашний линт / рейтинговый гейт / PH-симуляция) в операционной форме.
    Числа берутся из констант самих органов — контракт и линт делят одно
    число, дрейф невозможен. cfg=None — законный слой (спайн-время, до
    конфига батча); cfg=dict — значения конфига вписаны."""
    import rating_gate_lint as gate
    import ph_sim_gate as phs
    c = dict(DEFAULTS)
    if cfg:
        c.update(cfg)
    neg_lo, neg_hi = c["neg_band"]
    rb = c["racial_band"]
    return {
        "law": ("§62 FIRST-PASS: пиши против контракта — первый прогон линта и "
                "есть целевое состояние (0 ошибок); фикспасс = дефект с оплатой "
                "(root-cause + пункт контракта в worklog)"),
        "structure": {
            "blocks": (f"P01-P{PROMPT_COUNT:02d}, ровно {PROMPT_COUNT} (контракт N29: "
                       "P01-P03 = OC-заказа, та же логика сборки и те же гейты)"),
            "spine_fields": list(SPINE_FIELDS),
            "spine_fields_note": "имена полей ДОСЛОВНО — не 'GEAR (LABEL):' (T1)",
            "pos_neg_format": "POS:\n\n…\n\nNEG:\n\n — блоки разделены пустой строкой (T13)",
            "genre_line": "Genre: G · NCS: X · LLS: LN · Yodayo: T — в каждом блоке; BPT: ретиред",
            "sig": "SIG несёт -PLnnn- и -PALzzz_ENV- (позы/палитры считаются по кодам в SIG)",
        },
        "quotas": {
            "rating_spread": dict(c["rating_spread"]),
            "fam": "FAM-A ≤35% · FAM-C ≥15% · ни один регистр >50% R+-подмножества (§4C-2)",
            "niche": (f"NICHE = {c['niche_count']} (NCS ∈ {c['niche_ok_ncs']}; ARCH:/DEVICE: названы; без повторов)"
                      if c["niche_count"] else "§59 не проверяется этим конфигом"),
            "racial_band": [rb[0], rb[1]],
            "hair_eyes": f"hair ≥{HAIR_DISTINCT_MIN} distinct · eyes ≥{EYES_DISTINCT_MIN} · повторы ≤{HAIR_EYE_REPEAT_MAX}",
            "palettes": f"≥{PALETTES_DISTINCT_MIN} distinct · ≤{PALETTE_REPEAT_MAX} на палитру · вне префиксов окна",
            "lead": f"≥{LEAD_DISTINCT_MIN} зон · ≤{LEAD_REPEAT_MAX} на зону · мандаты: {c['lead_mandates'] or '—'}",
            "poses": f"21-distinct · erotic ≥{EROTIC_MIN} · ecchi ≥{ECCHI_MIN} · static ≤{STATIC_MAX} · X не статичен",
            "codes": (f"K: минты ≤{K_MINT_BUDGET} (голова конфига; из спайна — см. mint_head), "
                      f"возвраты ≥{K_RETURNS_MIN} · distinct ≥{K_DISTINCT_MIN} · повторы ≤{K_REPEAT_MAX} · "
                      f"FET hooks ≥{FET_HOOKS_MIN} · BRE ≥{BRE_DISTINCT_MIN} · BK ≥{BK_DISTINCT_MIN} · "
                      f"B ≥{B_DISTINCT_MIN} · H ≥{H_DISTINCT_MIN} · GAR-F ≥{GARF_DISTINCT_MIN} (семейство {list(c['garf_family'])})"),
        },
        "window": {
            "blocked": "ВСЕ коды K/FET/BRE/BK/B/H/GAR/CAM/PL/палитры окна (3 последних сданных) заблокированы",
            "tuple": f"тупл той же позиции: {SAME_TUPLE_MAX + 1}/4 совпадений с окном = фейл; hair/race той же позиции = фейл",
            "kebab": f"word-overlap ≤{KEBAB_OVERLAP_MAX:.0%} с каждым якорем окна (T10)",
        },
        "per_prompt": {
            "pos_len": f"≤{c['pos_len_hard']} слов (WARN >{c['pos_len_warn']}) — режь ДО сдачи (T5)",
            "state_floor": dict(STATE_FLOOR),
            "state_note": "state-ноуны буквально в POS, tag-run не в счёте; эвфемизмы не считаются (T3)",
            "sat": f"SAT ≥{SAT_MIN} · DESAT/SAT ≤{DESAT_MAX_RATIO} · closer 'Richly pigmented … saturated film color' (T4)",
            "neg": f"{neg_lo}-{neg_hi} терма · базовые {NEG_REQUIRED_BASE} + экстра {c['neg_required_extra']} · "
                    f"анти-лоли ≥{ANTI_LOLI_MIN} · без 'no X' · паритеты R+/X (T6)",
            "tag_floor": dict(TAG_FLOOR),
            "maturity": "якорь банка в tag-run + формула 'grown woman's face' в POS",
            "hedges": "хеджи = 0 в R+ POS (банк в ядре)",
            "race_feat": f"≥{RACE_FEAT_MIN} признаков в POS для не-human (T12)",
            "does_not": f"'does not' ≤{DOES_NOT_MAX} на батч (T14)",
            "caps": f"тики caps: {c['caps'] or 'задаются в конфиге'} (T11)",
            "k_line": "коды техник живут в K:/SIG строках — гейт считает КОДЫ, проза не в счёт (T2)",
            "require_in_pos": c["require_in_pos"] or "—",
            "x_recipe": c["x_recipe"] or "—",
        },
        "rating_layer": {
            "mech_groups": dict(gate.MECH_GROUPS),
            "core4": "≥4 класса × ВСЕ 4 группы механизмов (FABRIC/BODY/POSITION/PHYSICS); G/H — усилители 0.5, не считаются",
            "anti_monopoly": "sheer ≤2/промпт · ≤40% R+ кадров · W ≤45% инстансов батча (§4G)",
            "layer_stack": "внутренняя лямка покидает тело только через именованный выход: off-shoulder/boat neck/scoop/strapless/halter/armhole/… (§4F)",
            "payload": "≥30% предложений POS несут носитель",
            "noun_form": "носители в POS причастиями/пассивами (printing/riding/tracking/pressed) — стек-строки НЕ считаются (T7/T8)",
        },
        "ph_sim": {
            "keep_min": phs.PH_KEEP_MIN,
            "rules": f"tag-run растворяется · каждое предложение без ≥{phs.PH_KEEP_MIN} KEEP-ноунов умирает (T9) · "
                     f"SOFTEN ест verb-led гарниш (≤3 по конфигу) · face formula + closer выживают",
        },
        "traps": [{"id": t, "law": FIRST_PASS_TRAPS[t]}
                  for t in sorted(FIRST_PASS_TRAPS, key=lambda k: int(k[1:]))],
        "first_run": "первый прогон = первый рецепт слага после сборки (system/LINT_RECEIPTS.tsv); цель — 0 ошибок (§62)",
    }


def contract_brief(c, verbose=False):
    """Компактная печать контракта (спайн-отчёт); verbose — все разделы."""
    q, p, w, r = c["quotas"], c["per_prompt"], c["window"], c["rating_layer"]
    L = [
        f"закон: {c['law']}",
        f"структура: {c['structure']['blocks']} · поля дословно "
        f"{', '.join(c['structure']['spine_fields'])}",
        f"квоты: спред {q['rating_spread']} · {q['fam']}",
        f"       {q['racial_band'][0]}-{q['racial_band'][1]} расовых · {q['hair_eyes']} · {q['palettes']}",
        f"       позы: {q['poses']}",
        f"       коды: {q['codes']}",
        f"окно: {w['blocked']}",
        f"      {w['tuple']} · кебаб {w['kebab']}",
        f"промпт: POS {p['pos_len']} · state {p['state_floor']} · {p['sat'].split(' · ')[0]}",
        f"        NEG {p['neg'].split(' · ')[0]} · тег-этажи {p['tag_floor']} · расовые ≥{RACE_FEAT_MIN}",
        f"рейтинг: core-4 {r['core4'].split(';')[0]} · {r['anti_monopoly']}",
        f"        {r['noun_form']}",
        f"PH-сим: {c['ph_sim']['rules']}",
        f"ловушки: T1-T14 (каждая оплачена фикс-пассом N29 — больше не покупается)",
    ]
    if verbose:
        L += [
            f"формат: {c['structure']['pos_neg_format']}",
            f"genre-строка: {c['structure']['genre_line']}",
            f"SIG: {c['structure']['sig']}",
            f"NICHE: {q['niche']}",
            f"LEAD: {q['lead']}",
            f"state-ноуны: {p['state_floor']} — {p['state_note']}",
            f"NEG: {p['neg']}",
            f"{p['hedges']} · {p['does_not']}",
            f"K-строка: {p['k_line']}",
            f"кляузы POS: {p['require_in_pos']} · X-рецепт: {p['x_recipe']}",
            f"механо-группы: {r['mech_groups']}",
            f"layer stack: {r['layer_stack']}",
            f"payload: {r['payload']}",
            f"первый прогон: {c['first_run']}",
        ]
    return L


def print_contract(slug=None):
    """§62: печать контракта писца (с конфигом слага, если он есть)."""
    cfg = None
    if slug:
        cfg_all = yaml.safe_load(io.open(CFG_PATH, encoding="utf-8")) or {}
        cfg = cfg_all.get(slug)
        if cfg is None:
            print(f"HOUSE CONTRACT: нет конфига '{slug}' — законный слой (дефолты ядра)")
    c = writer_contract(cfg)
    print("═" * 72)
    print(f"WRITER'S CONTRACT — {slug or 'ЗАКОННЫЙ СЛОЙ'}  (§62 FIRST-PASS)")
    print("═" * 72)
    for line in contract_brief(c, verbose=True):
        print("  " + line)
    print("─" * 72)
    print("ЛОВУШКИ N29 (4 фикс-пасса → чеклист; §62(3): повторная покупка запрещена):")
    for t in c["traps"]:
        print(f"  {t['id']}: {t['law']}")


def selftest():
    """Чеки P3: (1) ретро n28 = PASS 0 errors; (2) мутационный тест ловит;
    (3) §62-контракт строится из констант; (4) селфтест не пишет рецептов."""
    ok = True
    print("── SELFTEST 1: retro n28 (delivered file must PASS)")
    errs = run_lint("n28", receipt=False)
    if errs is None:
        print("  ✗ no config"); return 1
    if errs:
        print(f"  ✗ retro run has {len(errs)} errors — port bug")
        ok = False
    else:
        print("  ✓ retro PASS 0 errors (matches batch_n28_lint.py)")

    print("── SELFTEST 2: mutation test (injected violations must be caught)")
    src = io.open(DL / "BATCH_N28_NOBODY_KNOWS.md", encoding="utf-8").read()
    mut = src
    # (a) §40: свеча в первый POS
    mut = re.sub(r"(?m)^(POS:\s*\n\s*\n)", r"\1A candle burns on the sill. ", mut, count=1)
    # (b) §43: vertebra в POS
    mut = mut.replace("Richly pigmented", "the spine vertebra by vertebra, Richly pigmented", 1)
    # (c) хедж в R+ POS
    mut = mut.replace("grown woman's face", "tasteful grown woman's face", 1)
    # (d) окно-заблокированный K в SIG
    win_text = "".join(io.open(p, encoding="utf-8").read()
                       for p in window_for(28).values())
    wk = sorted(set(re.findall(r"\bK\d{2,3}\b", win_text)))[0]
    mut = re.sub(r"(?m)^(SIG: .*)$", r"\1 " + wk, mut, count=1)
    tmp = SC / "mutation_test_n28.md"
    io.open(tmp, "w", encoding="utf-8").write(mut)
    errs2 = run_lint("n28", file_override=str(tmp), receipt=False)
    tmp.unlink()
    caught = [e for e in (errs2 or [])
              if any(k in e for k in ("§40", "§43", "vertebra", "hedge",
                                      "window-blocked K"))]
    if len(caught) >= 3:
        print(f"  ✓ mutation caught ({len(caught)} named hits): "
              + "; ".join(caught[:3]))
    else:
        print(f"  ✗ mutation test caught only {len(caught)}: {errs2}")
        ok = False
    print("── SELFTEST 3: §62 контракт + гигиена рецептов")
    n_before = len(_receipt_rows())
    c = writer_contract(None)
    okc = ({t["id"] for t in c["traps"]} ==
           {f"T{i}" for i in range(1, 15)}
           and c["per_prompt"]["state_floor"] == STATE_FLOOR
           and c["per_prompt"]["tag_floor"] == TAG_FLOOR
           and tuple(c["per_prompt"]["neg"].split(" · ")[0].replace("терма", "").strip().split("-")) == tuple(str(x) for x in DEFAULTS["neg_band"]))
    if okc:
        print("  ✓ контракт строится: T1-T14 на месте, числа из констант ядра")
    else:
        print("  ✗ контракт неполный/дрейфует"); ok = False
    if len(_receipt_rows()) == n_before:
        print("  ✓ селфтест рецептов не пишет (ledger чист)")
    else:
        print("  ✗ селфтест написал рецепт — нарушение §62(4)"); ok = False
    print("ALL SELFTESTS PASS" if ok else "SELFTEST FAILURES")
    return 0 if ok else 1


def main():
    args = sys.argv[1:]
    if not args or args[0] == "--selftest":
        sys.exit(selftest())
    if args[0] == "--contract":
        print_contract(args[1] if len(args) >= 2 else None)
        sys.exit(0)
    if args[0] == "--slug" and len(args) >= 2:
        errs = run_lint(args[1], file_override=(args[3] if len(args) >= 4 and args[2] == "--file" else None))
        if errs is None:
            sys.exit(0)   # no config — skip
        sys.exit(1 if errs else 0)
    print("usage: house_lint.py --slug n28 [--file OVERRIDE] | --contract [slug] | --selftest")
    sys.exit(2)


if __name__ == "__main__":
    main()
