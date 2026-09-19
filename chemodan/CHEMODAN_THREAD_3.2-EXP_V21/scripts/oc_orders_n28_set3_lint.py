#!/usr/bin/env python3
# oc_orders_n28_set3_lint.py — lint for OC_ORDERS_N28_SET3.md (Lua / Una /
# Yui — the three author themes). Canon locks in POS, anti-shields in NEG
# (noun-forms), §52 R+ floor ≥3, §53A bank + face formula, anti-loli floor,
# §49 economy 40-52, «no X» ban, §40 words, §16 closer, hedges zero,
# §17B tics zero, §60 PH-proof floors (prose states ≥3 + anti-leak guard),
# order-clause verification (the three themes).
import io, re, sys

D = "/home/z/my-project/download/OC_ORDERS_N28_SET3.md"
t = io.open(D, encoding="utf-8").read()
errors, warns = [], []
def err(m): errors.append(m)

SPEC = {
 "OC1": dict(anchor="the-second-cup-pours-anyway", name="Lua",
   locks=["obsidian-black", "purple sheen", "ram horns", "serpentine tail",
          "beauty mark", "mourning dress", "half-lidded"],
   shield=["straight antler horns", "tailless", "dark eyes",
           "bright festive clothing", "colorful outfit"]),
 "OC2": dict(anchor="the-gown-never-heard-the-verdict", name="Una",
   locks=["silver-grey", "curtain bangs", "pince-nez", "ruby-red",
          "eyebrow scar", "verdict gown", "cool ivory"],
   shield=["glasses worn high", "blue eyes", "heterochromia",
           "warm skin tone", "rosy skin"]),
 "OC3": dict(anchor="the-sun-cannot-play-it-cool", name="Yui",
   locks=["pink gradient", "messy ponytail", "bow", "hairpins",
          "ring-shaped pupils", "fangs", "beauty mark"],
   shield=["violet hair", "purple hair", "black hair", "blunt teeth",
           "bowless", "athletic build", "slender build"]),
}

blocks = re.split(r"(?m)^(?=OC\d — )", t)
found = {}
for b in blocks:
    m = re.match(r"(OC\d) — ", b)
    if m:
        found[m.group(1)] = b
if len(found) != 3: err(f"OC count {len(found)} != 3 (found: {sorted(found)})")

RP_BANK = ["pokies","cameltoe","wedgie","wet clothes","wet","wet hair","ass",
 "ass focus","presenting","spread legs","squatting","straddling",
 "arched back","open clothes","half-undressed","sweat","glistening",
 "large breasts","curvy","leotard","arms up","soap","bare shoulders",
 "breast focus","see-through","cleavage","sideboob","underboob","from behind",
 "from below","from above","from side","hip focus","thigh focus","bare back",
 "navel","collarbone","collar","sitting","mid-turn","ram horns","tail",
 "wet clothes","soaked","plastered"]

TICS = ["camel-honest", "shape-honest", "owns the frame", "clung"]
WATCH = {"goes": 1, "gone": 3, "last": 3, "weight": 3, "still": 3, "clinging": 2}

STATE_NOUNS = ["topless", "bare chest", "bare breasts", "see-through", "sheer",
    "wet", "transparent", "translucent", "large breasts", "glistening", "nipples",
    "bare", "bared", "soaked", "plastered", "clinging"]
TAGRUN_RX = re.compile(r"1girl, solo, [^.\n]+\.?", re.I)

for oid, spec in SPEC.items():
    b = found.get(oid)
    if not b: err(f"{oid}: block missing"); continue
    pm = re.search(r"(?m)^POS:\s*\n\s*\n(.*?)(?=^NEG:)", b, re.S)
    nm = re.search(r"(?m)^NEG:\s*\n\s*\n(.*?)(?=^OC\d|^═|^SELF-CHECK|\Z)", b, re.S)
    pos = pm.group(1).strip() if pm else ""
    neg = nm.group(1).strip() if nm else ""
    if not pos: err(f"{oid}: POS missing"); continue
    if not neg: err(f"{oid}: NEG missing"); continue
    if spec["anchor"] not in b: err(f"{oid}: anchor not in block")
    for lk in spec["locks"]:
        if lk.lower() not in pos.lower(): err(f"{oid}: canon lock missing in POS: '{lk}'")
    for sh in spec["shield"]:
        if sh.lower() not in neg.lower(): err(f"{oid}: anti-shield term missing in NEG: '{sh}'")
    m2 = re.search(r"1girl, solo, ([^,]+(?:, [^,]+){0,11}), ", pos)
    tagrun = m2.group(1).lower() if m2 else ""
    hits = sum(1 for tg in RP_BANK if tg in tagrun)
    if hits < 3: err(f"{oid}: §52 tag floor {hits} < 3 (tagrun: {tagrun[:80]})")
    if not any(a in tagrun for a in ("mature female", "adult woman", "young woman")):
        err(f"{oid}: §53A bank anchor missing")
    if "grown woman's face" not in pos: err(f"{oid}: face formula missing")
    lol = sum(1 for x in ("child","childish","chibi","young girl","immature body","oversized head") if x in neg)
    if lol < 3: err(f"{oid}: anti-loli floor {lol} < 3")
    terms = [x.strip() for x in neg.split(",") if x.strip()]
    if not (40 <= len(terms) <= 52): err(f"{oid}: NEG terms {len(terms)} outside 40-52")
    if re.search(r"\bno [a-z]", neg, re.I): err(f"{oid}: 'no X' phrasing in NEG")
    for need in ("tarot card", "male", "exposed genitals", "washed-out"):
        if need not in neg: err(f"{oid}: NEG missing '{need}'")
    if "nipples visible through" in neg: err(f"{oid}: §4B 'nipples visible through' in R+ NEG")
    for bare in ("nipple visible", "bare nipple", "bare breasts"):
        if bare not in neg: err(f"{oid}: R+ NEG missing '{bare}'")
    for w in re.finditer(r"\bcandle(s)?\b|\blamp\b|lantern|torch|chandelier|brazier|vertebra|camera \[", pos, re.I):
        err(f"{oid}: §40 banned word in POS: '{w.group(0)}'")
    if "Richly pigmented" not in pos or "saturated film color" not in pos:
        err(f"{oid}: §16 closer missing")
    for h in ("shape-only", "at its limit", "no further", "implied by", "hints of", "tasteful"):
        if h in pos.lower(): err(f"{oid}: hedge '{h}' in R+ POS")
    for tic in TICS:
        if tic in pos.lower(): err(f"{oid}: §17B tic in POS: '{tic}'")
    prose = re.sub(r"1girl, solo, [^.]*\.", " ", pos)
    for w, cap in WATCH.items():
        n = len(re.findall(r"\b" + w + r"\b", prose, re.I))
        if n > cap: err(f"{oid}: watchlist word '{w}' ×{n} > {cap}")
    # §60 PH-proof floors
    no_tags = TAGRUN_RX.sub(" ", pos).lower()
    states = {s for s in STATE_NOUNS if s in no_tags}
    if len(states) < 3: err(f"{oid}: §60 prose state nouns {len(states)} < 3")
    for guard in ("signature", "watermark"):
        if guard not in neg: err(f"{oid}: §60 anti-leak guard missing '{guard}'")
    wl = len(pos.split())
    if wl > 400: err(f"{oid}: §60 POS length {wl} > 400")  # V18.1
    elif wl > 320: warns.append(f"{oid}: §60 POS length {wl} > 320 (WARN)")

# order-clause verification (SET3's three author themes)
l = found.get("OC1", "").lower()
if not ("second cup" in l or "second teacup" in l):
    err("OC1: the second-cup clause missing (I Don't Need Anyone)")
if "pour" not in l:
    err("OC1: the pouring habit not named")
u = found.get("OC2", "").lower()
for clause in ("hem", "pince-nez", "irrelevant"):
    if clause not in u: err(f"OC2: the indifference-tell '{clause}' missing")
y = found.get("OC3", "").lower()
for clause in ("blush", "brighten"):
    if clause not in y: err(f"OC3: the attention-clause '{clause}' missing")

print("OC N28 SET3 LINT (Lua Alone / Una Indifferent / Yui Noticed)")
if errors:
    print(f"ERRORS ({len(errors)}):")
    for e in errors: print("  ✗", e)
    sys.exit(1)
print("PASS — 0 errors (canon locks ×3, shields, tag floors, §53A bank,")
print("anti-loli, economy, §40 clean, §17B tics zero, order clauses verified,")
print("§60 PH-proof floors held)")
if warns:
    print(f"warnings ({len(warns)}):")
    for w in warns: print("  ⚠", w)
