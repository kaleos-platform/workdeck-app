import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'
import { getUser } from '@/hooks/use-user'
import { ensureWorkspaceForUser } from '@/lib/workspace'
import crypto from 'crypto'

// 간단한 AES-256 암호화 (ENCRYPTION_KEY 환경변수 사용)
function encryptPassword(password: string): { encrypted: string; iv: string } {
  const key = process.env.ENCRYPTION_KEY
  if (!key) {
    if (process.env.VERCEL_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY가 설정되지 않아 자격증명을 저장할 수 없습니다')
    }
    // 비운영 환경: 평문 저장 (개발/preview 전용)
    console.warn('[credentials] ENCRYPTION_KEY 미설정 — 평문 저장 (비운영 환경 전용)')
    return { encrypted: password, iv: 'none' }
  }
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'hex'), iv)
  let encrypted = cipher.update(password, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return { encrypted, iv: iv.toString('hex') }
}

// GET /api/collection/credentials — 쿠팡 자격증명 조회
// 사용자 인증 또는 Worker 인증 모두 지원
export async function GET(request: NextRequest) {
  const workerKey = request.headers.get('x-worker-api-key')
  const expectedKey = process.env.WORKER_API_KEY

  if (workerKey && expectedKey && workerKey === expectedKey) {
    // Worker 인증: 모든 활성 크레덴셜 반환 (암호화된 비밀번호 포함)
    const credential = await prisma.coupangCredential.findFirst({
      where: { isActive: true },
      select: {
        id: true,
        workspaceId: true,
        loginId: true,
        loginPassword: true,
        encryptionIv: true,
        isActive: true,
        collectVendorSales: true,
      },
    })

    if (!credential) {
      return errorResponse('활성 크레덴셜이 없습니다', 404)
    }

    return NextResponse.json({
      credential: {
        ...credential,
        encryptedPassword: credential.loginPassword,
        passwordIv: credential.encryptionIv,
      },
    })
  }

  // 사용자 인증
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
      collectVendorSales: true,
    },
  })

  return NextResponse.json({
    credential,
    isConnected: credential?.isActive ?? false,
  })
}

// PUT /api/collection/credentials — 쿠팡 자격증명 생성/수정
export async function PUT(request: NextRequest) {
  // 워크스페이스 해석 — 워커 인증이면 기존 경로, 세션 유저면 없을 때 자동 생성.
  // (seller-ops 에서 쿠팡 연동을 먼저 설정하는 경우 Workspace 가 아직 없을 수 있음.
  //  계정당 1 Workspace 라 이렇게 만든 워크스페이스는 coupang-ads 와 공유된다.)
  const workerKey = request.headers.get('x-worker-api-key')
  const isWorker = !!(
    workerKey &&
    process.env.WORKER_API_KEY &&
    workerKey === process.env.WORKER_API_KEY
  )

  let workspace: { id: string }
  if (isWorker) {
    const resolved = await resolveWorkspace()
    if ('error' in resolved) return resolved.error
    workspace = resolved.workspace
  } else {
    const user = await getUser()
    if (!user) return errorResponse('인증이 필요합니다', 401)
    const ensured = await ensureWorkspaceForUser({
      id: user.id,
      email: user.email,
      name: user.user_metadata?.name ?? null,
    })
    workspace = ensured.workspace
  }

  let body: {
    loginId?: string
    password?: string
    loginPassword?: string
    encryptionIv?: string
    collectVendorSales?: boolean
  }
  try {
    body = await request.json()
  } catch {
    return errorResponse('요청 본문이 올바르지 않습니다', 400)
  }

  const loginId = body.loginId
  // 폼에서는 password, Worker에서는 loginPassword+encryptionIv
  const rawPassword = body.password || body.loginPassword

  if (!loginId || !rawPassword) {
    return errorResponse('로그인 ID와 비밀번호가 필요합니다', 400)
  }

  // 비밀번호 암호화 (encryptionIv가 없으면 새로 암호화)
  let loginPassword: string
  let encryptionIv: string

  if (body.encryptionIv && body.loginPassword) {
    // Worker에서 이미 암호화된 값 전달
    loginPassword = body.loginPassword
    encryptionIv = body.encryptionIv
  } else {
    // 폼에서 평문 전달 → 암호화
    let encrypted: { encrypted: string; iv: string }
    try {
      encrypted = encryptPassword(rawPassword)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '자격증명 암호화에 실패했습니다'
      return errorResponse(msg, 500)
    }
    loginPassword = encrypted.encrypted
    encryptionIv = encrypted.iv
  }

  // collectVendorSales: 미지정이면 update 시 기존값 유지, create 시 기본값 true
  const collectVendorSalesCreate = body.collectVendorSales ?? true
  const collectVendorSalesUpdate =
    body.collectVendorSales !== undefined ? { collectVendorSales: body.collectVendorSales } : {}

  const credential = await prisma.coupangCredential.upsert({
    where: { workspaceId: workspace.id },
    create: {
      workspaceId: workspace.id,
      loginId,
      loginPassword,
      encryptionIv,
      collectVendorSales: collectVendorSalesCreate,
    },
    update: {
      loginId,
      loginPassword,
      encryptionIv,
      isActive: true,
      lastError: null,
      ...collectVendorSalesUpdate,
    },
    select: {
      id: true,
      loginId: true,
      isActive: true,
      collectVendorSales: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return NextResponse.json({ credential, isConnected: true })
}
