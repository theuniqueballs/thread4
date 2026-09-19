#!/usr/bin/env python3
# color_audit.py — диагностика «маски блеклости» (author order 2026-09-10)
# Считает по каждому промпту батча:
#   SAT words  — слова-носители насыщения (указывают модели НЕ бледнить)
#   DESAT words — блеклые слова (pale/faint/dusty/muted/worn/smoke/ash/fog/mist/grey...)
#   ratio = DESAT / SAT, и сколько «pale-*» акцентов пришло из палитры
#   color closer — последняя цветовая строка POS (качество-теги §6/§18B)
# Гипотеза: чем выше доля DESAT-слов в POS, тем сильнее модель кладёт
# поверх картинки молочную вуаль, даже когда палитра формально хорошая.

import re, glob, sys

SAT_WORDS = [
    "richly pigmented", "saturated", "vivid", "jewel", "lacquer",
    "glowing", "burnished", "deep-", "bright", "brilliant", "luminous",
    "incandescent", "molten", "ember-", "corona", "vermilion", "crimson",
    "blood-moon", "blood-red", "bioluminescent", "gold-leaf", "gilt",
]
# отдельный класс: слова, которые сами по себе тянут картинку в блеклость
DESAT_WORDS = [
    "pale", "faint", "dusty", "washed", "muted", "desaturated", "flat",
    "smoke", "ash-grey", "ash-", "worn", "grey", "gray", "fog", "mist",
    "haze", "milky", "washed-out", "faded", "thin light", "thins",
    "bleached", "softly", "diffuse", "ghost", "drowsy", "drugged",
]

def analyze(path, label):
    print(f"\n{'='*72}\n{label}: {path}\n{'='*72}")
    text = open(path, encoding="utf-8").read()
    # формат батча: "P01 — kebab (GENRE — Act, PALETTE, ...)" строки
    blocks = re.split(r"\n(?=P\d\d — )", text)
    prompts = []
    for b in blocks:
        m = re.match(r"(P\d\d) — ", b)
        if not m:
            continue
        pm = re.search(r"^POS:\s*\n\s*\n(.*?)(?=^NEG:|\Z)", b, re.M | re.S)
        if not pm:
            continue
        pos = pm.group(1).strip()
        prompts.append((m.group(1), pos))
    totals = {"sat": 0, "desat": 0, "n": 0}
    rows = []
    for pid, pos in prompts:
        low = pos.lower()
        sat = 0
        for w in SAT_WORDS:
            sat += len(re.findall(re.escape(w), low))
        desat = 0
        for w in DESAT_WORDS:
            desat += len(re.findall(r"\b" + re.escape(w), low))
        # цветовой хвост: предложение с "tones" или "Masterpiece"
        closer = ""
        for s in re.split(r"(?<=[.!?])\s+", pos):
            if "tones" in s.lower() or "masterpiece" in s.lower():
                closer = s.strip()[:120]
        rows.append((pid, sat, desat, closer))
        totals["sat"] += sat; totals["desat"] += desat; totals["n"] += 1
    for pid, sat, desat, closer in rows:
        flag = " <-- WASH RISK" if desat > sat * 1.5 and desat >= 6 else ""
        print(f"{pid}  SAT={sat:2d}  DESAT={desat:2d}  {closer}{flag}")
    if totals["n"]:
        print(f"\nTOTAL: SAT={totals['sat']}  DESAT={totals['desat']}  "
              f"ratio={totals['desat']/max(1,totals['sat']):.2f}  on {totals['n']} prompts")
        wash = sum(1 for _, s, d, _ in rows if d > s * 1.5 and d >= 6)
        print(f"WASH-RISK prompts: {wash}/{totals['n']}")

for p, lbl in [
    ("/home/z/my-project/download/BATCH_N20_MONO_NO_AWARE.md", "N20"),
    ("/home/z/my-project/download/BATCH_N19_THE_ABYSS_HAS_A_MEMORY.md", "N19"),
    ("/home/z/my-project/download/BATCH_N18_TOO_MUCH_FEELING_NOT_ENOUGH_TIME.md", "N18"),
]:
    try:
        analyze(p, lbl)
    except Exception as e:
        print(f"{lbl}: SKIP ({e})")
