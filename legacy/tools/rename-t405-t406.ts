/**
 * Задача 7 (2): переименование предыдущего T4-05 (контракт limen,
 * 2026-09-23 11:27, сессия оборвалась до письма батча) → T4-06.
 * Приказ автора: «Если найдёшь предыдущий, переименуешь в T4-06».
 * Найден — переименовываем; новый T4-05 «The Unnamed Goddess» будет
 * произведён заново (свежий контракт под текущий закон: салиенс +
 * noun-lock + A/B-пары).
 */
import path from 'node:path'

import { appendEvent } from '../../src/lib/t4/events'
import { CONTRACTS_DIR, readJson, writeJson, writeText, readText } from '../../src/lib/t4/fsutil'
import { contractMarkdown, type BatchContract } from '../../src/lib/t4/compiler'

const oldSlug = 'T4-05'
const newSlug = 'T4-06'

const contract = readJson<BatchContract>(path.join(CONTRACTS_DIR, `${oldSlug}.json`))
if (!contract) {
  throw new Error(`контракт ${oldSlug} не найден — нечего переименовывать`)
}
if (readText(path.join(CONTRACTS_DIR, `${newSlug}.md`)) != null) {
  throw new Error(`контракт ${newSlug} уже существует — отмена`)
}

contract.slug = newSlug
writeJson(path.join(CONTRACTS_DIR, `${newSlug}.json`), contract)
writeText(path.join(CONTRACTS_DIR, `${newSlug}.md`), contractMarkdown(contract))

// удалить старые файлы (контент сохранён под T4-06)
for (const ext of ['json', 'md'] as const) {
  const p = path.join(CONTRACTS_DIR, `${oldSlug}.${ext}`)
  const fs = await import('node:fs')
  fs.rmSync(p)
}

// событие компиляции T4-06 — фолд узнаёт слаг (иначе следующая сборка
// попытается занять T4-06 и перезапишет файлы)
appendEvent(
  'batch.compiled',
  `${newSlug} «${contract.theme}» — контракт скомпилирован (движок ${contract.engine}, мейны R+×12 · R×7 · X×2)`,
  { slug: newSlug, theme: contract.theme, engine: contract.engine, seed: contract.seed, recompile: false }
)

// примечание о переименовании (приказ автора)
appendEvent(
  'note',
  `Переименование по приказу автора: предыдущий T4-05 «${contract.theme}» (контракт ${contract.engine}, сид ${contract.seed}, скомпилирован 2026-09-23 11:27 — сессия оборвалась до письма батча) сохранён как T4-06. Новый T4-05 «The Unnamed Goddess» производится заново под текущий закон (§9-секста салиенс, §10-поправка: A/B-пары + noun-lock + слепой VLM)`,
  { rename: { from: oldSlug, to: newSlug }, engine: contract.engine, seed: contract.seed, order: 'автор, 2026-09-23' }
)

console.log(`${oldSlug} → ${newSlug}: контракт ${contract.engine} сохранён, события записаны`)
