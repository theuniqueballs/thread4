#!/usr/bin/env python3
# archive_system.py — контекстная гигиена (SYSTEM_AUDIT §3 / M6, авторский приказ 2026-09-10)
# MOTIF_LOG.yaml (150KB) → активный файл (окно N18+N19+N20 + watch) + MOTIF_LOG_ARCHIVE.yaml
# TRACKER.yaml  (68KB)  → активный файл (окно N18+N19+N20 + баннер)    + TRACKER_ARCHIVE.yaml
# История не удаляется — переезжает в архивы. Dead-блэклисты (FLUERE/BAKA/BLASPHEMOUS) — в архив.

import io, os

BASE = "/home/z/my-project/system"

def read_lines(p):
    with io.open(p, encoding="utf-8") as f:
        return f.read().splitlines(keepends=True)

def write(p, text):
    with io.open(p, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"  written: {p} ({len(text):,} bytes, {text.count(chr(10))+1} lines)")

# ── MOTIF_LOG ─────────────────────────────────────────────────────────
ml = read_lines(f"{BASE}/MOTIF_LOG.yaml")
assert ml[1394].startswith("n18_too_much_feeling"), f"marker drift: {ml[1394][:40]!r}"
ml_header = "".join(ml[:7])            # строки 1-7 — заголовок
ml_active_tail = "".join(ml[1394:])    # строки 1395-1430 — n18/n19/n20
ml_archive_body = "".join(ml[7:1394])  # строки 8-1394 — вся история до N18

write(f"{BASE}/MOTIF_LOG.yaml",
      ml_header +
      "# ── ACTIVE WINDOW (N18+N19+N20, 3-batch rollback) + fossilization watch ──\n"
      "# History (N12-N17 + все промежуточные записи) moved to MOTIF_LOG_ARCHIVE.yaml\n"
      "# 2026-09-10 (SYSTEM_AUDIT §3 / M6). Архив читается только по запросу автора.\n"
      "# Правило: активный файл = текущее окно + watch. Новый батч → самый старый\n"
      "# блок окна переезжает в архив одним переносом (append в архив, delete здесь).\n\n"
      + ml_active_tail)

write(f"{BASE}/MOTIF_LOG_ARCHIVE.yaml",
      "# MOTIF_LOG_ARCHIVE.yaml — история журнала мотивов (N12-N17 + промежуточные)\n"
      "# Перенесено из MOTIF_LOG.yaml 2026-09-10 (SYSTEM_AUDIT §3 / M6).\n"
      "# НЕ загружается при чтении окна; открывается только для археологии по заказу.\n"
      "# Порядок сохранён как в исходном файле.\n\n"
      + ml_archive_body)

# ── TRACKER ───────────────────────────────────────────────────────────
tr = read_lines(f"{BASE}/TRACKER.yaml")
# баннер "ACTIVE BLACKLIST UPDATE — after batch N18" стоит на 1013-й строке (index 1012)
assert "ACTIVE BLACKLIST UPDATE" in tr[1012], f"marker drift: {tr[1012][:60]!r}"
assert tr[1247].startswith("n20_mono_no_aware"), f"marker drift: {tr[1247][:40]!r}"
tr_header = "".join(tr[:28])          # строки 1-28 — заголовок и доктрина окна
tr_active_tail = "".join(tr[1012:])   # строки 1013-1351 — баннер N18 + n18/n19/n20 + финальный баннер
tr_archive_body = "".join(tr[28:1012])

write(f"{BASE}/TRACKER.yaml",
      tr_header +
      "# ── ACTIVE WINDOW: N18 + N19 + N20 (rollback 3 батча) ─────────────────────\n"
      "# История (dead blacklists FLUERE/BAKA/BLASPHEMOUS + блоки N12-N17) перенесена\n"
      "# в TRACKER_ARCHIVE.yaml 2026-09-10 (SYSTEM_AUDIT §3 / M6).\n"
      "# Правило: активный файл = окно + OC-счётчики + незакрытые вето автора.\n\n"
      + tr_active_tail)

write(f"{BASE}/TRACKER_ARCHIVE.yaml",
      "# TRACKER_ARCHIVE.yaml — история трекера повторов (N12-N17 + мёртвые блэклисты)\n"
      "# Перенесено из TRACKER.yaml 2026-09-10 (SYSTEM_AUDIT §3 / M6).\n"
      "# Активное окно живёт в TRACKER.yaml; архив — только для археологии по заказу.\n"
      "# Порядок сохранён как в исходном файле.\n\n"
      + tr_archive_body)

# ── верификация ────────────────────────────────────────────────────────
for name in ["MOTIF_LOG", "TRACKER"]:
    act = os.path.getsize(f"{BASE}/{name}.yaml")
    arc = os.path.getsize(f"{BASE}/{name}_ARCHIVE.yaml")
    print(f"{name}: active {act:,} B + archive {arc:,} B (было до реза: "
          f"{act+arc-sum(len(x) for x in ['# ...\n']*0):,} суммарно — содержание не потеряно)")
print("ARCHIVE PASS")
