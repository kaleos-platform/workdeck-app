'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
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
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type BillingDeckProduct = {
  id: string
  name: string
  pricingMode: 'FREE_BETA' | 'SUBSCRIPTION'
  monthlyPrice: number
  paidActivatedAt: string | null
  isActive: boolean
  /** 신규 고객 공개 여부 — false=준비중 */
  released: boolean
}

type SubscriptionRow = {
  id: string
  spaceId: string
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  retryCount: number
  exemptFlag: boolean
  exemptNote: string | null
  space: {
    id: string
    name: string
    members: { user: { id: string; email: string; name: string | null } }[]
  }
  items: { deckAppId: string; status: string }[]
}

type ChargeRow = {
  id: string
  orderId: string
  amount: number
  status: string
  failReason: string | null
  periodStart: string
  periodEnd: string
  paymentKey: string | null
  createdAt: string
  space: { id: string; name: string }
}

type Overview = {
  products: BillingDeckProduct[]
  subscriptions: SubscriptionRow[]
  recentCharges: ChargeRow[]
  summary: { byStatus: Record<string, number>; exempt: number }
}

const STATUS_LABEL: Record<string, string> = {
  TRIALING: '체험',
  ACTIVE: '활성',
  PAST_DUE: '연체',
  CANCELED: '해지',
  EXPIRED: '만료',
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  TRIALING: 'secondary',
  ACTIVE: 'default',
  PAST_DUE: 'destructive',
  CANCELED: 'outline',
  EXPIRED: 'outline',
}

function formatKrw(n: number) {
  return `${n.toLocaleString('ko-KR')}원`
}

function formatDate(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('ko-KR')
}

export function BillingDashboard() {
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pastDueOnly, setPastDueOnly] = useState(false)
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({})
  const [pendingModeChange, setPendingModeChange] = useState<BillingDeckProduct | null>(null)
  const [pendingRelease, setPendingRelease] = useState<BillingDeckProduct | null>(null)
  const [exemptDialog, setExemptDialog] = useState<SubscriptionRow | null>(null)
  const [exemptNoteDraft, setExemptNoteDraft] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/billing/overview')
      if (!res.ok) throw new Error(`${res.status}`)
      const json = (await res.json()) as Overview
      setData(json)
    } catch {
      setError('결제 현황을 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filteredSubs = useMemo(() => {
    if (!data) return []
    return pastDueOnly
      ? data.subscriptions.filter((s) => s.status === 'PAST_DUE')
      : data.subscriptions
  }, [data, pastDueOnly])

  async function savePrice(product: BillingDeckProduct) {
    const draft = priceDrafts[product.id]
    if (draft === undefined) return
    const price = Number(draft)
    if (!Number.isInteger(price) || price < 0) {
      setError('가격은 0 이상의 정수여야 합니다')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/billing/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthlyPrice: price }),
      })
      if (!res.ok) throw new Error()
      setPriceDrafts((prev) => {
        const next = { ...prev }
        delete next[product.id]
        return next
      })
      await load()
    } catch {
      setError('가격 변경에 실패했습니다')
    } finally {
      setBusy(false)
    }
  }

  async function confirmModeChange() {
    if (!pendingModeChange) return
    const nextMode = pendingModeChange.pricingMode === 'FREE_BETA' ? 'SUBSCRIPTION' : 'FREE_BETA'
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/billing/products/${pendingModeChange.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pricingMode: nextMode }),
      })
      if (!res.ok) throw new Error()
      setPendingModeChange(null)
      await load()
    } catch {
      setError('과금 모드 변경에 실패했습니다')
    } finally {
      setBusy(false)
    }
  }

  async function confirmReleaseChange() {
    if (!pendingRelease) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/billing/products/${pendingRelease.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ released: !pendingRelease.released }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null
        throw new Error(json?.message ?? '공개 상태 변경에 실패했습니다')
      }
      setPendingRelease(null)
      await load()
    } catch (e) {
      setPendingRelease(null)
      setError(e instanceof Error ? e.message : '공개 상태 변경에 실패했습니다')
    } finally {
      setBusy(false)
    }
  }

  async function submitExempt(exempt: boolean) {
    if (!exemptDialog) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/billing/spaces/${exemptDialog.spaceId}/exempt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exempt, note: exemptNoteDraft || undefined }),
      })
      if (!res.ok) throw new Error()
      setExemptDialog(null)
      setExemptNoteDraft('')
      await load()
    } catch {
      setError('면제 설정 변경에 실패했습니다')
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>
  }
  if (!data) {
    return <p className="text-sm text-destructive">{error ?? '데이터 없음'}</p>
  }

  return (
    <div className="flex flex-col gap-8">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>활성 구독</CardDescription>
            <CardTitle className="text-2xl">{data.summary.byStatus.ACTIVE ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>체험 중</CardDescription>
            <CardTitle className="text-2xl">{data.summary.byStatus.TRIALING ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>연체</CardDescription>
            <CardTitle className="text-2xl text-destructive">
              {data.summary.byStatus.PAST_DUE ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>운영자 면제</CardDescription>
            <CardTitle className="text-2xl">{data.summary.exempt}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Deck 과금 상품</CardTitle>
          <CardDescription>
            공개 여부, 과금 모드, 월 공급가(VAT 별도)를 관리합니다. 준비중 업무는 신규 고객이
            추가·구독할 수 없고 이미 쓰는 공간은 그대로 이용합니다
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead>공개</TableHead>
                <TableHead>과금 모드</TableHead>
                <TableHead>월 공급가</TableHead>
                <TableHead>유료 전환일</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.products.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    {p.name}
                    <span className="ml-2 text-xs text-muted-foreground">{p.id}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={p.released}
                        onCheckedChange={() => setPendingRelease(p)}
                        disabled={busy}
                        aria-label={`${p.name} 공개 여부`}
                      />
                      <Badge variant={p.released ? 'default' : 'secondary'}>
                        {p.released ? '공개' : '준비중'}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={p.pricingMode}
                      onValueChange={() => setPendingModeChange(p)}
                      disabled={busy}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FREE_BETA">FREE_BETA</SelectItem>
                        <SelectItem value="SUBSCRIPTION">SUBSCRIPTION</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Input
                        className="w-32"
                        type="number"
                        min={0}
                        step={1}
                        value={priceDrafts[p.id] ?? String(p.monthlyPrice)}
                        onChange={(e) =>
                          setPriceDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))
                        }
                      />
                      {priceDrafts[p.id] !== undefined &&
                        priceDrafts[p.id] !== String(p.monthlyPrice) && (
                          <Button size="sm" disabled={busy} onClick={() => savePrice(p)}>
                            저장
                          </Button>
                        )}
                    </div>
                  </TableCell>
                  <TableCell>{formatDate(p.paidActivatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>구독 현황</CardTitle>
            <CardDescription>Space별 구독 상태와 면제 여부</CardDescription>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Switch checked={pastDueOnly} onCheckedChange={setPastDueOnly} />
            <span>연체만 보기</span>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Space</TableHead>
                <TableHead>소유자</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>Deck</TableHead>
                <TableHead>재시도</TableHead>
                <TableHead>다음 결제일</TableHead>
                <TableHead>면제</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSubs.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link
                      href={`/admin/billing/${s.spaceId}`}
                      className="font-medium hover:underline"
                    >
                      {s.space.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {s.space.members.length === 0 ? (
                      <span className="text-xs text-muted-foreground">-</span>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        {s.space.members.map(({ user }) => (
                          <Link
                            key={user.id}
                            href={`/admin/users/${user.id}`}
                            className="text-sm hover:underline"
                          >
                            {user.email}
                          </Link>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[s.status] ?? 'outline'}>
                      {STATUS_LABEL[s.status] ?? s.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {s.items.map((i) => i.deckAppId).join(', ') || '-'}
                  </TableCell>
                  <TableCell>{s.retryCount}</TableCell>
                  <TableCell>{formatDate(s.currentPeriodEnd)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={s.exemptFlag}
                        disabled={busy}
                        onCheckedChange={() => {
                          setExemptDialog(s)
                          setExemptNoteDraft(s.exemptNote ?? '')
                        }}
                      />
                      {s.exemptFlag && (
                        <span className="text-xs text-muted-foreground">{s.exemptNote}</span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredSubs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    표시할 구독이 없습니다
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>최근 청구 20건</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Space</TableHead>
                <TableHead>주문번호</TableHead>
                <TableHead>금액</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>실패 사유</TableHead>
                <TableHead>결제키</TableHead>
                <TableHead>일시</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recentCharges.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.space.name}</TableCell>
                  <TableCell className="font-mono text-xs">{c.orderId}</TableCell>
                  <TableCell>{formatKrw(c.amount)}</TableCell>
                  <TableCell>{c.status}</TableCell>
                  <TableCell className="max-w-48 truncate text-xs text-destructive">
                    {c.failReason ?? '-'}
                  </TableCell>
                  <TableCell>
                    {c.paymentKey ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigator.clipboard.writeText(c.paymentKey!)}
                      >
                        키 복사
                      </Button>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(c.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={!!pendingModeChange}
        onOpenChange={(open) => !open && setPendingModeChange(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>과금 모드 변경</DialogTitle>
            <DialogDescription>
              {pendingModeChange?.pricingMode === 'FREE_BETA' ? (
                <>
                  <strong>{pendingModeChange?.name}</strong>을(를) SUBSCRIPTION으로 전환합니다. 전환
                  즉시 유료화 유예 14일이 시작됩니다. 기존 사용 Space를 면제하려면 전환 전에{' '}
                  <code>exempt-all-existing</code> 백필을 먼저 실행했는지 확인하세요.
                </>
              ) : (
                <>
                  <strong>{pendingModeChange?.name}</strong>을(를) FREE_BETA로 되돌립니다. 유료
                  전환일(paidActivatedAt)은 유예 14일 재시작을 막기 위해 보존됩니다.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingModeChange(null)} disabled={busy}>
              취소
            </Button>
            <Button onClick={confirmModeChange} disabled={busy}>
              변경 확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingRelease} onOpenChange={(open) => !open && setPendingRelease(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingRelease?.released ? '준비중으로 전환' : '공개로 전환'} —{' '}
              {pendingRelease?.name}
            </DialogTitle>
            <DialogDescription>
              {pendingRelease?.released ? (
                <>
                  신규 고객이 이 업무를 추가·구독할 수 없게 되고, 마케팅 사이트에는 가격 대신
                  「준비중」과 출시 알림 신청이 표시됩니다. 이미 사용 중인 공간은 그대로 이용합니다.
                </>
              ) : (
                <>
                  누구나 이 업무를 추가·구독할 수 있게 되고, 마케팅 사이트 소개·요금 페이지에 가격과
                  구독 버튼이 표시됩니다. 결제 금액(월 공급가)을 먼저 확인하세요.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingRelease(null)} disabled={busy}>
              취소
            </Button>
            <Button onClick={confirmReleaseChange} disabled={busy}>
              변경 확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!exemptDialog} onOpenChange={(open) => !open && setExemptDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {exemptDialog?.exemptFlag ? '면제 해제' : '면제 설정'} — {exemptDialog?.space.name}
            </DialogTitle>
            <DialogDescription>
              {exemptDialog?.exemptFlag
                ? '면제를 해제하면 다음 결제 주기부터 정상 과금됩니다.'
                : '면제 사유를 입력하세요 (감사 로그에 기록됩니다).'}
            </DialogDescription>
          </DialogHeader>
          {!exemptDialog?.exemptFlag && (
            <Input
              placeholder="면제 사유 (선택)"
              value={exemptNoteDraft}
              onChange={(e) => setExemptNoteDraft(e.target.value)}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setExemptDialog(null)} disabled={busy}>
              취소
            </Button>
            <Button
              onClick={() => submitExempt(!exemptDialog?.exemptFlag)}
              disabled={busy}
              variant={exemptDialog?.exemptFlag ? 'destructive' : 'default'}
            >
              확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
