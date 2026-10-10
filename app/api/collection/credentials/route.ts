import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'
import { getUser } from '@/hooks/use-user'
import { ensureWorkspaceForUser } from '@/lib/workspace'
import { encryptSecret } from '@/lib/collection/secret-crypto'
import { decryptField, fieldWriteVersion, isV1, V1_IV_MARKER } from '@/lib/crypto/field-crypto'
import { canWorkspaceCollect } from '@/lib/billing/entitlement'

// worker/src/login-guard.ts 의 CREDENTIAL_INVALID 사유 문구 — 워커가 run.error 에 남긴다.
const CREDENTIAL_INVALID_MARK = '아이디/비밀번호 불일치'

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
    const resolved = await resolveWorkspace({ write: true })
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

  // 암호문 직접 입력은 워커만, 인증되는 v1(GCM) 암호문만 받는다(iv='none'·임의 IV·v0 재조합 차단).
  let loginPassword: string
  let encryptionIv: string

  if (body.encryptionIv !== undefined) {
    if (!isWorker) {
      return errorResponse('encryptionIv 는 받을 수 없습니다. 비밀번호를 평문으로 보내 주세요', 400)
    }
    if (!body.loginPassword) return errorResponse('로그인 ID와 비밀번호가 필요합니다', 400)
    // v0(CBC)는 IV 를 바꿔도 첫 블록만 달라져 복호화가 성공한다 — 재전달은 v1 만.
    // v0 쓰기 기간(4a)에는 v1 행을 만들지 않는다 — CBC 전용 배포로 롤백해도 읽을 수 있게.
    if (
      fieldWriteVersion('collection-credential') === 'v0' ||
      !isV1(body.loginPassword) ||
      body.encryptionIv !== V1_IV_MARKER
    ) {
      return errorResponse('암호문 형식이 올바르지 않습니다', 400)
    }
    try {
      decryptField('collection-credential', body.loginPassword, body.encryptionIv)
    } catch {
      return errorResponse('암호문 형식이 올바르지 않습니다', 400)
    }
    loginPassword = body.loginPassword
    encryptionIv = body.encryptionIv
  } else {
    // 폼에서 평문 전달 → 암호화
    let encrypted: { encrypted: string; iv: string }
    try {
      encrypted = encryptSecret(rawPassword)
    } catch {
      // 오류 원문은 응답에 넣지 않는다(키 이름·내부 상태 노출 방지).
      return errorResponse('자격증명 암호화에 실패했습니다', 500)
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

  // 비번 오류로 실패한 뒤 자격증명을 고치면 바로 1회 재수집한다. 정기 수집은
  // CREDENTIAL_INVALID 를 재시도하지 않아 다음날까지 아무것도 돌지 않았다.
  // 새 run 이 최신이 되므로 같은 값을 다시 저장해도 중복 트리거되지 않는다.
  // 재수집은 부가 동작 — 실패해도 이미 저장된 자격증명 응답을 500 으로 만들지 않는다.
  const retriggered = isWorker
    ? false
    : await retriggerAfterCredentialFix(workspace.id).catch((err) => {
        console.error('[credentials] 재수집 트리거 실패:', err)
        return false
      })

  return NextResponse.json({ credential, isConnected: true, retriggered })
}

async function retriggerAfterCredentialFix(workspaceId: string): Promise<boolean> {
  const last = await prisma.collectionRun.findFirst({
    where: { workspaceId, probeApi: false },
    orderBy: { createdAt: 'desc' },
    select: { status: true, error: true },
  })
  if (last?.status !== 'FAILED' || !last.error?.includes(CREDENTIAL_INVALID_MARK)) return false
  if (!(await canWorkspaceCollect(workspaceId))) return false

  await prisma.collectionRun.create({
    data: { workspaceId, triggeredBy: 'manual', status: 'PENDING' },
  })
  return true
}
