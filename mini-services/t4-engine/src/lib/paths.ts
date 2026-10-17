/**
 * THREAD 4 ENGINE — paths (single module that knows the filesystem).
 *
 * The engine lives at mini-services/t4-engine inside the my-project repo;
 * the retired file pipeline (thread4/) is read ONCE at migration. No
 * other module is allowed to know these paths.
 */
import path from 'node:path'

/** .../mini-services/t4-engine */
export const ENGINE_ROOT = path.resolve(import.meta.dir, '..', '..')
/** .../my-project (git root of the platform repo — two levels up) */
export const PROJECT_ROOT = path.resolve(ENGINE_ROOT, '..', '..')
/** legacy chronicle (read-only, migration source) */
export const LEGACY_LOG = path.join(PROJECT_ROOT, 'thread4', 'events', 'log.jsonl')
export const LEGACY_CHAIN = path.join(PROJECT_ROOT, 'thread4', 'events', 'chain.jsonl')

export const DATA_DIR = path.join(ENGINE_ROOT, 'data')
export const DB_PATH = path.join(DATA_DIR, 't4.db')

/** Commander key: header-only secret (Залп 1 «Правда»). */
export const T4_HOME = path.join(process.env['HOME'] ?? '/home/z', '.t4')
export const COMMANDER_KEY_PATH = path.join(T4_HOME, 'commander.key')
export const READ_LOCK_PATH = path.join(T4_HOME, 'read.lock')
