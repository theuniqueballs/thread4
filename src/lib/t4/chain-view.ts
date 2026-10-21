/**
 * THREAD 4 — хеш-цепь на рабочем столе (Фаза 5, UI v2).
 *
 * Чистая клиентская перевалидация звеньев: формула файл-эры унаследована
 * движками байт-в-байт (hash = sha256(prev + '|' + raw), генезис 'GENESIS'),
 * но браузеру raw-строки не нужны, чтобы проверить СШИВКУ: каждый prev[i]
 * обязан равняться hash[i-1], а первый prev — GENESIS. Это тот же приём,
 * что и в визуализаторе хроники (neon-dogma, 2026-10-18), поднятый до
 * честной вердиктной плашки рабочего стола: цепь либо цела, либо назван
 * номер первого битого звена. Аудитору движок не верим на слово.
 */

export interface ChainLinkInput {
  seq?: number
  hash: string
  prev: string
}

export interface ChainVerdict {
  /** все звенья сшиты и генезис на месте */
  ok: boolean
  /** первый prev === GENESIS */
  genesisOk: boolean
  /** индексы (в поданном массиве) звеньев с битой сшивкой */
  breaks: number[]
  /** сколько звеньев проверено */
  checked: number
  /** голова (hash последнего звена) или null */
  head: string | null
}

export const CHAIN_GENESIS = 'GENESIS'

export function validateChain(links: ChainLinkInput[]): ChainVerdict {
  const breaks: number[] = []
  const genesisOk = links.length === 0 ? true : links[0]!.prev === CHAIN_GENESIS
  if (!genesisOk && links.length > 0) breaks.push(0)
  for (let i = 1; i < links.length; i++) {
    if (links[i]!.prev !== links[i - 1]!.hash) breaks.push(i)
  }
  return {
    ok: breaks.length === 0,
    genesisOk,
    breaks,
    checked: links.length,
    head: links.length > 0 ? links[links.length - 1]!.hash : null,
  }
}
