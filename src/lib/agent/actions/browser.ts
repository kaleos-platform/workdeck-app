import {
  BROWSER_ROUNDTRIP_ACTION,
  enqueueBrowserWrite,
  markerDiff,
  roundtripParams,
} from '@/lib/browser/approved-write'
import type { ActionDefinition } from './types'

export const browserActions: ActionDefinition[] = [
  {
    actionType: BROWSER_ROUNDTRIP_ACTION,
    deckKey: 'seller-hub',
    title: 'Cafe24 개발 스킨 주석 저장·검증·원본 복원',
    paramsSchema: roundtripParams,
    requiredRole: 'ADMIN',
    expiryHours: 1,
    requiresWebReview: () => true,
    snapshot: async (_ctx, input) => {
      const p = roundtripParams.parse(input)
      return {
        target: `https://${p.mallId}.cafe24.com`,
        skin: p.skinCode,
        file: p.file,
        originalSha256: p.originalSha256,
        append: markerDiff(p),
        restore:
          '저장본 재조회 후 동일 원문으로 복원. 해시 충돌·결과 불명 시 자동 재실행하지 않음.',
        concurrency:
          '로컬 배포 도구는 대상 잠금으로 직렬화합니다. Cafe24 서버의 원자적 조건부 저장은 보장하지 못하므로, 이 검증 동안 사람이 편집하거나 다른 경로로 배포하지 않는 조건으로 승인하세요.',
      }
    },
    execute: async (ctx, input) => {
      if (!ctx.actionId) throw new Error('승인 액션 ID가 필요합니다')
      return enqueueBrowserWrite(ctx.spaceId, ctx.actionId, roundtripParams.parse(input))
    },
  },
]
