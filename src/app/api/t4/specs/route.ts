import { NextResponse } from 'next/server'

import { requireRead } from '@/lib/t4/apiguard'

import { specInventory } from '@/lib/t4/specs'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const read = requireRead(req)
  if (!read.ok) return read.response

  return NextResponse.json({ specs: specInventory() })
}
