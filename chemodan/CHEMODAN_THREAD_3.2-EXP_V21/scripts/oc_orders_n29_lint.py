#!/usr/bin/env python3
# oc_orders_n29_lint.py — OC canon locks for the MERGED batch (the author's
# 2026-09-16 order: OC orders ride the 21-batch as P01-P03 first, same
# assembly logic). Checks the three OC blocks inside BATCH_N29 against
# OC_CANON v1.7.1 (Rue / Rin / Nix — «the most bored in canon»), plus the
# standard §49/§52/§53A/§60 discipline the mains obey.
import io, re, sys

DL = "/home/z/my-project/download/"
F = "BATCH_N29_NO_ONE_WROTE_THIS_SCENE.md"
t = io.open(DL + F, encoding="utf-8").read()

errors = []
def err(m): errors.append(m)

# canon lock specs (POS must contain each lock string, lowercased match)
SPEC = {
    "P01": {
        "name": "Rue (The Hungry Mimic)",
        "anchor": "the-counterfeit-holds-its-fitting",
        "locks": ["dusty-rose hair in a crown braid halo", "haunted ruby eyes",
                  "ash-grey skin dusted in violet", "ivory-bone",
                  "drop earring", "white cotton thread", "apron"],
        "shields": ["warm skin", "rosy skin", "porcelain skin", "golden skin",
                    "green skin", "grey-green skin", "matching earrings",
                    "bare hairline", "cheerful expression", "threadless hands"],
        "clause": "the counterfeit",        # order delivery
    },
    "P02": {
        "name": "Rin (The Tentacle Nest)",
        "anchor": "the-nest-was-already-warm",
        "locks": ["tight-curled cloud", "jade eyes half-closed",
                  "bell-charms", "arm-ribbon", "off-shoulder exit",
                  "The linen top", "bare shoulders"],
        "shields": ["bare ears", "bell-less ears", "buttoned shirt",
                    "covered chest", "wide-awake expression", "pale skin",
                    "long hair", "straight hair", "black hair", "blue eyes",
                    "brown eyes"],
        "clause": "the nest",               # order delivery
    },
    "P03": {
        "name": "Nix (The Slime Pit)",
        "anchor": "the-gel-registers-her-mass",
        "locks": ["platinum french bob", "white eyelashes", "ice-blue",
                  "bronze", "key pendant", "pink scar"],
        "shields": ["olive skin", "large breasts", "soft rounded features",
                    "long hair", "black eyelashes", "dark eyelashes",
                    "brown eyelashes", "thick eyelashes", "keyless throat",
                    "unmarked neck"],
        "clause": "the pit",
    },
}

blocks = re.split(r"\n(?=P\d\d — )", t)
found = []
for b in blocks:
    m = re.match(r"(P\d\d) — ", b)
    if m and m.group(1) in SPEC:
        found.append(m.group(1))
if len(found) != 3:
    err(f"OC blocks found {len(found)} != 3 (found: {sorted(found)})")

ANTI_LOLI = ["child", "childish", "chibi", "young girl", "immature body",
             "oversized head"]
BAN = re.compile(r"\bcandle(s)?\b|\blamp\b|lantern|torch|chandelier|brazier|"
                 r"vertebra|spinal column", re.I)
HEDGES = ["shape-only", "at its limit", "at their limit", "no further",
          "never the sentence's subject", "never the point itself",
          "implied by", "hints of", "suggestion of", "tasteful"]
STATE = ["topless", "bare chest", "bare breasts", "see-through", "sheer",
         "wet", "transparent", "translucent", "presenting", "spread legs",
         "squatting", "straddling", "open clothes", "half-undressed",
         "large breasts", "glistening", "cameltoe", "bare shoulders",
         "her bare", "nipples", "bared", "soaked", "plastered",
         "clinging", "clings"]
RP = {"pokies", "cameltoe", "wedgie", "wet clothes", "wet", "wet hair",
      "ass", "presenting", "spread legs", "squatting", "straddling",
      "arched back", "open clothes", "half-undressed", "sweat", "glistening",
      "large breasts", "curvy", "leotard", "arms up", "soap",
      "breast focus", "see-through", "cleavage", "sideboob", "underboob",
      "shirt lift", "skirt lift", "fluttering clothes", "from behind",
      "from below", "from above", "from side", "hip focus", "thigh focus",
      "bare back", "navel", "collarbone", "bare shoulders"}

for pid, spec in SPEC.items():
    b = next((x for x in blocks if x.startswith(pid + " — ")), None)
    if not b:
        err(f"{pid}: block missing"); continue
    pm = re.search(r"(?m)^POS:\s*\n\s*\n(.*?)(?=^NEG:|\Z)", b, re.S)
    nm = re.search(r"(?m)^NEG:\s*\n\s*\n(.*?)(?=^P\d\d|^═|^SELF-CHECK|^── |\Z)", b, re.S)
    pos = pm.group(1).strip() if pm else ""
    neg = nm.group(1).strip() if nm else ""
    if not pos: err(f"{pid}: POS missing"); continue
    if not neg: err(f"{pid}: NEG missing"); continue
    if spec["anchor"] not in b:
        err(f"{pid}: anchor not in block")
    for lk in spec["locks"]:
        if lk.lower() not in pos.lower():
            err(f"{pid}: canon lock missing in POS: '{lk}'")
    for sh in spec["shields"]:
        if sh.lower() not in neg.lower():
            err(f"{pid}: anti-shield term missing in NEG: '{sh}'")
    if spec["clause"] not in pos.lower():
        err(f"{pid}: order clause word '{spec['clause']}' missing in POS")
    # §52/§53A (tagrun)
    tm = re.search(r"1girl, solo, ([^,]+(?:, [^,]+){0,8}), ", pos)
    tagrun = tm.group(1).lower() if tm else ""
    if not tm:
        err(f"{pid}: no tagrun")
    else:
        hits = sum(1 for tg in RP if tg in tagrun)
        if hits < 3:
            err(f"{pid}: §52 tag floor {hits} < 3 (tagrun: {tagrun[:80]})")
        if not any(a in tagrun for a in ("mature female", "adult woman",
                                         "young woman")):
            err(f"{pid}: §53A bank anchor missing")
    if "grown woman's face" not in pos:
        err(f"{pid}: face formula missing")
    # §49 NEG economy
    terms = [x.strip() for x in neg.split(",") if x.strip()]
    if not (38 <= len(terms) <= 52):
        err(f"{pid}: NEG terms {len(terms)} outside 38-52")
    if re.search(r"\bno [a-z]", neg, re.I):
        err(f"{pid}: 'no X' phrasing in NEG")
    for need in ("child", "chibi", "washed-out", "male", "exposed genitals",
                 "tarot card", "signature", "watermark"):
        if need not in neg:
            err(f"{pid}: NEG missing '{need}'")
    lol = sum(1 for x in ANTI_LOLI if x in neg)
    if lol < 3:
        err(f"{pid}: anti-loli floor {lol} < 3")
    if "nipples visible through" in neg:
        err(f"{pid}: §4B 'nipples visible through' in R+ NEG")
    for bare in ("nipple visible", "bare nipple", "bare breasts"):
        if bare not in neg:
            err(f"{pid}: R+ NEG missing '{bare}'")
    # §40 bans + §16 closer + hedges + §60
    for w in BAN.finditer(pos):
        err(f"{pid}: §40 banned word in POS: '{w.group(0)}'")
    if "Richly pigmented" not in pos or "saturated film color" not in pos:
        err(f"{pid}: §16 closer missing")
    for h in HEDGES:
        if h in pos.lower():
            err(f"{pid}: hedge '{h}' in R+ POS")
    no_tags = re.sub(r"1girl, solo, [^.\n]+\.?", " ", pos).lower()
    states = {s for s in STATE if s in no_tags}
    if len(states) < 3:
        err(f"{pid}: §60 prose state nouns {len(states)} < 3")
    wl = len(pos.split())
    if wl > 400:
        err(f"{pid}: §60 POS length {wl} > 400")
    # own tag must not be whole NEG term
    if tm:
        for tg in [x.strip() for x in tagrun.split(",")]:
            if tg and len(tg) > 3 and tg in [x.strip().lower() for x in neg.split(",")]:
                err(f"{pid}: own tag '{tg}' appears as WHOLE NEG term")

if errors:
    print(f"OC LINT (N29 merged): {len(errors)} ERRORS")
    for e in errors:
        print("  ✗", e)
    sys.exit(1)
print("OC LINT (N29 merged): P01 Rue / P02 Rin / P03 Nix — canon locks held, "
      "shields noun-form, §49/§52/§53A/§60 green — PASS")
