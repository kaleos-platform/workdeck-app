'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { sanitizeRedirectPath } from '@/lib/auth-redirect'
import { isMfaFresh } from '@/lib/auth/mfa-policy'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * aal1 → aal2 단계 인증. TOTP factor 가 없으면 등록(QR)부터, 있으면 코드 확인만 한다.
 * 성공하면 ?next= 경로(내부 경로만)로 돌아간다.
 * ?mode=replace: 이미 aal2(30일 이내)면 새 factor 를 등록·검증한 뒤에만 기존 verified factor 를 해제한다.
 * 검증 전 이탈하면 기존 factor 는 그대로이고, 남은 unverified 새 factor 는 다음 진입 때 정리된다.
 */
export function MfaStepUp() {
  const router = useRouter()
  const search = useSearchParams()
  const supabase = useMemo(() => createClient(), [])
  const [factorId, setFactorId] = useState<string | null>(null)
  const [enrollment, setEnrollment] = useState<{ qrCode: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const replaceRequested = search.get('mode') === 'replace'
  // 교체 중이면 해제할 기존 verified factor id 들. null 이면 일반 단계 인증/첫 등록.
  const [oldFactorIds, setOldFactorIds] = useState<string[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const next = sanitizeRedirectPath(search.get('next')) ?? '/'

  useEffect(() => {
    // StrictMode 이중 마운트 등으로 정리된 실행은 등록까지 가지 않게 막는다(중복 enroll 방지).
    let cancelled = false
    void (async () => {
      const { data, error: listError } = await supabase.auth.mfa.listFactors()
      if (cancelled) return
      if (listError) {
        setError('인증 정보를 불러오지 못했습니다. 다시 로그인해 주세요.')
        return
      }
      const totp = data.all.filter((f) => f.factor_type === 'totp')
      // 중단된 등록이 남긴 unverified factor 는 새 등록을 막으므로 정리한다.
      for (const f of totp.filter((f) => f.status !== 'verified')) {
        await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
      if (cancelled) return
      const verified = totp.filter((f) => f.status === 'verified')
      if (verified.length > 0 && replaceRequested) {
        const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
        if (cancelled) return
        if (aal.error || !aal.data || !isMfaFresh(aal.data)) {
          setNote(
            '인증 기기를 바꾸려면 먼저 현재 기기로 인증하세요. 인증 후 다시 [인증 기기 변경]을 누르세요.'
          )
          setFactorId(verified[0].id)
          return
        }
      } else if (verified.length > 0) {
        setFactorId(verified[0].id)
        return
      }
      const enrolled = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `workdeck-${Date.now()}`,
      })
      if (cancelled) return
      if (enrolled.error || !enrolled.data) {
        setError(
          enrolled.error?.code === 'insufficient_aal'
            ? '새 인증 기기를 등록하려면 먼저 현재 기기로 인증해야 합니다.'
            : '2단계 인증 등록을 시작하지 못했습니다.'
        )
        return
      }
      if (verified.length > 0) setOldFactorIds(verified.map((f) => f.id))
      setFactorId(enrolled.data.id)
      // qr_code 는 Supabase 가 이미 data URI(data:image/svg+xml;...) 로 준다 — 그대로 src 에 쓴다.
      setEnrollment({ qrCode: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret })
    })()
    return () => {
      cancelled = true
    }
  }, [supabase, replaceRequested])

  async function signOut() {
    await supabase.auth.signOut()
    router.replace('/login')
    router.refresh()
  }

  async function verify() {
    if (!factorId) return
    setBusy(true)
    setError(null)
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
    if (verifyError) {
      setBusy(false)
      setError('인증 코드가 올바르지 않습니다.')
      return
    }
    if (oldFactorIds) {
      // 새 factor 검증으로 세션이 aal2 가 된 뒤에만 기존 factor 를 해제한다(verified 해제는 aal2 필요).
      for (const id of oldFactorIds) {
        const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: id })
        if (unenrollError) {
          setBusy(false)
          setError(
            unenrollError.code === 'insufficient_aal'
              ? '새 기기는 등록됐지만 이전 기기를 해제하려면 2단계 인증이 필요합니다. 다시 인증 후 시도하세요.'
              : '새 기기는 등록됐지만 이전 기기를 해제하지 못했습니다. 잠시 후 다시 시도하세요.'
          )
          return
        }
      }
      void fetch('/api/admin/account/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'account.mfa.replace' }),
      }).catch(() => {})
      router.replace(next)
      router.refresh()
      return
    }
    setBusy(false)
    // 새로 등록한 경우 운영자 감사 로그(비운영자는 404 — 무해). account-settings.tsx 의 logAuditAction 과 같은 계약.
    if (enrollment) {
      void fetch('/api/admin/account/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'account.mfa.enroll' }),
      }).catch(() => {})
    }
    router.replace(next)
    router.refresh()
  }

  // 교체 취소 — 새로 만든 unverified factor 만 지운다. 기존 factor 는 건드리지 않는다.
  async function cancelReplace() {
    if (factorId) await supabase.auth.mfa.unenroll({ factorId })
    router.replace(next)
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4 py-16">
      <h1 className="text-lg font-semibold">{oldFactorIds ? '인증 기기 변경' : '2단계 인증'}</h1>
      <p className="text-sm text-muted-foreground">
        {enrollment
          ? '인증 앱(Google Authenticator 등)으로 QR 코드를 스캔한 뒤 6자리 코드를 입력하세요.'
          : '인증 앱의 6자리 코드를 입력하세요. 이 기기에서는 30일 동안 다시 묻지 않습니다.'}
      </p>
      {oldFactorIds && (
        <p className="text-sm text-muted-foreground">
          새 코드를 확인하면 이전 인증 앱은 더 이상 쓸 수 없습니다.
        </p>
      )}
      {note && <p className="text-sm text-amber-600">{note}</p>}
      {enrollment && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={enrollment.qrCode}
            alt="TOTP QR 코드"
            className="size-40 self-start rounded border bg-white p-2"
          />
          <div className="space-y-1">
            <Label htmlFor="mfa-secret">수동 입력용 비밀 키</Label>
            <Input
              id="mfa-secret"
              readOnly
              value={enrollment.secret}
              className="font-mono text-xs"
            />
          </div>
        </>
      )}
      <div className="space-y-1">
        <Label htmlFor="mfa-code">인증 코드</Label>
        <Input
          id="mfa-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button onClick={verify} disabled={busy || !factorId || code.length !== 6}>
        확인
      </Button>
      {oldFactorIds && (
        <Button variant="outline" onClick={cancelReplace} disabled={busy}>
          취소(기존 기기 유지)
        </Button>
      )}
      <Button variant="link" size="sm" className="self-start px-0" onClick={signOut}>
        다른 계정으로 로그인(로그아웃)
      </Button>
    </div>
  )
}
