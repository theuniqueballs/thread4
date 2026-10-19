#!/usr/bin/env bash
# THREAD 4 RUST TWIN — boot-resilient dev entry.
#
# WHY THIS EXISTS: box re-uploads wipe ~/.cargo (rustup toolchain lives
# outside the repo), so the stock `cargo build …` dev script dies at boot
# with `cargo: command not found` (see /tmp/mini-service-t4-engine-rs.log
# from the 2026-10-19 boot). This entry self-heals: installs rustup minimal
# if needed, then builds and runs. Boot runs it in the background, so the
# install latency (~40s) never blocks anything.
set -euo pipefail

export PATH="$HOME/.cargo/bin:$PATH"

if ! command -v cargo >/dev/null 2>&1; then
  echo "[t4-engine-rs] cargo не найден — ставлю rustup minimal (перезалив бокса сносит ~/.cargo)"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain stable
  # rustup пишет PATH в ~/.profile и ~/.bashrc; этот скрипт уже экспортил PATH выше,
  # но подстрахуемся на случай смены layout'а в будущем:
  [ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
fi

cargo build --release
exec ./target/release/t4-engine-rs
