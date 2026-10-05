import type { ActionDefinition } from './types'
import { financeActions } from './finance'
import { sellerHubActions } from './seller-hub'
import { coupangAdsActions } from './coupang-ads'

/**
 * 전체 액션 정의 단일 소스.
 * deck별 파일이 자신의 ActionDefinition[] 를 export하고 여기에 합친다.
 */
const allActions: ActionDefinition[] = [
  ...financeActions,
  ...sellerHubActions,
  ...coupangAdsActions,
]

const byType = new Map<string, ActionDefinition>(allActions.map((a) => [a.actionType, a]))

// 개발 시점 중복 actionType 방지 (배포 전 잡힘).
if (byType.size !== allActions.length) {
  const seen = new Set<string>()
  const dup = allActions
    .map((a) => a.actionType)
    .filter((t) => (seen.has(t) ? true : (seen.add(t), false)))
  throw new Error(`중복 actionType: ${[...new Set(dup)].join(', ')}`)
}

export function getActionDefinition(actionType: string): ActionDefinition | undefined {
  return byType.get(actionType)
}

export function listActionDefinitions(): ActionDefinition[] {
  return allActions
}

/**
 * 테스트 전용 — 상태머신/경합 검증을 위해 제어 가능한 액션을 등록한다.
 * 운영 코드 경로는 이 함수를 호출하지 않는다(deck 배열만 사용).
 * @returns 등록 해제 함수
 */
export function __registerActionForTest(def: ActionDefinition): () => void {
  byType.set(def.actionType, def)
  return () => {
    byType.delete(def.actionType)
  }
}
