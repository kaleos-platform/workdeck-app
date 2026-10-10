/**
 * 서버용 aal2 게이트 — 관리자 영역과 자격증명 쓰기 API 에서 호출한다.
 * 호출 전에 getUser()(서버 검증)로 세션을 확인한 상태여야 한다 — aal 판정은 같은 세션 토큰의 클레임을 읽는다.
 */
import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isMfaFresh } from './mfa-policy'

export async function isAal2Fresh(): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  return !error && !!data && isMfaFresh(data)
}

export async function requireAal2(): Promise<NextResponse | null> {
  // 비상 해제 스위치 — 운영자 게이트(requireOperator)와 같은 변수 하나로 같이 푼다(Task 10 Step 6).
  if (process.env.ADMIN_REQUIRE_MFA === 'false') return null
  if (await isAal2Fresh()) return null
  return NextResponse.json(
    { message: '2단계 인증이 필요합니다', code: 'MFA_REQUIRED' },
    { status: 403 }
  )
}
