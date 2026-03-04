import { prisma } from '@/lib/prisma'

export type MeterEventType = 'report_generated' | 'upload_processed' | 'analysis_run'

// 사용량 미터링 이벤트 기록
// 실패해도 상위 요청을 막지 않도록 호출부에서 catch 처리 권장
export async function trackMeterEvent(
  spaceId: string,
  deckAppId: string,
  eventType: MeterEventType,
  quantity = 1
) {
  await prisma.meterEvent.create({ data: { spaceId, deckAppId, eventType, quantity } })
}
