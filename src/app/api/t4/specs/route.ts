import { NextResponse } from 'next/server'

import { specInventory } from '@/lib/t4/specs'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ specs: specInventory() })
}
