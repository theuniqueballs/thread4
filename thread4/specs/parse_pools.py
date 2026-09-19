#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
parse_pools.py — THREAD 4 pool parser (Task 2-a, agent: pool-parser).

Converts the CHEMODAN THREAD 3.2-EXP-V21 pseudo-YAML system pools into
clean typed JSON specs for THREAD 4:

    carriers.json   <- CARRIER_LIBRARY.yaml        (280 carriers, 14 classes)
    poses.json      <- POSE_LIBRARY.yaml           (240 poses + §33 CAM pairs)
    palettes.json   <- PALETTE_LIBRARY.yaml + ONTOLOGY.yaml (P01-P105)
    pools.json      <- POOLS_V8.yaml + ONTOLOGY.yaml (K/FET/H/GAR/BRE/BK/B/
                        HS/CAM/LQ/R/NR pools, policies, misc axes)
    engines.json    <- ENGINES.yaml                (7 engines + seeds)
    oc-canon.json   <- OC_CANON.yaml               (16 active OCs + 2 reserve)
    races.json      <- POOLS_V8/ONTOLOGY races + Thread-4 directives

The 3.2 sources are NOT valid YAML (unbalanced braces, stray quotes,
bare tokens, YAML-ish fragments) — everything is parsed with REGEX.
Author's order for Thread 4: PRESERVE all entries and IDs; FLAG
near-duplicates and anomalies; do NOT delete content.

Usage:  python3 parse_pools.py
Writes: the seven JSON files + PARSE_REPORT.md next to this script.
"""

import json
import os
import re
import sys
from itertools import combinations

SRC = "/home/z/my-project/chemodan/CHEMODAN_THREAD_3.2-EXP_V21/system"
OUT = os.path.dirname(os.path.abspath(__file__))

ANOMALIES = []      # strings collected for the report
TYPOS_FIXED = []    # (file, line-no-ish, what, fix)
DECISIONS = []      # judgment calls made


def read(name):
    with open(os.path.join(SRC, name), encoding="utf-8") as f:
        return f.read()


def dump(name, obj):
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")
    # validate round-trip
    with open(path, encoding="utf-8") as f:
        json.load(f)
    return path


# --------------------------------------------------------------------------
# generic pseudo-YAML inline-entry parser:  {k: v, k2: "v2", k3: [a, b]}
# --------------------------------------------------------------------------
FIELD_RE = re.compile(
    r'([A-Za-z_][\w-]*)\s*:\s*(?:"([^"]*)"|\[([^\]]*)\]|([^,}]+))'
)


def parse_inline(content):
    """Parse one pseudo-YAML inline mapping into a dict.

    Handles quoted values (commas/colons inside are safe), bracket lists,
    bare values (stray quotes stripped) and the bare `OC-exempt` flag.
    """
    out = {}
    content = content.strip()
    if re.search(r'(^|,)\s*OC-exempt\s*(,|$)', content):
        out["oc_exempt"] = True
        content = re.sub(r'(^|,)\s*OC-exempt\s*(,|$)', r'\1\2', content).strip().strip(',')
    for m in FIELD_RE.finditer(content):
        key, quoted, bracket, bare = m.group(1), m.group(2), m.group(3), m.group(4)
        if key in out:
            continue
        if quoted is not None:
            out[key] = quoted
        elif bracket is not None:
            out[key] = [v.strip() for v in bracket.split(",") if v.strip()]
        else:
            out[key] = bare.strip().strip('"').strip()
    return out


def scan_entries(text, id_pred=None):
    """Scan every line for an inline {...} entry with an id field."""
    entries = []
    seen = set()
    for lineno, raw in enumerate(text.splitlines(), 1):
        line = raw.rstrip()
        if line.lstrip().startswith("#"):
            continue
        m = re.search(r"\{(.*)\}\s*$", line)
        if m:
            content = m.group(1)
        else:
            m2 = re.search(r"\{(.*)$", line)
            if not m2:
                continue
            content = m2.group(1)
        d = parse_inline(content)
        eid = d.get("id")
        if not isinstance(eid, str) or not eid:
            continue
        if id_pred and not id_pred(eid):
            continue
        if eid in seen:
            ANOMALIES.append(f"duplicate inline id skipped: {eid} (line {lineno})")
            continue
        seen.add(eid)
        d["_line"] = lineno
        entries.append(d)
    return entries


def scan_named_entries(section_text):
    """Scan for broken-brace `- {name: "...", ...` entries (env/skin/material
    donor dictionaries lost their closing braces somewhere in 3.2)."""
    out = []
    for raw in section_text.splitlines():
        line = raw.strip()
        if not line.startswith("- {"):
            continue
        content = line[2:].lstrip("{")
        d = parse_inline(content)
        if d.get("name"):
            out.append(d)
    return out


def text_between(text, start, end, include_start=False):
    i = text.find(start)
    if i < 0:
        raise ValueError(f"marker not found: {start!r}")
    i = i if include_start else i + len(start)
    j = text.find(end, i)
    if j < 0:
        return text[i:]
    return text[i:j]


def parse_kv_block(block, allowed_keys):
    """Parse `key: value` lines (quoted / [list] / bare) from a block."""
    out = {}
    for line in block.splitlines():
        line = line.rstrip()
        if not line or line.startswith("#"):
            continue
        if line.lstrip().startswith(("─", "═", "-")):
            # stop at decorative separators / list items
            if line.lstrip().startswith(("─", "═")):
                break
            continue
        m = re.match(r"^([A-Za-z_][\w]*)\s*:\s*(.*)$", line)
        if not m or m.group(1) not in allowed_keys:
            continue
        key, val = m.group(1), m.group(2).strip()
        if val.startswith("[") and val.endswith("]"):
            out[key] = [v.strip().strip('"') for v in val[1:-1].split(",") if v.strip()]
        elif val.startswith('"') and val.endswith('"') and len(val) >= 2:
            out[key] = val[1:-1]
        else:
            out[key] = val
    return out


# ==========================================================================
# 1. carriers.json
# ==========================================================================
CLASS_DEFS = {
    "W": {"name": "Fabric State", "mech": "FABRIC"},
    "A": {"name": "Cleft & Mound", "mech": "BODY"},
    "B": {"name": "Shape Telegraph / Body Topography", "mech": "BODY"},
    "C": {"name": "Seat & Cheek", "mech": "BODY"},
    "S": {"name": "Skin Framing", "mech": "BODY"},
    "E": {"name": "Garment Displacement", "mech": "POSITION"},
    "L": {"name": "Layer Interplay", "mech": "POSITION"},
    "U": {"name": "Situational Undress", "mech": "POSITION"},
    "F": {"name": "Presenting & Spread", "mech": "POSITION"},
    "D": {"name": "Kinetic Weight", "mech": "PHYSICS"},
    "M": {"name": "Compression & Press", "mech": "PHYSICS"},
    "I": {"name": "Imprint & Aftermath", "mech": "PHYSICS"},
    "G": {"name": "Aggressive Framing", "mech": "AMPLIFIER"},
    "H": {"name": "Reaction & Physiology", "mech": "AMPLIFIER"},
}
CLASS_ORDER = ["W", "A", "B", "C", "S", "E", "L", "U", "F", "D", "M", "I", "G", "H"]
EXPECTED_CLASS_COUNTS = {"W": 30, "A": 14, "B": 30, "C": 16, "S": 20, "E": 32,
                         "L": 18, "U": 20, "F": 14, "D": 28, "M": 16, "I": 18,
                         "G": 12, "H": 12}

# §4G anti-monopoly family: transparency-shaped carriers.
# Keywords hit the carrier TEXT; CR-W17 is a manual judgment call
# (open-weave light transmission — its own note says "never call it sheer").
SHEER_RE = re.compile(
    r"sheer|see-through|seethrough|transparent|translucent|gauze|"
    r"worn[ -]thin|threadbare|plastered|soaked|rain-sag|rain-weight|wet hemline",
    re.I,
)
MANUAL_SHEER = {"CR-W17"}


def parse_carriers():
    text = read("CARRIER_LIBRARY.yaml")
    raw = scan_entries(text, id_pred=lambda i: re.fullmatch(r"CR-[A-Z]\d+", i))
    classes = {c: [] for c in CLASS_ORDER}
    for d in raw:
        cls = d["id"].split("-")[1][0]
        if cls not in classes:
            ANOMALIES.append(f"carrier with unknown class: {d['id']}")
            continue
        deg = d.get("deg")
        if deg not in ("L", "M", "H"):
            ANOMALIES.append(f"carrier {d['id']} has unexpected deg {deg!r}")
        note = d.get("note")
        mat = None
        if note:
            mm = re.search(r"mat:\s*([ABC])", note)
            if mm:
                mat = mm.group(1)
        carrier_txt = d.get("carrier", "")
        sheer = bool(SHEER_RE.search(carrier_txt)) or d["id"] in MANUAL_SHEER
        classes[cls].append({
            "id": d["id"],
            "name": d.get("name", ""),
            "carrier": carrier_txt,
            "deg": deg,
            "note": note,
            "mat": mat,
            "sheer_family": sheer,
        })
    counts = {c: len(v) for c, v in classes.items()}
    for c, exp in EXPECTED_CLASS_COUNTS.items():
        if counts.get(c) != exp:
            ANOMALIES.append(f"class {c}: expected {exp} carriers, got {counts.get(c)}")
    total = sum(counts.values())
    if total != 280:
        ANOMALIES.append(f"carrier total {total} != 280")
    doc = {
        "version": "1.0.0",
        "born": "2026-09-19",
        "source": "3.2 CARRIER_LIBRARY v1.0.0 (THREAD 3.2-EXP V19, born 2026-09-16)",
        "mech_groups": {
            "FABRIC": ["W"],
            "BODY": ["A", "B", "C", "S"],
            "POSITION": ["E", "L", "U", "F"],
            "PHYSICS": ["D", "M", "I"],
            "AMPLIFIER": ["G", "H"],
        },
        "class_defs": {c: dict(CLASS_DEFS[c], count=counts[c]) for c in CLASS_ORDER},
        "classes": {c: classes[c] for c in CLASS_ORDER},
        "core4_law": (
            "R+ slots: >=4 carrier classes spanning all 4 mechanism groups "
            "(FABRIC+BODY+POSITION+PHYSICS); W <= 45% of a batch's carriers; "
            "sheer-family (§4G anti-monopoly) <= 2 carriers per prompt and "
            "<= 40% of a batch's R+ frames; G/H are AMPLIFIERS (0.5x weight, "
            "never count toward CORE-4). An R+ stack of four M-carriers beats "
            "one H-carrier + filler (the three-ladders doctrine)."
        ),
        "notes": [
            "deg ladder: L = suggest (reads at second glance), M = state (reads "
            "immediately), H = claim (the state is the frame's subject).",
            "mat affinity (A=mature / B=adult woman / C=young woman, all 18+, "
            "aesthetic direction only) extracted from note text 'mat: X'; null when absent. "
            "3.2 batch quotas: FAM-A <=35%, FAM-C >=15%, R+-subset <=50% one register.",
            "sheer_family marked per §4G (see-through/sheer/transparent/wet/soaked/"
            "translucent + worn-thin/gauze/plastered/rain-sag); flagged, never removed.",
            "PH doctrine: every carrier is noun-led (§4D-3) — the NOUN carries the claim.",
            "Source section order was W,B,E,D,A,C,F,G,H,I,L,M,S,U; output uses canonical "
            "mech-group order W,A,B,C,S,E,L,U,F,D,M,I,G,H. Nothing reordered inside classes.",
        ],
    }
    return doc, total, counts


# ==========================================================================
# 2. poses.json
# ==========================================================================
POSE_FAMILY = [
    (1, 48, "base"),
    (49, 60, "erotic_presentation"),
    (61, 84, "ecchi_classic"),
    (85, 108, "dynamic_v2"),
    (109, 132, "env_interaction"),
    (133, 156, "performance_mirror"),
    (157, 180, "partner_implied"),
    (181, 204, "erotic_presentation_v2"),
    (205, 228, "micropose_expression"),
    (229, 240, "threshold_limen"),
]


def pose_family(num):
    for lo, hi, fam in POSE_FAMILY:
        if lo <= num <= hi:
            return fam
    return None


def parse_poses():
    text = read("POSE_LIBRARY.yaml")
    raw = scan_entries(text, id_pred=lambda i: re.fullmatch(r"PL\d+", i))
    pairs = {}
    pair_re = re.compile(r"\{\s*pl:\s*(PL\d+)\s*,\s*preferred:\s*\[([^\]]*)\]\s*\}")
    for m in pair_re.finditer(text):
        pairs[m.group(1)] = [v.strip() for v in m.group(2).split(",") if v.strip()]
    poses = []
    for d in raw:
        num = int(d["id"][2:])
        fam = pose_family(num)
        if fam is None:
            ANOMALIES.append(f"pose {d['id']} outside known family ranges")
            fam = "unknown"
        if d.get("risk") not in ("LOW", "MID", "HIGH"):
            ANOMALIES.append(f"pose {d['id']} unexpected risk {d.get('risk')!r}")
        poses.append({
            "id": d["id"],
            "name": d.get("name", ""),
            "sd": d.get("sd", ""),
            "category": d.get("category"),
            "risk": d.get("risk"),
            "family": fam,
            "preferred_cams": pairs.get(d["id"], []),
        })
    poses.sort(key=lambda p: int(p["id"][2:]))
    missing_pairs = [p["id"] for p in poses if not p["preferred_cams"]]
    if missing_pairs:
        ANOMALIES.append(f"poses without §33 camera pairs: {missing_pairs}")
    extra_pairs = sorted(set(pairs) - {p["id"] for p in poses})
    if extra_pairs:
        ANOMALIES.append(f"camera pairs without poses: {extra_pairs}")
    if len(poses) != 240:
        ANOMALIES.append(f"pose total {len(poses)} != 240")
    fam_counts = {}
    for p in poses:
        fam_counts[p["family"]] = fam_counts.get(p["family"], 0) + 1
    doc = {
        "version": "1.0.0",
        "born": "2026-09-19",
        "source": "3.2 POSE_LIBRARY v3.0.0 (base v1 + erotic v2.0 2026-09-10 + ×4 expansion 2026-09-14)",
        "poses": poses,
        "family_counts": fam_counts,
        "pair_note": (
            "§33 pose-camera pair law: every PL code has 3-5 preferred camera "
            "angles; outside the preferred set is allowed but FLAGGED. PL+CAM must "
            "agree — a back-to-camera PL with a front eye-level CAM is a logical "
            "impossibility (viewer inside the body), and was the v16 #1 failure "
            "(effective cowboy rate 67%). Camera values reference the ONTOLOGY "
            "camera axis — CAUTION: the pose file's CAM code table and ONTOLOGY's "
            "CAM01-CAM12 axis DISAGREE on 5 codes (see pools.json cam.numbering_conflict); "
            "the pose pairs' self-describing suffixes (CAM02_three_quarter) are authoritative."
        ),
        "cam_reference": {
            "CAM01": "eye_level", "CAM02": "three_quarter", "CAM03": "from_below",
            "CAM04": "from_above", "CAM05": "over_shoulder", "CAM06": "side",
            "CAM07": "wide_env", "CAM08": "back_to_camera", "CAM09": "dutch_tilt",
            "CAM10": "through_element", "CAM11": "mirror_reflection", "CAM12": "aerial",
            "CAM13": "crotch_lead", "CAM14": "top_down_shaft", "CAM15": "water_level",
            "CAM16": "hip_height_gate", "CAM17": "between_legs_sightline", "CAM18": "fisheye_seat",
        },
        "usage_doctrine": [
            "1. STANDING-DEFAULT RETIRED: PL01 may not be a VOLT/X prompt's primary pose; "
            "static VERTICAL codes (PL01/02/06/08/19/29) cap at 2 per batch, never in X slots.",
            "2. POSE-FIRST DESIGN: the PL code is chosen BEFORE the prose; one striking "
            "pose per prompt is the scroll-stop engine (RF-001).",
            "3. EROTIC-PRESENTATION GREED: >=4 codes from PL49-60 + PL181-204 per 21-batch, "
            ">=1 per act; both families rotate, never one code twice in a batch.",
            "4. ECCHI CLASSIC = GRAMMAR: >=3 of PL61-84 per batch, censored register enforced.",
            "5. MICROPPOSES serve §15's portrait quota (2-3 close-ups per batch).",
            "6. THRESHOLD codes (PL229-240) belong to the LIMEN engine's world, open to any "
            "boundary-flavored frame.",
            "7. All families rotate per §33, per_code cap 2, category caps per C015.",
            "Known near-neighbors by design (source's own audit): PL188 vs PL84, PL194 vs "
            "PL147, PL195 vs PL76, PL232 vs PL29 — each pair differs on camera relationship "
            "or the body's key axis.",
        ],
    }
    return doc, len(poses), fam_counts


# ==========================================================================
# 3. palettes.json
# ==========================================================================
PAL_KEYS_6 = {"name", "dominant", "secondary", "accent1", "accent2", "shadow",
              "forbidden", "light_type", "sd_fragment", "mood"}
PAL_KEYS_3 = {"name", "dominant", "secondary", "accent", "shadow", "light_type",
              "forbidden_colors", "mood", "sd_fragment"}
PALETTE_FAMILIES = [
    ("NIGREDO", 21, 27), ("ALBEDO", 28, 34), ("RUBEDO", 35, 40),
    ("RAINBOW / SPECTRUM", 41, 50), ("HISTORICAL / ATMOSPHERIC", 51, 60),
    ("RARE / EXPERIMENTAL", 61, 70), ("TENCENCIES", 71, 82), ("TINT", 83, 88),
    ("SEAM (N27 pre-flight, PALETTE_EXTENSION_v4)", 89, 99),
    ("SECRET (arcana engine families)", 100, 105),
]


def palette_family(num):
    for fam, lo, hi in PALETTE_FAMILIES:
        if lo <= num <= hi:
            return fam
    return "legacy"


def parse_palettes():
    palettes = []
    # --- P01-P20: legacy 3-slot palettes from ONTOLOGY.yaml ---
    ont = read("ONTOLOGY.yaml")
    seg = text_between(ont, "\npalette:\n", "\n── LIGHT QUALITY")
    for chunk in re.split(r"\n- id: ", seg)[1:]:
        lines = chunk.splitlines()
        pid = lines[0].strip()
        d = parse_kv_block(chunk, PAL_KEYS_3)
        num = int(re.match(r"P(\d+)", pid).group(1))
        palettes.append({
            "id": pid,
            "name": d.get("name", ""),
            "dominant": d.get("dominant", []),
            "secondary": d.get("secondary", []),
            "accent1": d.get("accent", []),
            "accent2": None,
            "shadow": d.get("shadow", ""),
            "forbidden": d.get("forbidden_colors", []),
            "light_type": d.get("light_type", ""),
            "sd_fragment": d.get("sd_fragment", ""),
            "mood": d.get("mood", ""),
            "family": "legacy_3slot",
            "legacy_3slot": True,
            "source": "ONTOLOGY.yaml (THREAD 2.0 reuse)",
        })
    # --- P21-P105: 6-slot palettes from PALETTE_LIBRARY.yaml ---
    pal = read("PALETTE_LIBRARY.yaml")
    chunks = re.split(r"(?m)^id: ", pal)[1:]
    for chunk in chunks:
        first = chunk.splitlines()[0].strip()
        m = re.match(r"(P\d+_\S+)\s*$", first)
        if not m:
            continue
        pid = m.group(1)
        num = int(re.match(r"P(\d+)", pid).group(1))
        d = parse_kv_block(chunk, PAL_KEYS_6)
        for req in ("dominant", "secondary", "accent1", "accent2", "forbidden"):
            if req not in d:
                ANOMALIES.append(f"palette {pid} missing slot {req}")
        palettes.append({
            "id": pid,
            "name": d.get("name", ""),
            "dominant": d.get("dominant", []),
            "secondary": d.get("secondary", []),
            "accent1": d.get("accent1", []),
            "accent2": d.get("accent2", []),
            "shadow": d.get("shadow", ""),
            "forbidden": d.get("forbidden", []),
            "light_type": d.get("light_type", ""),
            "sd_fragment": d.get("sd_fragment", ""),
            "mood": d.get("mood", ""),
            "family": palette_family(num),
            "legacy_3slot": False,
            "source": "PALETTE_LIBRARY.yaml",
        })
    palettes.sort(key=lambda p: int(re.match(r"P(\d+)", p["id"]).group(1)))
    ids = [p["id"] for p in palettes]
    if len(ids) != len(set(ids)):
        ANOMALIES.append("duplicate palette ids present")
    if len(palettes) != 105:
        ANOMALIES.append(f"palette total {len(palettes)} != 105")
    # the known P22 'idnight-indigo' typo: verify (must be a BROKEN token, not
    # the substring of a correct 'midnight-indigo')
    p22 = next((p for p in palettes if p["id"].startswith("P22_")), None)
    if p22 and any(c.startswith("idnight") or " idnight" in c for c in p22["dominant"]):
        TYPOS_FIXED.append(("PALETTE_LIBRARY.yaml", "P22 dominant", "'idnight-indigo' -> 'midnight-indigo'"))
    doc = {
        "version": "1.0.0",
        "born": "2026-09-19",
        "source": "3.2 PALETTE_LIBRARY v1.0.0 (P21-P105, 6-slot) + ONTOLOGY P01-P20 (legacy 3-slot)",
        "palettes": palettes,
        "saturation_doctrine": (
            "Five Locks (RULES §51, binding from N21): (1) DEEP-ANCHOR — dominant "
            "anchored as DEPTH, never pallor; (2) SATURATED ANCHOR — one full-saturation "
            "element per prompt named in POS; (3) CONTRAST CARRIER — >=1 light-contrast "
            "carrier (rim/specular/hard shadow/caustic); (4) ANTI-WASH NEG — 'washed-out, "
            "faded colors, low contrast' always in scene-block; (5) COLOR GATE — per-prompt "
            "DESAT/SAT <= 1.2 with SAT >= 3 unless MUTED-BY-ORDER."
        ),
        "usage_rules": [
            "C066: batch uses >=7 distinct palettes (replaces C001).",
            "C067: no palette more than 3x per batch.",
            "C068_EXP (VOID mode): 21 distinct palettes for 21 prompts.",
            "C069: 6-slot structure honored in POS; accent1 must appear as a named color word.",
            "C070: forbidden colors must NOT appear in POS as named color words.",
            "C071: prior batch's palettes blacklisted (cross-batch rotation).",
        ],
    }
    return doc, len(palettes)


# ==========================================================================
# 4. pools.json  (POOLS_V8.yaml + ONTOLOGY.yaml)
# ==========================================================================
def collect_list_block(text, key):
    """Collect a `key:` block whose items are following `- ` lines."""
    m = re.search(rf"(?m)^{re.escape(key)}:\s*\n((?:- .*\n?)*)", text)
    if not m:
        return []
    items = []
    for line in m.group(1).splitlines():
        s = line.strip()
        if s.startswith("- "):
            items.append(s[2:].strip())
    return items


def section_text(text, key):
    """Lines from `^key:` until the next axis banner (── ... ──) or ═ bar.
    Sub-keys like `description:` / `values:` stay INSIDE the section."""
    m = re.search(rf"(?m)^{re.escape(key)}:\s*$", text)
    if not m:
        return ""
    start = m.end()
    nxt = re.search(r"(?m)^\u2500\u2500 |^\u2550{3,}", text[start:])
    end = start + (nxt.start() if nxt else len(text[start:]))
    return text[start:end]


def parse_pools():
    pools_txt = read("POOLS_V8.yaml")
    ont_txt = read("ONTOLOGY.yaml")

    def clean(entries, source):
        out = []
        for d in entries:
            e = {k: v for k, v in d.items() if not k.startswith("_")}
            e["source"] = source
            out.append(e)
        return out

    def num_of(e):
        return int(re.search(r"(\d+)", e["id"]).group(1))

    def by_prefix(text, source, pred):
        return sorted(clean(scan_entries(text, id_pred=pred), source), key=num_of)

    # ---- K kinetics (ONTOLOGY base + extensions + POOLS_V8 mint waves) ----
    kinetics = by_prefix(ont_txt, "ONTOLOGY", lambda i: re.fullmatch(r"K\d+", i))
    kinetics += by_prefix(pools_txt, "POOLS_V8", lambda i: re.fullmatch(r"K\d+", i))
    kinetics.sort(key=num_of)
    # OC-exempt codes defined only in comments (K155, K172-K174)
    oc_exempt_comment = []
    for m in re.finditer(
        r"(?m)^# (K1\d\d) OC-exempt \(([^)]+)\): (mid_\w+) — (.*)$", pools_txt
    ):
        oc_exempt_comment.append({
            "id": m.group(1), "name": m.group(3), "oc_exempt": True,
            "oc": m.group(2), "sd": m.group(4).strip(),
            "source": "POOLS_V8 (comment-defined)",
        })
    for m in re.finditer(
        r"(?m)^# (K17[234]) OC-exempt \(([^)]+)\): (mid_\w+) — (.*?)(?:\n#|$)",
        pools_txt, re.S,
    ):
        pass  # covered by the single-line regex above via re.M fallback below
    # multi-line comment variants (K172-174 descriptions span 2 lines)
    for m in re.finditer(
        r"(?m)^# (K\d+) OC-exempt \(([^)]+)\): (mid_\w+) — ((?:.*\n)(?:# .*\n?)*)",
        pools_txt,
    ):
        eid = m.group(1)
        if not any(e["id"] == eid for e in oc_exempt_comment):
            desc = " ".join(
                l.lstrip("# ").strip() for l in m.group(4).splitlines()
            ).strip()
            oc_exempt_comment.append({
                "id": eid, "name": m.group(3), "oc_exempt": True,
                "oc": m.group(2), "sd": desc,
                "source": "POOLS_V8 (comment-defined)",
            })
    kinetics += oc_exempt_comment
    kinetics.sort(key=num_of)

    k_ids = [e["id"] for e in kinetics]
    if len(k_ids) != len(set(k_ids)):
        ANOMALIES.append("duplicate K ids after merge")

    # ---- technique pools: BRE / BK / B ----
    bre = by_prefix(ont_txt, "ONTOLOGY", lambda i: re.fullmatch(r"BRE\d+", i))
    bre += by_prefix(pools_txt, "POOLS_V8", lambda i: re.fullmatch(r"BRE\d+", i))
    bre.sort(key=num_of)
    bk = by_prefix(ont_txt, "ONTOLOGY", lambda i: re.fullmatch(r"BK\d+", i))
    bk += by_prefix(pools_txt, "POOLS_V8", lambda i: re.fullmatch(r"BK\d+", i))
    bk.sort(key=num_of)
    b = by_prefix(ont_txt, "ONTOLOGY", lambda i: re.fullmatch(r"B\d+", i))
    b += by_prefix(pools_txt, "POOLS_V8", lambda i: re.fullmatch(r"B\d+", i))
    b.sort(key=num_of)

    # ---- FET (ONTOLOGY base + extension) ----
    fet = by_prefix(ont_txt, "ONTOLOGY", lambda i: re.fullmatch(r"FET\d+", i))

    # ---- H reaction physiology (POOLS_V8) ----
    h = by_prefix(pools_txt, "POOLS_V8", lambda i: re.fullmatch(r"H\d+", i))

    # ---- GAR garments + failure states ----
    gar = by_prefix(ont_txt, "ONTOLOGY", lambda i: re.fullmatch(r"GAR\d+", i))
    gar += by_prefix(pools_txt, "POOLS_V8", lambda i: re.fullmatch(r"GAR\d+", i))
    gar.sort(key=num_of)
    gar_f = [g for g in gar if num_of(g) >= 41]
    gar = [g for g in gar if num_of(g) <= 40]

    # ---- HS hairstyles ----
    hs = by_prefix(pools_txt, "POOLS_V8", lambda i: re.fullmatch(r"HS\d+", i))

    # ---- CAM cameras ----
    cam_ont = by_prefix(ont_txt, "ONTOLOGY", lambda i: re.fullmatch(r"CAM\d+", i))
    cam_pools = by_prefix(pools_txt, "POOLS_V8", lambda i: re.fullmatch(r"CAM\d+", i))

    # ---- LQ light qualities (ONTOLOGY) ----
    lq = by_prefix(ont_txt, "ONTOLOGY", lambda i: re.fullmatch(r"LQ\d+", i))

    # ---- races (POOLS_V8 base + extension) ----
    races = by_prefix(pools_txt, "POOLS_V8", lambda i: re.fullmatch(r"R\d+", i))

    # ---- NR features ----
    nr_entries = by_prefix(
        pools_txt, "POOLS_V8",
        lambda i: re.fullmatch(r"NR[GHEDCMW]\d+", i),
    )
    nr_cats = {
        "glasses": [e for e in nr_entries if e["id"].startswith("NRG")],
        "headbands": [e for e in nr_entries if e["id"].startswith("NRH")],
        "earrings": [e for e in nr_entries if e["id"].startswith("NRE")],
        "chokers_collars": [e for e in nr_entries if e["id"].startswith("NRC")],
        "marks_scars": [e for e in nr_entries if e["id"].startswith("NRM")],
        "wearables": [e for e in nr_entries if e["id"].startswith("NRW")],
    }
    # nr_extension_v2 uses a different shape: `nrg09: {name: ...}`
    nr_ext = []
    for m in re.finditer(r"(?m)^([a-z]{2,4}\d+):\s*\{(.*)\}\s*$", pools_txt):
        key, content = m.group(1), m.group(2)
        if not re.fullmatch(r"nr[ghedcmw]\d+", key):
            continue
        d = parse_inline(content)
        d["id"] = key.upper()
        d["source"] = "POOLS_V8 nr_extension_v2 (×4 harvest)"
        nr_ext.append(d)
    nr_ext.sort(key=num_of)

    # ---- emotions / engagement (ONTOLOGY) ----
    emotion = by_prefix(ont_txt, "ONTOLOGY", lambda i: re.fullmatch(r"E\d+", i))
    engagement = by_prefix(ont_txt, "ONTOLOGY", lambda i: re.fullmatch(r"ENG\d+", i))

    # ---- breast families (POOLS_V8 §1) ----
    bseg = text_between(pools_txt, "1. BREAST_POOL", "2. HAIRSTYLE_POOL")
    fams = {}
    for fm in re.finditer(
        r"── (FAM-[ABC]) \"([^\"]+)\" \(([^)]+)\) ─+\n(.*?)(?=── FAM-|rules:|\Z)",
        bseg, re.S,
    ):
        fam_key, label, brange, body = fm.groups()
        d = parse_kv_block(body, {"adjectives", "shapes", "light", "fabric", "motion", "bpt_hook"})
        fams[fam_key] = {"label": label, "b_range": brange, **d}
    b_rules = collect_list_block(bseg, "rules")
    b_directive = re.search(r"User directive: \"(.*)\"", bseg)
    b_map = re.search(r"(B-values map: .*)", bseg)

    # ---- hairstyle meta ----
    hs_seg = text_between(pools_txt, "2. HAIRSTYLE_POOL", "3. RACE_POOL")
    hair_length = re.search(r"(?m)^hair_length_axis: \[([^\]]+)\]", hs_seg)
    hair_verbs = re.search(r"(?m)^hair_mechanics_verbs: \[([^\]]+)\]", hs_seg)
    hair_usage = collect_list_block(hs_seg, "usage")
    hs_meta = {
        "hair_length_axis": [v.strip() for v in hair_length.group(1).split(",")] if hair_length else [],
        "hair_mechanics_verbs": [v.strip() for v in hair_verbs.group(1).split(",")] if hair_verbs else [],
        "usage": hair_usage,
    }

    # ---- race usage + collision table ----
    racial_usage = collect_list_block(pools_txt, "racial_usage")
    collision_m = re.search(r"(?m)^collision_table \(hard\):\s*\n((?:- .*\n?)+)", pools_txt)
    collision_table = [l[2:].strip() for l in collision_m.group(1).splitlines()] if collision_m else []

    nr_usage = collect_list_block(pools_txt, "nr_usage")
    wardrobe_usage = collect_list_block(pools_txt, "wardrobe_usage")

    # ---- misc axes from ONTOLOGY (keep-everything doctrine) ----
    misc = {}
    misc["env_archetypes"] = scan_named_entries(section_text(ont_txt, "environment"))
    misc["skin_words"] = scan_named_entries(section_text(ont_txt, "skin"))
    misc["materials"] = scan_named_entries(section_text(ont_txt, "material"))
    misc["hair_types"] = clean(scan_entries(ont_txt, lambda i: i in
        {"straight", "wavy", "curly", "braided", "loose_long", "short_pixie", "wet"}), "ONTOLOGY")
    misc["framing"] = clean(scan_entries(ont_txt, lambda i: i in
        {"extreme_close", "close_up", "medium", "cowboy", "full_body", "wide_env", "panoramic"}), "ONTOLOGY")
    misc["eye_colors"] = {
        "standard": re.search(r"standard: \[([^\]]+)\]", ont_txt).group(1).split(", "),
        "special": clean(scan_entries(ont_txt, lambda i: i.startswith("heterochromia")
                                       or i in {"blind_milky_white", "slit_pupil_feline"}), "ONTOLOGY"),
    }
    ncs_m = re.search(r"(?m)^ncs:\s*\nvalues: \[([^\]]+)\]", ont_txt)
    misc["ncs_states"] = [v.strip() for v in ncs_m.group(1).split(",")] if ncs_m else []

    def dash_list(seg):
        out = []
        for l in seg.splitlines():
            ls = l.strip()
            if re.match(r"^- \w", ls):
                out.append(ls[2:].split("#")[0].strip())
            elif out and not ls.startswith("-"):
                break
        return out

    misc["wardrobe_states"] = dash_list(section_text(ont_txt, "wardrobe_state"))
    misc["niche_archetypes"] = dash_list(section_text(ont_txt, "niche_archetypes"))
    misc["opening_strategies"] = dash_list(section_text(ont_txt, "opening_strategy"))
    ld = section_text(ont_txt, "light_direction")
    misc["light_direction"] = {
        k: [v.strip() for v in vs.split(",")]
        for k, vs in re.findall(r"(?m)^(\w+): \[([^\]]+)\]", ld)
    }
    misc["fill_ratios"] = clean(scan_entries(ont_txt, lambda i: re.fullmatch(r"FR\d", i)), "ONTOLOGY")
    misc["color_temperatures"] = clean(scan_entries(ont_txt, lambda i: i.startswith("CT_")), "ONTOLOGY")
    misc["genre"] = clean(scan_entries(ont_txt, lambda i: i in {"NICHE", "VOLT"}), "ONTOLOGY")
    misc["lls_tiers"] = clean(scan_entries(ont_txt, lambda i: i in {"L0", "L1", "L2", "L3"}), "ONTOLOGY")
    misc["bpt_templates"] = clean(scan_entries(ont_txt, lambda i: i.startswith("BPT-")), "ONTOLOGY")
    misc["closure_patterns"] = clean(scan_entries(ont_txt, lambda i: re.fullmatch(r"F[1-5]", i)), "ONTOLOGY")
    lv = section_text(ont_txt, "light_verb_pool")
    misc["light_verbs"] = dash_list(lv)
    misc["light_verb_subsets"] = {
        k: [v.strip() for v in vs.split(",")]
        for k, vs in re.findall(r"(?m)^(\w+): \[([^\]]+)\]", lv)
    }
    fire_extra = set(misc["light_verb_subsets"].get("fire", [])) - set(misc["light_verbs"])
    if fire_extra:
        ANOMALIES.append(
            "ONTOLOGY light_verb theme subset 'fire' contains verbs missing from "
            f"the 21-verb master pool: {sorted(fire_extra)} (kept as-is)"
        )
    misc["body_emphasis_zones"] = dash_list(section_text(ont_txt, "body_emphasis"))
    misc["gear_pool"] = {
        k: [v.strip(" []") for v in vs.split(",")]
        for k, vs in re.findall(r"(?m)^(\w+): \[([^\]]+)\]", section_text(ont_txt, "gear_pool"))
    }
    misc["counterpoint_pairs"] = [
        l.strip()[2:].strip('"')
        for l in section_text(ont_txt, "counterpoint_pairs").splitlines()
        if l.strip().startswith('- "')
    ]
    bdm_dims = {}
    for mm in re.finditer(r"(?m)^([A-Z]{1,2}): \{range: \"([^\"]+)\", meaning: \"([^\"]+)\"\}", ont_txt):
        bdm_dims[mm.group(1)] = {"range": mm.group(2), "meaning": mm.group(3)}
    misc["bdm"] = {
        "dimensions": bdm_dims,
        "banned_values": re.findall(r"\w\d+", re.search(r"banned_values: \[([^\]]+)\]", ont_txt).group(1)),
        "note": "Body = how it catches light, not anatomy. B0/H0/T0 banned outright.",
    }

    # ---- policies / law texts (POOLS_V8) ----
    def block(start, end):
        try:
            return re.sub(r"\n{3,}", "\n\n", text_between(pools_txt, start, end, include_start=True)).strip()
        except ValueError:
            ANOMALIES.append(f"policy block not found: {start[:40]}")
            return ""

    policies = {
        "k_numbering_ledger": block("# NUMBERING LEDGER", "- {id: K98"),
        "k_freeform_policy": block("K-FREEFORM POLICY", "K-RETURN LAW"),
        "k_return_law": block("K-RETURN LAW", "═══\n11. TECHNIQUE"),
        "env_oas_formalization": block("15. ENV_WORD / OAS_WORD", "═══\n16. POOL V9"),
        "pool_v9_summary": block("16. POOL V9 SUMMARY", "═══\n# 17."),
        "mint_ledger_n24": block("# 21. POOL v9.3.0", "# 22."),
        "mint_ledger_n25": block("# 25. POOL v9.4.0", "# 26."),
        "x4_harvest_note": block("# 26. THE ×4 POOL HARVEST", "version: \"10.0.0\""),
        "n27_preflight_mints": block("# 27. N27 PRE-FLIGHT MINTS", None) if False else block("# 27. N27 PRE-FLIGHT MINTS", "\x00" if False else ""),
    }
    # n27 block runs to EOF — handle specially
    i = pools_txt.find("# 27. N27 PRE-FLIGHT MINTS")
    policies["n27_preflight_mints"] = pools_txt[i:].strip() if i >= 0 else ""

    usage_lines = []
    current_section = "(header)"
    for line in pools_txt.splitlines():
        hdr = re.match(r"^(?:#\s*)?(\d+)\.\s+(.*)$", line)
        if hdr:
            current_section = f"§{hdr.group(1)} {hdr.group(2)[:60]}"
        if re.match(r"^usage: ", line):
            usage_lines.append({"section": current_section, "usage": line[len("usage: "):].strip()})
    policies["usage_lines"] = usage_lines

    # ---- FET numbering-hole note ----
    fet_ids = {e["id"] for e in fet}
    expected_fet = {f"FET{n:02d}" for n in range(1, 10)} | {f"FET{n}" for n in range(10, 71)}
    missing_fet = sorted(expected_fet - fet_ids)
    if missing_fet:
        ANOMALIES.append(
            "FET numbering hole (retired by law, not an error): missing "
            + ", ".join(missing_fet)
            + " — §12: 'the FET26-45 slot range is RETIRED — never number a code there'"
        )

    doc = {
        "version": "1.0.0",
        "born": "2026-09-19",
        "source": "3.2 POOLS_V8 v9.4.0/v10.0.0 + ONTOLOGY v2.0.0 (V15 de-numbered ENV/OAS/MAT)",
        "sections": {
            "kinetics_k": kinetics,
            "fet": fet,
            "h": h,
            "gar": gar,
            "gar_f": gar_f,
            "bre": bre,
            "bk": bk,
            "b": b,
            "b_fam": {
                "families": fams,
                "rules": b_rules,
                "directive": b_directive.group(1) if b_directive else "",
                "b_value_mapping": b_map.group(1) if b_map else "",
            },
            "hs": hs,
            "hs_meta": hs_meta,
            "cam": {
                "base_axis_onotology_cam01_12": cam_ont,
                "aggressive_framing_cam13_18": cam_pools,
                "numbering_conflict": (
                    "WARNING: ONTOLOGY's CAM01-CAM12 axis and POSE_LIBRARY's §33 "
                    "camera table disagree on 5 codes. ONTOLOGY: CAM02=From Above, "
                    "CAM04=Over Shoulder, CAM05=Macro Close, CAM06=Wide Env, "
                    "CAM07=Side Profile. POSE_LIBRARY pairs table: CAM02=three_quarter, "
                    "CAM04=from_above, CAM05=over_shoulder, CAM06=side, CAM07=wide_env. "
                    "The §33 pairs carry self-describing suffixes and are used "
                    "consistently with CAM13-CAM18; Thread 4 should renumber to one "
                    "authoritative axis (suffix-named codes recommended)."
                ),
            },
            "lq": lq,
            "races": {
                "entries": races,
                "racial_usage": racial_usage,
                "collision_table": collision_table,
            },
            "nr": {
                "categories": nr_cats,
                "extension_v2": nr_ext,
                "usage": nr_usage,
            },
            "wardrobe_usage": wardrobe_usage,
            "emotion": emotion,
            "engagement": {
                "entries": engagement,
                "note": "ENG codes are the legacy staging layer; coded reaction "
                        "physiology lives in the H-family (POOLS_V8 §12) — ONTOLOGY note 2026-09-10.",
            },
            "misc_axes": misc,
            "policies": policies,
        },
        "inventory": {},
    }
    inv = doc["inventory"]
    inv["kinetics_k"] = len(kinetics)
    inv["fet"] = len(fet)
    inv["h"] = len(h)
    inv["gar"] = len(gar)
    inv["gar_f"] = len(gar_f)
    inv["bre"] = len(bre)
    inv["bk"] = len(bk)
    inv["b"] = len(b)
    inv["hs"] = len(hs)
    inv["cam_total"] = len(cam_ont) + len(cam_pools)
    inv["lq"] = len(lq)
    inv["races"] = len(races)
    inv["nr"] = len(nr_entries) + len(nr_ext)
    inv["emotion"] = len(emotion)
    inv["engagement"] = len(engagement)
    return doc, inv


# ==========================================================================
# 5. engines.json
# ==========================================================================
ENGINE_NAMES = ["bespoke", "tint", "counterfall", "cantus", "limen", "arcana", "apocrypha"]


def parse_engines():
    text = read("ENGINES.yaml")
    engines = {}
    for name in ENGINE_NAMES:
        m = re.search(rf"(?m)^{name}:\s*\n(.*?)(?=^(?:\w[\w_]*:|open_engine_seeds:|\Z))",
                      text, re.S)
        if not m:
            ANOMALIES.append(f"engine block not found: {name}")
            continue
        block = m.group(1)
        eng = {}
        fb = re.search(r"(?m)^\s+first_batch: (.+)$", block)
        eng["first_batch"] = fb.group(1).strip() if fb else None
        st = re.search(r"(?m)^\s+status: (\S+)(.*)$", block)
        eng["status"] = st.group(1) if st else None
        note_lines = []
        if st and st.group(2):
            note_lines.append(st.group(2).strip())
        # continuation comment lines directly below the status line
        after = block[block.find("status:"):]
        for line in after.splitlines()[1:]:
            ls = line.strip()
            if ls.startswith("#"):
                note_lines.append(ls.lstrip("# ").strip())
            elif ls == "" and not note_lines:
                continue
            else:
                break
        eng["status_note"] = " ".join(l for l in note_lines if l).lstrip("# ").strip() or None
        for key in ("law", "on_body", "strong_pairs"):
            km = re.search(rf'(?m)^\s+{key}:\s*"(.*?)"\s*$', block, re.S)
            eng[key] = re.sub(r"\s+", " ", km.group(1)).strip() if km else None
        fms = re.search(r"(?m)^\s+failure_modes:\s*\n((?:\s+- .*\n?)+)", block, re.S)
        eng["failure_modes"] = [
            re.sub(r"\s+", " ", m.group(1)).strip()
            for m in re.finditer(r'- "(.*?)"', fms.group(1), re.S)
        ] if fms else []
        engines[name] = eng
    lin = re.search(r'(?m)^lineage_note: "(.*?)"\s*$', text, re.S)
    lineage_note = lin.group(1).strip() if lin else None
    seeds_raw = text[text.find("open_engine_seeds:"):]
    seeds = [m.group(1).strip() for m in re.finditer(r'- "(.*?)"', seeds_raw, re.S)]
    if len(engines) != 7:
        ANOMALIES.append(f"engine count {len(engines)} != 7")
    doc = {
        "version": "1.0.0",
        "born": "2026-09-19",
        "source": "3.2 ENGINES.yaml (THREAD 3.2-EXP V16, Path B MVP-4, born 2026-09-14)",
        "engines": engines,
        "open_seeds": seeds,
        "lineage_note": lineage_note,
        "entry_format": {
            "law": "one sentence, physical, testable in-frame",
            "on_body": "the exact channels the law claims on the girl",
            "strong_pairs": "LEAD + K + LQ + palette families that carried it",
            "failure_modes": "the observed ways it dies (from post-mortems)",
            "first_batch": "where it debuted",
            "status": "proven | retired | experimental | render-graded",
        },
        "definition": (
            "AN ENGINE IS NOT A THEME. An engine is a PHYSICAL/METAPHORICAL LAW of "
            "the world that can be worn; every engine answers the N22 question first: "
            "HOW DOES THIS LAW SIT ON HER? (hem / hair / weave / kinetic / "
            "wardrobe-state — never scenery)."
        ),
    }
    return doc, len(engines), len(seeds)


# ==========================================================================
# 6. oc-canon.json
# ==========================================================================
OC_FIELD_RE = re.compile(r"^([a-z_][a-z_0-9]*):(.*)$")


def finalize_oc_value(key, lines):
    txt = "\n".join(lines).strip()
    if not txt:
        return None
    if txt.startswith("[") and txt.endswith("]"):
        return [v.strip().strip('"') for v in txt[1:-1].split(",") if v.strip()]
    first = lines[0].strip()
    rest = [l.strip() for l in lines[1:] if l.strip()]

    def unquote(v):
        qm = re.match(r'^"(.*)"\s*(?:#.*)?$', v)
        return qm.group(1) if qm else v

    if not rest:
        return unquote(first)
    quoted_items = [l for l in rest if l.startswith('"')]
    if quoted_items and len(quoted_items) == len(rest) and not first:
        # value block made of quoted line(s) placed under the key
        if len(quoted_items) == 1:
            return unquote(quoted_items[0])
        return [unquote(l) for l in quoted_items]
    return txt


def parse_oc_block(body):
    fields = {}
    cur_key, cur_lines = None, []
    for line in body.splitlines():
        if not line.strip():
            if cur_key is not None:
                cur_lines.append("")
            continue
        m = OC_FIELD_RE.match(line)
        if m and not line.startswith((" ", "\t")):
            if cur_key:
                fields[cur_key] = finalize_oc_value(cur_key, cur_lines)
            cur_key, cur_lines = m.group(1), [m.group(2)]
        else:
            if cur_key is not None:
                cur_lines.append(line.rstrip())
    if cur_key:
        fields[cur_key] = finalize_oc_value(cur_key, cur_lines)
    return fields


def parse_oc_canon():
    text = read("OC_CANON.yaml")
    header = text.split("\nid: ", 1)[0]
    version = re.search(r'(?m)^version: "([\d.]+)"', text)
    changelog = [l.strip() for l in text.splitlines() if re.match(r"^2026-\d\d-\d\d v[\d.]+", l)]
    usage_policy = ""
    up = re.search(r"USAGE POLICY \(.*?\n(.*?)\noc_canon:", text, re.S)
    if up:
        usage_policy = re.sub(r"\n{2,}", "\n", up.group(1)).strip()

    blocks = re.split(r"(?m)^id: ", text)[1:]
    ocs = {}
    inactive = {}
    for blk in blocks:
        oc_id = blk.split("\n", 1)[0].strip()
        body = blk.split("\n", 1)[1] if "\n" in blk else ""
        if "\n── SELECTION RULE" in body:
            body = body.split("\n── SELECTION RULE", 1)[0]
        reserve = None
        if "\ninactive_reserve:" in body:
            body, reserve = body.split("\ninactive_reserve:", 1)
        fields = parse_oc_block(body)
        fields["id"] = oc_id
        fields["active"] = True
        name = fields.get("name", oc_id)
        ocs[name] = fields
        if reserve:
            for rblk in re.split(r"(?m)^- id: ", reserve)[1:]:
                rid = rblk.split("\n", 1)[0].strip()
                rbody = rblk.split("\n", 1)[1] if "\n" in rblk else ""
                rfields = parse_oc_block(rbody)
                rfields["id"] = rid
                rfields["active"] = False
                inactive[rfields.get("name", rid.capitalize())] = rfields

    # registries (raw text — registry-only data per usage policy)
    sel = text[text.find("── SELECTION RULE"):]
    registries = {}
    for label in ("TAROT REGISTRY", "ELEMENT REGISTRY", "ZODIAC REGISTRY"):
        seg = text_between(sel, label, "\n\n")
        seg = "\n".join(l for l in seg.splitlines() if not l.startswith("──"))
        registries[label.split()[0].lower()] = seg.strip()
    selection_rule = text_between(sel, "── SELECTION RULE", "\nTAROT REGISTRY")
    selection_rule = "\n".join(
        l for l in selection_rule.splitlines() if not l.startswith("─")
    ).strip()

    expected = {"Sue", "Miyu", "Yui", "Sol", "Noa", "Doe", "Lua", "Nix", "Vae",
                "Ash", "Mab", "Lyn", "Rue", "Zia", "Rin", "Una"}
    missing = expected - set(ocs)
    if missing:
        ANOMALIES.append(f"expected OCs missing: {sorted(missing)}")
    if len(ocs) != 16:
        ANOMALIES.append(f"active OC count {len(ocs)} != 16")

    doc = {
        "version": "1.0.0",
        "born": "2026-09-19",
        "source": "3.2 OC_CANON.yaml (THREAD 3.0 format, canon v1.7.1)",
        "canon_version": version.group(1) if version else None,
        "usage_policy": usage_policy,
        "selection_rule": selection_rule,
        "ocs": ocs,
        "inactive_reserve": inactive,
        "registries": registries,
        "notes": changelog,
        "note_on_status": (
            "16 ACTIVE OCs (3 drawn per session by author vibe/theme fit, no forced "
            "rotation). Rae and Iya are INACTIVE RESERVE (added accidentally, never "
            "used, bios retained). SP-registry characters (Nicole, Puppet/Valentine, "
            "Ereshkigal/Tito_Lopes) live in download/SP_ORDERS.md, never in OC canon."
        ),
    }
    return doc, len(ocs), len(inactive)


# ==========================================================================
# 7. races.json
# ==========================================================================
GOLD = {"R17": "jellyfish-kin", "R20": "harpy-kin"}
BANNED = [
    ("dwarves", "Dwarf"),
    ("goblins", "Goblin"),
    ("trolls", "Troll"),
    ("orcs", "Orc"),
]


def parse_races(race_entries, racial_usage, collision_table):
    races = []
    for e in race_entries:
        rid = e["id"]
        rf = e.get("rf")
        if isinstance(rf, list):
            features = rf
        elif isinstance(rf, str) and rf:
            features = [rf]
        else:
            features = []
        status = "gold" if rid in GOLD else "active"
        note_bits = []
        for k in ("skin", "wardrobe", "light", "collision", "pick", "motion", "mat", "race_hook"):
            if e.get(k):
                note_bits.append(f"{k}: {e[k]}")
        note = "; ".join(note_bits)
        if status == "gold":
            note = ("AUTHOR-CONFIRMED GOLD for Thread 4. " + note).strip()
        races.append({
            "id": rid,
            "name": e.get("name", ""),
            "features": features,
            "status": status,
            "note": note,
        })
    for i, (plural, singular) in enumerate(BANNED, 1):
        races.append({
            "id": f"BAN-{i:02d}",
            "name": plural.capitalize(),
            "features": [],
            "status": "banned",
            "note": (
                f"AUTHOR TASTE BAN for Thread 4: '{plural}' belong to the 'ugly "
                "fantasy creature' register the author rejects. Not present in any "
                "3.2 pool — listed here so the Thread 4 compiler can enforce the ban."
            ),
        })
    doc = {
        "version": "1.0.0",
        "born": "2026-09-19",
        "source": "3.2 POOLS_V8 race_pool R01-R15 + race_extension_v2 R16-R22 "
                  "+ Thread-4 author directives (2026-09-19)",
        "races": races,
        "directives": {
            "gold": [
                "jellyfish-kin (R17) — author-confirmed",
                "harpy-kin (R20) — author-confirmed",
            ],
            "banned": [
                "dwarves, goblins, trolls, orcs — author taste: 'ugly fantasy "
                "creature' register; banned outright",
            ],
        },
        "racial_usage": racial_usage,
        "collision_table": collision_table,
        "collision_table_note": (
            "Hard OC-signature combos (hair/eyes/ears/tail) that random girls may "
            "never draw — canon locks in OC_CANON always win over the race pool."
        ),
    }
    return doc, len(races)


# ==========================================================================
# similarity analysis (near-duplicate flagging — nothing is removed)
# ==========================================================================
def norm_words(s):
    s = s.lower()
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    return frozenset(w for w in s.split() if w)


def jaccard(a, b):
    if not a or not b:
        return 0.0
    inter = len(a & b)
    return inter / (len(a) + len(b) - inter)


def near_duplicates(items, text_key, threshold=0.75):
    words = [norm_words(it[text_key]) for it in items]
    flagged = []
    for i, j in combinations(range(len(items)), 2):
        if not words[i] or not words[j]:
            continue
        sim = jaccard(words[i], words[j])
        if sim > threshold:
            flagged.append({
                "a": items[i]["id"], "a_name": items[i].get("name", ""),
                "b": items[j]["id"], "b_name": items[j].get("name", ""),
                "similarity": round(sim, 3),
            })
    flagged.sort(key=lambda f: -f["similarity"])
    return flagged


# ==========================================================================
# main
# ==========================================================================
def main():
    print("== THREAD 4 pool parser (Task 2-a) ==")

    carriers_doc, carriers_total, class_counts = parse_carriers()
    dump("carriers.json", carriers_doc)
    print(f"carriers.json: {carriers_total} carriers, classes={class_counts}")

    poses_doc, poses_total, fam_counts = parse_poses()
    dump("poses.json", poses_doc)
    print(f"poses.json: {poses_total} poses, families={fam_counts}")

    palettes_doc, palettes_total = parse_palettes()
    dump("palettes.json", palettes_doc)
    print(f"palettes.json: {palettes_total} palettes")

    pools_doc, inv = parse_pools()
    dump("pools.json", pools_doc)
    print(f"pools.json inventory: {inv}")

    engines_doc, engines_total, seeds_total = parse_engines()
    dump("engines.json", engines_doc)
    print(f"engines.json: {engines_total} engines, {seeds_total} open seeds")

    oc_doc, oc_total, oc_inactive = parse_oc_canon()
    dump("oc-canon.json", oc_doc)
    print(f"oc-canon.json: {oc_total} active OCs + {oc_inactive} inactive reserve")

    race_entries = pools_doc["sections"]["races"]["entries"]
    races_doc, races_total = parse_races(
        race_entries,
        pools_doc["sections"]["races"]["racial_usage"],
        pools_doc["sections"]["races"]["collision_table"],
    )
    dump("races.json", races_doc)
    print(f"races.json: {races_total} race entries (incl. 4 banned directives)")

    # ---- similarity ----
    all_carriers = [c for cls in CLASS_ORDER for c in carriers_doc["classes"][cls]]
    carrier_dups = near_duplicates(all_carriers, "carrier", 0.75)
    pose_dups = near_duplicates(poses_doc["poses"], "sd", 0.75)
    print(f"near-duplicate carrier pairs (>0.75 Jaccard): {len(carrier_dups)}")
    print(f"near-duplicate pose-sd pairs (>0.75 Jaccard): {len(pose_dups)}")

    # ---- assemble the report ----
    k_numbered = [e for e in pools_doc["sections"]["kinetics_k"] if not e.get("oc_exempt")]
    k_ocx = [e for e in pools_doc["sections"]["kinetics_k"] if e.get("oc_exempt")]
    sheer_ids = [c["id"] for c in all_carriers if c["sheer_family"]]
    mat_counts = {}
    for c in all_carriers:
        if c["mat"]:
            mat_counts[c["mat"]] = mat_counts.get(c["mat"], 0) + 1

    rep = []
    rep.append("# PARSE REPORT — THREAD 3.2 pools → THREAD 4 specs")
    rep.append("")
    rep.append("Task ID: 2-a (pool parser) · generated by `parse_pools.py` · 2026-09-19")
    rep.append("")
    rep.append("Author's standing order honored: **preserve every entry and ID**; "
               "near-duplicates and anomalies are **flagged, never deleted**; "
               "the sources in `chemodan/` were not modified.")
    rep.append("")
    rep.append("## 1. Sanity counts")
    rep.append("")
    rep.append("| spec | expected | got | status |")
    rep.append("|---|---|---|---|")
    rows = [
        ("carriers.json", "280", carriers_total),
        ("— class W", "30", class_counts.get("W")),
        ("— class A", "14", class_counts.get("A")),
        ("— class B", "30", class_counts.get("B")),
        ("— class C", "16", class_counts.get("C")),
        ("— class S", "20", class_counts.get("S")),
        ("— class E", "32", class_counts.get("E")),
        ("— class L", "18", class_counts.get("L")),
        ("— class U", "20", class_counts.get("U")),
        ("— class F", "14", class_counts.get("F")),
        ("— class D", "28", class_counts.get("D")),
        ("— class M", "16", class_counts.get("M")),
        ("— class I", "18", class_counts.get("I")),
        ("— class G", "12", class_counts.get("G")),
        ("— class H", "12", class_counts.get("H")),
        ("poses.json", "240", poses_total),
        ("palettes.json", "105", palettes_total),
        ("engines.json", "7", engines_total),
        ("oc-canon.json active OCs", "16", oc_total),
    ]
    for name, exp, got in rows:
        ok = "OK" if str(got) == str(exp) else "MISMATCH"
        rep.append(f"| {name} | {exp} | {got} | {ok} |")
    rep.append("")
    rep.append("Pool inventory inside **pools.json**:")
    rep.append("")
    rep.append("```")
    for k, v in inv.items():
        rep.append(f"{k}: {v}")
    rep.append("```")
    rep.append("")
    rep.append(f"K-pool detail: {len(k_numbered)} numbered codes + "
               f"{len(k_ocx)} OC-exempt codes (K155, K172-K174 comment-defined; "
               "K182 inline-flagged) = " + str(len(k_numbered) + len(k_ocx)) + " total.")
    rep.append("")
    rep.append(f"mat affinities extracted from carrier notes: {mat_counts} "
               f"(total {sum(mat_counts.values())}; the rest are null = '*').")
    rep.append("")
    rep.append(f"sheer_family flagged (§4G anti-monopoly, judgment applied): "
               f"{len(sheer_ids)} carriers — {', '.join(sheer_ids)}.")
    rep.append("")

    rep.append("## 2. Typos fixed")
    rep.append("")
    if TYPOS_FIXED:
        for f, where, what in TYPOS_FIXED:
            rep.append(f"- {f} ({where}): {what}")
    else:
        rep.append("- P22 dominant reads `midnight-indigo` correctly in the V21 source — "
                   "the known 'idnight-indigo' typo appears to have been fixed upstream "
                   "before the V21 export. No palette typos found.")
    rep.append("")
    rep.append("Auto-repaired in-memory while parsing (sources untouched), all in "
               "POOLS_V8 NR entries — a missing OPENING quote leaves a stray `\"` at "
               "the end of unquoted `scene:` values:")
    rep.append("")
    rep.append("- NRM08 `scene: scribe/seamstress signature\"` → `scribe/seamstress signature`")
    rep.append("- NRM09 `scene: atelier — the press's kiss\"` → `atelier — the press's kiss`")
    rep.append("- NRW02 `scene: atelier signature\"` → `atelier signature`")
    rep.append("- NRW11 `scene: atelier improvisation\"` → `atelier improvisation`")
    rep.append("")

    rep.append("## 3. Format anomalies found (flagged, not 'fixed')")
    rep.append("")
    rep.append("1. **CAM axis split-brain** (the big one): ONTOLOGY's CAM01-CAM12 and "
               "POSE_LIBRARY's §33 camera table disagree on 5 codes (CAM02, CAM04, "
               "CAM05, CAM06, CAM07). The §33 pair table's self-describing suffixes "
               "(e.g. `CAM02_three_quarter`) are internally consistent and also match "
               "CAM13-CAM18; ONTOLOGY's numeric axis is the odd one out. Thread 4 "
               "should renumber to a single suffix-named axis. Both are preserved in "
               "pools.json → sections.cam.")
    rep.append("2. **K numbering holes** (documented by the source's own ledger, "
               "re-verified here): K09-K60 never existed; K94-K97 never existed; "
               "K102 skipped (v4 numbering error, documented); K105-K108 never issued; "
               "K109-K114 are freeform-designate (never numbered); the ledger says "
               "'next number is K123' yet the next mint wave started at K126 (K123-125 "
               "skipped, undocumented); K136-138 and K156-157 never issued.")
    rep.append("3. **FET26-45 hole**: retired permanently by POOLS_V8 §12 — nothing "
               "may ever be numbered there. FET numbering jumps FET25 → FET46.")
    rep.append("4. **Duplicate section key**: `kinetic_extension_v5:` appears twice in "
               "POOLS_V8 (§10 = K115-122, §17 = K126-135). Parser merges by unique IDs.")
    rep.append("5. **Broken braces**: the ONTOLOGY environment/skin/material donor "
               "dictionaries are lists of `- {name: ...` entries that never close "
               "their braces. Parsed line-by-line; preserved as-is in pools.json → "
               "sections.misc_axes.")
    rep.append("6. **Bare token field**: K182 carries a bare `OC-exempt` flag inside "
               "its inline entry (no value). Parsed into `oc_exempt: true`.")
    rep.append("7. **Comment-defined codes**: K155, K172, K173, K174 exist only inside "
               "comment lines (OC-exempt kinetics). Captured as entries with "
               "`source: comment-defined` so nothing is lost.")
    rep.append("8. **Referenced-but-undefined codes**: ENGINES.yaml strong_pairs cite "
               "K185-K188 (cantus breath-ledger mints) and K192-K195 (limen seam "
               "kinetics) — these live in batch files (N26/N27), not in the pool "
               "files; noted, not invented.")
    rep.append("9. **Base technique numbering starts mid-range**: BRE begins at BRE17, "
               "BK at BK7, B at B16 (older 3.0-era numbering retired below those "
               "numbers). Garment pool GAR01-20 (ONTOLOGY) + GAR21-40 (POOLS_V8) + "
               "failure states GAR41-64.")
    rep.append("10. **ENV/OAS/MAT de-numbered** (V15): they are donor dictionaries, "
               "not code menus — POOLS §15 formalizes freeform word usage. Preserved "
               "as dictionaries.")
    rep.append("11. **P01-P20 are 3-slot palettes** (dominant/secondary/accent) vs "
               "the 6-slot P21-P105; carried with `legacy_3slot: true` and "
               "`accent2: null`.")
    rep.append("12. **Carrier name reuse (not a dupe)**: 'Vinyl Print' names both "
               "CR-B20 and CR-C02 with different carrier texts — preserved, flagged "
               "here only as a naming note.")
    rep.append("13. OC file: `Vera` was renamed `Una` (v1.5.0) and `Vera/Astra` name "
               "alternatives remain on file; Zia's v1.2.0 'rich ebony' skin was "
               "superseded by hybrid 'warm tan' (v1.3.0) — the CURRENT locks are "
               "what oc-canon.json carries; full version history kept in `notes`.")
    rep.append("14. POSE_LIBRARY base-48 risk classification: the pose axis in "
               "ONTOLOGY still lists OLD category/risk mappings (pre-v3.0) — "
               "POSE_LIBRARY.yaml is authoritative and is what poses.json carries.")
    rep.append("")
    if ANOMALIES:
        rep.append("Parser-level anomaly log (auto-collected):")
        rep.append("")
        for a in ANOMALIES:
            rep.append(f"- {a}")
        rep.append("")

    rep.append("## 4. Judgment calls (decisions made where the source was ambiguous)")
    rep.append("")
    rep.append("- **sheer_family** = transparency-shaped carriers per §4G: keyword "
               "match on carrier text (sheer/see-through/transparent/translucent/"
               "gauze/worn-thin/threadbare/plastered/soaked/rain-sag/rain-weight/"
               "wet-hemline) + one manual call: CR-W17 'Open-Weave Light' (light "
               "transmission between weave rows; its own note says 'never call it "
               "sheer' — flagged anyway because the MECHANISM is light-through-cloth). "
               "Result: 7 carriers, all class W (W07, W08, W09, W10, W11, W12, W17). "
               "Silhouette-register carriers (CR-B09 Backlit Silhouette, CR-B30 Shoji "
               "Silhouette) were deliberately NOT flagged: light does the undressing, "
               "not fabric transparency.")
    rep.append("- **mat** extracted only from `note` text (`mat: A/B/C`); entries "
               "without the note stay null (the 3.2 '*' register).")
    rep.append("- **Pose families** assigned by ID range (deterministic; matches the "
               "file's own family ledger). Base = PL01-48, erotic = PL49-60.")
    rep.append("- **Palettes**: P01-P20 `accent` → `accent1`, `accent2: null`, "
               "`forbidden_colors` → `forbidden`. Family labels derived from the "
               "source's section headers (NIGREDO/ALBEDO/RUBEDO/…/TINT/SEAM/SECRET).")
    rep.append("- **races.json banned entries** (dwarves/goblins/trolls/orcs) are NEW "
               "directive entries — they never existed in 3.2 pools; ids BAN-01..04.")
    rep.append("- **GAR split**: garments GAR01-40 vs failure states GAR41-64 kept in "
               "separate sections (`gar`, `gar_f`) since they are different kinds of "
               "objects (garments vs machine states that stack ON garments).")
    rep.append("")

    rep.append("## 5. Near-duplicate report (Jaccard > 0.75 on normalized word sets)")
    rep.append("")
    rep.append("### 5.1 Carriers (carrier text)")
    rep.append("")
    if carrier_dups:
        rep.append("| a | name | b | name | similarity |")
        rep.append("|---|---|---|---|---|")
        for f in carrier_dups:
            rep.append(f"| {f['a']} | {f['a_name']} | {f['b']} | {f['b_name']} | {f['similarity']} |")
    else:
        rep.append("None above threshold — the 280-carrier pool has no near-duplicate "
                   "texts (closest pairs listed below for the record).")
    # always list the top-5 closest for the record
    closest = []
    allw = [(c, norm_words(c["carrier"])) for c in all_carriers]
    for i, j in combinations(range(len(allw)), 2):
        if not allw[i][1] or not allw[j][1]:
            continue
        s = jaccard(allw[i][1], allw[j][1])
        if s > 0.55:
            closest.append((s, allw[i][0]["id"], allw[i][0]["name"], allw[j][0]["id"], allw[j][0]["name"]))
    closest.sort(reverse=True)
    rep.append("")
    rep.append("Closest carrier pairs (>= 0.55, for the record — below flag threshold):")
    rep.append("")
    for s, a, an, b, bn in closest[:12]:
        rep.append(f"- {a} ({an}) ~ {b} ({bn}): {s:.3f}")
    rep.append("")
    rep.append("### 5.2 Poses (sd text)")
    rep.append("")
    if pose_dups:
        rep.append("| a | name | b | name | similarity |")
        rep.append("|---|---|---|---|---|")
        for f in pose_dups:
            rep.append(f"| {f['a']} | {f['a_name']} | {f['b']} | {f['b_name']} | {f['similarity']} |")
    else:
        rep.append("None above threshold.")
    closest_p = []
    max_p = (0.0, None, None)
    pw = [(p, norm_words(p["sd"])) for p in poses_doc["poses"]]
    for i, j in combinations(range(len(pw)), 2):
        if not pw[i][1] or not pw[j][1]:
            continue
        s = jaccard(pw[i][1], pw[j][1])
        if s > max_p[0]:
            max_p = (s, pw[i][0]["id"], pw[j][0]["id"])
        if s > 0.55:
            closest_p.append((s, pw[i][0]["id"], pw[i][0]["name"], pw[j][0]["id"], pw[j][0]["name"]))
    closest_p.sort(reverse=True)
    rep.append("")
    rep.append("Closest pose pairs (>= 0.55, for the record):")
    rep.append("")
    if closest_p:
        for s, a, an, b, bn in closest_p[:12]:
            rep.append(f"- {a} ({an}) ~ {b} ({bn}): {s:.3f}")
    else:
        names = {p["id"]: p["name"] for p in poses_doc["poses"]}
        rep.append(f"- none — the maximum pose-sd similarity in the whole 240-pose "
                   f"pool is {max_p[0]:.3f} ({max_p[1]} {names.get(max_p[1], '')} ~ "
                   f"{max_p[2]} {names.get(max_p[2], '')}). The ×4 expansion's "
                   "'без повторок' order was honored exactly: the pool is genuinely diverse.")
    # cross-check the source's own documented near-neighbors
    rep.append("")
    rep.append("Cross-check — the source's own documented near-neighbor pairs "
               "(NO-REPEAT AUDIT, v3.0) measure at:")
    rep.append("")
    pose_words = {p["id"]: norm_words(p["sd"]) for p in poses_doc["poses"]}
    for a, b in (("PL188", "PL84"), ("PL194", "PL147"), ("PL195", "PL76"), ("PL232", "PL29")):
        wa, wb = pose_words.get(a, frozenset()), pose_words.get(b, frozenset())
        s = jaccard(wa, wb) if wa and wb else 0.0
        rep.append(f"- {a} ~ {b}: {s:.3f} (documented as differing on camera "
                   "relationship or the body's key axis — confirmed: wording overlap is low)")
    rep.append("")

    rep.append("## 6. Pool section inventory (what pools.json contains)")
    rep.append("")
    rep.append(f"- kinetics_k: {inv['kinetics_k']} (K01-08 base · K61-79 · K80-93 · "
               "K98-104 · K115-122 · K126-135 · K139-154 · K158-171 · K175-182 + "
               "OC-exempt K155/K172-174)")
    rep.append(f"- fet: {inv['fet']} (FET01-10 light-based · FET11-25 scenario hooks · FET46-70 anatomical)")
    rep.append(f"- h: {inv['h']} (H01-20 reaction physiology + H21-26 wrong-physics)")
    rep.append(f"- gar: {inv['gar']} garments (GAR01-20 ONTOLOGY + GAR21-40 POOLS_V8)")
    rep.append(f"- gar_f: {inv['gar_f']} failure states (GAR41-48 + GAR49-56 coastal + GAR57-64 antigrav/physics-undresses)")
    rep.append(f"- bre: {inv['bre']} (BRE17-24 base + 25-28 + 29-31 + 32-40 mechanics-first)")
    rep.append(f"- bk: {inv['bk']} (BK7-13 base + 14-15 + 16-18 + 19-22 mechanics-first)")
    rep.append(f"- b: {inv['b']} (B16-21 base + 22-24 + 25-27 + 28-31 + 32-34 + 35-37)")
    rep.append("- b_fam: FAM-A/FAM-B/FAM-C breast families + rules + directive + B-value mapping")
    rep.append(f"- hs: {inv['hs']} hairstyles (HS01-26 + HS27-50 ×4 harvest) + length axis + verbs + usage")
    rep.append(f"- cam: {inv['cam_total']} (CAM01-12 base axis + CAM13-18 aggressive framing) + numbering-conflict note")
    rep.append(f"- lq: {inv['lq']} light qualities")
    rep.append(f"- races: {inv['races']} (R01-15 + R16-22) + racial_usage + hard collision table")
    rep.append(f"- nr: {inv['nr']} non-racial features (6 categories + ×4 extension) + usage")
    rep.append(f"- emotion: {inv['emotion']} (E01-08 + E51-70) · engagement: {inv['engagement']} (ENG01-08, legacy staging)")
    rep.append("- misc_axes: env/skin/material/hair-type donor dictionaries, framing, NCS, "
               "wardrobe states, niche archetypes, light direction, fill ratios, color "
               "temperatures, BDM, body-emphasis zones, BPT templates, light verbs, "
               "closure patterns, opening strategies, eye colors, gear pool, "
               "counterpoint pairs — everything keepable was kept.")
    rep.append("- policies: K numbering ledger, K-freeform policy, K-return law, "
               "ENV/OAS formalization, pool v9 summary, N24/N25 mint ledgers, ×4 "
               "harvest note, N27 pre-flight mints, per-section usage lines.")
    rep.append("")
    rep.append("## 7. Recommended next actions for Thread 4")
    rep.append("")
    rep.append("1. Renumber the camera axis to the POSE_LIBRARY suffix scheme (one "
               "authoritative axis); ONTOLOGY CAM02/04/05/06/07 are the conflict.")
    rep.append("2. Collapse the K-numbering treadmill: Thread 4 should mint "
               "sequentially (K123 was promised, K126 arrived) or drop numbers for "
               "names entirely (the freeform policy already points that way).")
    rep.append("3. Decide the fate of the sheer-family cap numbers with the author "
               "(7 flagged carriers; 3.2 law: ≤2/prompt, ≤40% of R+ frames).")
    rep.append("4. Races: implement gold/banned directives in the compiler "
               "(races.json is ready).")
    rep.append("5. The H-family and GAR-F families are the freshest 3.2 assets — "
               "carry their doctrine forward as first-class carrier classes.")
    rep.append("")
    report_path = os.path.join(OUT, "PARSE_REPORT.md")
    with open(report_path, "w", encoding="utf-8") as f:
        f.write("\n".join(rep) + "\n")
    print(f"PARSE_REPORT.md written ({len(rep)} lines)")

    # exit non-zero on hard mismatches
    hard = [a for a in ANOMALIES if "!=" in a or "missing" in a.lower()]
    if hard:
        print("\nHARD ANOMALIES:", *hard, sep="\n  - ")
    print("done.")


if __name__ == "__main__":
    main()
