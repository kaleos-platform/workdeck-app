import { NextResponse } from 'next/server'
import { requireOperator } from '@/lib/admin/auth'
import { getSubscriptionAccessOverview } from '@/lib/billing/subscription-admin'

export async function GET() {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json(await getSubscriptionAccessOverview())
  } catch {
    return NextResponse.json({ message: '구독 현황을 불러오지 못했습니다' }, { status: 500 })
  }
}
