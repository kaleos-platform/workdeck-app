'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { sanitizeRedirectPath } from '@/lib/auth-redirect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * aal1 → aal2 단계 인증. TOTP factor 가 없으면 등록(QR)부터, 있으면 코드 확인만 한다.
 * 성공하면 ?next= 경로(내부 경로만)로 돌아간다.
 */
export function MfaStepUp() {
  const router = useRouter()
  const search = useSearchParams()
  const supabase = useMemo(() => createClient(), [])
  const [factorId, setFactorId] = useState<string | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const { data, error: listError } = await supabase.auth.mfa.listFactors()
      if (listError) {
        setError('인증 정보를 불러오지 못했습니다. 다시 로그인해 주세요.')
        return
      }
      const totp = data.all.filter((f) => f.factor_type === 'totp')
      // 중단된 등록이 남긴 unverified factor 는 새 등록을 막으므로 정리한다.
      for (const f of totp.filter((f) => f.status !== 'verified')) {
        await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
      const verified = totp.find((f) => f.status === 'verified')
      if (verified) {
        setFactorId(verified.id)
        return
      }
      const enrolled = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `workdeck-${Date.now()}`,
      })
      if (enrolled.error || !enrolled.data) {
        setError('2단계 인증 등록을 시작하지 못했습니다.')
        return
      }
      setFactorId(enrolled.data.id)
      setQrCode(enrolled.data.totp.qr_code)
    })()
  }, [supabase])

  async function verify() {
    if (!factorId) return
    setBusy(true)
    setError(null)
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
    setBusy(false)
    if (verifyError) {
      setError('인증 코드가 올바르지 않습니다.')
      return
    }
    // 새로 등록한 경우 운영자 감사 로그(비운영자는 404 — 무해). account-settings.tsx 의 logAuditAction 과 같은 계약.
    if (qrCode) {
      void fetch('/api/admin/account/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'account.mfa.enroll' }),
      }).catch(() => {})
    }
    router.replace(sanitizeRedirectPath(search.get('next')) ?? '/')
    router.refresh()
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4 py-16">
      <h1 className="text-lg font-semibold">2단계 인증</h1>
      <p className="text-sm text-muted-foreground">
        {qrCode
          ? '인증 앱(Google Authenticator 등)으로 QR 코드를 스캔한 뒤 6자리 코드를 입력하세요.'
          : '인증 앱의 6자리 코드를 입력하세요. 이 기기에서는 30일 동안 다시 묻지 않습니다.'}
      </p>
      {qrCode && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`data:image/svg+xml;utf-8,${encodeURIComponent(qrCode)}`}
          alt="TOTP QR 코드"
          className="size-40 self-start rounded border bg-white p-2"
        />
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
    </div>
  )
}
