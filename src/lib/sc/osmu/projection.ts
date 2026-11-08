// 발행 요청(DB) 상태 → 노션 「상태」 라벨. 노션은 이 함수의 결과로만 덮어쓴다(멱등).

import type { DeploymentStatus, ScPublishRequestState } from '@/generated/prisma/client'
import { NOTION_STATUS, type NotionStatusLabel } from './notion-schema'

export type ProjectionInput = {
  state: ScPublishRequestState
  deployment?: { status: DeploymentStatus; platformUrl: string | null } | null
}

export function notionStatusFor({ state, deployment }: ProjectionInput): NotionStatusLabel {
  switch (state) {
    case 'RECEIVED':
    case 'READY':
      return NOTION_STATUS.WRITING
    case 'PROPOSED':
      return NOTION_STATUS.AWAITING_APPROVAL
    case 'CANCELED':
      return NOTION_STATUS.CANCELED
    case 'NEEDS_INPUT':
    case 'FAILED':
      return NOTION_STATUS.NEEDS_REVIEW
    case 'APPROVED':
      break
  }
  if (!deployment) return NOTION_STATUS.NEEDS_REVIEW
  switch (deployment.status) {
    case 'AWAITING_ASSETS':
      return NOTION_STATUS.AWAITING_PHOTOS
    case 'SCHEDULED':
    case 'PUBLISHING':
      return NOTION_STATUS.PUBLISHING
    case 'AWAITING_MANUAL':
      return NOTION_STATUS.DRAFT_CHECK
    case 'PUBLISHED':
      // 게시 완료는 실제 글 URL 을 확인한 뒤에만.
      return deployment.platformUrl ? NOTION_STATUS.PUBLISHED : NOTION_STATUS.NEEDS_REVIEW
    case 'CANCELED':
      return NOTION_STATUS.CANCELED
    case 'FAILED':
      return NOTION_STATUS.NEEDS_REVIEW
  }
}

/** 노션에서 사람이 「취소」로 바꿨을 때 반영 가능한가. 승인 이후(게시 경로 진입)는 반영하지 않는다. */
export function canCancel(state: ScPublishRequestState): boolean {
  return (
    state === 'RECEIVED' || state === 'NEEDS_INPUT' || state === 'READY' || state === 'PROPOSED'
  )
}
