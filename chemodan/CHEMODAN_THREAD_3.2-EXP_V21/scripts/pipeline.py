#!/usr/bin/env python3
"""
PIPELINE (2026-09-14, Path B MVP — the author's review: «один
pipeline-скрипт, который перед выдачей прогоняет всё»).

One command runs every gate that exists for a batch. ALLOWLIST ONLY —
mutators (fix_*, assemble_*, update_*, build_*, window_*) are never
discovered, never run. The more gates live outside the solver's head,
the less drift.

Usage:
  python3 scripts/pipeline.py n25
  python3 scripts/pipeline.py n26 --strict-rhythm

Steps (each skipped silently if its artifact does not exist yet):
  1. batch_{slug}_lint.py        — per-batch mechanical lint
  2. batch_{slug}_simcheck.py    — §17A cross-batch prose similarity
  3. oc_orders_{slug}_lint.py    — OC canon/shield/economy lint
  4. oc_{slug}_simcheck.py       — OC-side similarity (if separate)
  5. rating_gate_lint.py         — §50/§52/§53 gate (GATE_SET=slug)
  6. rhythm_lint.py              — closer-cadence + soft cap (diagnostic
                                   unless --strict-rhythm)
  5a. sp_lint.py                — special orders (added at the N26
                                   audit — SP hygiene was unwatched)
  7. freq_lint.py                — §17B in-batch tics (batch file at
                                   default caps; OC files at 0.70 —
                                   small-file threshold)
Exit 0 only if every hard step passes.
"""
import argparse
import glob
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path("/home/z/my-project")
SC = ROOT / "scripts"
DL = ROOT / "download"


def run(label, cmd, env_extra=None):
    env = dict(os.environ)
    if env_extra:
        env.update(env_extra)
    r = subprocess.run(cmd, capture_output=True, text=True, env=env)
    tail = (r.stdout or "").strip().splitlines()
    verdict = "PASS" if r.returncode == 0 else "FAIL"
    print(f"  [{verdict}] {label}")
    if r.returncode != 0:
        for line in tail[-6:]:
            print(f"         {line}")
    elif tail:
        print(f"         {tail[-1][:110]}")
    return r.returncode == 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug", help="batch slug, e.g. n25")
    ap.add_argument("--strict-rhythm", action="store_true")
    args = ap.parse_args()
    slug = args.slug.lower()
    SLUG = slug.upper()

    print(f"═" * 72)
    print(f"PIPELINE — {slug}  (Path B, one-command gates)")
    print(f"═" * 72)

    results = {}

    # 0a: the unified house lint (P3, 2026-09-16) — runs INSTEAD of the
    # legacy per-batch lint when a config block exists in house_configs.yaml
    # (the house layer is the per-batch lint's superset; the per-batch zoo
    # retires batch by batch as configs land)
    has_house_cfg = False
    hc_path = SC / "house_configs.yaml"
    if hc_path.exists():
        try:
            import io as _io
            import yaml as _yaml
            _cfgs = _yaml.safe_load(_io.open(hc_path, encoding="utf-8")) or {}
            has_house_cfg = slug in _cfgs
        except Exception:
            has_house_cfg = False
    if has_house_cfg:
        results["house"] = run(f"house_lint.py ({slug})",
                               [sys.executable, str(SC / "house_lint.py"),
                                "--slug", slug])

    # 1-2: batch lint (legacy; skipped when house_lint owns the slug) + simcheck
    legacy_lint = f"batch_{slug}_lint.py"
    if has_house_cfg and (SC / legacy_lint).exists():
        print(f"  [skip] {legacy_lint} (owned by house_lint.py — P3)")
    for key, script in [("lint", legacy_lint), ("simcheck", f"batch_{slug}_simcheck.py")]:
        if has_house_cfg and key == "lint":
            continue
        path = SC / script
        if path.exists():
            results[key] = run(script, [sys.executable, str(path)])
        else:
            print(f"  [skip] {script} (not found)")

    # 3-4: OC lints (glob — SET-суффиксы: oc_orders_n28_set3_lint.py и т.п.)
    for key, pat in [("oc_lint", f"oc_orders_{slug}*_lint.py"),
                     ("oc_simcheck", f"oc_{slug}*_simcheck.py")]:
        found = sorted(SC.glob(pat))
        for path in found:
            results[f"{key}:{path.stem}"] = run(
                path.name, [sys.executable, str(path)])
        if not found:
            print(f"  [skip] {pat} (not found)")

    # 5a: the SP lint (added 2026-09-14, N26 audit: SP-05/06 had drifted
    # out of §49 range because sp_lint lived outside the pipeline)
    if (ROOT / "download" / "SP_ORDERS.md").exists():
        results["sp_lint"] = run("sp_lint.py (special orders)",
                                 [sys.executable, str(SC / "sp_lint.py")])

    # 5: the rating gate
    results["gate"] = run("rating_gate_lint.py (GATE_SET="
                          f"{slug})", [sys.executable, str(SC / "rating_gate_lint.py")],
                          env_extra={"GATE_SET": slug})

    # 6: rhythm lint (batch + OC files)
    batch_files = sorted(glob.glob(str(DL / f"BATCH_{SLUG}_*.md")))
    oc_files = sorted(glob.glob(str(DL / f"OC_ORDERS_{SLUG}.md")))
    rhythm_files = batch_files + oc_files
    if rhythm_files:
        cmd = [sys.executable, str(SC / "rhythm_lint.py")] + rhythm_files
        if args.strict_rhythm:
            cmd.append("--strict")
        key = "rhythm" + ("*" if not args.strict_rhythm else "")
        results["rhythm(diag)" if not args.strict_rhythm else "rhythm"] = \
            run("rhythm_lint.py " + " ".join(Path(f).name[:40] for f in rhythm_files), cmd)
    else:
        print("  [skip] rhythm_lint.py (no files found)")

    # 7: freq lint — themed, baseline-diffed, fail-on-NEW-only (§17B's
    # original mission: catch NEW batch-favorite constructions; house
    # substrate reports, does not gate). Baseline auto-discovered.
    THEMES = {
        "n25": ("rain,water,wet,sky,soaked,upward,night,city,ground,world,"
                "pool,track,stadium,aurora,lane,frame,glow,light,turn,"
                "reversed,iron,drained,leaving,puddles,settling,bright,"
                "rising,ascending,wrong,climb,climbing,dry,fall,falling,"
                "rise,rises,bead,beads,witness"),
        "n26": ("song,songs,sing,sings,singing,sang,sung,singer,voice,voices,"
                "note,notes,breath,breathe,breathes,breathing,inhale,exhale,"
                "hum,humming,hummed,tune,melody,phrase,phrases,verse,verses,"
                "chorus,refrain,echo,echoes,aria,lullaby,duet,harmony,descant,"
                "coda,encore,reprise,fermata,octave,pitch,tempo,rhythm,scale,"
                "unravel,unravels,unraveled,unravelling,weave,woven,weaves,"
                "thread,threads,hem,hems,silence,silent,obey,obeys,obeyed,"
                "obedience,mouth,throat,brass,unsung,singsong,songbook,"
                "vowel,vowels,drone,croon,crooner,howl,yodel,chorister"),
        # add per-batch theme vocab here as batches are written
        "n29": ("nobody,wrote,write,written,unwritten,scene,found,caught,"
                "catch,catches,witness,accidental,improvise,improvised,"
                "improvisation,frame,glass,mirror,monitor,screen,schedule,"
                "shift,hour,night,dawn,morning,street,city,world,room,"
                "machine,water,light,pour,climb,climbs,climbing,settle,"
                "settles,settling,sway,swaying,ride,rides,riding,press,"
                "presses,pressed,print,prints,printed,mark,marks,line,"
                "lines,receipt,receipts,ledger,file,files,audit,argument,"
                "verdict,custody,schedule,appointment,round,loop,cycle,"
                "drum,strip,band,bench,counter,bar,shelve,shelf,rail,rim,"
                "custody,unhurried"),
    }
    theme = THEMES.get(slug)
    prev_batch = sorted(glob.glob(str(DL / f"BATCH_N{int(slug[1:]) - 1:02d}_*.md")))
    prev_oc = sorted(glob.glob(str(DL / f"OC_ORDERS_N{int(slug[1:]) - 1:02d}.md")))

    def freq_cmd(files, baseline, phrase, unigram):
        cmd = [sys.executable, str(SC / "freq_lint.py"),
               "--phrase-thresh", str(phrase), "--unigram-thresh", str(unigram)]
        if baseline:
            cmd += ["--baseline", baseline, "--fail-on-new-only"]
        if theme:
            cmd += ["--theme", theme]
        return cmd + files

    if batch_files:
        results["freq"] = run("freq_lint.py (batch, themed, vs prev, new-tics-gate)",
                              freq_cmd(batch_files, prev_batch[0] if prev_batch else None,
                                       0.35, 0.65))
    if oc_files:
        results["freq_oc"] = run("freq_lint.py (OC, 0.70/0.99 small-file)",
                                 freq_cmd(oc_files, prev_oc[0] if prev_oc else None,
                                          0.70, 0.99))

    print("─" * 72)
    hard = {k: v for k, v in results.items() if not k.endswith("*") and "diag" not in k}
    ok = sum(1 for v in hard.values() if v)
    print(f"RESULT: {ok}/{len(hard)} hard gates PASS"
          + (f" · FAIL: " + ", ".join(k for k, v in hard.items() if not v) if ok < len(hard) else ""))

    # §62 FIRST-PASS status — вердикт из леджера рецептов (лейаут:
    # первый рецепт слага = первый прогон; sha-дельта между соседними
    # прогонами = фикс-пасс; оплата — root-cause + пункт контракта).
    # house_lint уже дописал рецепт этого прогона (шаг 0a) — метрика
    # включает текущий запуск. Информационно: гейты решают коды выхода.
    try:
        import io as _io2
        sys.path.insert(0, str(SC))
        import house_lint as _hl
        runs, verdict, fixp = _hl.first_pass_stats(slug)
        if runs:
            print(f"§62 FIRST-PASS [{slug}]: {verdict} · прогонов {runs} · "
                  f"фикс-пассов {fixp}"
                  + (" — оплата §62(3): root-cause + пункт контракта" if fixp else ""))
        else:
            print(f"§62 FIRST-PASS [{slug}]: нет рецептов — house_lint ещё не "
                  f"прогонялся по конфигу (ритуал V21, шаг 5)")
    except Exception as _e:
        print(f"§62 FIRST-PASS [{slug}]: леджер недоступен ({_e})")
    print("═" * 72)
    sys.exit(0 if ok == len(hard) else 1)


if __name__ == "__main__":
    main()
