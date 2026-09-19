#!/usr/bin/env python3
# ph_sim_gate.py — V18 §60(5), THE CARDINAL MEASURE. RF-002 proved the
# text-gate grades the document the renderer never sees. This gate
# simulates PromptHero's observed rewrite behavior (PH_DOSSIER.md) and
# re-grades the SURVIVOR: if the claimed tier doesn't survive its own
# compression, the claim was never real.
#
# PH model (crude, honest, corpus-derived from RF-002's 27 rewrites):
#   1. the tag-run is dissolved        -> strip it
#   2. PH keeps noun-dense description -> drop sentences without >=2
#      keep-list hits (state/body/race/camera/color nouns)
#   3. the face formula and the closer survive -> keep them
#   4. ~40% of words survive           -> the survivor is what remains
# Then: rating_gate_lint.grade() on the survivor. sim_earned < claimed
# = FAIL. Verdicts print per prompt with survival stats.
import io, re, sys, importlib.util
from pathlib import Path

DL = Path("/home/z/my-project/download")

spec = importlib.util.spec_from_file_location("gate", str(Path(__file__).parent / "rating_gate_lint.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

KEEP = [
    # state nouns (RF-002 verbatim survivors)
    "topless", "bare chest", "bare breasts", "bare", "topless,", "nipple", "nipples",
    "see-through", "sheer", "wet", "transparent", "translucent", "presenting",
    "spread legs", "squatting", "straddling", "open clothes", "half-undressed",
    "large breasts", "glistening", "cleavage", "sideboob", "underboob", "cameltoe",
    # body nouns
    "breast", "breasts", "chest", "nipples", "mound", "cleft", "cheeks", "behind",
    "thigh", "thighs", "hip", "hips", "waist", "navel", "collarbone", "shoulder",
    "shoulders", "back", "spine", "neck", "throat", "legs", "knees", "calf",
    "ankles", "wrists", "lips", "mouth", "eyes", "hair", "skin",
    # race nouns
    "ears", "ear", "horn", "horns", "tail", "wings", "wing", "scales", "antennae",
    "antenna", "hood", "frill", "spore", "feather", "feathered", "membrane",
    "suckered", "harp", "moth", "elf", "kitsune", "wolf", "bunny", "ram", "serpent",
    "dryad", "jellyfish", "salamander", "gargoyle", "cat", "dragon",
    # camera nouns
    "viewed from", "view", "angle", "shot", "framing", "from below", "from above",
    "from side", "from behind", "overhead", "low-angle", "wide", "full body",
    "medium shot", "close", "camera", "lens",
    # palette / closer
    "color", "colors", "palette", "light", "lighting", "glow", "gold", "amber",
    "teal", "green", "red", "blue", "grey", "silver", "copper", "pink", "candle",
    "lamp", "lantern", "bulb", "neon", "saturated", "pigmented", "cel-shaded",
    "cel-shading", "anime", "illustration", "2d",
    # garment nouns
    "dress", "gown", "skirt", "blouse", "shirt", "coat", "sweater", "cardigan",
    "apron", "leotard", "towel", "robe", "wrap", "slip", "lining", "seam", "zipper",
    "button", "buttons", "strap", "straps", "silk", "cotton", "linen", "denim",
    "wool", "lace", "fabric", "weave", "hem", "collar", "sleeve", "boots", "socks",
    "stockings", "garter", "shorts", "suit", "vest", "harness", "mask", "veil",
    "glove", "gloves", "ribbon", "bow", "hairpin", "pins",
    # v5 (V19, CARRIER_LIBRARY): the new-class nouns — the diversity carriers
    # must survive the PH simulation, not only the wet/sheer state family
    "taut", "worn", "stretched", "creased", "crease", "rumpled", "cling",
    "slipped", "fallen", "unzipped", "untied", "mid-change", "flattened",
    "imprint", "imprinted", "dent", "dents", "footprint", "footprints",
    "tanline", "tanlines", "tan lines", "hickey", "sunburn", "goosebumps",
    "midriff", "nape", "anklet", "choker", "zettai", "ryouiki",
    "petticoat", "camisole", "bandeau", "strapless", "halter", "sleeveless",
    "armhole", "corset", "bodysuit", "overall", "overalls", "pinafore",
    "elastic", "waistband", "hemline", "kimono", "yukata", "sock",
    "pillow", "grass", "sand", "measuring", "tape", "seatbelt",
    "crossbody", "backpack", "sundress", "bodice", "knit", "tee",
    "blazer", "crop top", "swinging", "bouncing", "pokies",
    # environment nouns
    "room", "hall", "kitchen", "bath", "window", "door", "mirror", "table", "chair",
    "stool", "bench", "bed", "floor", "wall", "stairs", "stairwell", "street",
    "city", "roof", "rooftop", "tower", "bridge", "platform", "train", "bus",
    "station", "market", "shop", "shelves", "shelf", "counter", "fountain",
    "chandelier", "fireplace", "hearth", "garden", "greenhouse", "tree", "trees",
    "sea", "tide", "water", "rain", "snow", "night", "dusk", "dawn", "noon",
    "midnight", "morning", "evening",
]
KEEP_RX = re.compile("|".join(re.escape(k) for k in KEEP), re.I)

# §62: порог выживания предложения (писец видит его в writer_contract —
# контракт и симуляция делят одно число)
PH_KEEP_MIN = 2

TAGRUN_RX = re.compile(r"1girl, solo, [^.\n]+\.?", re.I)  # the tag-run ends at its first period

# PH softening: the verb-led v5/v6 carrier patterns PH dilutes or eats
SOFTEN_RX = [
    r"(?:weave|fabric|cotton|silk|lycra|cloth|suit|shirt|dress|bodice|bikini|towel|denim|linen|chiffon|lamé|lamé)[^.]{0,60}?(?:wicks?|maps|copies|transcribes|memoriz\w+|takes? (?:the|its) (?:print|dictation|testimony|inventory))",
    r"(?:takes?|taking) (?:the|its) (?:print|dictation|testimony|inventory) (?:of|from) (?:her|the|the body)",
    r"(?:publishes?|broadcasts?|announces?|recites?|files?|filing)[^.]{0,45}?(?:through|beneath|across|past) (?:the|its|her) (?:weave|fabric|cotton|silk|cloth|lycra|bodice)",
    r"(?:chest|breasts?|bust|weight|account|testimony|arithmetic|evidence|ledger)[^.]{0,55}?(?:re-?arriv\w+|lands?|pours?|tips?|leads?|votes?|tallies)",
    r"(?:seam|hem|strap|clasp|button|knot|zipper|collar|sash|cuff)[^.]{0,55}?(?:emigrat\w+|resign\w*|clocks? out|renegotiat\w+|quits?)",
    r"cheeks? claiming", r"fabric consumed between", r"seat's full claim",
    r"cheeks' full account", r"the cleft of her folded", r"cleft of her crossed",
    r"seam pressed flat into the cleft", r"riding the cleft",
]
SOFTEN = [re.compile(rx, re.I) for rx in SOFTEN_RX]

# the render-confirmed recipe: prose state nouns (P09/P14 held BECAUSE of them)
# v5 (V19): the STATE NOUN BANK v2 — diversity-first (CARRIER_LIBRARY
# Appendix A); the transparency family stays legal but no longer monopolizes
# the §60(2) prose-state floor.
STATE_NOUNS = ["topless", "bare chest", "bare breasts", "see-through", "sheer",
    "wet", "transparent", "translucent", "presenting", "spread legs", "squatting",
    "straddling", "open clothes", "half-undressed", "large breasts", "glistening",
    "cameltoe", "bare shoulders", "her bare", "nipples", "bare", "bared", "soaked",
    "plastered", "clinging", "clings", "topless state", "nude", "naked",
    # ── v5: the diversity-first primaries ──
    "taut", "worn thin", "stretched", "creased", "rumpled", "slipped",
    "fallen", "unzipped", "untied", "half-off", "mid-change", "pressed",
    "flattened", "zettai ryouiki", "tanlines", "tan lines", "garter",
    "strapless", "sleeveless", "off shoulder", "off-shoulder", "bare back",
    "sideboob", "underboob", "cleavage", "sweat", "arms up", "arched back",
    "swinging", "bouncing", "pokies", "apron", "towel", "yukata"]

def simulate(pos: str):
    """Return the PH-survivor text per the dossier model."""
    # 1. dissolve the tag-run
    sim = TAGRUN_RX.sub(" ", pos)
    # 1b. soften: strip the verb-led/poetic carriers PH dilutes
    for rx in SOFTEN:
        sim = rx.sub(" ", sim)
    # 2. sentence filter: keep noun-dense / formula / closer
    sents = re.split(r"(?<=[.!?;])\s+", sim)
    kept = []
    for s in sents:
        s2 = s.strip()
        if not s2:
            continue
        if s2.startswith("Her grown woman's face") or s2.startswith("Richly pigmented") \
           or "Masterpiece, best quality" in s2:
            kept.append(s2)
            continue
        hits = len(KEEP_RX.findall(s2))
        if hits >= PH_KEEP_MIN:
            kept.append(s2)
    return " ".join(kept)

TIER_ORDER = ["PG-13", "R", "R+", "X"]
def tier_rank(s):
    if s is None: return -1
    s = str(s)
    if "core4" in s:            # v5: a core4-fail sim-earn is NOT a held R+ —
        return TIER_ORDER.index("R+") - 0.5   # the mechanism spread must survive PH too
    if "borderline" in s:
        base = re.match(r"(PG-13|R\+|R|X)", s)
        return TIER_ORDER.index(base.group(1)) - 0.5 if base else -1
    m = re.match(r"(PG-13|R\+|R|X)", s)
    return TIER_ORDER.index(m.group(1)) if m else -1

def audit(path, header_pat, label):
    text = path.read_text(encoding="utf-8")
    rows = []
    prose_fail = []
    for bid, block in gate.split_blocks(text, header_pat):
        gline = re.search(r"Genre:.*", block)
        if not gline: continue
        g = gline.group(0)
        ncs_m = re.search(r"NCS:\s*([A-Z_\-]+)", g)
        yod_m = re.search(r"Yodayo:\s*(R\+|R|X|PG-13|PG)", g)
        pm = re.search(r"(?m)^POS:\s*\n\s*\n(.*?)\n\s*\n(?=^NEG:|\Z)", block, re.S)
        if not (ncs_m and yod_m and pm): continue
        claimed = yod_m.group(1)
        pos = pm.group(1).strip()
        # §60(2) tag-mirror: prose state nouns (tag-run stripped for this count)
        no_tags = TAGRUN_RX.sub(" ", pos)
        prose_states = sorted({s for s in STATE_NOUNS if s in no_tags.lower()})
        need_states = {"X": 4, "R+": 3}.get(claimed, 0)
        sim = simulate(pos)
        g2 = gate.grade(sim, claimed, ncs_m.group(1))
        rows.append((bid, claimed, g2["earned"], len(pos.split()), len(sim.split()),
                     g2["core"], g2["classes"], round(g2["share"], 2), prose_states))
        if len(prose_states) < need_states:
            prose_fail.append(f"{bid}")
    print(f"{'═' * 100}\n{label}")
    print(f"{'id':<6}{'claim':<7}{'SIM earned':<28}{'orig→sim w':<12}{'core':<6}{'cls':<5}{'share':<7}{'prose states'}")
    fails = []
    for bid, claimed, earned, w0, w1, core, cls, share, pstates in rows:
        flag = "" if tier_rank(earned) >= TIER_ORDER.index(claimed) else "  ✗DROP"
        # V18 doctrine (RF-002): NICHE/R claims are rating-exempt («так как это ниша —
        # простительно»); the sim FAILS only R+/X claims (the tiers PH collapses)
        hard = claimed in ("R+", "X")
        if (flag or bid in prose_fail) and hard: fails.append(bid)
        if flag and not hard: flag = "  ~drop(R-exempt)"
        print(f"{bid:<6}{claimed:<7}{earned:<28}{w0}→{w1:<8}{core:<6}{cls:<5}{share:<7}{len(pstates)}{flag}")
    print(f"  survival mean: {sum(r[4] for r in rows)/max(len(rows),1):.0f}w of "
          f"{sum(r[3] for r in rows)/max(len(rows),1):.0f}w "
          f"({100*sum(r[4] for r in rows)/max(sum(r[3] for r in rows),1):.0f}%)")
    print(f"  §60(2) prose-state fails (R+ needs ≥3, X ≥4): {prose_fail}")
    return rows, fails

def main():
    import os
    gate_set = os.environ.get("GATE_SET", "n28")
    targets = {
        "n29": [
            (DL / "BATCH_N29_NO_ONE_WROTE_THIS_SCENE.md", re.compile(r"^(P\d{2}) — ", re.M), "BATCH N29 — NO ONE WROTE THIS SCENE (21 merged: 3 OC + 18 mains, PH-sim)"),
        ],
        "n28": [
            (DL / "BATCH_N28_NOBODY_KNOWS.md", re.compile(r"^(P\d{2}) — ", re.M), "BATCH N28 — NOBODY KNOWS (21 mains, PH-sim)"),
            (DL / "OC_ORDERS_N28_SET3.md", re.compile(r"^(OC\d) — ", re.M), "OC ORDERS N28 SET3 (3 OC, PH-sim)"),
        ],
        "n27": [
            (DL / "BATCH_N27_SOMEWHERE_BETWEEN_HERE_AND_MAGIC.md", re.compile(r"^(P\d{2}) — ", re.M), "BATCH N27 — PH-sim (the retro proof of collapse)"),
        ],
    }
    all_fails = []
    for path, pat, label in targets.get(gate_set, targets["n28"]):
        if not path.exists():
            print(f"!! missing {path}")
            continue
        _, fails = audit(path, pat, label)
        all_fails += fails
    print(f"{'═' * 100}\nPH-SIM GATE (set={gate_set}): "
          + ("FAIL — " + ", ".join(all_fails) if all_fails else "PASS — every claim survives its own compression"))
    return 1 if all_fails else 0

if __name__ == "__main__":
    sys.exit(main())
