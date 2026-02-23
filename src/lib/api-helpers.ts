import { NextResponse } from 'next/server'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'

// 에러 응답 생성 헬퍼 — extra 필드를 병합해 추가 정보를 포함할 수 있음
export function errorResponse(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ message, ...extra }, { status })
}

// 인증 + 워크스페이스 소유권 검증
// 모든 인증 필요 API 라우트에서 호출
export async function resolveWorkspace() {
  const user = await getUser()
  if (!user) return { error: errorResponse('인증이 필요합니다', 401) }

  const workspace = await prisma.workspace.findUnique({
    where: { ownerId: user.id },
    select: { id: true },
  })
  if (!workspace) return { error: errorResponse('워크스페이스가 없습니다', 404) }

  return { user, workspace }
}
