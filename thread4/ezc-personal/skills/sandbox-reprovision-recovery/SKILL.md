---
name: sandbox-reprovision-recovery
description: Sandbox reprovision survival ritual for Thread-4 — what dies and what survives a re-provision, commander key reissue, three-branch probe verification (header x-commander-key, NOT query param), restore order (server → key → probe → browser → Glass), and flash-resilient placement rules for all working artifacts.
---

# Sandbox Reprovision Recovery (ритуал выживания реапа)

## Что умирает и что выживает

| Умирает | Выживает |
|---|---|
| `~/.t4/` (ключ командира, read.lock) | `/home/z/my-project/` целиком |
| Клоны вне проекта (`/home/z/everything-zcode`, …) | `thread4/` — летопись, батчи, контракты, спеки |
| `/home/z/Issues/`, `/tmp/*` | git-снапшоты персиста внутри проекта |
| Браузерное localStorage (ключ в Стекле) | ворклог `worklog.md` |
| Запущенные процессы (dev-сервер, мини-сервисы) | `dev.log` перезаписывается |

Правило размещения: **всё, что дорого, — внутри my-project** (персонализация
внешних инструментов — мастер-копией в `thread4/ezc-personal/`, синхронизация
в клон скриптом, не руками).

## Порядок восстановления (проверен 3+ реапами)

1. **Сверка**: `wc -l thread4/events/log.jsonl` + хвост ворклога — сколько
   событий и чем закончился прошлый раунд.
2. **Ключ**: `mkdir -p ~/.t4 && openssl rand -hex 24 > ~/.t4/commander.key
   && chmod 600 ~/.t4/commander.key`. Показать автору в ответе.
3. **Сервер**: `nohup bun run dev > dev.log 2>&1 &`, ждать `:3000`.
4. **Probe-трёхветка** — ВНИМАНИЕ, ключ идёт ЗАГОЛОВКОМ, не query:
   ```bash
   curl -s localhost:3000/api/t4/events?probe=1                      # keyOk:false
   curl -s localhost:3000/api/t4/events?probe=1 -H 'x-commander-key: wrong'  # keyOk:false
   curl -s localhost:3000/api/t4/events?probe=1 -H "x-commander-key: $(cat ~/.t4/commander.key)"  # keyOk:true
   curl -s -o /dev/null -w '%{http_code}' -X POST localhost:3000/api/t4/events -d '{}'  # 403
   ```
   Query-параметр `key` замок НЕ читает — частая ловушка.
5. **Цепь**: `bun run thread4/tools/verify-chain-quick.ts` → `chain: OK`.
6. **Браузер**: agent-browser → `/` → вкладка Стекло → вставить ключ →
   Сохранить → Проверить → «ключ совпал». Событие «тред восстановлен»
   в летопись POST-ом с ключом.
7. **Внешние инструменты**: переклонировать (публичное репо — без PAT),
   синхронизировать персонализацию из мастер-копии, поднять на своём порту.

## PAT-протокол

PAT одноразовый: в env/креды/файлы не пишется, живёт только в команде
текущего раунда. Из git-конфига клонированного по PAT — вычищать сразу
(`git remote set-url` на https-без-токена).
