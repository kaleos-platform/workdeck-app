import { NextResponse } from 'next/server'
import { requireOperator } from '@/lib/admin/auth'
import { listInvitations } from '@/lib/spaces/invitations'

// 운영자(CS) 전용 — 고객 공간의 초대 목록(대기·최근 30일 내역). 링크·토큰은 내려주지 않는다.
export async function GET(_request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response
  const { spaceId } = await params
  return NextResponse.json({ invitations: await listInvitations(spaceId) })
}
