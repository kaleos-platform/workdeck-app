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

type OAuthGrant = { client: { id: string; name: string }; granted_at: string }

const dateText = (iso: string) => new Date(iso).toLocaleDateString('ko-KR')

/**
 * 내 계정으로 워크덱 MCP 에 연결한 AI 앱(OAuth 동의) 목록과 연결 해제.
 * 해제하면 Supabase 가 그 앱의 세션을 지우고, MCP 인증(src/lib/mcp/auth.ts)이 세션 생존을 확인해 즉시 막는다.
 */
export function OAuthGrantsCard() {
  const supabase = useMemo(() => createClient(), [])
  const [grants, setGrants] = useState<OAuthGrant[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [target, setTarget] = useState<OAuthGrant | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [revokeError, setRevokeError] = useState(false)

  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data, error } = await supabase.auth.oauth.listGrants()
      if (cancelled) return
      if (error || !data) return setFailed(true)
      setFailed(false)
      setGrants(data)
    })()
    return () => {
      cancelled = true
    }
  }, [supabase, version])

  async function revoke() {
    if (!target) return
    setRevoking(true)
    setRevokeError(false)
    const { error } = await supabase.auth.oauth.revokeGrant({ clientId: target.client.id })
    setRevoking(false)
    if (error) return setRevokeError(true)
    setTarget(null)
    setVersion((v) => v + 1)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>연결된 AI 앱</CardTitle>
        <CardDescription>
          내 계정으로 워크덱에 연결한 ChatGPT·Claude 같은 AI 앱입니다. 연결을 해제하면 그 앱은 바로
          워크덱에 접근할 수 없습니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {failed ? (
          <p className="text-sm text-destructive">연결된 AI 앱을 불러오지 못했습니다.</p>
        ) : !grants ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : grants.length === 0 ? (
          <p className="text-sm text-muted-foreground">연결된 AI 앱이 없습니다.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {grants.map((g) => (
              <li key={g.client.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0 space-y-0.5 text-sm">
                  <p className="truncate font-medium">{g.client.name || '이름 없는 앱'}</p>
                  <p className="text-muted-foreground">{dateText(g.granted_at)} 연결</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setRevokeError(false)
                    setTarget(g)
                  }}
                >
                  연결 해제
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={!!target} onOpenChange={(open) => !open && !revoking && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{target?.client.name || '이 앱'} 연결 해제</DialogTitle>
            <DialogDescription>
              이 앱은 바로 워크덱에 접근할 수 없게 됩니다. 다시 쓰려면 그 앱에서 워크덱을 다시
              연결해야 합니다.
            </DialogDescription>
          </DialogHeader>
          {revokeError && (
            <p className="text-sm text-destructive">연결을 해제하지 못했습니다. 다시 시도하세요.</p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={revoking} onClick={() => setTarget(null)}>
              취소
            </Button>
            <Button variant="destructive" disabled={revoking} onClick={revoke}>
              {revoking ? '해제 중...' : '연결 해제'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
