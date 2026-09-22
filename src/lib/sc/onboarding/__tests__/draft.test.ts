import { onboardingDraftSchema } from '../schemas'
import { buildOnboardingUserPrompt } from '../prompts'

it('전체 상품과 콘텐츠 근거를 5개 제한 없이 보존한다', () => {
  const customFields = [{ key: '소재', value: '재생펠트 — 출처: https://example.com' }]
  const parsed = onboardingDraftSchema.safeParse({
    brandProfile: { companyName: '미닝랩', customFields },
    products: Array.from({ length: 12 }, (_, i) => ({ name: `상품 ${i}`, customFields })),
    personas: [{ name: '기업 ESG 담당자', customFields }],
  })
  expect(parsed.success).toBe(true)
  if (parsed.success) {
    expect(parsed.data.products).toHaveLength(12)
    expect(parsed.data.brandProfile.customFields).toEqual(customFields)
    expect(parsed.data.personas[0].customFields).toEqual(customFields)
  }
})

it('긴 첫 자료 때문에 뒤의 블로그 근거가 사라지지 않는다', () => {
  const prompt = buildOnboardingUserPrompt(
    [
      { label: '홈페이지', text: '가'.repeat(30000) },
      { label: '납품 사례', text: '기업 임직원 ESG 행사 활용' },
    ],
    '기업 ESG 담당자'
  )
  expect(prompt).toContain('기업 임직원 ESG 행사 활용')
  expect(prompt).toContain('기업 ESG 담당자')
})
