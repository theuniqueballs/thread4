#!/bin/sh
# Песочница полного конвейера (ревизия 2026-10-14): клон репо в .t4-sandbox/
# (gitignored), летопись-копия — настоящий лог не тронут. Прогон:
#   bun thread4/tools/contract-from-batch... (см. docs/REVISION-2026-10-14.md)
# Перезапуск: rsync-клон → sh thread4/tools/sandbox-pipeline.sh
# T4 SANDBOX PIPELINE — полный инструментированный конвейер на ЛЕТОПИСИ-КОПИИ.
# Настоящий репо не получает ни одного события: всё пишется в .t4-sandbox/.
# Стадии: compile → scribe (настоящий LLM) → check → deliver → verify.
P=/home/z/my-project/thread4/tools/trace-preload.cjs
T=/tmp/t4-trace
cd /home/z/my-project/.t4-sandbox || exit 1

echo "=== [1/5] compile ==="
T4_TRACE_OUT=$T/sbx-compile.log bun --preload $P thread4/cli.ts compile "Песочница ревизии 2026-10-13: конвейер на копии летописи" > /tmp/t4-trace/sbx-compile-stdout.log 2>&1
SLUG=$(grep -oE 'T4-[0-9]+' /tmp/t4-trace/sbx-compile-stdout.log | head -1)
echo "SLUG=$SLUG"
if [ -z "$SLUG" ]; then echo "FATAL: compile не дал слага"; exit 1; fi

echo "=== [2/5] scribe (LLM, долго) ==="
T4_TRACE_OUT=$T/sbx-scribe.log bun --preload $P thread4/cli.ts scribe "$SLUG" > /tmp/t4-trace/sbx-scribe-stdout.log 2>&1
echo "scribe exit=$?"

echo "=== [3/5] check (сухие гейты) ==="
T4_TRACE_OUT=$T/sbx-check.log bun --preload $P thread4/cli.ts check "$SLUG" > /tmp/t4-trace/sbx-check-stdout.log 2>&1
echo "check exit=$?"

echo "=== [4/5] deliver ==="
T4_TRACE_OUT=$T/sbx-deliver.log bun --preload $P thread4/cli.ts deliver "$SLUG" > /tmp/t4-trace/sbx-deliver-stdout.log 2>&1
echo "deliver exit=$?"

echo "=== [5/5] verify (цепь копии) ==="
T4_TRACE_OUT=$T/sbx-verify.log bun --preload $P thread4/cli.ts verify > /tmp/t4-trace/sbx-verify-stdout.log 2>&1
echo "verify exit=$?"
tail -2 /tmp/t4-trace/sbx-verify-stdout.log
echo "SANDBOX PIPELINE DONE"
