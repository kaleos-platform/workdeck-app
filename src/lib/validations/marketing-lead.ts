import { z } from 'zod'

export const EMPLOYEE_COUNT_OPTIONS = [
  { value: '1-4', label: '1~4명' },
  { value: '5-9', label: '5~9명' },
  { value: '10-29', label: '10~29명' },
  { value: '30-99', label: '30~99명' },
  { value: '100+', label: '100명 이상' },
] as const

const required = (label: string, max = 100) =>
  z.string().trim().min(1, `${label}을(를) 입력하세요`).max(max)

const utmValue = z.string().max(300).optional()

export const employeeCountLabel = (value: string) =>
  EMPLOYEE_COUNT_OPTIONS.find((o) => o.value === value)?.label ?? value

export const marketingLeadSchema = z.object({
  name: required('이름', 50),
  phone: z.string().regex(/^010\d{8}$/, '휴대폰 번호는 010으로 시작하는 숫자 11자리입니다'),
  email: z.string().trim().toLowerCase().max(200).email('올바른 이메일 주소를 입력하세요'),
  companyName: required('회사명'),
  position: required('직책', 50),
  employeeCount: z.enum(['1-4', '5-9', '10-29', '30-99', '100+'], {
    message: '직원 수를 선택하세요',
  }),
  consent: z.literal(true, { message: '개인정보 수집·이용에 동의해 주세요' }),
})

export type MarketingLeadInput = z.infer<typeof marketingLeadSchema>

/** API 요청 본문 — 폼 값 + 허니팟 + 유입 정보 */
export const marketingLeadRequestSchema = marketingLeadSchema.extend({
  deck: z.string().min(1).max(50),
  hp_extra: z.string().optional(),
  utm: z
    .object({
      utm_source: utmValue,
      utm_medium: utmValue,
      utm_campaign: utmValue,
      utm_term: utmValue,
      utm_content: utmValue,
    })
    .optional(),
  referrer: z.string().max(500).optional(),
})
