'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useCurrentSpace } from '@/hooks/use-current-space'
import { fetchWithMfa, redirectIfMfaRequired } from '@/lib/auth/mfa-client'

type MallStatus = 'needs_auth' | 'connected' | 'reauth_required'
type Cafe24Mall = {
  mallId: string
  status: MallStatus
  connectedAt: string | null
  scopes: string[]
  error: string | null
}
type Cafe24StatusResponse = { appConfigured: boolean; limit: number; malls: Cafe24Mall[] }

const STATUS_LABEL: Record<MallStatus, string> = {
  connected: '연결됨',
  needs_auth: '승인 필요',
  reauth_required: '다시 승인 필요',
}
const STATUS_CLASS: Record<MallStatus, string> = {
  connected: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  needs_auth: 'bg-muted text-muted-foreground',
  reauth_required: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
}

const RESULT_MESSAGE: Record<string, { title: string; variant: 'default' | 'destructive' }> = {
  connected: { title: '카페24 연결이 완료되었습니다', variant: 'default' },
  denied: {
    title: '카페24 승인을 취소했습니다. 쇼핑몰 대표 운영자 계정인지 확인해 주세요',
    variant: 'destructive',
  },
  error: {
    title: '카페24 연결에 실패했습니다. 앱 정보를 확인하고 다시 시도해 주세요',
    variant: 'destructive',
  },
  mall_mismatch: {
    title: '승인한 쇼핑몰이 입력한 쇼핑몰 ID와 다릅니다. 쇼핑몰 ID를 확인해 주세요',
    variant: 'destructive',
  },
  scope_missing: {
    title: '주문 읽기·쓰기 권한이 승인되지 않았습니다. 카페24 앱의 권한 설정을 확인해 주세요',
    variant: 'destructive',
  },
  mfa_required: {
    title: '2단계 인증이 필요합니다. 「다시 승인」을 눌러 인증한 뒤 진행해 주세요',
    variant: 'destructive',
  },
  forbidden: {
    title:
      '이 작업 공간의 관리자 권한이 없거나 승인을 시작한 계정과 다릅니다. 같은 계정으로 다시 시도해 주세요',
    variant: 'destructive',
  },
  expired: {
    title:
      '승인 요청이 만료되었거나 유효하지 않습니다. 「다시 승인」을 눌러 처음부터 진행해 주세요',
    variant: 'destructive',
  },
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: unknown } | null
  return typeof body?.message === 'string' ? body.message : fallback
}

export function Cafe24ConnectCard({
  result,
  resultMall,
  onChanged,
  embedded = false,
}: {
  /** OAuth 복귀 결과(?cafe24=) */
  result: string | null
  /** OAuth 복귀한 쇼핑몰(?mall=) */
  resultMall?: string | null
  onChanged?: () => void
  embedded?: boolean
}) {
  const space = useCurrentSpace()
  const spaceId = space?.id
  const [data, setData] = useState<Cafe24StatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [editingApp, setEditingApp] = useState(false)
  const [mallId, setMallId] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [startingMall, setStartingMall] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ mallId: string; message: string } | null>(null)

  const load = useCallback(async () => {
    if (!spaceId) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/integrations/cafe24/status?spaceId=${encodeURIComponent(spaceId)}`
      )
      setData(res.ok ? ((await res.json()) as Cafe24StatusResponse) : null)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [spaceId])

  useEffect(() => {
    load()
  }, [load])

  const credentialsUrl = spaceId
    ? `/api/spaces/${encodeURIComponent(spaceId)}/credentials/cafe24`
    : ''

  // 서버가 Origin·권한·2단계 인증을 확인하고 카페24 승인 주소를 준다. 인증이 만료됐으면 제자리에서 다시 인증한다.
  async function handleInstall(targetMall: string) {
    if (!spaceId) return
    setStartingMall(targetMall)
    setRowError(null)
    try {
      const body = new FormData()
      body.set('spaceId', spaceId)
      body.set('mallId', targetMall)
      const res = await fetchWithMfa('/api/integrations/cafe24/install', { method: 'POST', body })
      if (await redirectIfMfaRequired(res)) return
      const json = (await res.json().catch(() => null)) as { url?: string } | null
      if (!res.ok || !json?.url) {
        setRowError({
          mallId: targetMall,
          message: await errorMessage(res, '카페24 승인을 시작하지 못했습니다'),
        })
        return
      }
      window.location.assign(json.url)
    } catch {
      setRowError({ mallId: targetMall, message: '카페24 승인을 시작하지 못했습니다' })
    } finally {
      setStartingMall(null)
    }
  }

  // mode=add: 쇼핑몰 추가(첫 몰이면 앱 정보 포함), mode=app: 앱 정보만 수정
  async function handleSave(mode: 'add' | 'app') {
    if (!spaceId) return
    setSaving(true)
    setError(null)
    try {
      const needSecret = mode === 'app' || !data?.appConfigured
      const payload: Record<string, unknown> = {}
      if (mode === 'add') payload.config = { mallId: mallId.trim().toLowerCase() }
      if (needSecret) {
        payload.secret = { clientId: clientId.trim(), clientSecret: clientSecret.trim() }
      }
      const res = await fetchWithMfa(credentialsUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (await redirectIfMfaRequired(res)) return
      if (!res.ok) {
        setError(await errorMessage(res, '저장하지 못했습니다'))
        return
      }
      setMallId('')
      setClientId('')
      setClientSecret('')
      setAdding(false)
      setEditingApp(false)
      await load()
      onChanged?.()
    } catch {
      setError('저장하지 못했습니다')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!spaceId || !deleteTarget) return
    const target = deleteTarget
    setDeleting(true)
    setRowError(null)
    try {
      const res = await fetchWithMfa(`${credentialsUrl}?mallId=${encodeURIComponent(target)}`, {
        method: 'DELETE',
      })
      if (await redirectIfMfaRequired(res)) return
      if (!res.ok) {
        setRowError({ mallId: target, message: await errorMessage(res, '삭제하지 못했습니다') })
        return
      }
      await load()
      onChanged?.()
    } catch {
      setRowError({ mallId: target, message: '삭제하지 못했습니다' })
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  const toast = result ? RESULT_MESSAGE[result] : null
  const malls = data?.malls ?? []
  const limit = data?.limit ?? 5
  const appConfigured = Boolean(data?.appConfigured)
  const needSecret = !appConfigured
  const secretFields = (
    <>
      <div className="space-y-2">
        <Label htmlFor="cafe24-client-id">클라이언트 ID (client_id)</Label>
        <Input
          id="cafe24-client-id"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cafe24-client-secret">클라이언트 시크릿 (client_secret)</Label>
        <Input
          id="cafe24-client-secret"
          type="password"
          autoComplete="off"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
        />
      </div>
    </>
  )
  const secretReady = clientId.trim() && clientSecret.trim()
  const formError = error && (
    <p role="alert" className="text-xs text-destructive">
      {error}
    </p>
  )

  return (
    <Card className={embedded ? 'border-0 bg-transparent py-0 shadow-none' : undefined}>
      <CardContent className={embedded ? 'space-y-4 px-0' : 'space-y-4'}>
        {toast && (
          <Alert variant={toast.variant}>
            {toast.variant === 'destructive' ? (
              <XCircle className="h-4 w-4" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            <AlertTitle>
              {/* 서명 없는 쿼리라 연결된 몰일 때만 이름을 붙인다 */}
              {resultMall && malls.some((m) => m.mallId === resultMall)
                ? `[${resultMall}] ${toast.title}`
                : toast.title}
            </AlertTitle>
          </Alert>
        )}

        {loading || !spaceId ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                연결된 쇼핑몰{' '}
                <span className="font-medium text-foreground">
                  {malls.length} / {limit}
                </span>
              </p>
              <div className="flex items-center gap-2">
                {appConfigured && !editingApp && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingApp(true)
                      setAdding(false)
                      setError(null)
                    }}
                  >
                    앱 정보 수정
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={malls.length >= limit || adding}
                  onClick={() => {
                    setAdding(true)
                    setEditingApp(false)
                    setError(null)
                  }}
                >
                  + 쇼핑몰 추가
                </Button>
              </div>
            </div>

            {malls.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>쇼핑몰 ID</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead>승인일</TableHead>
                    <TableHead className="text-right">작업</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {malls.map((m) => (
                    <Fragment key={m.mallId}>
                      <TableRow>
                        <TableCell className="font-medium">{m.mallId}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`border-transparent ${STATUS_CLASS[m.status]}`}
                          >
                            {STATUS_LABEL[m.status]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {m.connectedAt
                            ? new Date(m.connectedAt).toLocaleDateString('ko-KR')
                            : '-'}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant={m.status === 'connected' ? 'outline' : 'default'}
                              disabled={startingMall !== null}
                              onClick={() => handleInstall(m.mallId)}
                            >
                              {startingMall === m.mallId && (
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                              )}
                              {m.status === 'connected' ? '다시 승인' : '카페24에서 승인'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteTarget(m.mallId)}
                            >
                              삭제
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {(rowError?.mallId === m.mallId || m.error) && (
                        <TableRow>
                          <TableCell colSpan={4} className="py-1">
                            <p role="alert" className="text-xs text-destructive">
                              {rowError?.mallId === m.mallId ? rowError.message : m.error}
                            </p>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            )}

            {adding && (
              <div className="space-y-4 rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">
                  추가한 뒤 「카페24에서 승인」을 누르면 그 쇼핑몰 관리자 로그인·동의 화면으로
                  이동합니다. 쇼핑몰 대표 운영자 계정으로 승인해 주세요.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="cafe24-mall-id">쇼핑몰 ID</Label>
                  <Input
                    id="cafe24-mall-id"
                    placeholder="myshop24"
                    value={mallId}
                    onChange={(e) => setMallId(e.target.value.toLowerCase())}
                  />
                </div>
                {needSecret && secretFields}
                {formError}
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleSave('add')}
                    disabled={saving || !mallId.trim() || (needSecret && !secretReady)}
                  >
                    {saving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        추가 중...
                      </>
                    ) : (
                      '추가'
                    )}
                  </Button>
                  <Button variant="ghost" onClick={() => setAdding(false)} disabled={saving}>
                    취소
                  </Button>
                </div>
              </div>
            )}

            {editingApp && (
              <div className="space-y-4 rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">
                  클라이언트 ID를 바꾸면 모든 쇼핑몰을 다시 승인해야 합니다.
                </p>
                {secretFields}
                {formError}
                <div className="flex gap-2">
                  <Button onClick={() => handleSave('app')} disabled={saving || !secretReady}>
                    {saving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        저장 중...
                      </>
                    ) : (
                      '저장'
                    )}
                  </Button>
                  <Button variant="ghost" onClick={() => setEditingApp(false)} disabled={saving}>
                    취소
                  </Button>
                </div>
              </div>
            )}

            {malls.length === 0 && !adding && (
              <p className="text-sm text-muted-foreground">
                연결된 쇼핑몰이 없습니다. 「+ 쇼핑몰 추가」로 시작하세요.
              </p>
            )}
          </>
        )}
      </CardContent>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && !deleting && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>쇼핑몰 삭제</DialogTitle>
            <DialogDescription>
              「{deleteTarget}」 연결을 삭제합니다. 이 쇼핑몰로 주문 관측 중인 판매채널이 있으면
              먼저 관측을 꺼야 합니다. 다시 연결하려면 쇼핑몰 추가 후 승인을 다시 받아야 합니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              취소
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? '삭제 중...' : '삭제'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
