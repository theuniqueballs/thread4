#!/bin/bash
# scripts/cleanup_scripts.sh — 2026-09-16, global cleanup (Task c4)
# Splits scripts/ into the live arsenal (top level) vs archive/ (one-off
# fix-passes, per-batch mutators, part fragments of already-assembled batches).
set -euo pipefail
SC=/home/z/my-project/scripts
mkdir -p "$SC/archive"

# --- LIVE CORE (reusable, referenced by pipeline.py / verify / export) ---
KEEP=(
  pipeline.py
  rating_gate_lint.py
  ph_sim_gate.py
  test_gate_v5.py
  rhythm_lint.py
  freq_lint.py
  sp_lint.py
  verify_system.py
  export_system_md.py
  archive_system.py
  save_batch_history.py
  usage_audit.py
  color_audit.py
  # current batch (n28) per-batch gates, discovered by pipeline.py
  batch_n28_lint.py
  batch_n28_simcheck.py
  oc_orders_n28_set3_lint.py
  oc_n28set3_simcheck.py
)

cd "$SC"
moved=0
for f in *.py; do
  keep=false
  for k in "${KEEP[@]}"; do [[ "$f" == "$k" ]] && keep=true; done
  if ! $keep; then mv "$f" archive/ && moved=$((moved+1)); fi
done

# part fragments & loose artifacts of assembled batches → archive
for d in n16_parts n17_parts n18_parts n19_parts n20_parts n21_parts \
         n22_parts n23_parts n24_parts n25_parts n26_parts anatomy_parts; do
  [[ -d "$d" ]] && mv "$d" archive/ && moved=$((moved+1))
done
for f in window_n23.json window_n24.json oc_n25_ext.md n15_pre_decard_backup.md; do
  [[ -f "$f" ]] && mv "$f" archive/ && moved=$((moved+1))
done

echo "moved to archive: $moved entries"
echo "live at top level:"; ls "$SC" | grep -v "^archive$"
echo "archive contents: $(ls "$SC/archive" | wc -l) entries"
