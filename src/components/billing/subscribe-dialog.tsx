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
import {
  discountNote,
  firstChargeAfterTrial,
  formatDate,
  formatTrialEndDate,
  formatWon,
  startCardRegistration,
} from './billing-shared'

export type SubscribeTarget = {
  /** 구독할 업무 목록 — 구독 시작은 여러 건, 업무 추가는 1건 */
  /** monthlyPrice = 이 Space 에 청구될 공급가(보장가 반영), listPrice = 정가 공급가 */
  decks: Array<{ id: string; name: string; monthlyPrice: number; listPrice: number }>
  /** true = 기존 구독에 업무 추가(일할 청구), false = 신규 구독 시작(전액) */
  isAddition: boolean
  /** 체험 중인 업무의 체험 종료 시각 — 있으면 지금은 0원, 체험 종료일에 결제가 시작된다(구독 예약) */
  trialEndsAt?: string | null
  /** 업무 추가 경로지만 결제된 업무가 없는(체험 예약만 있는) 구독 — 일할이 아니라 한 달치로 새 주기를 시작한다 */
  chargesFullMonth?: boolean
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
      await startCardRegistration(returnTo)
    } catch (e) {
      setCardError(e instanceof Error ? e.message : '카드 등록에 실패했습니다')
    } finally {
      setCardBusy(false)
    }
  }, [returnTo])

  if (!target) return null

  const supply = target.decks.reduce((sum, d) => sum + d.monthlyPrice, 0)
  const total = Math.round(supply * 1.1)
  const listSupply = target.decks.reduce((sum, d) => sum + d.listPrice, 0)
  const note = discountNote(listSupply, supply)
  const names = target.decks.map((d) => d.name).join(', ')
  const needsCard = !cardSummary
  const trialEnd =
    target.trialEndsAt && new Date(target.trialEndsAt).getTime() > Date.now()
      ? formatTrialEndDate(target.trialEndsAt)
      : null
  // 결제 예정일: 체험 중이면 체험 종료 후 첫 정기결제 실행일, 아니면 확인 즉시
  const payDate = trialEnd
    ? formatDate(firstChargeAfterTrial(target.trialEndsAt!))
    : '오늘 (확인 즉시)'
  // 결제 일정 안내 — 하단 불릿으로 짧게 나눠 보여준다
  const payNotes = trialEnd
    ? [
        '결제 예정일에 첫 결제, 이후 매월 같은 날 자동 결제',
        '구독 중인 다른 업무가 있으면 첫 결제는 다음 결제일까지 일할 계산',
        '체험이 끝나기 전에 예약을 취소하면 결제되지 않음',
      ]
    : target.isAddition && !target.chargesFullMonth
      ? ['오늘 다음 결제일까지 남은 기간만 일할 결제', '이후 다른 업무와 함께 매월 결제']
      : ['오늘 첫 달 결제, 이후 매월 같은 날 자동 결제']

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && !cardBusy && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {needsCard
              ? '결제수단을 먼저 등록해주세요'
              : trialEnd
                ? '구독을 예약할까요?'
                : '구독을 시작할까요?'}
          </DialogTitle>
          <DialogDescription>
            {needsCard
              ? '카드를 등록하면 이어서 구독 내용을 확인할 수 있습니다. 등록 단계에서는 결제가 일어나지 않습니다.'
              : trialEnd
                ? `${names} 업무를 구독합니다. 체험은 ${trialEnd}까지 그대로 이용하고, 체험이 끝나면 유료로 전환됩니다.`
                : `${names} 업무를 구독합니다.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="space-y-1.5 rounded-lg border bg-muted/30 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">월 결제 금액</span>
              <span className="text-lg font-semibold tabular-nums">
                {note && (
                  // 할인 고객: 정가에 취소선을 긋고 실제 결제되는 할인가를 나란히 보여준다
                  <span className="mr-1.5 text-sm font-normal text-muted-foreground line-through">
                    {formatWon(Math.round(listSupply * 1.1))}
                  </span>
                )}
                {formatWon(total)}
                <span className="text-sm font-normal text-muted-foreground">(VAT 포함)/월</span>
              </span>
            </div>
            {note && <p className="text-xs text-primary">{note}</p>}
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">결제 예정일</span>
              <span className="font-semibold tabular-nums">{payDate}</span>
            </div>
            {target.decks.length > 1 && (
              <>
                <Separator className="my-2" />
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {target.decks.map((deck) => (
                    <li key={deck.id} className="flex justify-between">
                      <span>{deck.name}</span>
                      <span>
                        {formatWon(Math.round(deck.monthlyPrice * 1.1))}
                        {deck.monthlyPrice < deck.listPrice && (
                          <span className="ml-1 line-through">
                            {formatWon(Math.round(deck.listPrice * 1.1))}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <ul className="space-y-1 text-xs break-keep text-muted-foreground">
            {payNotes.map((line) => (
              <li key={line}>• {line}</li>
            ))}
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
              {trialEnd
                ? '구독 예약'
                : target.isAddition && !target.chargesFullMonth
                  ? '추가하고 결제'
                  : '구독 시작'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
