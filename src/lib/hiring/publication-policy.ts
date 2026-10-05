export const PUBLISHED_POSTING_LOCK_MESSAGE =
  '최초 발행 후에는 모집 조건과 지원서 설정을 변경할 수 없습니다. 새로운 모집은 공고를 복사해 진행해 주세요.'

export function isPostingRecruitmentLocked(posting: {
  publishedAt?: Date | string | null
  status: string
}): boolean {
  return !!posting.publishedAt || ['ACTIVE', 'CLOSED', 'ARCHIVED'].includes(posting.status)
}
