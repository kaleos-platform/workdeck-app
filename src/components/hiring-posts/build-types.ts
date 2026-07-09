import type { PostingStatus } from './status-badge'
import type { FormFieldInput } from '@/lib/validations/hiring-posts'

// 위저드가 서버에서 받는 직렬화된 공고 상세 형태
export type WizardPositionData = {
  id: string
  positionId: string | null
  name: string
  jobType: string | null
  payFrequency: string | null
  payAmount: number | null
  workDays: number[] | null
  workStartAt: string | null
  workEndAt: string | null
  headcount: number | null
  experience: string | null
  education: string | null
  jobDescription: string | null
  requiredQualifications: string | null
  preferredQualifications: string | null
}

export type WizardContentData = {
  id: string
  contentType: 'image' | 'text' | 'button'
  data: unknown
  imagePath: string | null
  sortOrder: number
}

export type WizardStore = {
  id: string
  name: string
  roadAddress: string | null
}

export type WizardPosition = {
  id: string
  name: string
  category: string | null
}

export type WizardPosting = {
  id: string
  uuid: string
  title: string
  status: PostingStatus
  closingDate: string | null
  notificationEnabled: boolean
  positions: WizardPositionData[]
  storeIds: string[]
  contents: WizardContentData[]
  formFields: FormFieldInput[]
}

export type WizardData = {
  posting: WizardPosting
  spaceStores: WizardStore[]
  spacePositions: WizardPosition[]
}

// enum 라벨
export const JOB_TYPE_LABELS: Record<string, string> = {
  FULL_TIME: '정규직',
  PART_TIME: '아르바이트',
  CONTRACT: '계약직',
  FREELANCER: '프리랜서',
  INTERN: '인턴',
}

export const PAY_FREQUENCY_LABELS: Record<string, string> = {
  HOURLY: '시급',
  DAILY: '일급',
  WEEKLY: '주급',
  MONTHLY: '월급',
  YEARLY: '연봉',
  PER_TASK: '건당',
  TBD: '협의',
}

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const

// ─── 위저드 통합 상태 ──────────────────────────────────────────────────────────
// BuildWizard 가 단일 소유하는 상태. 각 섹션은 슬라이스 + onChange 로 받아 편집하고
// 우측 미리보기는 이 상태에서 즉시(서버 왕복 없이) 렌더된다.
export type WizardState = {
  title: string
  closingDate: string // date input 용 'YYYY-MM-DD' (없으면 '')
  notificationEnabled: boolean
  positions: WizardPositionData[]
  stores: WizardStore[] // 매장 전체 목록(신규 생성 시 확장) — 미리보기 이름/주소 참조용
  storeIds: string[]
  noStores: boolean // UI 전용: true → storeIds 비우고 매장 선택 비활성화
  formFields: FormFieldInput[]
  contents: WizardContentData[]
  status: PostingStatus
}

// 클라이언트 전용 공개 이미지 URL 조립 (storage.ts 는 service-role 서버 전용이므로 import 금지)
export function getPostingAssetPublicUrl(imagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return `${base}/storage/v1/object/public/hiring-assets/${imagePath}`
}
