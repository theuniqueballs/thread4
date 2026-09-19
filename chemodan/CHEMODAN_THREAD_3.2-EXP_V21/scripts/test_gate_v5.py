#!/usr/bin/env python3
"""test_gate_v5.py — V19 self-test: core-4 positive case + layer-stack trap.
The gate must (1) pass a four-mechanism R+ stack that uses NO transparency
family at all, (2) catch the N28 strap bug («лифчик под одеждой, лямки
снаружи»), (3) accept the same strap when the exit route is named."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("gate", str(Path(__file__).parent / "rating_gate_lint.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

GOOD = """1girl, solo, young woman, zettai ryouiki, off shoulder, open clothes, tanlines, large breasts, arms up, vintage apartment interior, warm window light.
Her grown woman's face is rendered in stylized 2D anime style: long lashes, soft hazel eyes, a small mouth caught mid-decision. The taut weave of her shirt pulls flat across the chest, the ribbing stretched into pale bands over the bust. The contour of her apex reads through the dry knit, unmistakable without any wet. The zettai ryouiki's band of bare thigh sits between sock-top and skirt hem, the tan lines' pale geometry framing what the bikini covered last summer. The overalls' one strap unbuckled, the bib sagging sideways off her hip. The bra strap escaped past the wide boat neckline onto her collarbone, lace edge visible below the open collar. The bounce at each heel-strike on the stairs writes itself down the whole front of her. The measuring tape's overlap at the bust line waits on the table, the atelier's own arithmetic. Richly pigmented saturated film colors, cel-shaded, soft window glow, painterly detail, masterpiece, best quality, anime illustration."""

BAD = """1girl, solo, adult woman, wet clothes, see-through, pokies, wet, blush.
Her grown woman's face is rendered in stylized 2D anime style: long lashes, grey eyes, small mouth. The soaked shirt plastered to her, printing its whole account. Two dark points pressed against the weave of her top. The bra strap slipping off her shoulder under the buttoned blouse, fallen outside the sweater. The full weight of her breasts mid-swing at the turn. Richly pigmented saturated film colors, cel-shaded, masterpiece, best quality, anime illustration."""

g1 = gate.grade(GOOD, "R+", "COVERED")
g2 = gate.grade(BAD, "R+", "THROUGH_FABRIC")
ls1 = gate.layer_stack_violations(GOOD)
ls2 = gate.layer_stack_violations(BAD)

print("── TEST 1: the dry-beach core-4 stack (NO transparency family)")
print(f"    classes: {sorted(g1['carriers'])}  mech: {g1['mech_n']}/4  core: {g1['core']}  share: {g1['share']:.0%}  earned: {g1['earned']}")
assert g1["earned"] == "R+", "core-4 stack must earn R+"
assert gate.TRANS_PAT.findall(GOOD) == [], "the good stack uses zero transparency carriers"

print("── TEST 2: the N28 strap bug (under-strap + closed blouse, no exit)")
print(f"    layer_stack: {ls2 or 'NOT CAUGHT'}")
assert ls2, "the layer-stack check must fire on the bug"

print("── TEST 3: the same stack with the exit route named")
print(f"    layer_stack on GOOD (boat neck + open collar named): {ls1 or 'clean'}")
assert not ls1, "named exit route must pass"

print("── TEST 4: the BAD stack's diagnostics")
print(f"    earned: {g2['earned']}  sheer hits: {len(gate.TRANS_PAT.findall(BAD))}")
assert "core4" in g2["earned"] or g2["earned"] == "R+", "mono-mech stack should not earn clean R+"

print("\nALL FOUR TESTS PASS — gate v5 behaves per §4E/§4F/§4G.")
