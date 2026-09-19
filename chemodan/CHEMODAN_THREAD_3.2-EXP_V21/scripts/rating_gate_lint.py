#!/usr/bin/env python3
"""
Task 22-1 (2026-09-09) — RATING GATE + honest re-audit.
Task 24 (2026-09-10) — GATE v2: TAG-DELIVERY enforcement (RULES §52).

The §50 enforcement arm of RATING_MAP.md: a prompt's Yodayo tier is EARNED by
mechanical erotic payload (carriers x classes), not declared by the genre line.

v2 adds the two checks the N21 post-mortem exposed (the author's verdict:
beauty PASS, rating FAIL — «оно даже в PG 13 трудно умещается»):
  - RAW TAG FLOOR — the diffusion tag-parser does not read poetry; every
    R/R+/X POS must carry platform-parseable tags (R >= 1 shape-safe,
    R+ >= 3, X >= 2 state anchors) from the tier-gated bank below.
  - NEG-PAYLOAD PARITY — NEG must never ban the tier's/prompt's own
    payload: «nipples visible through» is §41's definition of R+ and is
    forbidden in every R+ NEG; a prompt's own raw tags must never appear
    in its NEG.

v3 adds the two checks the PH-off experiment exposed (the author's
specimen: «тела весьма детские (лоли) и с большой головой. с PH такой
проблемы нет» — RULES §53 MATURITY & HELPER LAW):
  - MATURITY ANCHOR — every POS carries an adult anchor (the
    «mature female» tag-run anchor or the «grown woman» prose anchor).
  - ANTI-LOLI NEG FLOOR — every NEG carries >= 3 of: child, childish,
    chibi, young girl, immature body, oversized head.

v5 (2026-09-16, §61 CARRIER DIVERSITY LAW / V19 — the N28 render
verdict: «сборище милфух-мамочек в одежде, через которую просвечивается
нижнее бельё»; vocabulary: system/CARRIER_LIBRARY.yaml, 280 positions):
  - CORE-4 — an R+ claim needs >=4 distinct carrier classes spanning
    ALL FOUR mechanism groups (FABRIC=W / BODY=A,B,C,S /
    POSITION=E,L,U,F / PHYSICS=D,M,I). One mechanism is one stamp.
  - FIVE NEW CLASSES counted — I imprint, L layers, M compression,
    S skin framing, U situational undress (full weight; H/G stay 0.5
    amplifiers). W/B broadened past the wet/sheer monopoly.
  - ANTI-MONOPOLY (§4G) — transparency family capped: <=2/prompt,
    <=40% of a batch's R+ frames; W-class <=45% of batch carriers.
  - LAYER STACK (§4F) — under-garment strap + falling verb + closed
    outer layer and NO named exit route = fail («лифчик под одеждой,
    лямки снаружи» is the render bug this prevents).
  - MATURITY QUOTA (§4C-2) — batch-level FAM-A/B/C spread on files
    >=10 prompts: FAM-A <=35%, FAM-C >=15%, no register >50% of the
    R+ subset. The bank without a quota renders as its default.

Exit code 1 on any failure — this is a gate, not a report.

Grades:
  - claimed tier  (from the Genre line)
  - carriers      (lexicon hits, per class A-H + W delivery)
  - hedges        (sterility retreat vocabulary — each cancels 0.5 credit)
  - payload share (fraction of POS sentences carrying >=1 carrier)
  - earned tier   (points >= thresholds; X needs the bare state + a carrier)
  - tag floor     (v2: distinct tier-legal raw tags in POS)
  - parity        (v2: NEG vs tier payload conflicts)
  - maturity      (v3: POS adult anchor + NEG anti-loli floor)

Run modes:
  python rating_gate_lint.py                 # N20 + SET5 + SP (legacy)
  GATE_SET=n21 python rating_gate_lint.py    # N21 + SET6 (the v2 target)
"""
import re
import sys
from pathlib import Path

DL = Path("/home/z/my-project/download")

# ─── THE CARRIER LEXICON (source of truth: RATING_MAP.md) ──────────────
# Multi-word patterns only — single common words would false-positive.
CLASSES = {
    "A": [  # CLEFT & MOUND (cameltoe-grade — the ladder's own R+ content)
        r"cameltoe",
        r"(?:seam|center-seam|suit's seam|leotard's seam)[^.]{0,60}?(?:pressed|riding|claiming|split|swallowed|devour\w+|print\w*)",
        r"(?:cleft|mons|mound)[^.]{0,50}?(?:print\w*|pressed|reading through|claim\w*|flat against)",
        r"seam[- ]split",
        r"(?:riding|pressed)[^.]{0,45}?into the cleft",
    ],
    "B": [  # POINT-TELEGRAPH (nipples-through-fabric, C072-safe register)
        r"nipples? (?:dark|hard|pressed|straining|standing|printed|pointed|stiff|beneath|through)",
        r"(?:two |small )?dark points?[^.]{0,25}?(?:beneath|against|through|standing|straining|printed|hard)",
        r"(?:points?|peaks?)[^.]{0,35}?(?:printing|printed|straining|reading through|pressed against|standing)",
        r"shape of her nipples? pressed",
        r"erect through",
        r"nip[- ]telegraph",
        r"nipples? tracking",
    ],
    "C": [  # SEAT & CHEEK CONSUMPTION (wedgie/ride/overflow)
        r"(?:cheeks?|cleft of her)[^.]{0,70}?(?:consum\w+|claim\w+|swallow\w+|devour\w+|riding|ridden)",
        r"wedg\w+",
        r"(?:suit|shorts|fabric|seam|silk)[^.]{0,60}?(?:consumed|devoured|swallowed) between",
        r"under-?curve[^.]{0,45}?(?:bare|surrendered|escaped|claim|deepest shadow|holding|spilling)",
        r"overflow\w* (?:the|its)",
        r"whale[- ]?tail",
        r"(?:ridden|riding) (?:up|into)",
        r"spill\w* (?:out|over|past) (?:either|the|its)",
        r"shelf of her behind",
        r"printed flat",
    ],
    "D": [  # BREAST PHYSICS (weight in motion)
        r"(?:breasts?|bust|chest)[^.]{0,60}?(?:drop|dropping|swinging|sagging|bouncing|settling|flattening|spilling|sway|jiggle)",
        r"(?:chest|breasts?)[^.]{0,30}?\bbare\w*\b",  # bare/bared chest — X-tier carrier (C072 bans it in R+ POS)
        r"\bbare[- ]chested\b",
        r"under-?boob[^.]{0,40}?(?:crescent|escaping|curve|line arriving)",
        r"under-?bust[^.]{0,40}?(?:fold|crease|crescent)",
        r"side-?boob",
        r"cleavage[^.]{0,35}?(?:deep|shaft|swallowing)",
        r"crescents? (?:escaping|rising|arriving|over)",
        r"(?:soft )?mounds?[^.]{0,45}?(?:rise over|rising|escaping|settling)",
        r"(?:soft |full )?(?:weight|bust)[^.]{0,45}?(?:sagging|swinging|settling|printing)",
        # ── v5 verb-led (see W): weight ACTS, it doesn't just settle
        r"(?:chest|breasts?|bust|weight)[^.]{0,55}?(?:re-?arriv\w+|lands?|pours?|tips?|leads?|votes?|takes? the (?:turn|stride|lead|far side))",
        r"(?:sways?|swaying|pours?|tipping)[^.]{0,35}?(?:with|at|past) (?:the|every|each|both) (?:turn|step|stride|quarter|breath)",
        r"(?:testimony|account|arithmetic|evidence|ledger)[^.]{0,35}?(?:sways|swaying|pours?|poured|re-?arriving|landing|tipping|tallies)",
    ],
    "E": [  # WARDROBE MALFUNCTION MECHANICS
        r"(?:one-hook|single hook|riding crooked|crooked)",
        r"(?:knot|clasp|strap|zipper|button|sash|hook|tie|halter)[^.]{0,55}?(?:losing|lost|slipping|slipped|frozen|surrendered|defeated|migrating|tugged|tugged loose|sagged|sagging|sliding)",
        r"(?:towel|wrap|robe|dress|top)[^.]{0,55}?(?:mid-losing|losing its|slipping its|last of its)",
        r"total (?:honesty|confession|transparency)",
        r"gone transparent",
        r"barely,? (?:still )?(?:covering|on duty)",
        r"barely covering",
        r"last (?:button|stitch|thread|hook|strap)",
        r"(?:gravity|the wet)[^.]{0,35}?voting",
        r"migrating",
        r"camel-honest",
        # ── v5 verb-led (see W): the garment QUITS — new failure verbs
        # that don't reuse slipping/lost/surrendered
        r"(?:seam|hem|strap|clasp|button|knot|zipper|collar|sash|cuff)[^.]{0,55}?(?:emigrat\w+|resign\w*|clocks? out|renegotiat\w+|quits?)",
        r"(?:emigrat\w+|resign\w*|clocks? out|renegotiat\w+)[^.]{0,35}?(?:seam|hem|strap|clasp|fabric|garment|trouser|cuff|collar)",
    ],
    "F": [  # PRESENTING & SPREAD
        r"(?:knees|legs|hips|thighs)[^.]{0,45}?(?:apart|wide|sprawled|sprawl|spread[- ]|slack open)",
        r"spread[- ]legged",
        r"presenting",
        r"all fours",
        r"(?:arch|arching)[^.]{0,45}?(?:offering|display|present)",
        r"(?:hips|mound) (?:pushed|thrust) (?:forward|first)",
        r"unapologetic geometry",
    ],
    "G": [  # AGGRESSIVE FRAMING & ANGLE
        r"(?:from below|low angle|water-?level|ground-?level|knee-?level|hip-?level)[^.]{0,25}?(?:camera|lens|viewed|framing|shot|looking)",
        r"(?:camera|lens) (?:low|at hip height|at water|patient)",
        r"viewed from (?:the water's own level|below|down the length)",
        r"(?:crotch|seat|bust|chest)-lead",
        r"macro (?:on|shot|close)",
        r"(?:filling|fills) the (?:lower|frame's)",
        r"between[- ](?:the[- ])?legs",
        r"top-?down",
        r"sightline",
    ],
    "H": [  # REACTION & PHYSIOLOGY (amplifiers)
        r"blush[^.]{0,40}?(?:flooding|climbing|past|down)",
        r"(?:thighs|knees)[^.]{0,25}?press\w* together",
        r"goose\w+",
        r"(?:flush|blush)[^.]{0,30}?(?:upper chest|mottling|past the collar)",
        r"shiver[^.]{0,20}?(?:arriving|at the)",
        r"(?:heat|sweat)[- ](?:slick|dark)",
        r"lip (?:bitten|bite)",
    ],
    "W": [  # WET/SHEER DELIVERY (intensity multiplier material)
        r"(?:soaked|wet|drenched|rain)[^.]{0,55}?(?:transparen\w+|sheer|clinging|second[- ]skin|film|printing|print|shape-?honest|clung)",
        r"sheer[^.]{0,25}?(?:wet|rain|against)",
        r"(?:clinging|clung) (?:to|film)",
        r"second[- ]skin",
        r"drum-?taut",
        r"fabric's (?:whole )?(?:architecture|confession) print\w*",
        r"shape-?honest",
        r"every contour readable",
        # ── v5 (2026-09-14, Path B): VERB-LED families — the gate was
        # breeding tics out of its own noun-led exemplars (camel-honest,
        # shape-honest, printed; then clinging/gone/last/weight). New
        # rule: the FABRIC is the subject and the VERB carries the claim.
        # Additive only — historical grades stay comparable.
        r"(?:weave|fabric|cotton|silk|lycra|cloth|suit|shirt|dress|bodice|bikini)[^.]{0,60}?(?:wicks?|maps|copies|transcribes|memoriz\w+|takes? (?:the|its) (?:print|dictation|testimony|inventory))",
        r"(?:takes?|taking) (?:the|its) (?:print|dictation|testimony|inventory) (?:of|from) (?:her|the|the body)",
        r"(?:publishes?|broadcasts?|announces?|recites?)[^.]{0,45}?(?:through|beneath|across|past) (?:the|its|her) (?:weave|fabric|cotton|silk|cloth|lycra|bodice)",
        # ── v5 (V19): FABRIC STATE beyond wet/sheer — the anti-monopoly
        # families (taut / stretch / wear / crease / mold / drape / rumple)
        r"taut (?:weave|shirt|fabric|suit|seat|lycra)",
        r"\btaut\b[^.]{0,35}?(?:weave|shirt|seam|ribbing|front|across|at the)",
        r"buttonholes? stretched",
        r"ribbing stretched",
        r"(?:worn|washed)[^.]{0,20}?(?:thin|gauze|white at)",
        r"gone (?:shiny|taut|wide)",
        r"press[- ]?mark",
        r"static (?:cling|charge)",
        r"(?:sweat|steam|splash)[^.]{0,30}?(?:darkening|darkened)",
        r"molded to her",
        r"open[- ]weave",
        r"rumpled",
        r"pleats?[^.]{0,25}?(?:losing|lost)",
        r"wind (?:pressing|pressed)",
        r"elastic (?:bite|biting)",
        r"chair'?s? lattice",
        r"nap flattened",
    ],
    "I": [  # IMPRINT & AFTERMATH — physics receipts (MECH: PHYSICS; V19)
        r"(?:bra|strap|sock|garter|belt|elast\w+|seat[- ]?belt)[^.]{0,40}?(?:release lines?|lines?|marks?|dents?|rings?|crease|sleep-crease)[^.]{0,15}?(?:on|across|around|above|below|pressed)",
        r"tan[- ]?lines?",
        r"pillow'?s? crease",
        r"love bite",
        r"hickey",
        r"grass(?:'s)? print",
        r"sheet'?s? (?:drape|crease)",
        r"buttons? realigned",
        r"inside[- ]out",
        r"mascara'?s? smear",
        r"(?:wet|damp) footprints?",
        r"lipstick'?s? transfer",
        r"pale (?:borders?|track)",
    ],
    "L": [  # LAYER INTERPLAY — multi-garment physics (MECH: POSITION; V19)
        r"(?:band|cup'?s? edge|ridge|busk|lace)[^.]{0,35}?(?:through|beneath|under)[^.]{0,15}?(?:the )?(?:tight )?(?:white )?(?:tee|shirt|blouse|sweater|bodice|knit|tank|dress)",
        r"petticoat",
        r"under[- ]layer",
        r"crossed with (?:the )?(?:sundress|dress|swimsuit|blouse)?'?s? (?:own )?strap",
        r"waistband (?:above|over|riding above)",
        r"layers?' (?:confession|negotiation|collar-lines?)",
        r"bandeau",
        r"(?:straps? )?crossed with",
        r"hem (?:two inches |an inch )?below",
        r"(?:camisole|slip)'s (?:lace )?(?:edge|trim|hem)",
        r"(?:strapless|bandeau)[^.]{0,30}?(?:war|vigilance|gravity|migrat\w+)",
        r"stack order",
        r"(?:what is )?over what",
    ],
    "M": [  # COMPRESSION & PRESS — external forces (MECH: PHYSICS; V19)
        r"seat[- ]?belt'?s? (?:diagonal|sleep-crease|bisect\w*|claim)",
        r"cross[- ]?body (?:bag'?s? )?strap",
        r"(?:table|counter)'s (?:edge|lip)[^.]{0,35}?(?:flattening|pressed|pressing|flatten\w*)",
        r"measuring tape",
        r"guitar'?s? (?:waist|body|strap)",
        r"cello'?s? embrace",
        r"crowd'?s? press",
        r"life[- ]?jacket'?s? crush",
        r"backpack'?s? chest strap",
        r"corset'?s? exhale",
        r"whole front against the (?:window|glass)",
        r"cold'?s print",
    ],
    "S": [  # SKIN FRAMING — bare-skin bands/frames (MECH: BODY; V19)
        r"zettai[- ]?ryouiki",
        r"bare (?:shoulder|shoulders|back|midriff)",
        r"collarbone'?s? (?:shelf|hollow)",
        r"back dimples?",
        r"goose[- ]?bumps",
        r"nape'?s? bare",
        r"anklet",
        r"choker'?s? line",
        r"navel'?s? dip",
        r"garter'?s? (?:clasps|frame|dents)",
        r"(?:sweat|water)'s? (?:track|beads)",
        r"sunburn",
        r"under[- ]?boob'?s? (?:line|shadow)",
        r"inner (?:band|thigh)",
        r"first inch of the cleavage",
        r"tan[- ]?lines?' (?:pale )?geometry",
    ],
    "U": [  # SITUATIONAL UNDRESS — context undresses (MECH: POSITION; V19)
        r"mid[- ]change",
        r"half[- ]buttoned",
        r"post[- ]shower",
        r"quick[- ]change",
        r"fitting room",
        r"laundry day",
        r"borrowed (?:shirt|jacket|hoodie|tee)",
        r"walk (?:of shame|home)",
        r"towel'?s? (?:turban|fold|damp rectangle)",
        r"hospital gown",
        r"dressing gown",
        r"oversized (?:tee|shirt|hoodie)",
        r"one arm in (?:the )?sleeve",
        r"caught in (?:the )?(?:car |door)",
        r"seamstress",
        r"pins in (?:the )?hem",
        r"curtain'?s? half[- ]drawn",
        r"yukata'?s? morning",
        r"obi a rumor",
        r"hoodie over pajama",
        r"sleepwear",
    ],
}

# ─── GATE v5: CARRIER DIVERSITY (RULES §61 / RATING_MAP §4E-§4G) ─────────
MECH_GROUPS = {  # the four delivery mechanisms (§4E)
    "FABRIC": "W",
    "BODY": "ABCS",
    "POSITION": "ELUF",
    "PHYSICS": "DMI",
}
CORE_LETTERS = "ABCDEFGILMSU"   # full-weight classes (H/W stay 0.5 amplifiers)
WEIGHT = {c: 1.0 for c in CORE_LETTERS}
WEIGHT.update({"H": 0.5, "W": 0.5})

# §4G anti-monopoly: the transparency family (capped, never banned)
TRANS_PAT = re.compile(r"see[- ]?through|sheer|transparent|translucent|soaked[- ]?through", re.I)

# §4F layer stack: an under-garment strap escapes only through a named route
UNDER_STRAP = re.compile(
    r"(?:bra|bikini|swimsuit|one[- ]piece|leotard|bodysuit|chemise|garter|corset|bandeau)"
    r"[^.]{0,30}?(?:strap|straps|band)\b", re.I)
STRAP_FALLING = re.compile(
    r"(?:slipping|slipped|fallen|falling|slid|slides? down|migrat\w+|riding (?:down|low|crooked)|escaped?)", re.I)
OUTER_COVER = re.compile(
    r"\b(?:blouse|shirt|sweater|knit|cardigan|t-?shirt|tee|jacket|pullover|turtleneck|button[- ]up)\b", re.I)
EXIT_ROUTE = re.compile(
    r"off[- ]shoulder|boat[- ]?neck|wide (?:neckline|neck|collar)|scoop(?:ed)? (?:neck|neckline)"
    r"|strapless|cold[- ]shoulder|sleeveless|armhole|halter|low[- ]back|open[- ]back|sweetheart"
    r"|plung(?:e|ing)|unzipped|unbuttoned|open (?:collar|front|clothes)"
    r"|half[- ](?:off|undressed|removed)"
    r"|neckline[^.]{0,25}(?:wide|slipped|fallen|scooped|boat|low)"
    r"|collar[^.]{0,15}(?:slipped|fallen|wide|loose|askew|gone wide)"
    r"|stretched[^.]{0,15}(?:neck|collar|neckhole)|neckhole"
    r"|shirt lift|jacket open|bare shoulders?|open[- ]?toed", re.I)


def layer_stack_violations(pos_body):
    """§4F: the under-strap needs a named exit when a closed outer layer exists."""
    v = []
    if not OUTER_COVER.search(pos_body):
        return v  # no covering garment in frame — the strap may fall freely
    for u in re.split(r"(?<=[.!?;])\s+|\s—\s", pos_body):
        if UNDER_STRAP.search(u) and STRAP_FALLING.search(u):
            if not EXIT_ROUTE.search(pos_body):
                v.append("LAYER STACK: under-strap escapes with no named exit route "
                         "(off-shoulder/boat neck/scoop/strapless/halter/armhole/) — "
                         "«лифчик под одеждой, лямки снаружи» is the bug this prevents")
            break  # one diagnostic per prompt is enough
    return v


FAM_TAGS = [  # §53A registers, specific-first (§4C-2 quota detects on these)
    ("A", re.compile(r"mature female", re.I)),
    ("C", re.compile(r"young woman", re.I)),
    ("B", re.compile(r"adult woman", re.I)),
    ("B", re.compile(r"grown woman", re.I)),
]


def detect_fam(pos_body):
    for fam, rx in FAM_TAGS:
        if rx.search(pos_body):
            return fam
    return None

# Sterility retreats — each is a -0.5 credit and marks the prose culture §50 kills.
HEDGES = [
    r"shape-only",
    r"at (?:its|their|the [\w'’]*)\s*(?:honest\s*)?limit",
    r"and no further",
    r"never the (?:sentence's |outline's |nipple's )?(?:subject|point(?: itself)?)",
    r"implied by",
    r"hints? of",
    r"suggestion of",
    r"reading at",
    r"tasteful",
    r"state, never",
    r"exposure is (?:the |a )?(?:state|season's)",
]

# (RAW_TAGS — the v1 dead variable, declared and never called: the exact bug
#  class v2 fixes. Kept as a tombstone comment, not code.)

# ─── GATE v2: TAG-DELIVERY (RULES §52) ─────────────────────────────────
# The tier-gated raw tag bank (source of truth: RATING_MAP v2.0 §4A).
# R shape-safe floor >=1 · R+ floor >=3 · X state anchors >=2.
R_BANK = [
    "see-through", "cleavage", "sideboob", "underboob", "shirt lift",
    "skirt lift", "skirt flip", "fluttering clothes", "fluttering skirt",
    "from behind", "from below", "from above", "from side", "hip focus",
    "thigh focus", "bare back", "navel", "collarbone", "collar",
]
RP_BANK = R_BANK + [
    "pokies", "cameltoe", "wedgie", "wet clothes", "wet", "wet hair",
    "ass", "ass focus", "ass grab", "grabbing own ass", "presenting",
    "spread legs", "squatting", "straddling", "arched back", "open clothes",
    "half-undressed", "sweat", "glistening", "large breasts", "curvy",
    "tentacles", "leotard", "arms up", "soap", "bare shoulders",
    "breast focus", "navel", "hip focus",
]
X_BANK = RP_BANK + ["topless", "bare chest"]
TAG_FLOOR = {"R": 1, "R+": 3, "X": 2}

# NEG-PAYLOAD PARITY: terms that may NEVER appear in a tier's NEG because
# they ARE that tier's payload (§41's own definitions). The bare-forms trio
# (nipple visible / bare nipple / bare breasts) stays legal in R NEG — it
# guards the real R+/X boundary there.
PARITY_BAN = {
    "R+": ["nipples visible through"],
    "X": ["nipples visible through", "nipple visible", "bare nipple", "bare breasts"],
    "R": [],
}

# ─── GATE v3: MATURITY (RULES §53) ─────────────────────────────────
# The PH-off experiment proved the Prompt Helper was silently supplying
# adult anchoring. With PH off (§53 clause 1), the anchoring is ours.
# v4 (2026-09-12, §53A MATURITY RANGE, author directive «милфы пусть
# остаются... защититься от лоли и только от лоли»): the anchor is a BANK
# matched to the girl's build — mature female (FAM-A) / adult woman (FAM-B)
# / young woman (FAM-C, college-age; никогда школьницы). The grown-woman
# face formula + anti-loli NEG floor stay universal.
POS_ANCHORS = ["mature female", "adult woman", "grown woman", "young woman"]
NEG_FLOOR = ["child", "childish", "chibi", "young girl", "immature body",
             "oversized head"]

def maturity_violations(pos_body, neg_body):
    v = []
    if not any(a in pos_body.lower() for a in POS_ANCHORS):
        v.append("POS lacks maturity anchor (mature female / grown woman)")
    neg_terms = {t.strip().lower().rstrip(",") for t in neg_body.split(",") if t.strip()}
    hits = sum(1 for f in NEG_FLOOR if f in neg_terms)
    if hits < 3:
        v.append(f"NEG anti-loli floor {hits}/6 terms (<3)")
    return v

def count_raw_tags(pos_body, tier):
    bank = {"R": R_BANK, "R+": RP_BANK, "X": X_BANK}[tier]
    # multi-word tags first so "wet clothes" matches before "wet"
    found = []
    for t in sorted(bank, key=len, reverse=True):
        if re.search(r"(?<![\w-])" + re.escape(t) + r"(?![\w-])", pos_body, re.I):
            found.append(t)
    return found

def parity_violations(pos_body, neg_body, tier):
    v = []
    # NEG granularity = whole comma-separated terms (a term like
    # «tentacles with mouths» sculpts a feature; it does not ban «tentacles»)
    neg_terms = {t.strip().lower().rstrip(",") for t in neg_body.split(",") if t.strip()}
    for term in PARITY_BAN.get(tier, []):
        if term.lower() in neg_terms:
            v.append(f"NEG bans «{term}» — the {tier} payload itself")
    own = count_raw_tags(pos_body, tier)
    for t in own:
        if t.lower() in neg_terms:
            v.append(f"NEG bans own tag «{t}»")
    return v

RE_CARRIER = [(cls, re.compile(p, re.I)) for cls, pats in CLASSES.items() for p in pats]
RE_HEDGE = [re.compile(p, re.I) for p in HEDGES]

BARE_STATES = ("TOPLESS", "NAKED", "TAPE", "VISIBLE")


def split_blocks(text, header_pat):
    """Yield (block_id, header_area, body) per prompt block."""
    matches = list(re.finditer(header_pat, text))
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        yield m.group(1), text[m.start():end]


def grade(pos_body, claimed, ncs):
    # Clause-level granularity: the house prose packs 8 clauses into one mega-sentence,
    # so sentence-level share undercounts payload. Units = sentences + em-dash clauses.
    # The fixed face-formula and masterpiece closer never carry payload — excluded.
    units = re.split(r"(?<=[.!?;])\s+|\s—\s", pos_body.strip())
    units = [s for s in units if len(s) > 25
             and not (s.startswith("Her face is rendered")
                      or s.startswith("Her grown woman's face"))
             and not s.startswith("Richly pigmented")]
    hits, class_hits = 0, {}
    carrier_words = 0
    total_words = 0
    for s in units:
        s_hits = 0
        words = len(s.split())
        total_words += words
        for cls, rx in RE_CARRIER:
            found = rx.findall(s)
            if found:
                s_hits += len(found)
                class_hits[cls] = class_hits.get(cls, 0) + len(found)
        hedge_n = sum(len(rx.findall(s)) for rx in RE_HEDGE)
        if s_hits:
            carrier_words += words
        hits += s_hits
    hedges = sum(len(rx.findall(pos_body)) for rx in RE_HEDGE)
    share = carrier_words / total_words if total_words else 0

    # weighted (v5): H and W are amplifiers/delivery (0.5x); A-G + I/L/M/S/U full weight
    core = sum(class_hits.get(c, 0) for c in CORE_LETTERS)
    points = core + 0.5 * (class_hits.get("H", 0) + class_hits.get("W", 0))
    points -= min(0.5 * hedges, 2.0)
    if share >= 0.35:
        points += 1.5
    elif share >= 0.25:
        points += 0.5
    classes_n = len([c for c in CORE_LETTERS if class_hits.get(c, 0) > 0])

    # ── v5: mechanism spread (§4E core-4) ──
    mech_hits = {g: sum(class_hits.get(c, 0) for c in letters)
                 for g, letters in MECH_GROUPS.items()}
    mech_n = len([g for g, n in mech_hits.items() if n > 0])
    mech_missing = [g for g, n in mech_hits.items() if n == 0]
    all_classes_n = len(class_hits)  # including H/W
    core4 = all_classes_n >= 4 and mech_n >= 4

    if claimed == "X":
        if any(b in ncs for b in BARE_STATES) and core >= 1 and share >= 0.10:
            earned = "X" if share >= 0.20 else "X (degree thin)"
        elif any(b in ncs for b in BARE_STATES):
            earned = "R+ (bare state, degree weak)"
        else:
            earned = "R+"
    elif claimed == "R+":
        if core >= 3 and share >= 0.30 and core4:
            earned = "R+"
        elif core >= 3 and share >= 0.30:
            earned = (f"R+ (core4 fail: {mech_n}/4 mech — "
                      f"{'/'.join(mech_missing)} missing)")
        elif core >= 2 and share >= 0.20:
            earned = "R/R+ (borderline)"
        elif core >= 1:
            earned = "R"
        else:
            earned = "PG-13"
    elif claimed == "R":
        if core >= 2 and share >= 0.20:
            earned = "R"
        elif core >= 1:
            earned = "R/PG-13 (borderline)"
        else:
            earned = "PG-13"
    else:
        earned = "PG-13"
    return {
        "carriers": class_hits, "core": core, "classes": classes_n,
        "classes_all": all_classes_n, "mech_n": mech_n,
        "mech_missing": mech_missing, "core4": core4,
        "hedges": hedges, "share": share, "points": round(points, 1),
        "earned": earned, "n_sent": len(units),
    }


def audit_file(path, header_pat, label):
    text = path.read_text(encoding="utf-8")
    rows = []
    for bid, block in split_blocks(text, header_pat):
        genre = re.search(r"Genre:.*", block)
        if not genre:
            continue
        gline = genre.group(0)
        ncs_m = re.search(r"NCS:\s*([A-Z_\-]+)", gline)
        yod_m = re.search(r"Yodayo:\s*(R\+|R|X|PG-13|PG)", gline)
        pos_m = re.search(r"POS:\s*\n\s*\n(.*?)(?:\n\s*\nNEG:|\nNEG:)", block, re.S)
        neg_m = re.search(r"NEG:\s*\n\s*\n(.*?)(?:\n\s*\n|\Z)", block, re.S)
        if not (ncs_m and yod_m and pos_m):
            continue
        g = grade(pos_m.group(1), yod_m.group(1), ncs_m.group(1))
        # ── v2: tag floor + parity ──
        tier = yod_m.group(1)
        tags = count_raw_tags(pos_m.group(1), tier)
        g["tags"] = tags
        g["tag_floor_ok"] = len(tags) >= TAG_FLOOR[tier]
        g["parity"] = parity_violations(pos_m.group(1),
                                        neg_m.group(1) if neg_m else "", tier)
        g["maturity"] = maturity_violations(pos_m.group(1),
                                            neg_m.group(1) if neg_m else "")
        # ── v5: diversity data (§4C-2 / §4E / §4F / §4G) ──
        g["fam"] = detect_fam(pos_m.group(1))
        g["sheer_hits"] = len(TRANS_PAT.findall(pos_m.group(1)))
        g["layer_stack"] = layer_stack_violations(pos_m.group(1))
        anchor = re.search(r"— ([a-z0-9\-]+) \(", block)
        rows.append((bid, anchor.group(1) if anchor else "-", yod_m.group(1), g))
    return rows


def report(rows, label):
    print(f"\n{'═' * 100}\n{label}\n{'═' * 100}")
    print(f"{'id':4s} {'anchor':44s} {'claim':6s} {'core':4s} {'cls':4s} {'mech':5s} {'hedg':4s} "
          f"{'share':6s} {'pts':5s} {'tags':5s} EARNED")
    counts = {}
    for bid, anchor, claimed, g in rows:
        cl = "".join(sorted(g["carriers"].keys(), key=lambda c: "ABCDEFGHILMSUW".index(c)))
        cl = cl or "-"
        print(f"{bid:4s} {anchor:44s} {claimed:6s} {g['core']:<4d} {g['classes']:<4d} "
              f"{g.get('mech_n', '-')}/4   {g['hedges']:<4d} {g['share']:>5.0%} {g['points']:<5.1f} "
              f"{len(g.get('tags', [])):<5d} {g['earned']}")
        counts[claimed] = counts.get(claimed, 0) + 1
        if not g.get("tag_floor_ok", True):
            print(f"     !! TAG FLOOR: {len(g.get('tags', []))} tier-legal tags, "
                  f"floor is {TAG_FLOOR[claimed]} — the tag parser gets nothing "
                  f"({', '.join(g.get('tags', [])) or 'zero tags'})")
        for v in g.get("parity", []):
            print(f"     !! PARITY: {v}")
        for v in g.get("maturity", []):
            print(f"     !! MATURITY: {v}")
        if g.get("sheer_hits", 0) > 2:
            print(f"     !! SHEER CAP: {g['sheer_hits']} transparency-family hits (§4G cap = 2)")
        for v in g.get("layer_stack", []):
            print(f"     !! {v}")
    honest = {}
    for _, _, claimed, g in rows:
        e = g["earned"]
        if e.startswith("X"):
            key = "X"
        elif "core4" in e:
            key = "R+ (core4 fail)"
        elif e == "R+":
            key = "R+"
        elif e.startswith("R") and "borderline" not in e and "weak" not in e:
            key = "R"
        elif "borderline" in e:
            key = "R (borderline)" if e.startswith("R/") else "R+ (borderline)"
        else:
            key = "PG-13"
        honest[key] = honest.get(key, 0) + 1
    print(f"\n  CLAIMED : {counts}")
    print(f"  EARNED  : {honest}")
    return honest


def main():
    total_claimed, total_earned = {}, {}
    failures = []
    all_rows = []   # v5: batch-level diversity accounting (§4C-2/§4G)
    import os
    gate_set = os.environ.get("GATE_SET", "n20")
    if gate_set == "n29":
        files = [
            (DL / "BATCH_N29_NO_ONE_WROTE_THIS_SCENE.md", re.compile(r"^(P\d{2}) — ", re.M), "BATCH N29 — NO ONE WROTE THIS SCENE (21: 3 OC ORDERS FIRST + 18 mains — the merged-batch order)"),
        ]
    elif gate_set == "n28":
        files = [
            (DL / "BATCH_N28_NOBODY_KNOWS.md", re.compile(r"^(P\d{2}) — ", re.M), "BATCH N28 — NOBODY KNOWS (21 mains)"),
            (DL / "OC_ORDERS_N28_SET3.md", re.compile(r"^(OC\d) — ", re.M), "OC ORDERS N28 SET3 (3 OC — Lua/Una/Yui)"),
        ]
    elif gate_set == "n27":
        files = [
            (DL / "BATCH_N27_SOMEWHERE_BETWEEN_HERE_AND_MAGIC.md", re.compile(r"^(P\d{2}) — ", re.M), "BATCH N27 — SOMEWHERE BETWEEN HERE AND MAGIC (21 mains)"),
            (DL / "OC_ORDERS_N26_SET2.md", re.compile(r"^(OC\d) — ", re.M), "OC ORDERS N26 SET2 (3 OC — the author's theme trio)"),
            (DL / "EXQUISITE_ORDERS_01.md", re.compile(r"^(EX-\d\d) — ", re.M), "EXQUISITE SET 1 (3 EX — the tier's first mint)"),
        ]
    elif gate_set == "n26":
        files = [
            (DL / "BATCH_N26_SILENCE_IS_THE_SLOWEST_UNDRESSING.md", re.compile(r"^(P\d{2}) — ", re.M), "BATCH N26 — SILENCE IS THE SLOWEST UNDRESSING (21 mains)"),
            (DL / "OC_ORDERS_N26.md", re.compile(r"^(OC\d) — ", re.M), "OC ORDERS N26 (3 OC — the CANTUS trio)"),
            (DL / "SP_ORDERS.md", re.compile(r"^(SP-07) — ", re.M), "SP-07 (special — the 2000 fathoms challenge)"),
        ]
    elif gate_set == "n25":
        files = [
            (DL / "BATCH_N25_THE_RAIN_FELL_UPWARD.md", re.compile(r"^(P\d{2}) — ", re.M), "BATCH N25 — THE RAIN FELL UPWARD (21 mains)"),
            (DL / "OC_ORDERS_N25.md", re.compile(r"^(OC\d) — ", re.M), "OC ORDERS N25 (3 OC — color-inversion orders)"),
        ]
    elif gate_set == "n24":
        files = [
            (DL / "BATCH_N24_BLUE_IS_THE_LONELIEST_COLOR.md", re.compile(r"^(P\d{2}) — ", re.M), "BATCH N24 — BLUE IS THE LONELIEST COLOR (21 mains)"),
            (DL / "OC_ORDERS_N24.md", re.compile(r"^(OC\d) — ", re.M), "OC ORDERS SET9 (3 OC)"),
        ]
    elif gate_set == "n23":
        files = [
            (DL / "BATCH_N23_SIN_LOOKS_GOOD_ON_YOU.md", re.compile(r"^(P\d{2}) — ", re.M), "BATCH N23 — SIN LOOKS GOOD ON YOU (21 mains)"),
            (DL / "OC_ORDERS_N23.md", re.compile(r"^(OC\d) — ", re.M), "OC ORDERS SET8 (3 OC)"),
        ]
    elif gate_set == "n22":
        files = [
            (DL / "BATCH_N22_A_WORLD_SLIGHTLY_OUT_OF_PLACE.md", re.compile(r"^(P\d{2}) — ", re.M), "BATCH N22 — A WORLD SLIGHTLY OUT OF PLACE (21 mains)"),
            (DL / "OC_ORDERS_N22.md", re.compile(r"^(OC\d) — ", re.M), "OC ORDERS SET7 (3 OC)"),
            (DL / "SP_ORDERS.md", re.compile(r"^(SP-06) — ", re.M), "SP-06 (special)"),
        ]
    elif gate_set == "n21":
        files = [
            (DL / "BATCH_N21_PERHAPS_WE_WERE_THE_DREAM.md", re.compile(r"^(P\d{2}) — ", re.M), "BATCH N21 — PERHAPS WE WERE THE DREAM (21 mains)"),
            (DL / "OC_ORDERS_N21.md", re.compile(r"^(OC\d) — ", re.M), "OC ORDERS SET6 (3 OC)"),
        ]
    else:
        files = [
            (DL / "BATCH_N20_MONO_NO_AWARE.md", re.compile(r"^(P\d{2}) — ", re.M), "BATCH N20 — MONO NO AWARE (21 mains)"),
            (DL / "OC_ORDERS_N20.md", re.compile(r"^(OC\d) — ", re.M), "OC ORDERS SET5 (3 OC)"),
            (DL / "SP_ORDERS.md", re.compile(r"^(SP-\d{2}) — ", re.M), "SP ORDERS (special)"),
        ]
    for path, pat, label in files:
        if not path.exists():
            print(f"!! missing {path}")
            continue
        rows = audit_file(path, pat, label)
        h = report(rows, label)
        for k, v in h.items():
            total_earned[k] = total_earned.get(k, 0) + v
        for bid, _, claimed, g in rows:
            all_rows.append((path.name, bid, claimed, g))
            if not g.get("tag_floor_ok", True):
                failures.append(f"{path.name}:{bid} tag floor {len(g.get('tags', []))}<{TAG_FLOOR[claimed]}")
            for v in g.get("parity", []):
                failures.append(f"{path.name}:{bid} {v}")
            for v in g.get("maturity", []):
                failures.append(f"{path.name}:{bid} {v}")
            if claimed == "R+" and "core4 fail" in g["earned"]:
                failures.append(f"{path.name}:{bid} {g['earned']} (§4E core-4 — add the missing mechanism's carrier, not a rewrite)")
            if g.get("sheer_hits", 0) > 2:
                failures.append(f"{path.name}:{bid} sheer cap {g['sheer_hits']}>2 transparency-family hits (§4G)")
            for v in g.get("layer_stack", []):
                failures.append(f"{path.name}:{bid} {v}")

    # ── v5 batch checks (§61): maturity quota + sheer/W monopoly ──
    n = len(all_rows)
    if n >= 10:
        fams = {}
        for _, _, _, g in all_rows:
            fams[g.get("fam") or "?"] = fams.get(g.get("fam") or "?", 0) + 1
        a, c, unk = fams.get("A", 0), fams.get("C", 0), fams.get("?", 0)
        if a > 0.35 * n:
            failures.append(f"MATURITY QUOTA (batch): FAM-A {a}/{n} > 35% — «сборище милфух» guard (§4C-2)")
        if c < 0.15 * n:
            failures.append(f"MATURITY QUOTA (batch): FAM-C {c}/{n} < 15% — the young-woman register starved (§4C-2)")
        if unk > 0:
            print(f"  [v5] maturity anchors unparsed on {unk}/{n} prompts (counted as neither register)")
        rp = [r for r in all_rows if r[2] == "R+"]
        if rp:
            rf = {}
            for _, _, _, g in rp:
                rf[g.get("fam") or "?"] = rf.get(g.get("fam") or "?", 0) + 1
            for fam, cnt in rf.items():
                if cnt > 0.5 * len(rp):
                    failures.append(f"MATURITY QUOTA (R+ subset): FAM-{fam} {cnt}/{len(rp)} > 50% of R+ frames (§4C-2)")
        sheer_frames = sum(1 for _, _, _, g in rp if g.get("sheer_hits", 0) > 0)
        if sheer_frames > 0.40 * len(rp):
            failures.append(f"SHEER MONOPOLY (batch): {sheer_frames}/{len(rp)} R+ frames carry transparency-family carriers (§4G cap 40%)")
    total_carriers = sum(sum(g["carriers"].values()) for _, _, _, g in all_rows)
    w_total = sum(g["carriers"].get("W", 0) for _, _, _, g in all_rows)
    if total_carriers and w_total / total_carriers > 0.45:
        failures.append(f"W MONOPOLY (batch): W-class {w_total}/{total_carriers} = {w_total/total_carriers:.0%} of carriers (§4G cap 45%)")

    print(f"\n{'═' * 100}\nTOTAL (gate_set={gate_set})\n  earned: {total_earned}")
    if failures:
        print(f"  GATE v5 FAILURES ({len(failures)}):")
        for f in failures:
            print(f"    - {f}")
        print(f"{'═' * 100}")
        return 1
    print("  GATE v5: tag floor + parity + maturity + diversity (core-4 / anti-monopoly / layer stack) — PASS")
    print(f"{'═' * 100}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
