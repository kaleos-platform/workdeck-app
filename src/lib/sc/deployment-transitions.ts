// 허용 상태 전이 맵 — UI 는 status PATCH 를 사용하지 않으므로 기본안 적용.
// PUBLISHING/PUBLISHED 는 워커 전용이라 외부 전이 불가.
export const ALLOWED_DEPLOYMENT_TRANSITIONS: Partial<Record<string, string[]>> = {
  SCHEDULED: ['CANCELED'],
  FAILED: ['SCHEDULED', 'CANCELED'],
  CANCELED: ['SCHEDULED'],
}
