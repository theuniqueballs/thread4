import { verifyChain } from '../../src/lib/t4/events'
const v = verifyChain()
console.log('chain:', v.ok ? `OK (${v.events} events)` : `BROKEN: ${v.problems.slice(0,3)}`)
