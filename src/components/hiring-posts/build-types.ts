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
