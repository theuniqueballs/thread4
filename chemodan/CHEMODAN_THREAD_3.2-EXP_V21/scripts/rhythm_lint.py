#!/usr/bin/env python3
"""
RHYTHM LINT v1 (2026-09-14, Path B MVP — the architecture review's brief:
«детекция формульности, а не только конкретных слов — одинаковый ритм
предложений, одинаковая структура закрытия»).

What it measures (structure, not words):
  1. CLOSER CADENCE — the word-length profile of each POS's final
     sentences. A file where most prompts end in the same cadence
     (e.g. the staccato triplet "X does A. Y does B. Z keeps her.")
     is formulaic even when every word is fresh. §17B cannot see this;
     this does.
  2. POS SOFT CAP (§56C adjacent) — prompts over --cap words (default
     400, the review's density warning) are listed. WARN only: the
     tag-run carries the payload, prose length mostly spends solver
     attention; the cap becomes law only when render data shows signal
     dilution.

Verdict policy: v1 is a DIAGNOSTIC (exit 0 with a report) — thresholds
calibrate on 2-3 batches of evidence first, the Path B way: instrument,
then legislate. --strict turns the closer flag into exit 1.
"""
import argparse
import re
import sys
from collections import Counter
from pathlib import Path

PROMPT_RE = re.compile(r"^(?:P\d+|OC\d+)\s+—\s", re.M)


def pos_of_block(block):
    m = re.search(r"(?m)^POS:\s*\n\s*\n(.*?)(?=\n\s*\nNEG:)", block, re.S)
    return m.group(1).strip() if m else ""


def sentences(text):
    parts = re.split(r"(?<=[.!?])\s+", text)
    return [p for p in parts if p.strip()]


def wc(s):
    return len(s.split())


def closer_class(sent_lens):
    tail3 = sent_lens[-3:] if len(sent_lens) >= 3 else sent_lens
    tail2 = sent_lens[-2:]
    if len(tail3) == 3 and all(n <= 12 for n in tail3):
        return "staccato-triplet"
    if len(tail2) == 2 and all(n <= 9 for n in tail2):
        return "staccato-pair"
    if sent_lens and sent_lens[-1] >= 25:
        return "long-fused"
    return "mixed"


def audit(path, cap):
    text = Path(path).read_text(encoding="utf-8")
    heads = [(m.start(), m.group(0).strip()) for m in PROMPT_RE.finditer(text)]
    rows = []
    for i, (pos, label) in enumerate(heads):
        end = heads[i + 1][0] if i + 1 < len(heads) else len(text)
        body = text[pos:end]
        p = pos_of_block(body)
        if not p:
            continue
        sents = sentences(p)
        lens = [wc(s) for s in sents]
        rows.append({
            "id": label.split("—")[0].strip(),
            "words": wc(p),
            "n_sent": len(sents),
            "closer": closer_class(lens),
        })
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--closer-thresh", type=float, default=0.6)
    ap.add_argument("--cap", type=int, default=400)
    ap.add_argument("--strict", action="store_true",
                    help="closer-cadence flag becomes exit 1 (after calibration)")
    args = ap.parse_args()

    any_flag = False
    for path in args.files:
        rows = audit(path, args.cap)
        if not rows:
            print(f"RHYTHM LINT — {Path(path).name}: no prompts parsed")
            continue
        n = len(rows)
        counts = Counter(r["closer"] for r in rows)
        over_cap = [r for r in rows if r["words"] > args.cap]

        print("═" * 78)
        print(f"RHYTHM LINT v1 — {Path(path).name}")
        print(f"prompts: {n} | closer flag >{args.closer_thresh:.0%} | "
              f"soft cap {args.cap}w (WARN)")
        print("═" * 78)
        for cls, c in counts.most_common():
            share = c / n
            mark = "  ⚑ FORMULA" if share > args.closer_thresh else ""
            print(f"  closer: {cls:<18} {c:>3}/{n}  {share:>5.0%}{mark}")
        mean_w = sum(r["words"] for r in rows) / n
        mean_s = sum(r["n_sent"] for r in rows) / n
        print(f"  length: mean {mean_w:.0f}w / {mean_s:.1f} sentences")
        if over_cap:
            print(f"  ⚠ POS over soft cap ({len(over_cap)}): " +
                  ", ".join(f"{r['id']} {r['words']}w" for r in over_cap))
        worst = max(counts.items(), key=lambda kv: kv[1])
        flagged = worst[1] / n > args.closer_thresh
        if flagged:
            ids = [r["id"] for r in rows if r["closer"] == worst[0]]
            print(f"  ⚑ closer-cadence formula: {worst[0]} shared by "
                  f"{worst[1]}/{n} — {', '.join(ids[:12])}"
                  f"{' …' if len(ids) > 12 else ''}")
            print("    fix: rotate the cadence — one long fused closer, one "
                  "dialogue-close, one fragment-pair per act")
            if args.strict:
                any_flag = True
        print(f"  RESULT: {'FLAG' if flagged else 'OK'} (diagnostic mode"
              f"{'; --strict not set — exit stays 0' if flagged and not args.strict else ''})")

    sys.exit(1 if any_flag else 0)


if __name__ == "__main__":
    main()
