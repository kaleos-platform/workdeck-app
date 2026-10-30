import { marketingLeadSchema } from '../marketing-lead'

const valid = {
  name: '홍길동',
  phone: '01012345678',
  email: 'a@b.co',
  companyName: '회사',
  position: '대표',
  employeeCount: '10-29',
  consent: true,
}

it('유효한 입력 통과', () => {
  expect(marketingLeadSchema.safeParse(valid).success).toBe(true)
})
it.each(['010-1234-5678', '0111234567', '0101234567'])('휴대폰 %s 거부', (phone) => {
  expect(marketingLeadSchema.safeParse({ ...valid, phone }).success).toBe(false)
})
it('동의 누락 거부', () => {
  expect(marketingLeadSchema.safeParse({ ...valid, consent: false }).success).toBe(false)
  expect(marketingLeadSchema.safeParse({ ...valid, consent: undefined }).success).toBe(false)
})
