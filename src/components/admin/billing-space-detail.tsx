'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type SpaceDetail = {
  space: { id: string; name: string }
  subscription: {
    id: string
    status: string
    trialEndsAt: string | null
    currentPeriodEnd: string | null
    retryCount: number
    exemptFlag: boolean
    exemptNote: string | null
    provider: string | null
    items: {
      id: string
      deckAppId: string
      priceSnapshot: number
      status: string
      addedAt: string
      endedAt: string | null
    }[]
  } | null
  methods: {
    id: string
    provider: string
    cardSummary: string | null
    isDefault: boolean
    createdAt: string
  }[]
  charges: {
    id: string
    orderId: string
    amount: number
    status: string
    failReason: string | null
    createdAt: string
  }[]
}

function formatDate(iso: string | null) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ko-KR')
}

function formatKrw(n: number) {
  return `${n.toLocaleString('ko-KR')}원`
}

export function BillingSpaceDetail({ spaceId }: { spaceId: string }) {
  const [data, setData] = useState<SpaceDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/admin/billing/spaces/${spaceId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`)
        return res.json()
      })
      .then(setData)
      .catch(() => setError('상세 정보를 불러오지 못했습니다'))
  }, [spaceId])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!data) return <p className="text-sm text-muted-foreground">불러오는 중...</p>

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{data.space.name}</h1>
        <p className="text-sm text-muted-foreground">{data.space.id}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>구독</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {data.subscription ? (
            <>
              <div className="flex flex-wrap gap-6 text-sm">
                <span>
                  상태 <Badge className="ml-1">{data.subscription.status}</Badge>
                </span>
                <span>재시도 {data.subscription.retryCount}회</span>
                <span>다음 결제일 {formatDate(data.subscription.currentPeriodEnd)}</span>
                <span>트라이얼 종료 {formatDate(data.subscription.trialEndsAt)}</span>
                <span>
                  면제{' '}
                  {data.subscription.exemptFlag
                    ? `Y (${data.subscription.exemptNote ?? '-'})`
                    : 'N'}
                </span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Deck</TableHead>
                    <TableHead>가격 스냅샷</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead>추가일</TableHead>
                    <TableHead>종료일</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.subscription.items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>{i.deckAppId}</TableCell>
                      <TableCell>{formatKrw(i.priceSnapshot)}</TableCell>
                      <TableCell>{i.status}</TableCell>
                      <TableCell>{formatDate(i.addedAt)}</TableCell>
                      <TableCell>{formatDate(i.endedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">구독 정보가 없습니다</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>결제수단</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>제공자</TableHead>
                <TableHead>카드</TableHead>
                <TableHead>기본</TableHead>
                <TableHead>등록일</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.methods.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{m.provider}</TableCell>
                  <TableCell>{m.cardSummary ?? '-'}</TableCell>
                  <TableCell>{m.isDefault ? 'Y' : 'N'}</TableCell>
                  <TableCell>{formatDate(m.createdAt)}</TableCell>
                </TableRow>
              ))}
              {data.methods.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    등록된 결제수단이 없습니다
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>청구 이력 (최근 50건)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>주문번호</TableHead>
                <TableHead>금액</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>실패 사유</TableHead>
                <TableHead>일시</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.charges.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs">{c.orderId}</TableCell>
                  <TableCell>{formatKrw(c.amount)}</TableCell>
                  <TableCell>{c.status}</TableCell>
                  <TableCell className="text-xs text-destructive">{c.failReason ?? '-'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(c.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
              {data.charges.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    청구 이력이 없습니다
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
