'use client'

import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createClient } from '@/lib/supabase/client'
import { AUTH_TIMEOUT_MESSAGE, withAuthTimeout } from '@/lib/auth/auth-timeout'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type StepUpResult = 'verified' | 'cancelled' | 'enroll'

function StepUpDialog({
  factorId,
  onDone,
}: {
  factorId: string
  onDone: (result: 'verified' | 'cancelled') => void
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function verify() {
    setBusy(true)
    setError(null)
    const verified = await withAuthTimeout(
      createClient().auth.mfa.challengeAndVerify({ factorId, code })
    )
    if (!verified) {
      setBusy(false)
      setError(AUTH_TIMEOUT_MESSAGE)
      return
    }
    if (verified.error) {
      setBusy(false)
      setError('인증 코드가 올바르지 않습니다.')
      return
    }
    onDone('verified')
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onDone('cancelled')}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>2단계 인증</DialogTitle>
          <DialogDescription>
            저장하려면 인증 앱의 6자리 코드를 입력하세요. 이 기기에서는 30일 동안 다시 묻지
            않습니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="mfa-dialog-code">인증 코드</Label>
          <Input
            id="mfa-dialog-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && !busy && void verify()}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onDone('cancelled')} disabled={busy}>
            취소
          </Button>
          <Button onClick={verify} disabled={busy || code.length !== 6}>
            확인
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 현재 화면 위에 TOTP 코드 다이얼로그를 띄워 단계 인증(aal2)을 받는다.
 * 인증 기기가 없으면 다이얼로그 없이 'enroll' — 등록(QR)은 /auth/mfa 페이지에서만 한다.
 */
export async function requestMfaStepUp(): Promise<StepUpResult> {
  const listed = await withAuthTimeout(createClient().auth.mfa.listFactors())
  const factor = listed?.data?.all.find((f) => f.factor_type === 'totp' && f.status === 'verified')
  if (!factor) return 'enroll'

  return new Promise<StepUpResult>((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    root.render(
      <StepUpDialog
        factorId={factor.id}
        onDone={(result) => {
          resolve(result)
          // Dialog 닫힘 처리 중 동기 unmount 를 피한다.
          setTimeout(() => {
            root.unmount()
            host.remove()
          })
        }}
      />
    )
  })
}
