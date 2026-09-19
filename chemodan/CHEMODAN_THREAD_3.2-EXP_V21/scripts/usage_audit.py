#!/usr/bin/env python3
"""
Task 22-4 (2026-09-09) — POOL UTILIZATION LEDGER.

Counts distinct codes actually used across the current era's deliverables
(N17-N20 mains + OC orders N16/SET2/SET3/SET4/SET5 + SP orders) versus each
pool's inventory in system/. Feeds SYSTEM_AUDIT.md.

Usage: python usage_audit.py
"""
import re
from pathlib import Path

DL = Path("/home/z/my-project/download")
SYS = Path("/home/z/my-project/system")

# The current era: everything written after the V9 ladder landed, plus the
# OC/SP files that share the live pools.
DELIVERABLES = [
    "BATCH_N17_YOU_WERE_BEAUTIFUL_IN_THE_WRONG_WORLD.md",
    "BATCH_N18_TOO_MUCH_FEELING_NOT_ENOUGH_TIME.md",
    "BATCH_N19_THE_ABYSS_HAS_A_MEMORY.md",
    "BATCH_N20_MONO_NO_AWARE.md",
    "OC_ORDERS_N16.md",
    "OC_ORDERS_N16_SET2.md",
    "OC_ORDERS_N18.md",
    "OC_ORDERS_N19.md",
    "OC_ORDERS_N20.md",
    "SP_ORDERS.md",
]

BODIES = ""
for name in DELIVERABLES:
    p = DL / name
    if p.exists():
        BODIES += p.read_text(encoding="utf-8") + "\n"

ont = (SYS / "ONTOLOGY.yaml").read_text(encoding="utf-8")
pools = (SYS / "POOLS_V8.yaml").read_text(encoding="utf-8")
palette = (SYS / "PALETTE_LIBRARY.yaml").read_text(encoding="utf-8")
pose = (SYS / "POSE_LIBRARY.yaml").read_text(encoding="utf-8")


def ids(text, pat):
    return set(re.findall(pat, text))


def used(pat, source=None):
    return set(re.findall(pat, source if source else BODIES))


FAMILIES = [
    # (family, pool_size, used_set, note)
    ("P  palettes", len(ids(palette, r"\bid: (P\d+)")), used(r"\b(P\d{2})_[A-Z]"), "SIG lines; window-managed"),
    ("PL poses", len(ids(pose, r"\bid: (PL\d+)")), used(r"\bPL\d{2}\b"), "§33 pose-camera pairs"),
    ("K  kinetic", len(ids(ont, r"\bid: (K\d+)")) + len(ids(pools, r"\bid: (K\d+)")),
     {k for k in used(r"\b(K\d{2,3})\b") if int(k[1:]) <= 104}, "incl. freeform K1xx OC/SP"),
    ("FET fetish", len(ids(ont, r"\bid: (FET\d+)")), used(r"\bFET\d{2}\b"), "FET26-45 hole: 20 dead slots"),
    ("BRE breast-tech", len(ids(ont, r"\bid: (BRE\d+)")) + len(ids(pools, r"\bid: (BRE\d+)")),
     used(r"\bBRE\d{2}\b"), "L2+ mandatory §37"),
    ("BK back-tech", len(ids(ont, r"\bid: (BK\d+)")) + len(ids(pools, r"\bid: (BK\d+)")),
     used(r"\bBK\d{1,2}\b"), ""),
    ("B  butt-tech", len(ids(ont, r"\bid: (B\d+)")) + len(ids(pools, r"\bid: (B\d+)")),
     used(r"\bB\d{2}\b"), "B16+ era codes"),
    ("GAR wardrobe", len(ids(ont, r"\bid: (GAR\d+)")) + len(ids(pools, r"\bid: (GAR\d+)")),
     used(r"\bGAR\d{2}\b"), "CUSTOM_GAR counted separately"),
    ("ENV environment", len(ids(ont, r"\bid: (ENV\d+)")), used(r"\b(ENV\d{2})\b"), "ENV_word freeforms counted"),
    ("LQ light quality", len(ids(ont, r"\bid: (LQ\d+)")), used(r"\bLQ\d{2}\b"), ""),
    ("E  emotion", len(ids(ont, r"\bid: (E\d+)")) + len(ids(pools, r"\bid: (E\d+)")),
     used(r"\bE\d{2,3}\b"), "E5x/E6x extension era"),
    ("OAS skin", len(ids(ont, r"\bid: (OAS\d+)")), used(r"\bOAS\d{2}\b"), "mostly prose-translated"),
    ("CAM camera", len(ids(ont, r"\bid: (CAM\d+)")), used(r"\bCAM\d{2}\b"), "prose-translated — see framing words"),
    ("BPT body-prose", 8, used(r"\bBPT-\d\b"), "cap 3 per batch"),
    ("HS hairstyle", len(ids(pools, r"\bid: (HS\d+)")), used(r"\bHS\d{2}\b"), "26 styles + length axis"),
    ("R  race", len(ids(pools, r"\bid: (R\d+)")), used(r"\bR\d{2}-"), "R03-kitsune form"),
    ("NR features", len(ids(pools, r"\b(NR[A-Z]\d+)")), used(r"\bNR[A-Z]\d{2}\b"), "NRM/NRC/NRE/NRG/NRH"),
    ("MAT material", len(ids(ont, r"\bid: (MAT\d+)")), used(r"\bMAT\d{2}\b"), "N16-only so far"),
    ("ENG engagement", 8, used(r"\bENG\d{2}\b"), "DORMANT — N13 only"),
]

print(f"{'family':<18} {'pool':>5} {'used':>5} {'util':>6}  never-used sample")
rows = []
for fam, size, use, note in FAMILIES:
    use_clean = {u for u in use if not u.startswith("K1") or fam != "K  kinetic"} if False else use
    util = len(use) / size if size else 0
    never = ""
    if fam.startswith("P "):
        all_ids = sorted(ids(palette, r"\bid: (P\d+)"))
        never = ", ".join(sorted(set(all_ids) - use, key=lambda x: int(x[1:]))[:14])
    elif fam.startswith("FET"):
        all_ids = sorted(ids(ont, r"\bid: (FET\d+)"), key=lambda x: int(x[3:]))
        never = ", ".join(sorted(set(all_ids) - use, key=lambda x: int(x[3:]))[:20])
    print(f"{fam:<18} {size:>5} {len(use):>5} {util:>5.0%}  {never[:80]}")
    rows.append((fam, size, len(use), util))

# FET detail: which scenario hooks (11-25) were used when?
print("\nFET scenario-hook usage by file (the revival case):")
for name in DELIVERABLES:
    p = DL / name
    if not p.exists():
        continue
    t = p.read_text(encoding="utf-8")
    hits = sorted(set(re.findall(r"\b(FET(?:1[1-9]|2[0-5]))\b", t)), key=lambda x: int(x[3:]))
    if hits:
        print(f"  {name[:44]:<46} {", ".join(hits)}")

# wardrobe_state axis usage
ws = ["pristine", "disheveled", "compromised", "dissolving", "half-doffed", "mid-maintenance",
      "soaked", "ridden", "sagging", "open", "wedged"]
print("\nWardrobe-state vocabulary in POS prose (failure states = R+ fuel):")
for w in ws:
    n = len(re.findall(rf"\b{w}", BODIES, re.I))
    print(f"  {w:<14} {n}")

# hedge census across the era (the §50 case in numbers)
HEDGES = [r"shape-only", r"at (?:its|their|the [\w'’]*)\s*(?:honest\s*)?limit", r"and no further",
          r"never the (?:sentence's |outline's |nipple's )?(?:subject|point(?: itself)?)",
          r"implied by", r"hints? of", r"suggestion of", r"reading at", r"tasteful",
          r"state, never", r"exposure is (?:the |a )?(?:state|season's)"]
print("\nHedge census across N17-N20 + OC + SP:")
tot = 0
for pat in HEDGES:
    n = len(re.findall(pat, BODIES, re.I))
    tot += n
    print(f"  {pat[:50]:<52} {n}")
print(f"  {'TOTAL':<52} {tot}")
