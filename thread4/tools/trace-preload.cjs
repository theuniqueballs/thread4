/* T4 TRACE PRELOAD — fs-обёртка инструментированного прогона (ревизия 2026-10-13).
 *
 * Назначение: записать КАЖДУЮ файловую операцию техпроцесса в $T4_TRACE_OUT,
 * чтобы отчёт ревизии опирался на факты, а не на догадки о «что используется».
 * Bun подхватывает через `bun --preload <этот файл> <entry>`.
 *
 * Гарантии:
 *  - семантика не меняется: обёртка вызывает оригиналы, результат/бросок
 *    пробрасывается как есть;
 *  - рекурсии нет: лог пишет ТОЛЬКО оригиналами (appendFileSync→orig);
 *  - пути нормализуются к cwd-относительным в момент операции;
 *  - процесс без T4_TRACE_OUT не платит ничего (патчи не ставятся).
 *
 * Прецедент: трасса «READ thread4/specs/policy.json» из прогона `check`
 * — доказательство живого потребления спеки гейтами (ревизия категория 1). */
'use strict'

const OUT = process.env.T4_TRACE_OUT
if (OUT) {
  const fs = require('node:fs')
  const path = require('node:path')

  const orig = {
    appendFileSync: fs.appendFileSync,
    readFileSync: fs.readFileSync,
    writeFileSync: fs.writeFileSync,
    existsSync: fs.existsSync,
    statSync: fs.statSync,
    lstatSync: fs.lstatSync,
    readdirSync: fs.readdirSync,
    mkdirSync: fs.mkdirSync,
    renameSync: fs.renameSync,
    unlinkSync: fs.unlinkSync,
    rmSync: fs.rmSync,
    accessSync: fs.accessSync,
    copyFileSync: fs.copyFileSync,
    utimesSync: fs.utimesSync,
    realpathSync: fs.realpathSync,
    truncateFileSync: fs.truncateFileSync,
    openSync: fs.openSync,
    readSync: fs.readSync,
    writeSync: fs.writeSync,
    closeSync: fs.closeSync,
  }

  /* тихий best-effort лог: сбой лога не должен ломать прогон */
  const log = (op, p) => {
    try {
      let rel = String(p)
      try {
        rel = path.relative(process.cwd(), path.resolve(process.cwd(), String(p)))
      } catch { /* не путь — пишем как есть */ }
      orig.appendFileSync(OUT, op + ' ' + rel + '\n')
    } catch { /* прогон важнее трассы */ }
  }

  const wrapArgs0Path = (op, fn) => function wrapped(p) {
    log(op, p)
    return fn.apply(this, arguments)
  }

  /* openSync: путь первым, но флаги решают READ/WRITE — пишем оба маркера */
  const wrapOpen = function wrapped(p, flags) {
    const w = typeof flags === 'string' && /[wa+]/.test(flags)
    log(w ? 'WRITE' : 'READ', p)
    return orig.openSync.apply(this, arguments)
  }

  fs.readFileSync = wrapArgs0Path('READ', orig.readFileSync)
  fs.writeFileSync = wrapArgs0Path('WRITE', orig.writeFileSync)
  fs.appendFileSync = wrapArgs0Path('WRITE', orig.appendFileSync)
  fs.existsSync = wrapArgs0Path('STAT', orig.existsSync)
  fs.statSync = wrapArgs0Path('STAT', orig.statSync)
  fs.lstatSync = wrapArgs0Path('STAT', orig.lstatSync)
  fs.readdirSync = wrapArgs0Path('READDIR', orig.readdirSync)
  fs.mkdirSync = wrapArgs0Path('WRITE', orig.mkdirSync)
  fs.renameSync = function wrapped(a, b) {
    log('WRITE', a)
    log('WRITE', b)
    return orig.renameSync.apply(this, arguments)
  }
  fs.unlinkSync = wrapArgs0Path('WRITE', orig.unlinkSync)
  fs.rmSync = wrapArgs0Path('WRITE', orig.rmSync)
  fs.accessSync = wrapArgs0Path('STAT', orig.accessSync)
  fs.copyFileSync = function wrapped(a, b) {
    log('READ', a)
    log('WRITE', b)
    return orig.copyFileSync.apply(this, arguments)
  }
  fs.utimesSync = wrapArgs0Path('WRITE', orig.utimesSync)
  fs.realpathSync = wrapArgs0Path('STAT', orig.realpathSync)
  fs.truncateFileSync = wrapArgs0Path('WRITE', orig.truncateFileSync)
  fs.openSync = wrapOpen

  /* fs/promises — тем же способом (scribe/долгое ожидание могут ходить туда) */
  try {
    const fsp = require('node:fs/promises')
    const oReadFile = fsp.readFile.bind(fsp)
    const oWriteFile = fsp.writeFile.bind(fsp)
    const oAppendFile = fsp.appendFile.bind(fsp)
    const oStat = fsp.stat.bind(fsp)
    const oReaddir = fsp.readdir.bind(fsp)
    const oMkdir = fsp.mkdir.bind(fsp)
    const oRename = fsp.rename.bind(fsp)
    const oUnlink = fsp.unlink.bind(fsp)
    const oRm = fsp.rm.bind(fsp)
    const oAccess = fsp.access.bind(fsp)
    const oCopy = fsp.copyFile.bind(fsp)
    const oOpen = fsp.open.bind(fsp)

    fsp.readFile = (p, ...rest) => (log('READ', p), oReadFile(p, ...rest))
    fsp.writeFile = (p, ...rest) => (log('WRITE', p), oWriteFile(p, ...rest))
    fsp.appendFile = (p, ...rest) => (log('WRITE', p), oAppendFile(p, ...rest))
    fsp.stat = (p, ...rest) => (log('STAT', p), oStat(p, ...rest))
    fsp.readdir = (p, ...rest) => (log('READDIR', p), oReaddir(p, ...rest))
    fsp.mkdir = (p, ...rest) => (log('WRITE', p), oMkdir(p, ...rest))
    fsp.rename = (a, b, ...rest) => (log('WRITE', a), log('WRITE', b), oRename(a, b, ...rest))
    fsp.unlink = (p, ...rest) => (log('WRITE', p), oUnlink(p, ...rest))
    fsp.rm = (p, ...rest) => (log('WRITE', p), oRm(p, ...rest))
    fsp.access = (p, ...rest) => (log('STAT', p), oAccess(p, ...rest))
    fsp.copyFile = (a, b, ...rest) => (log('READ', a), log('WRITE', b), oCopy(a, b, ...rest))
    fsp.open = (p, flags, ...rest) => {
      const w = typeof flags === 'string' && /[wa+]/.test(flags)
      log(w ? 'WRITE' : 'READ', p)
      return oOpen(p, flags, ...rest)
    }
  } catch { /* fs/promises недоступен — синхронной трассы достаточно */ }
}
