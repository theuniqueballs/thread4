'use client'

/**
 * THREAD 4 — Browser Vault (клиент).
 *
 * Полный снимок состояния THREAD 4 (батчи, контракты, спекы, документы,
 * события), сложенный в IndexedDB браузера автора. Сервер контейнера
 * эфемерен — браузер переживает любое выключение. Инцидент 2026-09-23
 * (гибель T4-05 и T4-07 с контейнером) больше не повторится: достаточно
 * было один раз открыть Workflow после сдачи — и снимок уже здесь.
 */

export interface VaultBundle {
  savedAt: string
  counts?: Record<string, number>
  files: Record<string, string>
}

export interface VaultMeta {
  key: string
  savedAt: string
  counts: Record<string, number>
  bytes: number
  batches: number
}

const DB_NAME = 't4-vault'
const STORE = 'snapshots'
const KEEP = 5

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexedDB недоступен'))
  })
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = fn(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('операция не удалась'))
        t.oncomplete = () => db.close()
      })
  )
}

function countBy(files: Record<string, string>, prefix: string, ext?: string): number {
  return Object.keys(files).filter((p) => p.startsWith(prefix) && (ext ? p.endsWith(ext) : true)).length
}

/** Забрать бандл с сервера и положить в хранилище (дедуп по содержимому). */
export async function cacheCurrentState(): Promise<VaultMeta | null> {
  const res = await fetch('/api/t4/vault', { cache: 'no-store' })
  if (!res.ok) throw new Error(`vault API ${res.status}`)
  const bundle = (await res.json()) as VaultBundle
  const serialized = JSON.stringify(bundle)

  const existing = await listSnapshots()
  if (existing.length > 0) {
    const prev = await getSnapshot(existing[0].key)
    if (prev && JSON.stringify(prev) === serialized) return existing[0]
  }

  const key = `${bundle.savedAt}|${Math.random().toString(36).slice(2, 8)}`
  await tx('readwrite', (s) => s.put({ key, bundle }))
  const meta: VaultMeta = {
    key,
    savedAt: bundle.savedAt,
    counts: bundle.counts ?? {},
    bytes: serialized.length,
    batches: countBy(bundle.files, 'thread4/batches/', '.md'),
  }

  /* храним последние KEEP снимков */
  const all = await listSnapshots()
  for (const old of all.slice(KEEP)) {
    await tx('readwrite', (s) => s.delete(old.key))
  }
  return meta
}

export async function listSnapshots(): Promise<VaultMeta[]> {
  try {
    const rows = await tx<VaultMeta[]>('readonly', (s) => s.getAll() as IDBRequest<VaultMeta[]>)
    const metas: VaultMeta[] = (rows as unknown as { key: string; bundle: VaultBundle }[]).map((r) => ({
      key: r.key,
      savedAt: r.bundle.savedAt,
      counts: r.bundle.counts ?? {},
      bytes: JSON.stringify(r.bundle).length,
      batches: countBy(r.bundle.files, 'thread4/batches/', '.md'),
    }))
    return metas.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
  } catch {
    return []
  }
}

export async function getSnapshot(key: string): Promise<VaultBundle | null> {
  try {
    const row = await tx<{ key: string; bundle: VaultBundle } | undefined>(
      'readonly',
      (s) => s.get(key) as IDBRequest<{ key: string; bundle: VaultBundle } | undefined>
    )
    return row?.bundle ?? null
  } catch {
    return null
  }
}

export async function deleteSnapshot(key: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(key))
}

/** Восстановление: бандл уходит на сервер, сервер возвращает отчёт. */
export async function restoreSnapshot(
  bundle: VaultBundle
): Promise<{ restored: string[]; skipped: string[]; mergedEvents: number }> {
  const res = await fetch('/api/t4/vault', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ savedAt: bundle.savedAt, files: bundle.files }),
  })
  if (!res.ok) throw new Error(`vault API ${res.status}`)
  return res.json()
}
