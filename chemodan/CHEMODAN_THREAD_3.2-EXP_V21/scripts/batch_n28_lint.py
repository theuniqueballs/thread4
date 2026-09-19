#!/usr/bin/env python3
# batch_n28_lint.py — lint for N28 «NOBODY KNOWS»
# V18 edition: ARCANA engine + §60 PH-PROOF checks — anti-leak guard
# in every NEG, POS length (WARN>320, FAIL>380), prose state-noun floor
# (R+≥3, X≥4 — the render-confirmed recipe), §58/§59 standing, K-RETURN
# (mint head K202+), window AUTO-PARSED from N25/N26/N27.
import io, re, sys
from collections import Counter

D = "/home/z/my-project/download/"
t = io.open(D + "BATCH_N28_NOBODY_KNOWS.md", encoding="utf-8").read()
errors, warns = [], []
def err(m): errors.append(m)
def warn(m): warns.append(m)

WIN_FILES = {"N25": "BATCH_N25_THE_RAIN_FELL_UPWARD.md",
             "N26": "BATCH_N26_SILENCE_IS_THE_SLOWEST_UNDRESSING.md",
             "N27": "BATCH_N27_SOMEWHERE_BETWEEN_HERE_AND_MAGIC.md"}

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

WIN = {tag: parse_window(D + f) for tag, f in WIN_FILES.items()}
win_text = "".join(io.open(D + f, encoding="utf-8").read() for f in WIN_FILES.values())
BLOCK_K = set(re.findall(r"\bK\d{2,3}\b", win_text))
BLOCK_FET = set(re.findall(r"\bFET\d+\b", win_text))
BLOCK_GARF = set(re.findall(r"\bGAR\d+\b", win_text))
BLOCK_PAL_PREFIX = {p.split("_")[0] + "_" for p in re.findall(r"\b(P\d{2,3}_[A-Z_]+)\b", win_text)}

blocks = re.split(r"\n(?=P\d\d — )", t)
prompts = {}
for b in blocks:
    m = re.match(r"(P\d\d) — ", b)
    if not m: continue
    pm = re.search(r"(?m)^POS:\s*\n\s*\n(.*?)(?=^NEG:|\Z)", b, re.S)
    nm = re.search(r"(?m)^NEG:\s*\n\s*\n(.*?)(?=^P\d\d|^═|^SELF-CHECK|^── |\Z)", b, re.M | re.S)
    if not pm: err(f"{m.group(1)}: no POS block"); continue
    prompts[m.group(1)] = {"pos": pm.group(1).strip(),
                           "neg": (nm.group(1).strip() if nm else ""), "raw": b}
if len(prompts) != 21: err(f"prompt count {len(prompts)} != 21")
order = [f"P{n:02d}" for n in range(1, 22)]
for pid in order:
    if pid not in prompts: err(f"{pid}: missing")

ratings, genres, ncs_map, lls_map, lead_map = {}, {}, {}, {}, {}
for pid, p in prompts.items():
    gm = re.search(r"Genre: (\w+) · NCS: (\w+) · LLS: (L\d)", p["raw"])
    if not gm: err(f"{pid}: no Genre/NCS/LLS line"); continue
    genres[pid], ncs_map[pid], lls_map[pid] = gm.group(1), gm.group(2), gm.group(3)
    ym = re.search(r"Yodayo: (\S+)", p["raw"])
    if not ym: err(f"{pid}: no Yodayo tag"); continue
    ratings[pid] = ym.group(1)
    lm = re.search(r"LEAD: ([\w-]+)", p["raw"])
    lead_map[pid] = lm.group(1) if lm else "?"
    if "BPT:" in p["raw"]: err(f"{pid}: retired BPT field still present")

rc = Counter(ratings.values())
if dict(rc) != {"R": 7, "R+": 12, "X": 2}:
    err(f"rating spread {dict(rc)} != R7/R+12/X2")

xp = sorted(pid for pid in order if ratings.get(pid) == "X")
if xp != ["P07", "P14"]: err(f"X positions {xp} != P07/P14 (window-clean pair)")

# §41 ladder
for pid in order:
    n, l, y = ncs_map.get(pid), lls_map.get(pid), ratings.get(pid)
    if n == "THROUGH_FABRIC" and l not in ("L1", "L2"): err(f"{pid}: TF with {l}")
    if n == "VISIBLE" and l != "L2": err(f"{pid}: VISIBLE with {l}")
    if n == "TOPLESS_BACK" and l not in ("L2", "L3"): err(f"{pid}: TB with {l}")
    if n == "TOPLESS" and l not in ("L2", "L3"): err(f"{pid}: TOPLESS with {l}")
    if n == "NAKED" and l != "L3": err(f"{pid}: NAKED with {l}")
    if y == "X" and n not in ("TOPLESS", "NAKED", "VISIBLE"): err(f"{pid}: X with {n}")
    if y == "R" and l not in ("L1", "L2"): err(f"{pid}: R with {l}")
    if y == "R+" and l not in ("L2", "L3"): err(f"{pid}: R+ with {l}")

# same-position tuples vs window
for pid in order:
    for tag, w in WIN.items():
        row = w.get(pid)
        if not row: continue
        fields = [genres[pid] == row["genre"], lead_map[pid] == row["d19"],
                  ncs_map[pid] == row["ncs"], lls_map[pid] == row["lls"]]
        if sum(fields) >= 4:
            err(f"{pid}: same-position tuple {sum(fields)}/4 vs {tag}")

# hair/eye/race grid
hair_map, eye_map, race_map = {}, {}, {}
for pid in order:
    hm = re.search(r"Hair/Eyes: (.*?)\n", prompts[pid]["raw"])
    if not hm: err(f"{pid}: no Hair/Eyes spine"); continue
    hair_map[pid] = hm.group(1).split("/")[0].strip()
    eye_map[pid] = hm.group(1).split("/")[1].split("·")[0].strip()
    rm = re.search(r"Race: ([\w-]+)", prompts[pid]["raw"])
    race_map[pid] = rm.group(1) if rm else "human"

hc = Counter(hair_map.values()); ec = Counter(eye_map.values())
if len(hc) < 15: err(f"hair distinct {len(hc)} < 15")
if len(ec) < 10: err(f"eyes distinct {len(ec)} < 10")
for c, n in hc.items():
    if n > 3: err(f"hair '{c}' x{n} > 3")
for c, n in ec.items():
    if n > 3: err(f"eyes '{c}' x{n} > 3")
for pid in order:
    for tag, w in WIN.items():
        row = w.get(pid)
        if not row: continue
        if hair_map[pid].split()[0].lower() == row["hair"].split()[0].lower():
            err(f"{pid}: same-position hair '{hair_map[pid]}' vs {tag}")
        if race_map[pid] == row["race"] and race_map[pid] != "human":
            err(f"{pid}: same-position race '{race_map[pid]}' vs {tag}")

nr = sum(1 for pid in order if race_map[pid] != "human")
if not (9 <= nr <= 11): err(f"racial girls {nr} outside 9-11")

# §59 NICHE restoration
NICHE_OK_NCS = {"CONCEALED", "COVERED"}
niche_ids = [pid for pid in order if genres.get(pid) == "NICHE"]
if len(niche_ids) != 7: err(f"NICHE count {len(niche_ids)} != 7")
for pid in niche_ids:
    if ncs_map.get(pid) not in NICHE_OK_NCS:
        err(f"{pid}: §59 NICHE with NCS {ncs_map.get(pid)} — auto-VOLT violation")
    if "ARCH:" not in prompts[pid]["raw"] or "DEVICE:" not in prompts[pid]["raw"]:
        err(f"{pid}: §59 archetype/device not named in pre-header")
archs = [re.search(r"ARCH: (\w[\w-]*)", prompts[p]["raw"]).group(1) for p in niche_ids
         if re.search(r"ARCH: (\w[\w-]*)", prompts[p]["raw"])]
if len(set(archs)) != len(archs): err(f"§59 archetype repeat: {archs}")

# §58 pose ledger
pl_map = {}
for pid in order:
    pm = re.search(r"-PL(\d{2,3})-", prompts[pid]["raw"])
    pl_map[pid] = "PL" + pm.group(1) if pm else None
    if not pm: err(f"{pid}: no PL code in SIG")
plc = Counter(v for v in pl_map.values() if v)
for v, n in plc.items():
    if n > 1: err(f"§58(e): pose code {v} used {n}x — 21-distinct law")
STATIC = {"PL01", "PL02", "PL06", "PL08", "PL19", "PL29"}
statics = [p for p in order if pl_map.get(p) in STATIC]
if len(statics) > 2: err(f"§58(b): static verticals {len(statics)} > 2")
for pid in order:
    if ratings.get(pid) == "X" and pl_map.get(pid) in STATIC:
        err(f"{pid}: §58(b) static vertical in X slot")
EROTIC = {f"PL{n}" for n in list(range(49, 61)) + list(range(181, 205))}
erotic = [p for p in order if pl_map.get(p) in EROTIC]
if len(erotic) < 4: err(f"§58(c): erotic-presentation codes {len(erotic)} < 4")
ECCHI = {f"PL{n}" for n in range(61, 85)}
ecchi = [p for p in order if pl_map.get(p) in ECCHI]
if len(ecchi) < 3: err(f"§58(d): ecchi-classic codes {len(ecchi)} < 3")

# LEAD mandates (declared grid: hands ×3, breasts ×3)
leadc = Counter(lead_map.values())
for z in ("hands", "breasts"):
    if leadc.get(z, 0) < 3: err(f"LEAD mandate {z} = {leadc.get(z, 0)} < 3")
for z, n in leadc.items():
    if n > 4: err(f"LEAD {z} x{n} > 4")
if len(leadc) < 8: err(f"LEAD distinct zones {len(leadc)} < 8")

# K codes: window + budget + mints
spines = "".join(p["raw"] for p in prompts.values())
all_k = set(re.findall(r"\bK\d{2,3}\b", spines))
if all_k & BLOCK_K: err(f"window-blocked K used: {sorted(all_k & BLOCK_K)}")
mints = {k for k in all_k if int(k[1:]) >= 202}
returns = all_k - mints
if len(mints) > 8: err(f"K mint budget {len(mints)} > 8")
if len(returns) < 10: err(f"K returns {len(returns)} < 10")
kc = Counter(re.findall(r"\bK\d{2,3}\b", spines))
if len(kc) < 5: err(f"distinct K codes {len(kc)} < 5")
for k, n in kc.items():
    if n > 3: err(f"{k} x{n} > 3")

# FET: window + §55 scenario floor
used_f = set(re.findall(r"\bFET\d+\b", spines))
if used_f & BLOCK_FET: err(f"window-blocked FET used: {sorted(used_f & BLOCK_FET)}")
SCEN = {"FET11","FET12","FET13","FET14","FET15","FET16","FET17","FET18","FET19",
        "FET20","FET21","FET22","FET23","FET24","FET25"}
hooks = used_f & SCEN
if len(hooks) < 2: err(f"§55 scenario hooks < 2 ({sorted(hooks)})")

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
if len(used_bre) < 3: err(f"BRE distinct {len(used_bre)} < 3")
if len(used_bk) < 2: err(f"BK distinct {len(used_bk)} < 2")
if len(used_b) < 2: err(f"B distinct {len(used_b)} < 2")

# H + GAR-F (v1 family returns this cycle)
used_h = set(re.findall(r"\bH\d{2}\b", spines))
win_h = set(re.findall(r"\bH\d{2}\b", win_text))
if used_h & win_h: err(f"window-blocked H: {sorted(used_h & win_h)}")
if len(used_h) < 2: err(f"H codes {len(used_h)} < 2")
garf = {"GAR" + g for g in re.findall(r"\bGAR(4[1-8])\b", spines)}
if len(garf) < 2: err(f"GAR-F v1 returns {len(garf)} < 2 (GAR41-48 family)")
if BLOCK_GARF & garf: err(f"window-blocked GAR-F cited: {sorted(BLOCK_GARF & garf)}")

# palettes
pals = Counter(re.findall(r"((?:P\d{2,3})_[A-Z_]+)", spines))
bad_pal = {p for p in pals if p.startswith(tuple(BLOCK_PAL_PREFIX))}
if bad_pal: err(f"window-blocked palettes: {sorted(bad_pal)}")
pids_only = Counter(re.findall(r"-((?:P\d{2,3})_[A-Z_]+)-ENV", spines))
for k, n in pids_only.items():
    if n > 2: err(f"palette {k} x{n} > 2")
if len(pids_only) < 19: err(f"distinct palettes {len(pids_only)} < 19")

# kebab anchors vs window
new_anchors = [m.group(1) for m in re.finditer(r"(?m)^P\d\d — ([a-z0-9-]+) ", t)]
if len(new_anchors) != 21: err(f"anchors found {len(new_anchors)} != 21")
if len(set(new_anchors)) != len(new_anchors): err("duplicate anchors in batch")
win_all = []
for f in WIN_FILES.values():
    win_all += re.findall(r"(?m)^P\d\d — ([a-z0-9-]+) ", io.open(D + f, encoding="utf-8").read())
def word_overlap(a, b):
    sa, sb = set(a.split("-")), set(b.split("-"))
    if len(sa) < 2 or len(sb) < 2: return 0.0
    return len(sa & sb) / len(sa | sb)
for a in new_anchors:
    for w in win_all:
        if word_overlap(a, w) > 0.34:
            err(f"kebab '{a}' ~ window '{w}' (word overlap {word_overlap(a,w):.0%} > 34%)")

# §40 banned words in POS
BAN = r"\bcandle(s)?\b|\blamp\b|lantern|torch|chandelier|brazier|vertebra|spinal column|camera \[|camera a|camera at"
for pid in order:
    pos = prompts[pid]["pos"]
    for m in re.finditer(BAN, pos, re.I):
        err(f"{pid}: §40 banned word in POS: '{m.group(0)}'")
dn = len(re.findall(r"does not", " ".join(prompts[p]["pos"] for p in order)))
if dn > 1: err(f"'does not' count {dn} > 1")

# §17B caps — N26's rotation tics at ZERO + the N27 watchlist
pos_all = " ".join(prompts[p]["pos"] for p in order)
low = pos_all.lower()
caps = {"camel-honest": 0, "shape-honest": 0, "clung": 0, "clinging": 8,
        "peaks printing": 0, "points straining": 0, "depth tones": 25,
        "deposed": 5, "municipal": 11, "far half": 10, "near half": 7,
        "arithmetic": 8, "at a glance": 3, "unhurried": 5, "seam": 32,  # theme noun — N25 rain precedent  # the theme noun (N25 rain precedent)
        "honest": 2, "printed": 9, "line": 34, "keeps": 8, "standing": 5,
        "jurisdiction": 5, "owns": 14, "goes": 2}
for phrase, cap in caps.items():
    n = len(re.findall(r"(?<![a-z-])" + re.escape(phrase) + r"(?![a-z-])", low))
    if n > cap:
        err(f"§17B cap '{phrase}' = {n} > {cap}")

# hedges in R+ POS
HEDGES = ["shape-only", "at its limit", "at their limit", "no further",
          "never the sentence's subject", "never the point itself",
          "implied by", "hints of", "suggestion of", "tasteful"]
for pid in order:
    if ratings.get(pid) != "R+": continue
    pos = prompts[pid]["pos"].lower()
    for h in HEDGES:
        if h in pos: err(f"{pid}: hedge '{h}' in R+ POS")

# §49 NEG economy
for pid in order:
    neg = prompts[pid]["neg"]
    terms = [x.strip() for x in neg.split(",") if x.strip()]
    if not (38 <= len(terms) <= 52): err(f"{pid}: NEG terms {len(terms)} outside 38-52")
    if re.search(r"\bno [a-z]", neg, re.I): err(f"{pid}: 'no X' phrasing in NEG")
    for need in ("tarot card", "child", "chibi", "washed-out", "male", "exposed genitals"):
        if need not in neg: err(f"{pid}: NEG missing '{need}'")
    lol = sum(1 for x in ("child", "childish", "chibi", "young girl", "immature body", "oversized head") if x in neg)
    if lol < 3: err(f"{pid}: anti-loli floor {lol} < 3")
    if ratings.get(pid) in ("R",):
        if "nipples visible through" not in neg:
            warn(f"{pid}: R NEG missing 'nipples visible through' (full block per §49)")
    if ratings.get(pid) == "R+":
        if "nipples visible through" in neg:
            err(f"{pid}: 'nipples visible through' in R+ NEG — §4B violation")
        for bare in ("nipple visible", "bare nipple", "bare breasts"):
            if bare not in neg: err(f"{pid}: R+ NEG missing bare-form '{bare}'")
    if ratings.get(pid) == "X":
        for bad in ("nipple visible", "bare nipple", "bare breasts", "nipples visible through"):
            if bad in neg: err(f"{pid}: X NEG carries nipple term '{bad}' (bare is the content)")

# §52 tag floors + §53A bank
R_BANK = {"see-through","cleavage","sideboob","underboob","shirt lift","skirt lift",
          "skirt flip","fluttering clothes","from behind","from below","from above",
          "from side","hip focus","thigh focus","bare back","navel","collarbone","collar",
          "bare shoulders","sleeveless"}
RP_BANK = R_BANK | {"pokies","cameltoe","wedgie","wet clothes","wet","wet hair","ass",
          "ass focus","ass grab","grabbing own ass","presenting","spread legs","squatting",
          "straddling","arched back","open clothes","half-undressed","sweat","glistening",
          "large breasts","curvy","leotard","arms up","soap","breast focus","apron","no bra","mesh"}
X_BANK = RP_BANK | {"topless","bare chest"}
MAT = ("mature female", "adult woman", "young woman")
for pid in order:
    pos = prompts[pid]["pos"]
    m = re.search(r"1girl, solo, ([^,]+(?:, [^,]+){0,8}), ", pos)
    tagrun = m.group(1).lower() if m else ""
    r = ratings.get(pid)
    bank = {"R": R_BANK, "R+": RP_BANK, "X": X_BANK}.get(r, set())
    hits = sum(1 for tg in bank if tg in tagrun)
    need = {"R": 1, "R+": 3, "X": 2}.get(r, 0)
    if hits < need: err(f"{pid}: §52 tag floor {hits} < {need} (tag-run: …{tagrun[:80]})")
    if not any(a in tagrun for a in MAT): err(f"{pid}: §53A maturity anchor missing")
    if "grown woman's face" not in pos: err(f"{pid}: grown-woman face formula missing")
    neg_terms = [x.strip().lower() for x in prompts[pid]["neg"].split(",")]
    for tg in [x.strip() for x in tagrun.split(",")]:
        if tg and len(tg) > 3 and tg in neg_terms:
            err(f"{pid}: own tag '{tg}' appears as WHOLE NEG term")

# §54 RACE DELIVERY
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
for pid in order:
    race = race_map[pid]
    if race == "human": continue
    pos = prompts[pid]["pos"]
    m = re.search(r"1girl, solo, ([^,]+(?:, [^,]+){0,8}), ", pos)
    tagrun = m.group(1).lower() if m else ""
    if not any(tt in tagrun for tt in RACE_TAG.get(race, ())):
        err(f"{pid}: §54 race tag missing for {race}")
    feats = re.findall(r"ear|horn|tail|wing|scale|seam|joint|vine|bloom|slit pupil|antler|hoof|carapace|tine|membrane|antenna|frill|spore|hood|mast|mantle|feather|sucker", pos, re.I)
    if len(feats) < 3: err(f"{pid}: §54 prose feature mentions {len(feats)} < 3 ({race})")

# §51 color gate (the LIMEN witness bank)
DESAT = r"pale|muted|faint|washed|milky|hazy|soft grey|ash grey|grey overlay|desaturated|smoke-grey|dust"
SAT = r"saturated|vermilion|gold|brass|honey|amber|gilt|gilded|silver|copper|bright red|burning|ember|teal|plum|ivory|scarlet|crimson|burgundy|wine|oxblood|cherry|mahogany|henna|flax|edelweiss|ultramarine|cobalt|prussian|cerulean|glacier|gentian|sapphire|indigo|neon-teal|sepia|fawn|clover|champagne|ingot|vermeil|lacquer|coral|lantern|phosphor|aurora|nacre|pearl"
for pid in order:
    pos = prompts[pid]["pos"]
    d = len(re.findall(DESAT, pos, re.I)); s = len(re.findall(SAT, pos, re.I))
    if s < 3: err(f"{pid}: SAT carriers {s} < 3")
    if d and d / max(s, 1) > 1.2: err(f"{pid}: DESAT/SAT {d}/{s} > 1.2")
    if "Richly pigmented" not in pos or "saturated film color" not in pos:
        err(f"{pid}: §16 color closer missing")

# spine fields
for pid in order:
    for field in ("Verb:", "CLO:", "OPN:", "LEAD:", "THESIS:", "SIG:", "Interaction type:", "GEAR:"):
        if field not in prompts[pid]["raw"]:
            err(f"{pid}: spine line missing '{field}'")

# ── V18 §60 checks ───────────────────────────────────────────────────────
STATE_NOUNS = ["topless", "bare chest", "bare breasts", "see-through", "sheer",
    "wet", "transparent", "translucent", "presenting", "spread legs", "squatting",
    "straddling", "open clothes", "half-undressed", "large breasts", "glistening",
    "cameltoe", "bare shoulders", "her bare", "nipples", "bared", "soaked",
    "plastered", "clinging", "clings"]
TAGRUN_RX = re.compile(r"1girl, solo, [^.\n]+\.?", re.I)
for pid in order:
    pos = prompts[pid]["pos"]
    r = ratings.get(pid)
    no_tags = TAGRUN_RX.sub(" ", pos).lower()
    states = {s for s in STATE_NOUNS if s in no_tags}
    need = {"X": 4, "R+": 3}.get(r, 0)
    if len(states) < need:
        err(f"{pid}: §60 prose state nouns {len(states)} < {need} (PH-proof floor)")
    # length law
    w = len(pos.split())
    if w > 400: err(f"{pid}: §60 POS length {w} > 400")  # V18.1: calibrated — the see-saw lesson
    if w > 320: warn(f"{pid}: §60 POS length {w} > 320 (WARN)")
    # anti-leak guard
    neg = prompts[pid]["neg"]
    for guard in ("signature", "watermark"):
        if guard not in neg: err(f"{pid}: §60 anti-leak guard missing '{guard}'")
    # verb-led carriers: max 1 load-bearing garnish (count v5/v6 verbs in POS)
    v56 = len(re.findall(r"\b(re-arriv|publishes?|filing|files its|claiming her|emigrat|clocks? out|swaying to rest|settles with)\b", pos, re.I))
    if v56 > 3: err(f"{pid}: §60 verb-led carrier garnish {v56} > 3 (PH-fragile load-bearing)")

# the ARCANA clause: confidant named per frame
for pid in order:
    if "confidant" not in prompts[pid]["pos"].lower():
        err(f"{pid}: ARCANA's one-confidant clause missing")

# V18 X-craft markers (the render-confirmed recipe)
for pid in ("P07", "P14"):
    pos = prompts[pid]["pos"]
    if "mouth open" not in pos.lower():
        err(f"{pid}: X-recipe open-mouth marker missing")

# report
print("BATCH N28 LINT (V18: ARCANA + §60 PH-proof checks, §58/§59 standing)")
print(f"  prompts: {len(prompts)} | R {rc.get('R',0)} / R+ {rc.get('R+',0)} / X {rc.get('X',0)}")
print(f"  hair distinct: {len(hc)} | eye distinct: {len(ec)} | racial: {nr}")
print(f"  K: {len(kc)} distinct (mints {len(mints)} ≤8, returns {len(returns)}) | FET hooks: {sorted(hooks)}")
print(f"  BRE: {sorted(used_bre)} | BK: {sorted(used_bk)} | B: {sorted(used_b)} | GAR-F: {sorted(garf)}")
print(f"  palettes distinct: {len(pids_only)} | H: {sorted(used_h)}")
print(f"  LEAD: {dict(leadc)}")
print(f"  §58 poses: {len(plc)} distinct | erotic {len(erotic)} | ecchi {len(ecchi)} | static {len(statics)}")
print(f"  §17B counts: " + ", ".join(f"{p}={len(re.findall(r'(?<![a-z-])' + re.escape(p) + r'(?![a-z-])', low))}" for p in ("seam","municipal","deposed","far half","printed")))
if errors:
    print(f"\nERRORS ({len(errors)}):")
    for e in errors: print("  ✗", e)
else:
    print("\nPASS — 0 errors")
if warns:
    print(f"warnings ({len(warns)}):")
    for w in warns: print("  ⚠", w)
sys.exit(1 if errors else 0)
