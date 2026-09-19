#!/usr/bin/env python3
"""
SPINE — P2: компилятор спайна (V20 build, 2026-09-16; V21 §62: эмиссия
контракта писца).

Замес ручного пре-флайта (build_window_n23/n24.py, window_scan_n25.py и
«Computed the N26 free shelf live» в голове) в ОДНУ команду. Читает
окно (3 последних сданных батча — по номерам файлов, TRACKER лишь
сверяется), пулы системы, всю историю сданного — и компилирует спайн
следующего батча: заблокированное, свободные полки, голову минта,
X-фоссили, статус движков, указатель watch.

§62 FIRST-PASS: помимо фактов, компилятор эмитит WRITER'S CONTRACT —
все механические законы трёх органов (домашний линт / рейтинговый гейт /
PH-симуляция) в операционной форме, числа из констант самих органов
(дрейф невозможен: контракт и линт делят одно число). Письмо прозы
идёт ПРОТИВ контракта — первый прогон линта и есть целевое состояние.

CLI:
  python3 scripts/spine.py compile n29     # спайн N29 (окно N26+N27+N28) + контракт
  python3 scripts/spine.py compile n28     # ретро: окно N25+N26+N27
  python3 scripts/spine.py selftest        # чеки компилятора (окна/минты + контракт)

Выход: консольный отчёт + scripts/spine_n{NN}.json (машинный артефакт
для писца и для house_lint; включает writer_contract). TRACKER/MOTIF
сверяются толерантно — их долг репортится, не роняет компиляцию (W5:
псевдо-YAML не источник правды, а объект сверки).
"""
import glob
import io
import json
import re
import sys
from pathlib import Path

import house_lint as HL   # P3 — контракт строится из констант ядра (§62)

ROOT = Path("/home/z/my-project")
SC = ROOT / "scripts"
DL = ROOT / "download"
SYS = ROOT / "system"


def rd(p):
    return io.open(p, encoding="utf-8").read()


# ── сданное ───────────────────────────────────────────────────────────────

def delivered_batches():
    files = {}
    for m in glob.glob(str(DL / "BATCH_N*.md")):
        mm = re.search(r"BATCH_N(\d+)_", Path(m).name)
        if mm:
            files[int(mm.group(1))] = Path(m)
    return files


def all_oc_files():
    """(путь, номер батча) — для исторического скана минтов."""
    out = []
    for p in sorted(DL.glob("OC_ORDERS_*.md")):
        m = re.search(r"OC_ORDERS_N(\d+)", p.name)
        out.append((p, int(m.group(1)) if m else 10 ** 6))
    return out


def window_for(n):
    nums = sorted(k for k in delivered_batches() if k < n)
    return {k: delivered_batches()[k] for k in nums[-3:]}


# ── вселенные кодов из системы ────────────────────────────────────────────

def palette_universe():
    """id → name из PALETTE_LIBRARY.yaml (P21..P105)."""
    out = {}
    for m in re.finditer(r"(?m)^id: (P\d{2,3}_[A-Z_]+)\s*$\n^name: \"([^\"]+)\"",
                         rd(SYS / "PALETTE_LIBRARY.yaml")):
        out[m.group(1)] = m.group(2)
    return out


def pl_universe():
    """PL-коды из POSE_LIBRARY.yaml + предпочтительные камеры, где есть."""
    text = rd(SYS / "POSE_LIBRARY.yaml")
    ids = sorted({m for m in re.findall(r"\{id: (PL\d+),", text)},
                 key=lambda x: int(x[2:]))
    pairs = {}
    for m in re.finditer(r"\{pl: (PL\d+), preferred: \[([^\]]+)\]", text):
        pairs[m.group(1)] = re.findall(r"(CAM\d+)_", m.group(2))
    return ids, pairs


def code_universe(rx, *files):
    text = "".join(rd(SYS / f) for f in files)
    return sorted({m for m in re.findall(rx, text)}, key=lambda x: int(re.sub(r"\D", "", x)))


# ── разбор батча ──────────────────────────────────────────────────────────

def scan_batch(path):
    t = rd(path)
    codes = {
        "K": set(re.findall(r"\bK\d{2,3}\b", t)),
        "FET": set(re.findall(r"\bFET\d+\b", t)),
        "BRE": set(re.findall(r"\bBRE\d+\b", t)),
        "BK": set(re.findall(r"\bBK\d+\b", t)),
        "B": set(re.findall(r"\bB(?!RE|K)\d{2,}\b", t)),
        "H": set(re.findall(r"\bH\d{2}\b", t)),
        "GAR": set(re.findall(r"\bGAR\d+\b", t)),
        "CAM": set(re.findall(r"\bCAM\d+\b", t)),
        "PL": set(re.findall(r"\bPL\d{2,3}\b", t)),
        "PAL": set(re.findall(r"\b(P\d{2,3}_[A-Z_]+)\b", t)),
    }
    positions = {}
    for m in re.finditer(r"(?m)^P(\d\d) — .*?(?=^P\d\d — |\Z)", t, re.S):
        pid, body = "P" + m.group(1), m.group(0)
        ym = re.search(r"Yodayo: (\S+)", body)
        rm = re.search(r"Race: ([\w-]+)", body)
        hm = re.search(r"Hair/Eyes: (.*?)\n", body)
        positions[pid] = {
            "yodayo": ym.group(1) if ym else None,
            "race": rm.group(1) if rm else "human",
            "hair": (hm.group(1).split("/")[0].strip() if hm else None),
            "anchor": re.match(r"P\d\d — ([a-z0-9-]+) ", body).group(1),
        }
    return codes, positions


def engine_status():
    text = rd(SYS / "ENGINES.yaml")
    out = {}
    cur = None
    for line in text.splitlines():
        m = re.match(r"^([a-z_]+):\s*$", line)
        if m and m.group(1) not in ("engines", "open_engine_seeds"):
            cur = m.group(1)
        if cur and line.strip().startswith("status:"):
            out[cur] = line.split("status:")[1].split("#")[0].strip()
            cur = None
    return out


def motif_watch(n):
    text = rd(SYS / "MOTIF_LOG.yaml")
    key = f"n{n}_watch:"
    if key not in text:
        return None
    seg = text.split(key, 1)[1]
    stop = re.search(r"(?m)^[a-z_0-9]+:\s*$", seg)
    return (seg[:stop.start()] if stop else seg)[:1500].strip()


# ── компиляция ────────────────────────────────────────────────────────────

def compile_spine(n, write=True):
    win = window_for(n)
    if len(win) != 3:
        print(f"[warn] window incomplete for N{n}: {sorted(win)}")

    win_codes, win_pos = {}, {}
    blocked = {k: set() for k in ("K", "FET", "BRE", "BK", "B", "H", "GAR",
                                  "CAM", "PL", "PAL")}
    anchors = []
    for k, path in win.items():
        codes, positions = scan_batch(path)
        win_codes[f"N{k}"] = codes
        win_pos[f"N{k}"] = positions
        for fam, s in codes.items():
            blocked[fam] |= s
        anchors += [p["anchor"] for p in positions.values() if p.get("anchor")]

    # вселенные
    pal_u = palette_universe()
    pl_ids, pl_pairs = pl_universe()
    k_u = code_universe(r"\{id: (K\d+),", "ONTOLOGY.yaml", "POOLS_V8.yaml")
    fet_u = code_universe(r"\{id: (FET\d+),", "ONTOLOGY.yaml", "POOLS_V8.yaml")
    h_u = code_universe(r"\{id: (H\d+),", "POOLS_V8.yaml")
    garf_u = code_universe(r"\{id: (GAR\d+),", "POOLS_V8.yaml")
    cam_u = code_universe(r"\{id: (CAM\d+),", "POOLS_V8.yaml")
    fet_u = [f for f in fet_u if not 26 <= int(f[3:]) <= 45]   # retired hole

    # исторические минты K: история ДО цели (батчи + OC + EXQ/SP)
    # ретро-компиляция n28 должна видеть мир глазами писца до N28.
    # (?!\+) отсекает проза-упоминания «next minting head: K209+».
    hist_paths = ([delivered_batches()[k] for k in sorted(delivered_batches()) if k < n]
                  + [p for p, num in all_oc_files() if num < n]
                  + sorted(DL.glob("EXQUISITE_ORDERS_*.md"))
                  + ([DL / "SP_ORDERS.md"] if (DL / "SP_ORDERS.md").exists() else []))
    hist_text = "".join(rd(p) for p in hist_paths)
    hist_k = set(re.findall(r"\bK\d{2,3}\b(?!\+)", hist_text))
    mint_head = (max(int(k[1:]) for k in hist_k) + 1) if hist_k else 158

    # X-фоссили: позиции X по всей истории
    x_hist = {}
    for k, path in sorted(delivered_batches().items()):
        _, positions = scan_batch(path)
        x_hist[f"N{k}"] = sorted(p for p, d in positions.items()
                                 if d["yodayo"] == "X")
    never_x = [f"P{i:02d}" for i in range(1, 22)
               if f"P{i:02d}" not in set(sum(x_hist.values(), []))]

    # свободные полки
    free = {
        "palettes": sorted((p for p in pal_u
                            if p.split("_")[0] + "_" not in
                            {b.split("_")[0] + "_" for b in blocked["PAL"]}),
                           key=lambda x: int(x.split("_")[0][1:])),
        "K": sorted(set(k_u) | {k for k in hist_k if int(k[1:]) < mint_head}
                    - blocked["K"], key=lambda x: int(x[1:])),
        "FET": sorted(set(fet_u) - blocked["FET"], key=lambda x: int(x[3:])),
        "PL": sorted(set(pl_ids) - blocked["PL"], key=lambda x: int(x[2:])),
        "H": sorted(set(h_u) - blocked["H"], key=lambda x: int(x[1:])),
        "GAR": sorted(set(garf_u) - blocked["GAR"], key=lambda x: int(x[3:])),
        "CAM": sorted(set(cam_u) - blocked["CAM"], key=lambda x: int(x[3:])),
    }

    # сверки (W5: TRACKER/MOTIF — объекты сверки, не источник)
    tracker = rd(SYS / "TRACKER.yaml")
    tracker_ok = all(f"n{k}_" in tracker for k in win)
    motif = motif_watch(n + 1)
    engines = engine_status()

    # расовые позиции окна (для той же-позиции расы)
    win_race_pos = {f"N{k}": {p: d["race"] for p, d in pos.items()}
                    for k, pos in win_pos.items()}

    spine = {
        "target": f"N{n}",
        "window": {f"N{k}": str(p.name) for k, p in win.items()},
        "blocked": {k: sorted(v) for k, v in blocked.items()},
        "window_anchors": anchors,
        "window_race_positions": win_race_pos,
        "free": free,
        "mint_head": mint_head,
        "x_history": x_hist,
        "x_never_used": never_x,
        "engines": engines,
        "motif_watch": motif,
        "crosschecks": {
            "tracker_window_blocks_present": tracker_ok,
        },
        "palette_names": {p: pal_u[p] for p in free["palettes"]},
        "pl_camera_pairs": {p: pl_pairs[p] for p in free["PL"] if p in pl_pairs},
    }

    # §62 FIRST-PASS: контракт писца — законы трёх органов в операционной
    # форме (числа из констант; факты спайна — mint head — вшиваются сверху)
    wc = HL.writer_contract()
    wc["quotas"]["mint_head_from_spine"] = mint_head
    spine["writer_contract"] = wc

    # ── отчёт ──
    W = f"N{sorted(win)[0]}+N{sorted(win)[1]}+N{sorted(win)[2]}" if len(win) == 3 else "?"
    print("═" * 72)
    print(f"SPINE COMPILE — N{n}  (окно {W}; mint head K{mint_head})")
    print("═" * 72)
    print(f"BLOCKED (окно, объединение):")
    for fam in ("K", "FET", "BRE", "BK", "B", "H", "GAR", "CAM", "PL"):
        print(f"  {fam}: {len(blocked[fam])} кодов: {sorted(blocked[fam])[:14]}"
              + (" …" if len(blocked[fam]) > 14 else ""))
    print(f"  палитры: {len(blocked['PAL'])}: {sorted(blocked['PAL'])}")
    print()
    print("FREE SHELF:")
    print(f"  палитры ({len(free['palettes'])}):")
    for p in free["palettes"]:
        print(f"    {p:<28} {pal_u.get(p, '?')}")
    print(f"  K free: {len(free['K'])} (минты K{mint_head}+ доступны; "
          f"бюджет ≤8, возвраты ≥10)")
    print(f"  FET free ({len(free['FET'])}): {free['FET']}")
    print(f"  PL free: {len(free['PL'])} из {len(pl_ids)} "
          f"(ecchi PL61-84: {sum(1 for p in free['PL'] if 61 <= int(p[2:]) <= 84)}, "
          f"erotic PL181-204: {sum(1 for p in free['PL'] if 181 <= int(p[2:]) <= 204)})")
    print(f"  H free: {free['H']}")
    print(f"  GAR free: {free['GAR']}")
    print(f"  CAM free: {free['CAM']}")
    print()
    print("X-ФОССИЛИ (позиции X по истории):")
    for b, xs in x_hist.items():
        print(f"  {b}: {xs}")
    print(f"  никогда не X: {never_x}")
    print()
    print(f"ДВИЖКИ: " + " · ".join(f"{e}={s}" for e, s in engines.items()))
    print(f"TRACKER-сверка: {'OK' if tracker_ok else '⚠ блоки окна отсутствуют'}")
    if motif:
        first = motif.splitlines()[0] if motif else ""
        print(f"MOTIF n{n + 1}_watch: {first[:100]}…")
    print()
    print("─" * 72)
    print(f"WRITER'S CONTRACT (§62 FIRST-PASS) — письмо против контракта;")
    print(f"полный: spine_n{n}.json → writer_contract · ловушки T1-T14 в конце JSON")
    print("─" * 72)
    for line in HL.contract_brief(wc):
        print("  " + line)
    if write:
        out = SC / f"spine_n{n}.json"
        io.open(out, "w", encoding="utf-8").write(
            json.dumps(spine, ensure_ascii=False, indent=1))
        print(f"\nJSON → {out}")
    return spine


def selftest():
    """Чеки P2: (1) ретро n28 — окно N25/26/27, голова минта 202;
    (2) свежий n29 — окно N26/27/28, голова 209; JSON на диске;
    (3) §62-контракт — эмиссия + drift-чеки (числа из органов)."""
    ok = True
    print("── SELFTEST 1: ретро compile n28")
    s28 = compile_spine(28, write=False)
    w28 = sorted(s28["window"])
    if w28 == ["N25", "N26", "N27"]:
        print("  ✓ окно N25+N26+N27")
    else:
        print(f"  ✗ окно {w28}"); ok = False
    if s28["mint_head"] == 202:
        print("  ✓ mint head 202 (K-RETURN факт N28)")
    else:
        print(f"  ✗ mint head {s28['mint_head']} != 202"); ok = False
    if s28["x_history"].get("N28") == ["P07", "P14"]:
        print("  ✓ X-позиции N28 = P07/P14")
    else:
        print(f"  ✗ X N28 = {s28['x_history'].get('N28')}"); ok = False

    print("── SELFTEST 2: compile n29 (боевой спайн)")
    s29 = compile_spine(29, write=True)
    w29 = sorted(s29["window"])
    if w29 == ["N26", "N27", "N28"]:
        print("  ✓ окно N26+N27+N28")
    else:
        print(f"  ✗ окно {w29}"); ok = False
    if s29["mint_head"] == 209:
        print("  ✓ mint head 209 (MOTIF watch: «next minting head: K209»)")
    else:
        print(f"  ✗ mint head {s29['mint_head']} != 209"); ok = False
    if (SC / "spine_n29.json").exists():
        print("  ✓ spine_n29.json записан")
    else:
        print("  ✗ JSON не записан"); ok = False
    if s29["crosschecks"]["tracker_window_blocks_present"]:
        print("  ✓ TRACKER держит блоки окна")
    else:
        print("  ⚠ TRACKER: блоки окна отсутствуют (долг W5)")

    print("── SELFTEST 3: writer's contract (§62) — эмиссия + drift-чеки")
    import rating_gate_lint as gate
    import ph_sim_gate as phs
    wc = s29.get("writer_contract")
    checks = [
        ("контракт в spine JSON", wc is not None and "law" in wc),
        ("state floor из ядра", bool(wc) and wc["per_prompt"]["state_floor"] == HL.STATE_FLOOR),
        ("tag floor из ядра", bool(wc) and wc["per_prompt"]["tag_floor"] == HL.TAG_FLOOR),
        ("механо-группы из гейта", bool(wc) and wc["rating_layer"]["mech_groups"] == gate.MECH_GROUPS),
        ("PH-порог из симуляции", bool(wc) and wc["ph_sim"]["keep_min"] == phs.PH_KEEP_MIN),
        ("ловушки T1-T14 полны", bool(wc) and {t["id"] for t in wc["traps"]} == {f"T{i}" for i in range(1, 15)}),
        ("mint head вшит в контракт", bool(wc) and wc["quotas"].get("mint_head_from_spine") == 209),
        ("поля спайна дословно", bool(wc) and wc["structure"]["spine_fields"] == list(HL.SPINE_FIELDS)),
    ]
    for name, passed in checks:
        print(f"  {'✓' if passed else '✗'} {name}")
        ok = ok and passed
    print("ALL SPINE SELFTESTS PASS" if ok else "SPINE SELFTEST FAILURES")
    return 0 if ok else 1


def main():
    args = sys.argv[1:]
    if not args or args[0] == "selftest":
        sys.exit(selftest())
    if args[0] == "compile" and len(args) >= 2:
        n = int(re.sub(r"\D", "", args[1]))
        compile_spine(n, write=True)
        sys.exit(0)
    print("usage: spine.py compile n29 | selftest")
    sys.exit(2)


if __name__ == "__main__":
    main()
