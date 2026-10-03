import { scalarFieldError, typedSubmissionError } from '../form-values'
import { formFieldSchema } from '@/lib/validations/hiring-posts'
import { planOpeningForm, convertOpeningSubmission } from '../opening-form-migration'

it.each(['0', '-1.5', '1e3'])('숫자 문자열 %s를 그대로 허용한다', (value) => {
  expect(scalarFieldError('number', value)).toBeNull()
})
it.each(['NaN', 'Infinity', '0x10', ' ', '1,000'])('잘못된 숫자 %s를 거부한다', (value) => {
  expect(scalarFieldError('number', value)).not.toBeNull()
})
it('윤년 날짜는 허용하고 자동 보정되는 날짜는 거부한다', () => {
  expect(scalarFieldError('date', '2024-02-29')).toBeNull()
  expect(scalarFieldError('date', '2026-02-30')).not.toBeNull()
})
it('서버는 공고 정의로 값을 검증하고 타입 위조·중복·필수 누락을 거부한다', () => {
  const fields = [{ key: 'n', type: 'number', required: true }]
  expect(typedSubmissionError(fields, [{ key: 'n', type: 'string', value: '3' }])).not.toBeNull()
  expect(typedSubmissionError(fields, [])).not.toBeNull()
  expect(
    typedSubmissionError(fields, [
      { key: 'n', type: 'number', value: '3' },
      { key: 'n', type: 'number', value: '4' },
    ])
  ).not.toBeNull()
  expect(typedSubmissionError(fields, [{ key: 'n', type: 'number', value: '0' }])).toBeNull()
})
it('날짜·숫자와 설명을 손실 없이 폼 계획과 제출값으로 변환한다', () => {
  const fields = [
    { key: 'custom', type: 'number', label: '경력', description: '년 단위', placeholder: '0' },
    { key: 'custom', type: 'date', label: '가능일' },
  ]
  expect(formFieldSchema.safeParse({ ...fields[0], required: false }).success).toBe(true)
  const plan = planOpeningForm('qa:v1', fields)
  if (!plan.ok) throw Error(plan.code)
  expect(plan.fields[0]).toMatchObject({ description: '년 단위', placeholder: '0', type: 'number' })
  const result = convertOpeningSubmission(
    plan,
    [
      { key: 'custom', type: 'number', label: '경력', value: 0 },
      { key: 'custom', type: 'date', label: '가능일', value: '2026-09-30' },
    ],
    { sourceSnapshotVerified: true }
  )
  expect(result).toMatchObject({ ok: true, entries: [{ value: '0' }, { value: '2026-09-30' }] })
})

it('일반 필수 항목·선택지·알 수 없는 key도 서버에서 검증한다', () => {
  const defs = [
    { key: 'name', type: 'string', required: true },
    { key: 'choice', type: 'select', options: ['A'] },
    { key: 'many', type: 'multiselect', options: ['A', 'B'] },
  ]
  const name = { key: 'name', type: 'string', value: '지원자' }
  expect(typedSubmissionError(defs, [])).not.toBeNull()
  expect(typedSubmissionError(defs, [{ ...name, value: '  ' }])).not.toBeNull()
  expect(
    typedSubmissionError(defs, [name, { key: 'unknown', type: 'string', value: 'X' }])
  ).not.toBeNull()
  expect(
    typedSubmissionError(defs, [name, { key: 'choice', type: 'select', value: 'X' }])
  ).not.toBeNull()
  expect(
    typedSubmissionError(defs, [name, { key: 'many', type: 'multiselect', value: ['A', 'A'] }])
  ).not.toBeNull()
  expect(
    typedSubmissionError(defs, [name, { key: 'many', type: 'multiselect', value: ['A', 'B'] }])
  ).toBeNull()
  expect(
    typedSubmissionError(
      [{ key: 'phone', type: 'phone', required: true }],
      [{ key: 'phone', type: 'phone', value: 'abc' }]
    )
  ).not.toBeNull()
})
