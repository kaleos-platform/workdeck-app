import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'

// GET /api/collection/credentials — 쿠팡 자격증명 조회
export async function GET() {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const credential = await prisma.coupangCredential.findUnique({
    where: { workspaceId: workspace.id },
    select: {
      id: true,
      loginId: true,
      isActive: true,
      lastLoginAt: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  // 비밀번호는 절대 반환하지 않음
  return NextResponse.json({ credential })
}

// PUT /api/collection/credentials — 쿠팡 자격증명 생성/수정
export async function PUT(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  let body: { loginId?: string; loginPassword?: string; encryptionIv?: string }
  try {
    body = await request.json()
  } catch {
    return errorResponse('요청 본문이 올바르지 않습니다', 400)
  }

  const { loginId, loginPassword, encryptionIv } = body
  if (!loginId || !loginPassword || !encryptionIv) {
    return errorResponse('loginId, loginPassword, encryptionIv가 필요합니다', 400)
  }

  const credential = await prisma.coupangCredential.upsert({
    where: { workspaceId: workspace.id },
    create: {
      workspaceId: workspace.id,
      loginId,
      loginPassword,
      encryptionIv,
    },
    update: {
      loginId,
      loginPassword,
      encryptionIv,
      isActive: true,
      lastError: null,
    },
    select: {
      id: true,
      loginId: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return NextResponse.json({ credential })
}
