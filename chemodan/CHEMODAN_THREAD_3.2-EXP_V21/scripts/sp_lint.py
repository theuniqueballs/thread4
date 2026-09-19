#!/usr/bin/env python3
"""SP lint — mechanical self-check for special orders in SP_ORDERS.md.

Checks per SP prompt block:
  §16   delivery: POS:/NEG: on own lines, non-empty
  §40   no candle/lamp words in POS (candle, candelabra, lamp, lantern, torch, chandelier, brazier)
  §10   no male-coded words in POS (male, man, 1boy, boy, men)
  §43   spine-only: no vertebra language in POS
  C072  POS side: no nipple/areola/slip language in POS
  §4    POS side: no genital language in POS
  TAG   if block declares character-tag mode, POS must end with `character: <...>` tag
  LOCK  if block claims R+/X rating, NEG must hold the C072 nipple block + §4 genital lock
  PROT  if block declares character-tag mode, NEG must NOT contain the lifted
        protection entries (established character, copyrighted character, named character)
  §49   (blocks declaring "NEG per §49"): NEG term count in [25, 40]; no "no X"/
        "missing X" phrasings in NEG terms (they feed the banned token)
  CONTR light §4/§49-r5 contradiction check (all blocks): any short NEG term
        (≤3 words) appearing verbatim in POS → advisory (NEG bans what POS asks)
Exit code 0 = PASS.
"""
import re
import sys

SP_FILE = "/home/z/my-project/download/SP_ORDERS.md"

POS_BAN = [
    (r"\b(candle[s]?|candelabra|lamp|lantern|torch|chandelier|brazier)\b", "S40 candle/lamp word in POS"),
    (r"\b(male|man|men|1boy|boys?)\b", "S10 male-coded word in POS"),
    (r"\b(vertebra[e]?|vertebral)\b", "S43 vertebra language in POS"),
    (r"\b(nipples?|areola[rye]*|nipple-?slip|slipped out)\b", "C072 nipple language in POS"),
    (r"\b(vulva|penis|genitals?|pussy)\b", "S4 genital language in POS"),
]
NEG_MUST_RPLUS = [
    ("nipple visible", "C072 NEG nipple block"),
    ("exposed genitals", "S4 NEG genital lock"),
]
NEG_LIFTED = ["established character", "copyrighted character", "named character"]


def parse_blocks(text):
    """Split into SP blocks: each starts at a line 'SP-NN — ...', POS/NEG captured."""
    blocks = []
    starts = [m.start() for m in re.finditer(r"^SP-\d+ — ", text, re.M)]
    for i, s in enumerate(starts):
        chunk = text[s:starts[i + 1] if i + 1 < len(starts) else len(text)]
        pos_m = re.search(r"^POS:\s*\n\s*\n(.*?)\n\s*\n", chunk, re.S | re.M)
        neg_m = re.search(r"^NEG:\s*\n\s*\n(.*?)\n(?:\s*\n|\Z)", chunk, re.S | re.M)
        blocks.append({
            "header": chunk.splitlines()[0],
            "meta": chunk,
            "pos": pos_m.group(1).strip() if pos_m else "",
            "neg": neg_m.group(1).strip() if neg_m else "",
        })
    return blocks


def main():
    text = open(SP_FILE, encoding="utf-8").read()
    blocks = parse_blocks(text)
    if not blocks:
        print("FATAL: no SP blocks found")
        return 1
    errors, advisories = [], []
    for b in blocks:
        tag_mode = "character-tag mode" in b["meta"]
        card_mode = bool(re.search(r"card\s+mode", b["meta"]))
        lean_neg = "NEG per §49" in b["meta"]
        tag_ok = re.search(r"character: .+?[\.\)]?\.?\s*$", b["pos"] or "")
        rating_rplus = bool(re.search(r"Yodayo:\s*R\+|Yodayo:\s*X", b["meta"]))
        if not b["pos"]:
            errors.append(f"{b['header']}: S16 POS missing/empty")
        if not b["neg"]:
            errors.append(f"{b['header']}: S16 NEG missing/empty")
        for pat, label in POS_BAN:
            if b["pos"] and re.search(pat, b["pos"], re.I):
                errors.append(f"{b['header']}: {label}")
        if tag_mode:
            if not tag_ok:
                errors.append(f"{b['header']}: TAG mode declared but POS does not end with character: tag")
            for entry in NEG_LIFTED:
                if entry in b["neg"]:
                    errors.append(f"{b['header']}: PROT protection not lifted in NEG ('{entry}')")
        else:
            if not card_mode:
                # non-tag, non-card SP orders must keep full house NEG protection
                missing = [e for e in NEG_LIFTED if e not in b["neg"]]
                if missing:
                    advisories.append(f"{b['header']}: house protection entries absent from NEG ({', '.join(missing)}) — intentional for SP?")
        if rating_rplus:
            for needle, label in NEG_MUST_RPLUS:
                if needle not in b["neg"]:
                    errors.append(f"{b['header']}: {label} missing in NEG")
        # §49 economy — only for blocks built under the doctrine
        if lean_neg and b["neg"]:
            terms = [t.strip() for t in b["neg"].split(",") if t.strip()]
            if not (25 <= len(terms) <= 40):
                errors.append(f"{b['header']}: S49 NEG economy violated — {len(terms)} terms (target 25-40)")
            for t in terms:
                if re.match(r"^(no|missing|without)\s+", t, re.I):
                    errors.append(f"{b['header']}: S49 'no X' phrasing in NEG ('{t}') — write the noun itself")
        # light §4 / §49 rule-5 contradiction check: short NEG terms verbatim in POS
        if b["pos"] and b["neg"]:
            pos_l = b["pos"].lower()
            for t in [x.strip() for x in b["neg"].split(",") if x.strip()]:
                if len(t.split()) <= 3 and re.search(r"\b" + re.escape(t.lower()) + r"\b", pos_l):
                    advisories.append(f"{b['header']}: NEG term '{t}' also appears in POS — check for contradiction (§4/§49r5)")
        # lint receipts
        print(f"[checked] {b['header']}")
    print()
    for a in advisories:
        print(f"ADVISORY: {a}")
    for e in errors:
        print(f"ERROR: {e}")
    print(f"\nSP LINT: {'PASS (0 errors, %d advisory)' % len(advisories) if not errors else 'FAIL (%d errors)' % len(errors)}")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
