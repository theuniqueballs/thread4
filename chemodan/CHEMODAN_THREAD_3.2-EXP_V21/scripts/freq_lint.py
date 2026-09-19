#!/usr/bin/env python3
"""
FREQ LINT §17B — in-batch word-tic detector (v2).

THE GAP IT CLOSES (author diagnosis 2026-09-13, N24 review):
SIMCHECK (§17A) compares whole sentences BETWEEN batches, so it is blind to
the "author's favorite word" class — a phrase quietly riding >50% of one
batch's prompts never trips it. FREQ LINT counts phrase frequency WITHIN
one file and, with --baseline, isolates NEW tics (present now, absent in the
reference batch).

FOUND ORIGIN (this session): the worst N24 tic, «camel-honest», is a
RATING_MAP §4A lexicon EXEMPLAR copied verbatim — the §17A pose-clause bug
recurring in the carrier lexicon, which had no anti-copy law of its own.
§17B closes that (see RULES).

Counting units:
- phrases: 2-3 word n-grams + hyphenated compounds (the tic class)
- plain unigrams: watched at a higher threshold (genre substrate lives here)

Hard flag:   phrase spread > 35% of prompts   |   unigram spread > 65%
Law-mandated boilerplate (§53A anchors, §53 face formula, §16 color closer,
§52/§4A tag bank, genre opener, quality tail) is scrubbed BEFORE counting
and reported in its own transparency section — excluded, never hidden.
Theme words (--theme) are shown as INFO — a theme may saturate its own
batch; a tic may not.  --baseline marks phrases that are NEW vs the
reference file.

Exit code 1 on any hard flag. Whitelist additions go in LAW_WHITELIST.
"""
import argparse
import re
import sys
from collections import Counter
from pathlib import Path

# ── law-mandated boilerplate: scrubbed before counting, shown in own section ──
LAW_WHITELIST = [
    # §53A maturity bank (per-body-type adult anchors)
    "mature female", "adult woman", "young woman",
    # §53 face formula + maturity prose anchors
    "grown woman's face", "woman's face", "grown woman", "woman",
    "large expressive eyes", "small nose", "small mouth",
    "flat cel-shaded", "cel-shaded", "stylized 2d anime style", "rendered",
    # format-mandated anatomy substrate (every POS must render these)
    "hair", "eyes", "eye", "skin", "face",
    # house genre opener (every POS starts with it) + framing boilerplate
    "2d hand-drawn anime illustration", "hand-drawn anime illustration",
    "anime illustration", "portrait framing", "framing viewed",
    "viewed frontally", "frontally at eye level", "at eye level",
    "eye level", "full-body framing", "upper-body portrait",
    "full-body", "upper-body", "viewed", "framing",
    # §51 SATURATION DOCTRINE's named device (since N23): every composition
    # mandates exactly ONE — the phrase is the law's own name, not a tic
    "warm witness", "one warm witness",
    # §16 COLOR CLOSER MANDATE vocabulary (closer rides every POS)
    "richly pigmented", "depth tones", "saturated film color",
    "saturated film", "film color", "saturated", "highlights", "pigmented",
    # quality tail (house standard)
    "masterpiece", "best quality", "anime artstyle",
    # tag-run head (§52/§53 channel)
    "1girl", "solo",
    # §4A TAG-DELIVERY BANK — tags are law-channels, matched to the stack
    "cameltoe", "pokies", "wedgie", "see-through", "cleavage", "sideboob",
    "underboob", "shirt lift", "skirt lift", "skirt flip",
    "fluttering clothes", "fluttering skirt", "from behind", "from below",
    "from above", "from side", "hip focus", "thigh focus", "bare back",
    "navel", "collar", "wet clothes", "wet hair", "ass focus", "ass grab",
    "grabbing own ass", "presenting", "spread legs", "squatting",
    "straddling", "arched back", "open clothes", "half-undressed", "sweat",
    "glistening", "large breasts", "curvy", "tentacles", "leotard",
    "arms up", "bare shoulders", "breast focus", "topless", "bare chest",
    # race-delivery parser language (§54 tag channel)
    "fox ears", "wolf ears", "bat ears", "elf ears", "ball joints",
]

STOPWORDS = set("""
the a an and or but if then than so as at by for from in into of on onto to
with without within is are was were be been being am has have had do does
did not no nor too very can will just she he they them their his her hers
its it this that these those there here where when while which who whom
whose what how all any both each few more most other some such only own
same s t don now over under again further once about against between
through during before after above below up down out off because until
still never always even also yet per upon one two three four five six
seven eight nine ten twelve
""".split())

PROMPT_RE = re.compile(r"^(?:P\d+|OC\d+)\s+—\s", re.M)
SPINE_SKIP = re.compile(
    r"^(SIG|Genre|Verb|CLO|OPN|BPT|D19|K:|Interaction|GEAR|Stack|Hair/Eyes"
    r"|Race:|Breast|VIS|THESIS|Wardrobe state|Act\s|POSITION|Rating|Latent"
    r"|Ref|Palette|Cam|H-codes|FET|BRE|BK\d|B\d|PL\d|GAR|LQ|ENV|OAS|MAT|ENG"
    r"|E\d|H\d|P\d\d_|D19)")


def parse_prompts(text, scope):
    heads = [(m.start(), m.group(0).strip()) for m in PROMPT_RE.finditer(text)]
    prompts = []
    for i, (pos, _) in enumerate(heads):
        end = heads[i + 1][0] if i + 1 < len(heads) else len(text)
        body = text[pos:end]
        label = body.split("—")[0].strip()
        if scope == "all":
            prompts.append((label, body))
            continue
        m = re.search(r"^POS:\s*$", body, re.M)
        if not m:
            continue
        chunk = body[m.end():]
        m2 = re.search(r"^NEG:\s*$", chunk, re.M)
        if m2:
            chunk = chunk[:m2.start()]
        keep = [ln for ln in chunk.splitlines() if not SPINE_SKIP.match(ln.strip())]
        prompts.append((label, "\n".join(keep)))
    return prompts


def scrub(text):
    found = Counter()
    low = text.lower()
    for phrase in sorted(LAW_WHITELIST, key=len, reverse=True):
        n = low.count(phrase)
        if n:
            found[phrase] += n
            low = low.replace(phrase, " ¶ ")
    return low, found


def tokens_of(text):
    toks = re.findall(r"[a-z][a-z'-]*[a-z]|[a-z]", text)
    return [t[:-2] if t.endswith("'s") else t for t in toks if t != "¶"]


def edge_clean(g):
    if any("¶" in t for t in g):
        return False
    if g[0] in STOPWORDS or g[-1] in STOPWORDS:
        return False
    return all(len(t) >= 2 for t in g)


def count_file(path, scope):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    prompts = parse_prompts(text, scope)
    stats = {}  # phrase -> [total, set_of_prompts, is_phrase(n>=2 or hyphen)]
    law = Counter()
    for label, chunk in prompts:
        scrubbed, found = scrub(chunk)
        law.update(found)
        toks = tokens_of(scrubbed)
        local = set()
        for n in (1, 2, 3):
            for i in range(len(toks) - n + 1):
                g = tuple(toks[i:i + n])
                if not edge_clean(g):
                    continue
                ph = " ".join(g)
                if n == 1 and (len(ph) < 4 or ph in STOPWORDS):
                    continue
                is_phrase = (n >= 2) or ("-" in ph)
                e = stats.setdefault(ph, [0, set(), is_phrase])
                e[0] += 1
                local.add(ph)
        for ph in local:
            stats[ph][1].add(label)
    return prompts, stats, law


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--baseline", help="reference file (previous batch): marks NEW tics")
    ap.add_argument("--phrase-thresh", type=float, default=0.35)
    ap.add_argument("--unigram-thresh", type=float, default=0.65)
    ap.add_argument("--top", type=int, default=25)
    ap.add_argument("--scope", choices=["pos", "all"], default="pos")
    ap.add_argument("--theme", default="")
    ap.add_argument("--fail-on-new-only", action="store_true",
                    help="exit 1 only on NEW TICs (spread >= threshold now, "
                         "<10% in baseline) — substrate/house-register words "
                         "report but do not gate; requires --baseline")
    args = ap.parse_args()

    theme = {w.strip().lower() for w in args.theme.split(",") if w.strip()}

    base_stats = None
    base_n = 0
    if args.baseline:
        _, base_stats, _ = count_file(args.baseline, args.scope)
        base_n = len(parse_prompts(Path(args.baseline).read_text(encoding="utf-8"), args.scope))

    any_flag = False
    for path in args.files:
        prompts, stats, law = count_file(path, args.scope)
        if not prompts:
            print(f"FREQ LINT §17B — {path}: no prompts parsed")
            any_flag = True
            continue
        n = len(prompts)

        def spread(ph):
            return len(stats[ph][1]) / n

        def base_spread(ph):
            if not base_stats:
                return 0.0
            e = base_stats.get(ph)
            return len(e[1]) / base_n if e else 0.0

        def class_of(ph):
            is_phrase = stats[ph][2]
            thr = args.phrase_thresh if is_phrase else args.unigram_thresh
            return is_phrase, thr

        rows = []
        for ph in stats:
            sp = spread(ph)
            is_phrase, thr = class_of(ph)
            if sp <= thr:
                continue
            rows.append((sp, ph, is_phrase))
        rows.sort(key=lambda r: (-r[0], -stats[r[1]][0]))

        print("═" * 80)
        print(f"FREQ LINT §17B — {Path(path).name}")
        print(f"prompts: {n} | scope: {args.scope.upper()} | "
              f"phrase flag >{args.phrase_thresh:.0%} | unigram flag >{args.unigram_thresh:.0%}"
              + (f" | baseline: {Path(args.baseline).name} ({base_n} prompts)" if args.baseline else ""))
        print("═" * 80)
        if law:
            print("[law-mandated, scrubbed before counting] " +
                  ", ".join(f"{ph} ×{c}" for ph, c in law.most_common(6)))
        print(f"{'phrase':<30}{'tot':>5}{'prompts':>9}{'spread':>8}"
              + (f"{'Δbase':>8}{'':>2}" if args.baseline else f"{'':>8}")
              + " status")
        print("-" * 80)
        flags = 0
        new_flags = 0
        for sp, ph, is_phrase in rows[:args.top]:
            base = base_spread(ph)
            delta = f"{sp-base:+.0%}" if args.baseline else ""
            base_word = ph.split("-")[0] if "-" in ph else ph
            is_theme = (base_word in theme or ph in theme
                        or all(w in theme for w in ph.split()))
            new_tic = args.baseline and base < 0.10 and sp >= 0.35
            if is_theme:
                status = "INFO theme"
            elif new_tic:
                status = "⚑ NEW TIC"
                flags += 1
                new_flags += 1
            else:
                flags += 1
                status = ("· residual (substrate; does not gate)"
                          if args.fail_on_new_only else "⚑ FLAG")
            print(f"{ph:<30}{stats[ph][0]:>5}{len(stats[ph][1]):>6}/{n:<3}{sp:>7.0%}"
                  f"{delta:>8}  {status}")
        extra = max(0, len(rows) - args.top)
        print("-" * 80)
        if args.fail_on_new_only:
            verdict = "FLAG" if new_flags else "PASS"
            print(f"RESULT: {verdict} (fail-on-new-only) — {new_flags} NEW tic(s); "
                  f"{flags} over threshold total (substrate reported, not gated)"
                  f"{f'; {extra} more below fold' if extra else ''}")
            if new_flags:
                any_flag = True
        else:
            verdict = "FLAG" if flags else "PASS"
            print(f"RESULT: {verdict} — {flags} hard flag(s); {len(rows)} phrase(s) over "
                  f"threshold total{f'; {extra} more below fold' if extra else ''}")
            if flags:
                any_flag = True

    sys.exit(1 if any_flag else 0)


if __name__ == "__main__":
    main()
