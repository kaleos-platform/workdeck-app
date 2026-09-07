/**
 * /api/collection/api-credentials — 쿠팡 Open API 자격증명(vendorId/accessKey/secretKey) 관리.
 * 기존 CoupangCredential(크롤링 로그인)과 별도 모델(CoupangApiCredential)을 사용한다.
 *
 * 인증: 세션(Space 멤버, ADMIN 이상) 또는 워커(x-worker-api-key).
 * secretKey는 세션 응답에 절대 포함하지 않는다 — 워커 응답에만 (암호문+IV) 형태로 내려간다.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errorResponse, assertRole } from '@/lib/api-helpers'
import { encryptSecret } from '@/lib/collection/secret-crypto'
import { resolveCollectionAuth } from '@/lib/collection/resolve-workspace'

// accessKey 마스킹 — 앞 4자만 노출
function maskAccessKey(accessKey: string): string {
  if (accessKey.length <= 4) return '*'.repeat(accessKey.length)
  return `${accessKey.slice(0, 4)}${'*'.repeat(accessKey.length - 4)}`
}

// GET /api/collection/api-credentials
export async function GET(request: NextRequest) {
  const auth = await resolveCollectionAuth(request)
  if ('error' in auth) return auth.error

  if (auth.kind === 'worker') {
    const credential = await prisma.coupangApiCredential.findUnique({
      where: { workspaceId: auth.workspaceId },
      select: {
        id: true,
        workspaceId: true,
        vendorId: true,
        accessKey: true,
        secretKey: true, // 암호문
        encryptionIv: true,
        isActive: true,
      },
    })
    if (!credential) return errorResponse('활성 API 자격증명이 없습니다', 404)
    return NextResponse.json({ credential })
  }

  const credential = await prisma.coupangApiCredential.findUnique({
    where: { workspaceId: auth.workspaceId },
    select: {
      vendorId: true,
      accessKey: true,
      isActive: true,
      lastVerifiedAt: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  if (!credential) {
    return NextResponse.json({ credential: null, isConnected: false })
  }

  return NextResponse.json({
    credential: {
      vendorId: credential.vendorId,
      accessKeyMasked: maskAccessKey(credential.accessKey),
      isActive: credential.isActive,
      lastVerifiedAt: credential.lastVerifiedAt,
      lastError: credential.lastError,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    },
    isConnected: credential.isActive,
  })
}

// PUT /api/collection/api-credentials — 폼(평문 secretKey) / 워커(암호문+IV 재사용) 양쪽 지원
export async function PUT(request: NextRequest) {
  const auth = await resolveCollectionAuth(request)
  if ('error' in auth) return auth.error

  if (auth.kind === 'session') {
    const permError = assertRole(auth.role, 'ADMIN')
    if (permError) return permError
  }

  let body: {
    vendorId?: string
    accessKey?: string
    secretKey?: string // 폼: 평문 / 워커: 암호문 재전달
    encryptionIv?: string // 워커에서 암호문 재전달 시 함께 옴
  }
  try {
    body = await request.json()
  } catch {
    return errorResponse('요청 본문이 올바르지 않습니다', 400)
  }

  const { vendorId, accessKey } = body
  if (!vendorId || !accessKey) {
    return errorResponse('vendorId와 accessKey가 필요합니다', 400)
  }

  // secretKey 처리: 빈 값이면 기존 값 유지(마스킹 표시 후 재저장하는 폼 UX), 값이 있으면 암호화.
  let secretKeyUpdate: { secretKey: string; encryptionIv: string } | Record<string, never> = {}
  let secretKeyCreate: { secretKey: string; encryptionIv: string } | null = null

  if (body.secretKey) {
    if (body.encryptionIv) {
      // 워커에서 이미 암호화된 값을 재전달
      secretKeyUpdate = { secretKey: body.secretKey, encryptionIv: body.encryptionIv }
    } else {
      // 폼에서 평문 전달 → 암호화
      let encrypted: { encrypted: string; iv: string }
      try {
        encrypted = encryptSecret(body.secretKey)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'secretKey 암호화에 실패했습니다'
        return errorResponse(msg, 500)
      }
      secretKeyUpdate = { secretKey: encrypted.encrypted, encryptionIv: encrypted.iv }
    }
    secretKeyCreate = secretKeyUpdate as { secretKey: string; encryptionIv: string }
  }

  const existing = await prisma.coupangApiCredential.findUnique({
    where: { workspaceId: auth.workspaceId },
    select: { id: true },
  })
  if (!existing && !secretKeyCreate) {
    return errorResponse('secretKey가 필요합니다', 400)
  }

  const credential = await prisma.coupangApiCredential.upsert({
    where: { workspaceId: auth.workspaceId },
    create: {
      workspaceId: auth.workspaceId,
      vendorId,
      accessKey,
      secretKey: secretKeyCreate!.secretKey,
      encryptionIv: secretKeyCreate!.encryptionIv,
    },
    update: {
      vendorId,
      accessKey,
      isActive: true,
      lastError: null,
      ...secretKeyUpdate,
    },
    select: {
      vendorId: true,
      accessKey: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return NextResponse.json({
    credential: { ...credential, accessKeyMasked: maskAccessKey(credential.accessKey) },
    isConnected: true,
  })
}

// DELETE /api/collection/api-credentials — 삭제 시 모든 API 소스 선택을 CRAWL로 되돌린다
// (자격 없는 API 소스 = 무조건 수집 실패이므로).
export async function DELETE(request: NextRequest) {
  const auth = await resolveCollectionAuth(request)
  if ('error' in auth) return auth.error
  if (auth.kind === 'session') {
    const permError = assertRole(auth.role, 'ADMIN')
    if (permError) return permError
  }

  const existing = await prisma.coupangApiCredential.findUnique({
    where: { workspaceId: auth.workspaceId },
    select: { id: true },
  })
  if (!existing) {
    return errorResponse('API 자격증명이 없습니다', 404)
  }

  await prisma.$transaction(async (tx) => {
    await tx.coupangApiCredential.delete({ where: { workspaceId: auth.workspaceId } })

    const sourceSetting = await tx.coupangSourceSetting.findUnique({
      where: { workspaceId: auth.workspaceId },
    })
    if (sourceSetting) {
      const revert: Record<string, 'CRAWL'> = {}
      for (const field of [
        'inventorySource',
        'salesSource',
        'settlementSource',
        'productSource',
      ] as const) {
        if (sourceSetting[field] === 'API') revert[field] = 'CRAWL'
      }
      if (Object.keys(revert).length > 0) {
        await tx.coupangSourceSetting.update({
          where: { workspaceId: auth.workspaceId },
          data: revert,
        })
      }
    }
  })

  return NextResponse.json({ success: true })
}
