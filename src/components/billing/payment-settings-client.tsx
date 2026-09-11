'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Info,
  Loader2,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { DECK_META, type DeckVariant } from '@/lib/deck-meta'
import {
  CHARGE_STATUS_LABEL,
  formatDate,
  formatWon,
  loadTossSdk,
  useBillingOverview,
} from './billing-shared'

export function PaymentSettingsClient({
  cardRegistered,
  initialError,
}: {
  cardRegistered: string | null
  initialError: string | null
}) {
  const { data, loading, error, banner, setBanner, isOwner } = useBillingOverview()
  const [cardBusy, setCardBusy] = useState(false)

  useEffect(() => {
    if (cardRegistered) {
      setBanner({ type: 'success', message: '카드 등록이 완료되었습니다' })
    } else if (initialError) {
      setBanner({ type: 'error', message: initialError })
    }
  }, [cardRegistered, initialError, setBanner])

  const handleRegisterCard = useCallback(async () => {
    setCardBusy(true)
    setBanner(null)
    try {
      const res = await fetch('/api/billing/setup', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        setBanner({ type: 'error', message: json?.error ?? '카드 등록 준비에 실패했습니다' })
        return
      }
      const { customerKey, clientKey } = json as { customerKey: string; clientKey: string }
      await loadTossSdk()
      if (!window.TossPayments) throw new Error('결제 SDK 로드에 실패했습니다')
      const toss = window.TossPayments(clientKey)
      const origin = window.location.origin
      await toss.payment({ customerKey }).requestBillingAuth({
        method: 'CARD',
        successUrl: `${origin}/api/billing/toss/callback`,
        failUrl: `${origin}/settings/billing?error=${encodeURIComponent('카드등록취소')}`,
      })
    } catch (e) {
      setBanner({
        type: 'error',
        message: e instanceof Error ? e.message : '카드 등록에 실패했습니다',
      })
    } finally {
      setCardBusy(false)
    }
  }, [setBanner])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        불러오는 중...
      </div>
    )
  }

  if (error || !data) {
    return (
      <Alert variant="destructive">
        <XCircle className="h-4 w-4" />
        <AlertTitle>결제 정보를 불러오지 못했습니다</AlertTitle>
        <AlertDescription>{error ?? '알 수 없는 오류가 발생했습니다'}</AlertDescription>
      </Alert>
    )
  }

  const { method, charges } = data

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {banner && (
          <Alert variant={banner.type === 'error' ? 'destructive' : 'default'}>
            {banner.type === 'error' ? (
              <XCircle className="h-4 w-4" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            <AlertTitle>{banner.message}</AlertTitle>
          </Alert>
        )}

        {!isOwner && (
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>결제 관리는 소유자만 가능합니다</AlertTitle>
            <AlertDescription>
              구독 현황은 열람할 수 있지만 변경은 소유자에게 요청하세요.
            </AlertDescription>
          </Alert>
        )}

        {/* 결제수단 카드 */}
        <Card>
          <CardHeader>
            <CardTitle>결제수단</CardTitle>
            <CardDescription>정기 결제에 사용되는 카드입니다.</CardDescription>
          </CardHeader>
          <CardContent>
            {method ? (
              <div className="flex items-center gap-2 text-sm">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                <span>{method.cardSummary ?? '등록된 카드'}</span>
                <span className="text-muted-foreground">· {formatDate(method.createdAt)} 등록</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Info className="h-4 w-4" />
                등록된 결제수단이 없습니다.
              </div>
            )}
          </CardContent>
          {isOwner && (
            <CardFooter>
              <Button
                onClick={handleRegisterCard}
                disabled={cardBusy}
                variant={method ? 'outline' : 'default'}
              >
                {cardBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {method ? '카드 변경' : '카드 등록'}
              </Button>
            </CardFooter>
          )}
        </Card>

        {/* 결제 내역 */}
        <Card>
          <CardHeader>
            <CardTitle>결제 내역</CardTitle>
            <CardDescription>최근 결제 내역입니다. 금액은 VAT 포함입니다.</CardDescription>
          </CardHeader>
          <CardContent>
            {charges.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                결제 내역이 없습니다.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>결제일</TableHead>
                      <TableHead>청구 기간</TableHead>
                      <TableHead>금액</TableHead>
                      <TableHead>상태</TableHead>
                      <TableHead>내역</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {charges.map((charge) => {
                      const statusMeta = CHARGE_STATUS_LABEL[charge.status]
                      return (
                        <TableRow key={charge.orderId}>
                          <TableCell className="whitespace-nowrap">
                            {formatDate(charge.createdAt)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {formatDate(charge.periodStart)} ~ {formatDate(charge.periodEnd)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {formatWon(charge.amount)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                              {charge.status === 'FAILED' && charge.failReason && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                                  </TooltipTrigger>
                                  <TooltipContent>{charge.failReason}</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {Array.isArray(charge.breakdown) && charge.breakdown.length > 0 ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-help text-xs text-muted-foreground underline decoration-dotted">
                                    {charge.breakdown.length}개 항목
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <ul className="space-y-0.5">
                                    {charge.breakdown.map((line, idx) => {
                                      const meta = DECK_META[line.deckAppId as DeckVariant]
                                      return (
                                        <li key={`${line.deckAppId}-${idx}`}>
                                          {meta?.name ?? line.deckAppId} · {formatWon(line.price)}
                                          {line.prorated ? ' (일할)' : ''}
                                        </li>
                                      )
                                    })}
                                  </ul>
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              '-'
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  )
}
