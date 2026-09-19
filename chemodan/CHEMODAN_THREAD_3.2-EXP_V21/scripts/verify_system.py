#!/usr/bin/env python3
# verify_system.py — глубокий аудит консистентности системы (2026-09-10,
# авторский приказ п.6: «найди и почини всё, что гадит»). Проверяет:
#   1. Все семейства кодов: полные списки, счёт, дубликаты
#   2. Дыры нумерации (ghost-коды)
#   3. K102-скип: подтверждён и задокументирован?
#   4. Новые V11-коды на месте
#   5. Файлы архивов на месте, активные окна чисты
import io, re, sys

BASE = "/home/z/my-project/system"
def rd(p):
    return io.open(f"{BASE}/{p}", encoding="utf-8").read()

report, fails = [], []

def fam(text, prefix, rx):
    ids = re.findall(rx, text)
    dup = sorted({i for i in ids if ids.count(i) > 1})
    return ids, dup

def check(label, text, prefix, rx, expect_min=None):
    ids, dup = fam(text, prefix, rx)
    holes = []
    if dup:
        fails.append(f"{label}: DUPLICATES {dup}")
    # дыры внутри диапазона min..max
    nums = sorted(int(re.sub(r"\D", "", i)) for i in ids)
    if nums:
        lo, hi = nums[0], nums[-1]
        holes = [n for n in range(lo, hi + 1) if n not in nums]
    report.append(f"{label}: {len(ids)} codes, range {nums[0] if nums else '-'}..{nums[-1] if nums else '-'}, holes: {holes if holes else 'none'}, dup: {dup if dup else 'none'}")
    if expect_min and len(ids) < expect_min:
        fails.append(f"{label}: expected ≥{expect_min}, got {len(ids)}")
    return ids

pools = rd("POOLS_V8.yaml")
onto = rd("ONTOLOGY.yaml")
pose = rd("POSE_LIBRARY.yaml")
cens = rd("CONSTRAINTS.yaml")
rules = rd("RULES.md")
rmap = rd("RATING_MAP.md")

# K-семейство: все Kxx-коды в обоих файлах (K01-K08, K61-K79, K80-K93, K98-K104, K115-122)
k_ids = check("KINETIC (ONTOLOGY+POOLS)", onto + pools, "K", r"\{id: (K\d+),")
# K109-114 — freeform-designate: упомянуты как политика?
assert "K109-114" in pools, "freeform K109-114 policy missing"
report.append("K-FREEFORM: K109-114 policy documented (no ghost numbering) ✓")

b_ids = check("BRE (ONTOLOGY+POOLS)", onto + pools, "BRE", r"\{id: (BRE\d+),")
bk_ids = check("BK (ONTOLOGY+POOLS)", onto + pools, "BK", r"\{id: (BK\d+),")
b_butt = check("B-butt (ONTOLOGY+POOLS)", onto + pools, "B", r"\{id: (B\d+),")
h_ids = check("H-FAMILY (POOLS §12)", pools, "H", r"\{id: (H\d+),", expect_min=20)
garf = check("GAR-F (POOLS §13)", pools, "GAR", r"\{id: (GAR4[1-8]),", expect_min=8)
camx = check("CAM13-18 (POOLS §14)", pools, "CAM", r"\{id: (CAM1[3-8]),", expect_min=6)
pl_new = check("PL49-60 (POSE v2)", pose, "PL", r"\{id: (PL(?:49|5\d|60)),", expect_min=12)
fet_all = check("FET (ONTOLOGY FET01-70 minus hole)", onto, "FET", r"\{id: (FET\d+),")

# дыра FET26-45: подтверждена как закрытая?
assert "FET26" not in onto and "retired" in pools.lower(), "FET26-45 closure missing"
report.append("FET26-45: hole CLOSED (retired; H-family + GAR-F own the territory) ✓")

# POSE pairs для новых кодов
pairs = len(re.findall(r"\{pl: PL(49|5\d|60), preferred", pose))
report.append(f"POSE-CAMERA pairs for PL49-60: {pairs}/12")
if pairs != 12:
    fails.append(f"PL49-60 pairs: {pairs} != 12")

# census-целостность: каждый C0xx в census?
cens_ids = set(re.findall(r"id: (C\d{3})", cens))
census_ids = set(re.findall(r"(C\d{3}):\s*\{status", cens))
missing = sorted(cens_ids - census_ids)
report.append(f"CONSTRAINTS census: {len(census_ids)}/{len(cens_ids)} codes marked; unmarked: {missing if missing else 'none'}")
if missing:
    fails.append(f"census unmarked: {missing}")

# архивы
import os
for f in ["MOTIF_LOG_ARCHIVE.yaml", "TRACKER_ARCHIVE.yaml", "RULES_CORE.md", "RULES_HISTORY.md"]:
    p = f"{BASE}/{f}"
    ok = os.path.exists(p)
    sz = os.path.getsize(p) if ok else 0
    report.append(f"file {f}: {'✓' if ok else 'MISSING'} ({sz:,} B)")
    if not ok:
        fails.append(f"missing file {f}")

# RULES: §51 на месте, порядок §
assert "51. SATURATION DOCTRINE" in rules
assert rules.index("50. RATING HONESTY LAW") < rules.index("51. SATURATION") < rules.index("CHANGELOG (for reference")
report.append("RULES: §51 in place, order §50 < §51 < CHANGELOG ✓")
# V21: §61 + §62 на месте, порядок до CHANGELOG; §62 ledger существует
assert "61. CARRIER DIVERSITY LAW" in rules and "62. FIRST-PASS LAW" in rules
assert rules.index("61. CARRIER DIVERSITY LAW") < rules.index("62. FIRST-PASS LAW") < rules.index("CHANGELOG (for reference")
report.append("RULES: §61 < §62 < CHANGELOG ✓ (FIRST-PASS LAW in place)")
import os as _os
_rc = f"{BASE}/LINT_RECEIPTS.tsv"
if _os.path.exists(_rc):
    _rrows = [l for l in open(_rc, encoding="utf-8").read().splitlines()
              if l and not l.startswith("#") and not l.startswith("date\t")]
    report.append(f"§62 LEDGER: {len(_rrows)} receipts ✓ (LINT_RECEIPTS.tsv)")
else:
    fails.append("§62 LEDGER missing: system/LINT_RECEIPTS.tsv")
assert "§11 code integration" in rmap or "CODE INTEGRATION" in rmap
report.append("RATING_MAP v1.1 §11: ✓")

print("\n".join(report))
print()
if fails:
    print("FAILURES:")
    print("\n".join("  " + f for f in fails))
    sys.exit(1)
print("VERIFY PASS — система консистентна")
