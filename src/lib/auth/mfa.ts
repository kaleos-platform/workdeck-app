/**
 * 서버용 aal2 게이트 — 관리자 영역과 자격증명 쓰기 API 에서 호출한다.
 * 호출 전에 getUser()(서버 검증)로 세션을 확인한 상태여야 한다 — aal 판정은 같은 세션 토큰의 클레임을 읽는다.
 */
import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { isMfaFresh } from './mfa-policy'

export async function isAal2Fresh(): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  return !error && !!data && isMfaFresh(data)
}

const mfaRequired = () =>
  NextResponse.json({ message: '2단계 인증이 필요합니다', code: 'MFA_REQUIRED' }, { status: 403 })

/**
 * 현재 사용자에게 2단계 인증이 필수인지 — 계정 단위 mfaRequired 또는 운영자.
 * claims 를 못 읽으면 닫힘(true), User 행이 없으면 false.
 */
export async function isMfaRequiredForCurrentUser(): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  const sub = data?.claims?.sub
  if (error || !sub) return true
  const user = await prisma.user.findUnique({
    where: { id: sub },
    select: { mfaRequired: true, platformRole: true },
  })
  if (!user) return false
  return user.mfaRequired || user.platformRole === 'OPERATOR'
}

export async function requireAal2(
  opts: { ignoreUserFlag?: boolean } = {}
): Promise<NextResponse | null> {
  // 비상 해제 스위치 — 운영자 게이트(requireOperator)와 같은 변수 하나로 같이 푼다(Task 10 Step 6).
  if (process.env.ADMIN_REQUIRE_MFA === 'false') return null
  // 계정이 필수로 켜지 않았으면 통과 — 평문 비밀값으로 이어지는 경로는 ignoreUserFlag 로 항상 요구한다.
  if (!opts.ignoreUserFlag && !(await isMfaRequiredForCurrentUser())) return null
  return (await isAal2Fresh()) ? null : mfaRequired()
}

/** 비상 해제와 무관하게 실제 aal2를 요구한다 — 비밀값 "보기"처럼 평문이 나가는 경로용. */
export async function requireFreshAal2(): Promise<NextResponse | null> {
  return (await isAal2Fresh()) ? null : mfaRequired()
}
