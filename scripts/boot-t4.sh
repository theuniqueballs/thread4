#!/bin/bash
# THREAD 4 boot — поднимает весь стек песочницы. Идемпотентен.
#
# ГЛАВНЫЙ УРОК ПЕСОЧНИЦЫ (2026-10-22): все живые демоны держат cwd ВНУТРИ
# /home/z/my-project — процессы с cwd вне неё песочница молча убивает за
# ~20-60 секунд (проверено на t4-engine-rs). Подробности: Recover_Sandbox.md.
#
# Порядок: bun-движок :3200 → twin :3201 (dev.sh сам поставит rustup при
# снесённом cargo) → next :3000 (если платформа ещё не подняла) → health.
set -u
ROOT=/home/z/my-project
LOG_T4="$ROOT/t4-engine.log"
LOG_RS="$ROOT/t4-engine-rs.log"
LOG_DEV="$ROOT/dev.log"

say() { echo "[boot-t4] $*"; }

# 0) node_modules при первом буте
[ -d "$ROOT/node_modules" ] || { say "bun install (root)"; (cd "$ROOT" && bun install); }
[ -d "$ROOT/mini-services/t4-engine/node_modules" ] || \
  { say "bun install (t4-engine)"; (cd "$ROOT/mini-services/t4-engine" && bun install); }

# 1) bun-движок :3200 (SSoT)
if curl -s -m 2 http://127.0.0.1:3200/v1/health | rg -q '"ok":true' 2>/dev/null; then
  say ":3200 уже жив — пропускаю"
else
  say "поднимаю t4-engine :3200"
  (cd "$ROOT/mini-services/t4-engine" && setsid nohup bun --hot index.ts > "$LOG_T4" 2>&1 &)
fi

# 2) twin :3201 (Rust, RO-прод + scratch) — dev.sh самовосстанавливающийся
if curl -s -m 2 http://127.0.0.1:3201/v1/health | rg -q '"ok":true' 2>/dev/null; then
  say ":3201 уже жив — пропускаю"
else
  say "поднимаю t4-engine-rs :3201 (первый бут может ставить rustup ~40с и собирать ~1-2 мин)"
  (cd "$ROOT/mini-services/t4-engine-rs" && setsid nohup bash dev.sh > "$LOG_RS" 2>&1 &)
fi

# 3) десктоп :3000 — платформа обычно уже подняла; поднимаем только если нет
code=""
for i in $(seq 1 4); do
  code=$(curl -s -m 2 -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 2
done
if [ "$code" != "200" ]; then
  say "поднимаю next :3000"
  (cd "$ROOT" && setsid nohup bun run dev > "$LOG_DEV" 2>&1 &)
fi

# 4) ожидание health + сводка
ok3200=""; ok3201=""; ok3000=""
for i in $(seq 1 30); do
  curl -s -m 2 http://127.0.0.1:3200/v1/health | rg -q '"ok":true' 2>/dev/null && ok3200=1
  curl -s -m 2 http://127.0.0.1:3201/v1/health | rg -q '"ok":true' 2>/dev/null && ok3201=1
  c=$(curl -s -m 2 -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ 2>/dev/null)
  [ "$c" = "200" ] && ok3000=1
  [ -n "$ok3200" ] && [ -n "$ok3201" ] && [ -n "$ok3000" ] && break
  sleep 2
done
say ":3200 ${ok3200:+OK}${ok3200:-НЕ ПОДНЯЛСЯ (лог: $LOG_T4)}"
say ":3201 ${ok3201:+OK}${ok3201:-НЕ ПОДНЯЛСЯ (лог: $LOG_RS)}"
say ":3000 ${ok3000:+OK}${ok3000:-НЕ ПОДНЯЛСЯ (лог: $LOG_DEV)}"
[ -n "$ok3200" ] && [ -n "$ok3201" ] && [ -n "$ok3000" ] && say "стек жив — золотой путь: bash scripts/verify-golden-path.sh"
exit 0
