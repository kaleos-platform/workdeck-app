/**
 * Deck 알림 이벤트 레지스트리 — 이벤트 단위 토글의 단일 소스.
 *
 * 저장 규약(DeckInstance.slackNotifyEvents): 비활성 이벤트만 `{ "<eventKey>": false }` 로 기록한다.
 * 미기재 = on(default-on). 새 이벤트를 추가하면 기존 사용자에게도 자동으로 on 상태가 된다.
 *
 * togglable=false 이벤트(수집 실패·로그인 실패 등)는 UI에서 끌 수 없고 마스터 토글로만 제어된다 —
 * 게이트는 이런 이벤트를 항상 발송 허용(fail-open)한다.
 *
 * 주의: '광고 분석 완료'는 여기에 없다 — 예약 알림(AnalysisSchedule.slackNotify) 관할이므로
 * Deck 이벤트 토글 대상이 아니다.
 */

export type DeckNotificationEvent = {
  key: string
  label: string
  description: string
  togglable: boolean
}

export const DECK_NOTIFICATION_EVENTS: Record<string, DeckNotificationEvent[]> = {
  'coupang-ads': [
    {
      key: 'collection_done',
      label: '광고 수집 완료',
      description: '쿠팡 광고 데이터 수집이 완료되면 알립니다',
      togglable: true,
    },
    {
      key: 'inventory_collection_done',
      label: '재고 수집 완료',
      description: '쿠팡 재고 데이터 수집이 완료되면 알립니다',
      togglable: true,
    },
    {
      key: 'inventory_analysis_done',
      label: '재고 분석 완료',
      description: '쿠팡 재고 분석이 완료되면 이슈 요약을 알립니다',
      togglable: true,
    },
    {
      key: 'collection_failed',
      label: '수집 실패',
      description: '광고 데이터 수집이 실패하면 알립니다',
      togglable: false,
    },
    {
      key: 'login_failed',
      label: '로그인 실패',
      description: '쿠팡 로그인에 실패하면 알립니다',
      togglable: false,
    },
    {
      key: 'inventory_stale',
      label: '재고 데이터 노후',
      description: '재고 데이터가 오래되어 분석을 건너뛰면 알립니다',
      togglable: false,
    },
  ],
  'seller-hub': [
    {
      key: 'vendor_sales_done',
      label: '판매 수집 완료',
      description: '쿠팡 로켓그로스 판매 데이터 수집이 완료되면 알립니다',
      togglable: true,
    },
  ],
}

/** 해당 Deck의 이벤트 정의를 찾는다(없으면 undefined). */
export function findDeckEvent(
  deckKey: string,
  eventKey: string
): DeckNotificationEvent | undefined {
  return DECK_NOTIFICATION_EVENTS[deckKey]?.find((e) => e.key === eventKey)
}

/** 레지스트리에 등록됐고 togglable=true 인 이벤트인지 여부. 미등록·비togglable이면 false. */
export function isTogglableEvent(deckKey: string, eventKey: string): boolean {
  return findDeckEvent(deckKey, eventKey)?.togglable === true
}
