import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'
import crypto from 'crypto'

// 간단한 AES-256 암호화 (ENCRYPTION_KEY 환경변수 사용)
function encryptPassword(password: string): { encrypted: string; iv: string } {
  const key = process.env.ENCRYPTION_KEY
  if (!key) {
    // 키 없으면 평문 저장 (개발 환경)
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
    },
  })

  return NextResponse.json({
    credential,
    isConnected: credential?.isActive ?? false,
  })
}

// PUT /api/collection/credentials — 쿠팡 자격증명 생성/수정
export async function PUT(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  let body: { loginId?: string; password?: string; loginPassword?: string; encryptionIv?: string }
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
    const encrypted = encryptPassword(rawPassword)
    loginPassword = encrypted.encrypted
    encryptionIv = encrypted.iv
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

  return NextResponse.json({ credential, isConnected: true })
}
