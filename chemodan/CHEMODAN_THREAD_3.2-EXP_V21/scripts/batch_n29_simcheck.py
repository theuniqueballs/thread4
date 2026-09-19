#!/usr/bin/env python3
# batch_n29_simcheck.py — §17A cross-batch text-similarity: N29 POS vs
# N26+N27+N28 POS (the window), sequence-matcher, flag pairs > 0.28.
import io, re, sys
from difflib import SequenceMatcher

DL = "/home/z/my-project/download/"
NEW = "BATCH_N29_NO_ONE_WROTE_THIS_SCENE.md"
WIN = ["BATCH_N26_SILENCE_IS_THE_SLOWEST_UNDRESSING.md",
       "BATCH_N27_SOMEWHERE_BETWEEN_HERE_AND_MAGIC.md",
       "BATCH_N28_NOBODY_KNOWS.md"]

def pos_texts(path):
    t = io.open(DL + path, encoding="utf-8").read()
    out = {}
    for m in re.finditer(r"(?m)^P(\d\d) — .*?(?=^NEG:)", t, re.S):
        pm = re.search(r"(?m)^POS:\s*\n\s*\n(.*?)\Z", m.group(0), re.S)
        if pm:
            out["P" + m.group(1)] = pm.group(1).strip()
    return out

new = pos_texts(NEW)
worst = []
for wf in WIN:
    old = pos_texts(wf)
    for nid, ntext in new.items():
        for oid, otext in old.items():
            r = SequenceMatcher(None, ntext, otext).ratio()
            if r > 0.28:
                worst.append((round(r, 3), nid, oid, wf[:8]))
worst.sort(reverse=True)
if worst:
    print(f"SIMCHECK §17A: {len(worst)} pairs > 0.28 — FAIL")
    for r, n, o, w in worst[:10]:
        print(f"  {r} N29-P{n} vs {w}-P{o}")
    sys.exit(1)
print(f"SIMCHECK §17A: zero pairs above 0.28 vs N26+N27+N28 (window) — PASS")
