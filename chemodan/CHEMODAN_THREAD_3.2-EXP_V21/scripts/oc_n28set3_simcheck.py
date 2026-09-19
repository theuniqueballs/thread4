#!/usr/bin/env python3
# oc_n26_simcheck.py — §17A OC-side similarity: the N26 OC trio vs the
# N26 mains + SET2 OC trio + the N27 mains + window + OC history mains (95+ refs).
import io, re, sys
from difflib import SequenceMatcher

DL = "/home/z/my-project/download/"
NEW = "OC_ORDERS_N28_SET3.md"
WIN = ["BATCH_N23_SIN_LOOKS_GOOD_ON_YOU.md",
       "BATCH_N24_BLUE_IS_THE_LONELIEST_COLOR.md",
       "BATCH_N25_THE_RAIN_FELL_UPWARD.md",
       "OC_ORDERS_N23.md", "OC_ORDERS_N24.md", "OC_ORDERS_N25.md",
       "BATCH_N26_SILENCE_IS_THE_SLOWEST_UNDRESSING.md"]

def pos_texts(path, pat):
    t = io.open(DL + path, encoding="utf-8").read()
    out = {}
    for m in re.finditer(r"(?m)^(" + pat + r").*?(?=^NEG:)", t, re.S):
        pm = re.search(r"(?m)^POS:\s*\n\s*\n(.*?)\Z", m.group(0), re.S)
        if pm:
            out[m.group(1)[:3]] = pm.group(1).strip()
    return out

new = pos_texts(NEW, r"^OC\d — ")
worst = []
for wf in WIN:
    old = pos_texts(wf, r"^(?:OC\d|P\d\d) — ")
    for nid, ntext in new.items():
        for oid, otext in old.items():
            r = SequenceMatcher(None, ntext, otext).ratio()
            if r > 0.28:
                worst.append((round(r, 3), nid, oid, wf[:12]))
worst.sort(reverse=True)
if worst:
    print(f"OC SIMCHECK §17A: {len(worst)} pairs > 0.28 — FAIL")
    for r, n, o, w in worst[:10]:
        print(f"  {r} N26-{n} vs {w}-{o}")
    sys.exit(1)
print("OC SIMCHECK §17A: zero pairs above 0.28 vs the full reference set — PASS")
