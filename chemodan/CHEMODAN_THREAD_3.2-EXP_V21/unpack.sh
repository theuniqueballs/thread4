#!/usr/bin/env bash
# unpack.sh — восстановление THREAD 3.2-EXP-V21 из чемодана (см. README_MIGRATION.md)
# Использование:
#   ./unpack.sh [--force] [/путь/к/дому]
# По умолчанию дом = /home/z/my-project (органы хардкодят этот корень).
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
FORCE=0
TARGET=/home/z/my-project
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    *) TARGET="$a" ;;
  esac
done

echo "CHEMODAN THREAD 3.2-EXP-V21 -> $TARGET  (src: $SRC)"

# 0) охрана перезаписи
if [ -f "$TARGET/system/RULES.md" ] && [ "$FORCE" -ne 1 ]; then
  echo "ОШИБКА: $TARGET/system/RULES.md уже существует."
  echo "Дом обитаем. Перезапись — только осознанно:  ./unpack.sh --force $TARGET"
  exit 1
fi

# 1) зависимости
python3 -c "import yaml" 2>/dev/null || {
  echo "ПРЕДУПРЕЖДЕНИЕ: PyYAML не найден (house_lint/pipeline требуют)."
  echo "  Установка:  pip install pyyaml"
}

# 2) дерево
mkdir -p "$TARGET"/{system,scripts,download,backup}

# 3) файлы (1:1 из чемодана; download/ ПЛОСКО — контракт гейтов: спайн
#    сканирует всю историю: голова K-минта, X-фоссили; подкаталоги не читаются)
cp -v "$SRC"/system/*   "$TARGET"/system/
cp "$SRC"/scripts/*     "$TARGET"/scripts/   # 25 файлов, без подкаталогов
cp "$SRC"/download/*    "$TARGET"/download/  # 33 файла, плоско
cp "$SRC"/worklog/worklog.md                    "$TARGET"/worklog.md
cp "$SRC"/worklog/worklog_archive_tasks_1-30.md "$TARGET"/backup/
echo "Файлы на месте: $(find "$TARGET"/system "$TARGET"/scripts -type f | wc -l) в system+scripts," \
     "$(ls "$TARGET"/download | wc -l) в download."

# 4) дым-тест (ожидания — README_MIGRATION.md §4)
echo
echo "=== ДЫМ-ТЕСТ ==="
cd "$TARGET"
python3 scripts/verify_system.py          || { echo "FAIL verify_system"; exit 1; }
python3 scripts/test_gate_v5.py           || { echo "FAIL test_gate_v5"; exit 1; }
python3 scripts/spine.py selftest         || { echo "FAIL spine selftest"; exit 1; }
python3 scripts/house_lint.py --selftest  || { echo "FAIL house selftest"; exit 1; }
python3 scripts/pipeline.py n29           || { echo "FAIL pipeline n29"; exit 1; }

echo
echo "=== ГОТОВО ==="
echo "Следующий шаг по потоку: N30 — первый батч, градуируемый FIRST_RUN_CLEAN (§62)."
echo "Ритуал: scripts/README.md §«Ритуал цикла (V21)»; спайн: python3 scripts/spine.py compile n30"
