// 체험 중 구독 예약 판정 — DB 무접근 순수 함수. 서버(구독 서비스)와 화면이 같은 규칙을 쓴다.
type ItemState = { status: string; awaitingTrialEnd?: boolean | null }

/** 결제된(예약이 아닌) 업무가 하나라도 살아 있는지. 해지 예정(CANCEL_AT_PERIOD_END)도 결제된 업무다. */
export function hasPaidItems(items: ItemState[]) {
  return items.some((i) => i.status !== 'ENDED' && !i.awaitingTrialEnd)
}

/** 결제된 업무 없이 체험 예약만 남은 구독인지 */
export function isReservationOnly(items: ItemState[]) {
  const live = items.filter((i) => i.status !== 'ENDED')
  return live.length > 0 && !hasPaidItems(live)
}
