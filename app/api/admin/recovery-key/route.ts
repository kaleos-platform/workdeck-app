import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOperator } from '@/lib/admin/auth'
import { requireFreshAal2 } from '@/lib/auth/mfa'
import { getRecoveryKeyStatus, manageRecoveryKey, RecoveryKeyError } from '@/lib/admin/recovery-key'

export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'private, no-store' }
const bodySchema = z.object({ action: z.enum(['backup', 'verify']) }).strict()
const noStore = (response: NextResponse) => {
  response.headers.set('Cache-Control', headers['Cache-Control'])
  return response
}
function failure(error: unknown) {
  const code = error instanceof RecoveryKeyError ? error.code : 'RECOVERY_UNAVAILABLE'
  const messages = {
    BACKUP_MISSING: '보관된 사본이 없습니다. 먼저 복구 키를 보관하세요.',
    BACKUP_MISMATCH: '보관 사본이 현재 키와 다릅니다. 기존 사본을 유지하고 작업을 중단했습니다.',
    RUNTIME_KEY_UNAVAILABLE: '현재 k1 키를 사용할 수 없습니다. 운영 환경 설정을 확인하세요.',
    RECOVERY_UNAVAILABLE:
      '복구 키 작업을 완료하지 못했습니다. Vault와 감사 기록 상태를 확인하세요.',
  }
  return NextResponse.json(
    { code, message: messages[code] },
    {
      status: code === 'BACKUP_MISSING' || code === 'BACKUP_MISMATCH' ? 409 : 503,
      headers,
    }
  )
}

export async function GET() {
  const auth = await requireOperator()
  if (!auth.ok) return noStore(auth.response)
  try {
    return NextResponse.json(await getRecoveryKeyStatus(), { headers })
  } catch (error) {
    return failure(error)
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireOperator()
  if (!auth.ok) return noStore(auth.response)
  // 상태 변경은 같은 origin의 운영자 화면에서만 받는다.
  if (req.headers.get('origin') !== new URL(req.url).origin) {
    return NextResponse.json({ message: '허용되지 않은 요청입니다' }, { status: 403, headers })
  }
  const mfa = await requireFreshAal2()
  if (mfa) return noStore(mfa)
  const text = await req.text()
  if (text.length > 256)
    return NextResponse.json({ message: '입력값이 올바르지 않습니다' }, { status: 400, headers })
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = null
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ message: '입력값이 올바르지 않습니다' }, { status: 400, headers })
  try {
    return NextResponse.json(await manageRecoveryKey(parsed.data.action, auth.user.id), { headers })
  } catch (error) {
    return failure(error)
  }
}
