'use client'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { redirectIfMfaRequired } from '@/lib/auth/mfa-client'
import type { RecoveryKeyStatus } from '@/lib/admin/recovery-key'

const endpoint = '/api/admin/recovery-key'
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString('ko-KR') : '아직 없음'

export function RecoveryKeySettings() {
  const [state, setState] = useState<RecoveryKeyStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(endpoint, { cache: 'no-store' })
      if (await redirectIfMfaRequired(res)) return
      const body = await res.json()
      if (!res.ok)
        throw new Error('상태를 불러오지 못했습니다. 연결과 운영 설정을 확인한 뒤 다시 시도하세요.')
      setState(body)
    } catch {
      setError('상태를 불러오지 못했습니다. 연결과 운영 설정을 확인한 뒤 다시 시도하세요.')
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  async function run(action: 'backup' | 'verify') {
    setConfirm(false)
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (await redirectIfMfaRequired(res)) return
      const body = await res.json()
      if (!res.ok) {
        setError(body.message ?? '작업을 완료하지 못했습니다. 상태를 새로고침해 확인하세요.')
        return
      }
      setState(body)
      setNotice('보관 사본과 현재 키의 일치를 확인했습니다. 독립 환경 복원 시험은 별도입니다.')
    } catch {
      setError('작업 결과를 확인하지 못했습니다. 상태를 새로고침한 후 확인하세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>암호화 키 사본</CardTitle>
        <CardDescription>
          서비스 키를 Supabase Vault에 별도로 보관합니다. 원래 키는 변경하지 않습니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
            {notice}
          </p>
        )}
        {!state && !error && (
          <p role="status" className="text-sm text-muted-foreground">
            보관 상태를 확인하고 있습니다.
          </p>
        )}
        {state && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">키 ID: {state.keyId}</span>
              <Badge
                variant="outline"
                className={
                  state.stored
                    ? 'border-emerald-300 text-emerald-700 dark:text-emerald-400'
                    : 'border-amber-300 text-amber-700 dark:text-amber-400'
                }
              >
                {state.stored ? '보관됨' : '미보관'}
              </Badge>
              {!state.sourceAvailable && <Badge variant="destructive">현재 키 사용 불가</Badge>}
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-[11rem_1fr]">
              <dt className="text-muted-foreground">최초 보관</dt>
              <dd>{date(state.createdAt)}</dd>
              <dt className="text-muted-foreground">마지막 사본 일치 검증</dt>
              <dd>{date(state.lastVerifiedAt)}</dd>
            </dl>
            <p className="text-sm text-muted-foreground">
              플랫폼 운영자 전용입니다. 키 값은 화면·에이전트에 전달하지 않으며 작업에는 2단계
              인증이 필요합니다.
            </p>
            {!state.sourceAvailable && (
              <p className="text-sm text-destructive">
                현재 키 설정을 확인하세요. 사본을 새 키로 덮어쓰지 마세요.
              </p>
            )}
          </>
        )}
        <div className="flex flex-wrap gap-2">
          {state &&
            (state.stored ? (
              <Button onClick={() => void run('verify')} disabled={busy || !state.sourceAvailable}>
                사본 일치 검증
              </Button>
            ) : (
              <Button onClick={() => setConfirm(true)} disabled={busy || !state.sourceAvailable}>
                사본 보관
              </Button>
            ))}
          <Button variant="outline" onClick={() => void load()} disabled={busy}>
            상태 새로고침
          </Button>
        </div>
        <div className="border-t pt-4 text-sm text-muted-foreground">
          <p>서비스에 접속할 수 없을 때는 Supabase 운영자 관리 경로로 복구합니다.</p>
          <p>Supabase까지 유실되는 상황을 위한 별도 사본과 실제 복원 시험이 필요합니다.</p>
        </div>
        <Dialog open={confirm} onOpenChange={setConfirm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>복구 키 사본 보관</DialogTitle>
              <DialogDescription>
                현재 k1 키의 사본을 Supabase Vault에 저장하고 일치 여부를 확인합니다. 기존 사본이
                다르면 덮어쓰지 않고 중단합니다.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirm(false)}>
                취소
              </Button>
              <Button onClick={() => void run('backup')} disabled={busy}>
                보관 실행
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
