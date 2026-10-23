import { foldState } from '../../../src/lib/t4/events'
import { warmConsciousness, consciousnessEvents } from '../../../src/lib/t4/consciousness'
await warmConsciousness()
const st = foldState(consciousnessEvents())
console.log('windowSlugs:', JSON.stringify(st.windowSlugs))
