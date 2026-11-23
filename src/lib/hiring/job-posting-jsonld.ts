// 공개 공고 → Google JobPosting 구조화 데이터. 순수 함수 — DB 를 읽지 않는다.
// 입력은 페이지가 이미 spaceId 로 거르고 화면에 렌더한 값만 받는다(화면 = 마크업 일치).
// 필드 규격: https://developers.google.com/search/docs/appearance/structured-data/job-posting
import { isHiringDeadlinePassed } from '@/lib/hiring/closing-date'
import {
  formatPay,
  formatWorkDays,
  formatWorkTime,
} from '@/components/hiring-public/posting-labels'

export interface JobPostingPosition {
  name: string
  jobType: string | null
  payFrequency: string | null
  payAmount: number | null
  workDays: unknown
  workStartAt: string | null
  workEndAt: string | null
  experience: string | null
  education: string | null
  jobDescription: string | null
}

export interface JobPostingInput {
  title: string
  status: string
  isPreview: boolean
  closingDate: Date | null
  publishedAt: Date | null
  createdAt: Date
  companyName: string
  /** 공간 필터를 거친 포지션 */
  positions: JobPostingPosition[]
  /** 화면에 positions 블록이 렌더되는가 */
  positionsBlockRendered: boolean
  /** 화면에 내부 지원 폼 링크(button/image 블록)가 렌더되는가 */
  hasInternalApplyLink: boolean
  /** 공간 필터를 거친 매장(화면에 이름 옆에 표시되는 도로명 주소) */
  stores: { roadAddress: string | null }[]
  /** 화면에 렌더되는 텍스트 블록 HTML(renderTiptapHtml 결과 — 이미 정제됨) */
  textBlocksHtml: string[]
}

const EMPLOYMENT_TYPES: Record<string, string> = {
  FULL_TIME: 'FULL_TIME',
  PART_TIME: 'PART_TIME',
  CONTRACT: 'CONTRACTOR',
  FREELANCER: 'CONTRACTOR',
  INTERN: 'INTERN',
}

const SALARY_UNITS: Record<string, string> = {
  HOURLY: 'HOUR',
  DAILY: 'DAY',
  WEEKLY: 'WEEK',
  MONTHLY: 'MONTH',
  YEARLY: 'YEAR',
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 화면에 보이는 포지션 값(담당 업무·근무 요일·시간·급여·경력·학력)만 HTML 로 만든다. */
function positionHtml(p: JobPostingPosition): string {
  const rows: [string, string | null][] = [
    ['급여', formatPay(p.payFrequency, p.payAmount)],
    ['근무 요일', formatWorkDays(p.workDays)],
    ['근무 시간', formatWorkTime(p.workStartAt, p.workEndAt)],
    ['경력', p.experience],
    ['학력', p.education],
  ]
  const items = rows
    .filter(([, value]) => value)
    .map(([label, value]) => `<li>${label}: ${escapeHtml(value as string)}</li>`)
  const parts = [`<p>${escapeHtml(p.name)}</p>`]
  if (p.jobDescription?.trim()) {
    parts.push(`<p>${escapeHtml(p.jobDescription.trim()).replace(/\r?\n/g, '<br>')}</p>`)
  }
  if (items.length) parts.push(`<ul>${items.join('')}</ul>`)
  return parts.join('')
}

export function buildJobPostingJsonLd(input: JobPostingInput): Record<string, unknown> | null {
  if (input.status !== 'ACTIVE' || input.isPreview) return null
  if (isHiringDeadlinePassed(input.closingDate)) return null
  if (input.positions.length !== 1 || !input.positionsBlockRendered) return null
  if (!input.hasInternalApplyLink) return null

  const addresses = input.stores.map((s) => s.roadAddress?.trim()).filter((a): a is string => !!a)
  if (addresses.length === 0) return null

  const [position] = input.positions
  const description = [positionHtml(position), ...input.textBlocksHtml].join('')
  const hasText = !!position.jobDescription?.trim() || input.textBlocksHtml.some((h) => h.trim())
  // 담당 업무·본문 텍스트가 전혀 없으면(이름·조건 나열뿐) 설명 부족 — 내지 않는다.
  if (!hasText) return null

  const employmentType = [
    ...new Set(
      input.positions
        .map((p) => (p.jobType ? EMPLOYMENT_TYPES[p.jobType] : undefined))
        .filter(Boolean)
    ),
  ]
  const unitText = position.payFrequency ? SALARY_UNITS[position.payFrequency] : undefined

  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: input.title,
    description,
    datePosted: (input.publishedAt ?? input.createdAt).toISOString(),
    ...(input.closingDate
      ? { validThrough: `${input.closingDate.toISOString().slice(0, 10)}T23:59:59+09:00` }
      : {}),
    hiringOrganization: { '@type': 'Organization', name: input.companyName },
    jobLocation: [...new Set(addresses)].map((streetAddress) => ({
      '@type': 'Place',
      address: { '@type': 'PostalAddress', streetAddress, addressCountry: 'KR' },
    })),
    ...(employmentType.length ? { employmentType } : {}),
    ...(unitText && position.payAmount != null
      ? {
          baseSalary: {
            '@type': 'MonetaryAmount',
            currency: 'KRW',
            value: { '@type': 'QuantitativeValue', value: position.payAmount, unitText },
          },
        }
      : {}),
    directApply: true,
  }
}
