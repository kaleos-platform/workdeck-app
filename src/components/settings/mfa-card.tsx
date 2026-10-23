'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { createClient } from '@/lib/supabase/client'
import { MFA_REMEMBER_SEC, isMfaFresh, mfaStepUpPath } from '@/lib/auth/mfa-policy'

const HERE = '/settings/account'
const DAY_SEC = 24 * 60 * 60

type Status = { enrolled: boolean; fresh: boolean; daysSinceTotp: number | null }

/** 2단계 인증 상태 확인 + 단계 인증/기기 변경 진입점. 읽기만 한다 — factor 변경은 /auth/mfa 에서. */
export function MfaCard() {
  const supabase = useMemo(() => createClient(), [])
  const [status, setStatus] = useState<Status | null>(null)
  const [failed, setFailed] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [factors, aal] = await Promise.all([
        supabase.auth.mfa.listFactors(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ])
      if (cancelled) return
      if (factors.error || aal.error || !aal.data) return setFailed(true)
      const totp = aal.data.currentAuthenticationMethods.find(
        (m) => typeof m === 'object' && m.method === 'totp'
      ) as { timestamp: number } | undefined
      setStatus({
        enrolled: factors.data.all.some((f) => f.factor_type === 'totp' && f.status === 'verified'),
        fresh: isMfaFresh(aal.data),
        daysSinceTotp: totp ? Math.floor((Date.now() / 1000 - totp.timestamp) / DAY_SEC) : null,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [supabase])

  const stepUp = mfaStepUpPath(HERE)

  function lastAuthText(s: Status) {
    const keep = `${MFA_REMEMBER_SEC / DAY_SEC}일 동안 유지`
    if (s.daysSinceTotp == null) return '이 로그인에서는 아직 인증하지 않았습니다'
    const ago = s.daysSinceTotp < 1 ? '오늘' : `${s.daysSinceTotp}일 전`
    return `마지막 인증 ${ago} · ${s.fresh ? keep : '다시 인증 필요'}`
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>2단계 인증</CardTitle>
        <CardDescription>
          인증 앱(Google Authenticator 등)의 6자리 코드로 민감한 작업을 보호합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {failed ? (
          <p className="text-sm text-destructive">2단계 인증 상태를 불러오지 못했습니다.</p>
        ) : !status ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : !status.enrolled ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">미등록</p>
            <Button size="sm" asChild>
              <a href={stepUp}>등록하기</a>
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-0.5 text-sm">
              <p className="font-medium">등록됨</p>
              <p className="text-muted-foreground">{lastAuthText(status)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant={status.fresh ? 'outline' : 'default'} asChild>
                <a href={stepUp}>지금 인증</a>
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!status.fresh}
                onClick={() => setConfirmOpen(true)}
              >
                인증 기기 변경
              </Button>
              {!status.fresh && (
                <span className="text-xs text-muted-foreground">먼저 지금 인증하세요</span>
              )}
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>인증 기기 변경</DialogTitle>
            <DialogDescription>
              새 인증 앱을 등록하고 코드를 확인하면 이전 인증 앱은 더 이상 쓸 수 없습니다. 확인 전에
              그만두면 이전 기기가 그대로 유지됩니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              취소
            </Button>
            <Button asChild>
              <a href={`${stepUp}&mode=replace`}>계속</a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
