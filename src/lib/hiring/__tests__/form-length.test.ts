import {
  scalarFieldError,
  typedSubmissionError,
  clearIncompatibleFieldLimits,
} from '../form-values'
import { formFieldSchema } from '@/lib/validations/hiring-posts'
import { planOpeningForm, convertOpeningSubmission } from '../opening-form-migration'

it('최소·최대 경계와 선택 항목의 빈 값을 원본처럼 검사한다', () => {
  const limits = { minLength: 2, maxLength: 3 }
  expect(scalarFieldError('text', '', limits)).toBeNull()
  expect(scalarFieldError('text', '가', limits)).not.toBeNull()
  expect(scalarFieldError('text', '가나', limits)).toBeNull()
  expect(scalarFieldError('text', '가나다', limits)).toBeNull()
  expect(scalarFieldError('text', '가나다라', limits)).not.toBeNull()
  expect(scalarFieldError('text', '😀', { minLength: 2, maxLength: 2 })).toBeNull()
})
it('길이 0은 제한 없음으로 해석하고 잘못된 조합은 저장을 거부한다', () => {
  expect(scalarFieldError('string', 'abc', { maxLength: 0 })).toBeNull()
  const base = { key: 'custom', type: 'text', label: '자기소개', required: false }
  expect(formFieldSchema.safeParse({ ...base, minLength: 3, maxLength: 2 }).success).toBe(false)
  expect(formFieldSchema.safeParse({ ...base, minLength: -1 }).success).toBe(false)
  expect(formFieldSchema.safeParse({ ...base, type: 'file', maxLength: 10 }).success).toBe(false)
})
it('서버는 길이 제한이 있는 문자열도 검증한다', () => {
  const field = { key: 'q', type: 'text', required: false, maxLength: 3 }
  expect(typedSubmissionError([field], [{ key: 'q', type: 'text', value: '1234' }])).not.toBeNull()
  expect(typedSubmissionError([field], [{ key: 'q', type: 'text', value: '123' }])).toBeNull()
})
it('이전 시 제한과 원문을 보존하고 초과값은 자르지 않는다', () => {
  const field = { key: 'custom', type: 'text', label: '소개', min_length: 2, max_length: 3 }
  const plan = planOpeningForm('qa', [field])
  if (!plan.ok) throw Error(plan.code)
  expect(plan.fields[0]).toMatchObject({ minLength: 2, maxLength: 3 })
  expect(
    convertOpeningSubmission(
      plan,
      [{ key: 'custom', type: 'text', label: '소개', value: '1234' }],
      { sourceSnapshotVerified: true }
    )
  ).toMatchObject({ ok: false, code: 'INVALID_VALUE' })
})

it('원본 오류 안내문을 보존하고 길이 오류에만 사용한다', () => {
  const plan = planOpeningForm('qa', [
    {
      key: 'custom',
      type: 'text',
      label: '소개',
      max_length: 3,
      error_message: '세 글자 이내로 작성해주세요',
    },
  ])
  if (!plan.ok) throw Error(plan.code)
  const field = plan.fields[0]
  expect(field).toMatchObject({ errorMessage: '세 글자 이내로 작성해주세요' })
  expect(scalarFieldError('text', '1234', field)).toBe('세 글자 이내로 작성해주세요')
  expect(typedSubmissionError([field], [{ key: field.key, type: 'text', value: '1234' }])).toBe(
    '세 글자 이내로 작성해주세요'
  )
  expect(scalarFieldError('number', 'invalid', field)).toBe('올바른 숫자를 입력하세요')
  expect(scalarFieldError('date', '2026-02-30', field)).toBe('올바른 날짜를 입력하세요')
  expect(scalarFieldError('text', '', field)).toBeNull()
})
it('안내문만 있는 항목도 보존하고 공백 안내문은 기본 오류로 대체한다', () => {
  const plan = planOpeningForm('qa', [
    { key: 'custom', type: 'text', label: '소개', error_message: '안내' },
  ])
  if (!plan.ok) throw Error(plan.code)
  expect(plan.fields[0]).toMatchObject({ errorMessage: '안내' })
  const limits = { maxLength: 1, errorMessage: '   ' }
  expect(scalarFieldError('text', '12', limits)).toBe('최대 1자까지 입력하세요')
})

it('사용자가 항목 유형을 바꾸면 새 유형에 호환되지 않는 제한만 해제한다', () => {
  expect(
    clearIncompatibleFieldLimits({
      type: 'text',
      maxFileCount: 2,
      maxFileSize: 100,
      maxLength: 20,
      description: '설명',
    })
  ).toEqual({ type: 'text', maxLength: 20, description: '설명' })
  expect(clearIncompatibleFieldLimits({ type: 'select', minLength: 2, maxLength: 10 })).toEqual({
    type: 'select',
  })
  expect(clearIncompatibleFieldLimits({ type: 'file', minLength: 2, maxFileCount: 2 })).toEqual({
    type: 'file',
    maxFileCount: 2,
  })
})
