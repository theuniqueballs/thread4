# Recover_Sandbox — восстановление THREAD 4 после пересборки песочницы

Полная процедура поднятия стека «с нуля» за ~10 минут. Написана по свежим
граблям (пересборки бокса 2026-10-19 и 2026-10-22). Главное правило:

> **ВСЕ живые демоны держат cwd ВНУТРИ `/home/z/my-project`.**
> Песочница молча убивает фоновые процессы, чей cwd лежит вне этой папки
> (проверено на t4-engine-rs: из `/home/z/thread4` умирал за ~20 секунд,
> foreground жил — виноват cwd, не движок).

---

## 1. Что теряется при пересборке и где живёт копия

| Артефакт | Путь в песочнице | Переживает? | Копия |
|---|---|---|---|
| Код десктопа + движков | `/home/z/my-project/src`, `mini-services` | ❌ | **гит, ветка `thread4.1`** |
| Прод-летопись (SSoT, bun:sqlite) | `mini-services/t4-engine/data/t4.db` | ❌ | **гит** (снапшот-доктрина, коммитится руками) |
| Файловый хвост летописи (файл-эра) | `thread4/events/*.jsonl`, `thread4/engines-archive.jsonl` | ❌ | **гит** |
| Батчи/контракты (markdown) | `thread4/batches/`, `thread4/contracts/` | ❌ | **гит** |
| Scratch-летопись twin'а | `mini-services/t4-engine-rs/data/` | ❌ | не нужна — twin пересоздаёт сам |
| Собранный twin (`target/`) | `mini-services/t4-engine-rs/target/` | ❌ | не нужен — `dev.sh` пересоберёт (1–2 мин) |
| `node_modules` | везде | ❌ | `bun install` |
| Rust toolchain `~/.cargo` | `$HOME/.cargo` | ❌ | `dev.sh` twin'а ставит rustup сам (см. §4) |
| Ключ командира | `~/.t4/commander.key` | ❌ | **НЕ в гите** (секрет). Регенерация — §6 |
| `.env` / `.env.local` | `/home/z/my-project/` | ❌ | платформенные, THREAD 4 их не читает |
| Caddyfile, package.json, tsconfig | `/home/z/my-project/` | перезаписываются платформенным скелетом | гит-версии в репо (см. §5, шаг 4) |
| платформенный persist-гит | `/home/z/my-project/.git` | ❌ | служебный (авто-коммиты песочницы), тредом не используется |
| prisma `db/`, `skills/`, `examples/` | | ❌ | платформенный скелет, тред не использует |

**Доктрина снапшота:** состояние прод-летописи живёт в гите. После каждой
значимой сессии (новые звенья цепи, новые батчи) — залить `t4.db` +
`thread4/events/*` в `thread4.1`. Потеря бокса тогда стоит ноль.

## 2. Точки входа

- Репо: `github.com/theuniqueballs/thread4`, рабочая ветка **`thread4.1`**.
- PAT: выдаёт владелец в чате **двумя половинами** — склеить без пробела
  (`P1` + `P2`). В файлы/конфиги/историю НЕ писать; git — только через
  одноразовый `http.extraheader` (см. ниже), после — `unset`.
- Порты: `:3000` — десктоп (Next.js), `:3200` — t4-engine (bun, SSoT),
  `:3201` — t4-engine-rs (Rust twin, RO-прод + scratch).

## 3. Шаг 0 — одноразовый клон (гигиена секретов)

```bash
export HISTFILE=/dev/null            # токен не попадает в history
A='<половина 1>'; B='<половина 2>'; PAT="${A}${B}"   # склеить БЕЗ пробела
H=$(printf 'x-access-token:%s' "$PAT" | base64 -w0)
git -c http.extraheader="Authorization: Basic $H" clone -b thread4.1 \
  https://github.com/theuniqueballs/thread4.git /home/z/thread4
git -C /home/z/thread4 fetch -q origin '+refs/tags/*:refs/tags/*'
unset PAT H A B
# проверка чистоты: в remote URL не должно быть токена
git -C /home/z/thread4 config --get remote.origin.url   # → чистый https-URL
```

PAT проверять одним `ls-remote` до клона — если `could not read Username`,
склейка сломана (типичная ошибка: `printf 'A' 'B'` молча теряет второй
аргумент — используй `PAT="${A}${B}"`).

## 4. Шаг 1 — бут стека одним скриптом

В репо есть `scripts/boot-t4.sh` (идемпотентен, можно дёргать повторно):

```bash
bash /home/z/thread4/scripts/boot-t4.sh
```

Он делает ровно это (порядок важен):

1. **bun-движок :3200**
   ```bash
   (cd /home/z/my-project/mini-services/t4-engine && \
    setsid nohup bun --hot index.ts > /home/z/my-project/t4-engine.log 2>&1 &)
   ```
2. **twin :3201** — через `dev.sh`, он сам ставит rustup, если `cargo` снесён
   перезаливом бокса (ставит minimal-profile, ~40 с), затем собирает и
   запускает:
   ```bash
   (cd /home/z/my-project/mini-services/t4-engine-rs && \
    setsid nohup bash dev.sh > /home/z/my-project/t4-engine-rs.log 2>&1 &)
   ```
3. **десктоп :3000** — платформа песочницы обычно поднимает `next dev` сама;
   если нет:
   ```bash
   (cd /home/z/my-project && setsid nohup bun run dev > /home/z/my-project/dev.log 2>&1 &)
   ```
4. Ждёт health обоих движков и печатает сводку (см. §7).

`bun install` при первом буте: `cd /home/z/my-project && bun install`
(и в `mini-services/t4-engine` при отсутствии `node_modules`).

## 5. Шаг 2 — раскладка файлов по песочнице

Если платформа пересобрала my-project со скелетом (пустой `src/`):

```bash
rsync -a /home/z/thread4/src/            /home/z/my-project/src/
rsync -a /home/z/thread4/public/         /home/z/my-project/public/
rsync -a /home/z/thread4/mini-services/  /home/z/my-project/mini-services/
rsync -a /home/z/thread4/thread4/        /home/z/my-project/thread4/
# конфиги: репо-версии правильные, но платформа держит свой скелет —
# сверять руками, перезаписывать осознанно:
#   Caddyfile, package.json (dev-скрипт), tsconfig.json, next.config.ts
```

**НЕ копировать** в my-project: `.env*` (платформенные), `db/`, `prisma/`,
`skills/`, `examples/`, `node_modules`, `.git` (у my-project свой служебный).

## 6. Ключ командира

```bash
mkdir -p ~/.t4 && openssl rand -base64 24 > ~/.t4/commander.key
chmod 600 ~/.t4/commander.key && cat ~/.t4/commander.key   # 31 символ
```

- Мутации кромки требуют заголовка `x-commander-key: <ключ>`.
- Ключ в гит НЕ попадает (`.gitignore`: `commander.key`, `~/.t4/`) — это
  осознанно: секрет после потери бокса считается скомпрометированным
  (он светился в логах/чате), новый бокс = новый ключ, который владелец
  получает свежим.
- Ротация = перезаписать файл + сообщить ключ владельцу.

## 7. Верификация (золотой путь)

```bash
bash /home/z/thread4/scripts/verify-golden-path.sh
```

Критерии живого стека (все команды с cwd внутри `/home/z/my-project`):

| Проверка | Ожидание |
|---|---|
| `curl -s :3200/v1/health` | `"ok":true, "engine":"t4-engine"` |
| `curl -s :3201/v1/health` | `"ok":true, "engine":"t4-engine-rs"`, прод RO |
| `curl -s :3201/v1/chain/verify` | `ok:true`, 473+ звена, `problems:[]` |
| `curl -s :3000/api/t4/state` | `degraded:false`, состав движок∪файл-хвост |
| `curl -s :3000/api/t4/cycle` | `ok:true`, без `stopped` |
| `:3000` в браузере | рендер «THREAD 4», футер прибит, мобильный 390px без оверфлоу |

## 8. Заливка снапшота обратно в гит (после сессии)

```bash
cd /home/z/thread4
cp /home/z/my-project/mini-services/t4-engine/data/t4.db mini-services/t4-engine/data/t4.db
cp /home/z/my-project/thread4/events/*.jsonl thread4/events/
cp /home/z/my-project/thread4/engines-archive.jsonl thread4/
cp /home/z/my-project/thread4/batches/*.md thread4/batches/ 2>/dev/null
cp /home/z/my-project/thread4/contracts/* thread4/contracts/ 2>/dev/null
git add -A && git commit -m "snapshot: t4.db + file-tail + batches" && git push
```

`git push` внутри клона работает без extraheader только если remote чистый и
креденшлы не сохранились (клон по extraheader их НЕ сохраняет — пушить так же
одноразово: `git -c http.extraheader="Authorization: Basic $H" push origin thread4.1`).

## 9. Известные грабли

1. **cwd вне my-project → молчаливая смерть демона.** Симптом: процесс есть,
   порт слушает, через минуту-две процесса нет, лог чист. Лечение: запускать
   изнутри `/home/z/my-project` (см. шапку).
2. **`cargo: command not found` при буте twin** — перезалив бокса снёс
   `~/.cargo`. Лечение уже в `dev.sh` (авто-установка rustup minimal).
   Ручной вариант: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable`
3. **Молча умер первый запуск rustup из nohup-фона** — установка из фоновой
   сессии может не пережить закрытие shell. Ставь rustup foreground'ом.
4. **Склейка PAT**: `printf 'A' 'B'` теряет второй аргумент; только `PAT="${A}${B}"`.
5. **`t4.db-wal/-shm` живые при копировании** — останови bun-движок
   (`pkill -f 'bun --hot index.ts'`) или смирись: снапшот чуть отстанет,
   `-wal` отфильтрован игнором движка. Для чистого снапшота: SQLite
   `VACUUM INTO` либо копия при остановленном движке.
6. **Платформа перезаписывает `package.json`/`tsconfig`** при пересборке —
   после восстановления сверить с репо (у репо `-H 127.0.0.1`, security
   headers, строгие exclude в tsconfig).
7. **my-project/.git** — служебный persist песочницы (авто-коммиты «persist:
   write:…»), remote пуст. Не путать с гитом треда (`/home/z/thread4`).
8. **Twin умирает с Connection refused, но health-порт слушался** — см. граблю 1.

## 10. Быстрая шпаргалка

```bash
# бут всего стека
bash /home/z/thread4/scripts/boot-t4.sh
# золотой путь
bash /home/z/thread4/scripts/verify-golden-path.sh
# снапшот в гит (см. §8)
# ключ (см. §6)
```
