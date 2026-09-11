'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'
import { CreditCard, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { buildMarketingUrl } from '@/lib/domain'
import { formatWon, loadTossSdk } from './billing-shared'

export type SubscribeTarget = {
  /** 구독할 업무 목록 — 구독 시작은 여러 건, 업무 추가는 1건 */
  decks: Array<{ id: string; name: string; monthlyPrice: number }>
  /** true = 기존 구독에 업무 추가(일할 청구), false = 신규 구독 시작(전액) */
  isAddition: boolean
}

type SubscribeDialogProps = {
  target: SubscribeTarget | null
  /** 등록된 결제수단 요약. null 이면 카드 등록 단계부터 시작한다 */
  cardSummary: string | null
  /** 카드 등록 후 돌아올 경로 (쿼리 포함). 내부 절대 경로여야 한다 */
  returnTo: string
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}

/**
 * 구독 확인 모달. 결제수단이 없으면 카드 등록 단계를 먼저 거친다.
 *
 * 카드 등록은 토스 호스팅 페이지로 풀페이지 이동했다가 콜백으로 돌아오므로,
 * returnTo 에 "돌아와서 어떤 업무의 확인 단계를 열지"를 실어 보내야 선택이 유지된다.
 */
export function SubscribeDialog({
  target,
  cardSummary,
  returnTo,
  busy = false,
  onCancel,
  onConfirm,
}: SubscribeDialogProps) {
  const [cardBusy, setCardBusy] = useState(false)
  const [cardError, setCardError] = useState<string | null>(null)

  const handleRegisterCard = useCallback(async () => {
    setCardBusy(true)
    setCardError(null)
    try {
      const res = await fetch('/api/billing/setup', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        setCardError(json?.error ?? '카드 등록 준비에 실패했습니다')
        return
      }
      const { customerKey, clientKey } = json as { customerKey: string; clientKey: string }
      await loadTossSdk()
      if (!window.TossPayments) throw new Error('결제 SDK 로드에 실패했습니다')
      const origin = window.location.origin
      const callback = `${origin}/api/billing/toss/callback?returnTo=${encodeURIComponent(returnTo)}`
      await window
        .TossPayments(clientKey)
        .payment({ customerKey })
        .requestBillingAuth({
          method: 'CARD',
          successUrl: callback,
          failUrl: `${origin}${returnTo}`,
        })
    } catch (e) {
      setCardError(e instanceof Error ? e.message : '카드 등록에 실패했습니다')
    } finally {
      setCardBusy(false)
    }
  }, [returnTo])

  if (!target) return null

  const supply = target.decks.reduce((sum, d) => sum + d.monthlyPrice, 0)
  const total = Math.round(supply * 1.1)
  const names = target.decks.map((d) => d.name).join(', ')
  const needsCard = !cardSummary

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && !cardBusy && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {needsCard ? '결제수단을 먼저 등록해주세요' : '구독을 시작할까요?'}
          </DialogTitle>
          <DialogDescription>
            {needsCard
              ? '카드를 등록하면 이어서 구독 내용을 확인할 수 있습니다. 등록 단계에서는 결제가 일어나지 않습니다.'
              : `${names} 업무를 구독합니다.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="space-y-1.5 rounded-lg border bg-muted/30 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">월 결제 금액</span>
              <span className="text-lg font-semibold">{formatWon(total)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              부가세 포함 / 공급가 {formatWon(supply)}
            </p>
            {target.decks.length > 1 && (
              <>
                <Separator className="my-2" />
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {target.decks.map((deck) => (
                    <li key={deck.id} className="flex justify-between">
                      <span>{deck.name}</span>
                      <span>{formatWon(Math.round(deck.monthlyPrice * 1.1))}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <ul className="space-y-1 text-xs break-keep text-muted-foreground">
            <li>• 결제일로부터 1개월 단위로 자동 갱신되며, 언제든 해지할 수 있습니다.</li>
            {target.isAddition && (
              <li>• 이용 기간 중 추가하므로 남은 기간만큼 일할 계산된 금액이 즉시 청구됩니다.</li>
            )}
            <li>
              • 해지하면 결제한 기간의 마지막 날까지 이용할 수 있습니다. 자세한 기준은{' '}
              <Link
                href={buildMarketingUrl('/refund')}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                취소·환불 규정
              </Link>
              을 확인하세요.
            </li>
          </ul>

          {cardSummary && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CreditCard className="h-3.5 w-3.5" aria-hidden />
              {cardSummary} 으로 결제됩니다
            </p>
          )}
          {cardError && <p className="text-xs text-destructive">{cardError}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={busy || cardBusy}>
            취소
          </Button>
          {needsCard ? (
            <Button onClick={handleRegisterCard} disabled={cardBusy}>
              {cardBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              카드 등록
            </Button>
          ) : (
            <Button onClick={onConfirm} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {target.isAddition ? '추가하고 결제' : '구독 시작'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
