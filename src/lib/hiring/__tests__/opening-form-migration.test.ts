import { planOpeningForm, convertOpeningSubmission } from '../opening-form-migration'

const fields = [
  { key: 'name', type: 'string', label: '이름', required: true },
  { key: 'custom', type: 'select', label: '직무', items: [{ label: '매장 운영', value: 1 }] },
  { key: 'custom', type: 'text', label: '경력' },
]
const verified = { sourceSnapshotVerified: true }

it('반복 custom 항목을 구분하고 배열 순서가 바뀌어도 같은 ID를 만든다', () => {
  const a = planOpeningForm('posting:9007199254740993:v1', fields)
  const b = planOpeningForm('posting:9007199254740993:v1', [...fields].reverse())
  expect(a.ok).toBe(true)
  expect(b.ok).toBe(true)
  if (!a.ok || !b.ok) throw Error('plan failed')
  expect(a.fields[0].key).toBe('name')
  expect(new Set(a.fields.map((f) => f.key)).size).toBe(3)
  expect(a.fields.map((f) => f.key)).toEqual(b.fields.map((f) => f.key).reverse())
})

it('확인된 폼의 선택값을 라벨로 변환하고 다른 custom 값을 보존한다', () => {
  const plan = planOpeningForm('posting:qa:v1', fields)
  const result = convertOpeningSubmission(
    plan,
    [
      { key: 'name', type: 'string', label: '이름', value: '합성 이름' },
      { key: 'custom', type: 'select', label: '직무', value: '1' },
      { key: 'custom', type: 'text', label: '경력', value: '합성 경력' },
    ],
    verified
  )
  expect(result.ok).toBe(true)
  if (!result.ok) throw Error('conversion failed')
  expect(result.entries.map((e) => e.value)).toEqual(['합성 이름', '매장 운영', '합성 경력'])
  expect(new Set(result.entries.map((e) => e.key)).size).toBe(3)
})

it.each([
  [[{ key: 'custom', type: 'unknown', label: '미지원' }], 'UNSUPPORTED_TYPE'],
  [[fields[2], fields[2]], 'AMBIGUOUS_FIELD'],
  [[{ ...fields[2], key: '' }], 'INVALID_FIELD'],
  [[{ ...fields[2], max_file_count: 5 }], 'INVALID_TARGET_FIELD'],
  [
    [
      {
        ...fields[1],
        items: [
          { label: 'A', value: 1 },
          { label: 'B', value: '1' },
        ],
      },
    ],
    'AMBIGUOUS_OPTIONS',
  ],
])('손실 또는 모호한 폼을 부분 변환하지 않는다', (source, code) => {
  const result = planOpeningForm('qa', source)
  expect(result).toEqual(expect.objectContaining({ ok: false, code }))
  expect(result).not.toHaveProperty('fields')
})

it('과거 폼 확인 없이 현재 폼으로 지원서를 추측하지 않는다', () => {
  expect(convertOpeningSubmission(planOpeningForm('qa', fields), [], {})).toEqual({
    ok: false,
    code: 'UNVERIFIED_SNAPSHOT',
  })
})

it('알 수 없는 선택값과 라벨 변경은 원문을 오류에 넣지 않고 차단한다', () => {
  const plan = planOpeningForm('qa', [fields[1]])
  const unknown = convertOpeningSubmission(plan, [{ ...fields[1], value: '비밀값' }], verified)
  expect(unknown).toEqual({ ok: false, code: 'UNKNOWN_OPTION', index: 0 })
  expect(
    convertOpeningSubmission(plan, [{ ...fields[1], label: '바뀐 질문', value: '1' }], verified)
  ).toEqual({ ok: false, code: 'UNMATCHED_FIELD', index: 0 })
})

it('다중선택을 변환하며 같은 항목의 중복 제출을 거부한다', () => {
  const field = { ...fields[1], type: 'multiselect' }
  const plan = planOpeningForm('qa', [field])
  const entry = { key: field.key, label: field.label, type: field.type, value: [1] }
  expect(convertOpeningSubmission(plan, [entry], verified)).toEqual(
    expect.objectContaining({
      ok: true,
      entries: [expect.objectContaining({ value: ['매장 운영'] })],
    })
  )
  expect(convertOpeningSubmission(plan, [entry, entry], verified)).toEqual({
    ok: false,
    code: 'DUPLICATE_SUBMISSION',
    index: 1,
  })
})

it('누락된 필수 항목과 미이전 파일은 성공으로 처리하지 않는다', () => {
  expect(convertOpeningSubmission(planOpeningForm('qa', [fields[0]]), [], verified)).toEqual({
    ok: false,
    code: 'MISSING_REQUIRED_FIELD',
  })
  const file = {
    key: 'resume',
    type: 'file',
    label: '이력서',
    max_file_count: 1,
    max_file_size: 100,
  }
  expect(
    convertOpeningSubmission(
      planOpeningForm('qa', [file]),
      [{ key: file.key, type: file.type, label: file.label, value: ['old-key'] }],
      verified
    )
  ).toEqual({ ok: false, code: 'FILE_MAPPING_REQUIRED', index: 0 })
})

it('서로 다른 원본 폼의 custom ID는 충돌하지 않는다', () => {
  const a = planOpeningForm('posting:a:v1', [fields[2]])
  const b = planOpeningForm('posting:b:v1', [fields[2]])
  if (!a.ok || !b.ok) throw Error('plan failed')
  expect(a.fields[0].key).not.toBe(b.fields[0].key)
})

it('표시명 중복 선택지와 자유입력 선택값은 차단한다', () => {
  expect(
    planOpeningForm('qa', [
      {
        ...fields[1],
        items: [
          { label: 'A', value: 1 },
          { label: 'A', value: 2 },
        ],
      },
    ])
  ).toEqual(expect.objectContaining({ ok: false, code: 'AMBIGUOUS_OPTIONS' }))
  expect(
    convertOpeningSubmission(
      planOpeningForm('qa', [fields[1]]),
      [{ ...fields[1], value: '기타', is_other: true }],
      verified
    )
  ).toEqual({ ok: false, code: 'OTHER_RESPONSE_REVIEW_REQUIRED', index: 0 })
})

it('문자열 항목의 빈 배열을 개인정보 추출기에서 잃지 않도록 거부한다', () => {
  const field = { ...fields[0], required: false }
  expect(
    convertOpeningSubmission(planOpeningForm('qa', [field]), [{ ...field, value: [] }], verified)
  ).toEqual({ ok: false, code: 'INVALID_VALUE', index: 0 })
})

it('빈 선택값과 선택지가 아닌 항목의 잘못된 items를 버리지 않는다', () => {
  expect(planOpeningForm('qa', [{ ...fields[1], items: [{ label: '없음', value: '' }] }])).toEqual(
    expect.objectContaining({ ok: false, code: 'AMBIGUOUS_OPTIONS' })
  )
  expect(planOpeningForm('qa', [{ ...fields[2], items: { hidden: true } }])).toEqual(
    expect.objectContaining({ ok: false, code: 'UNSUPPORTED_ATTRIBUTE' })
  )
})

it.each(['1', '', null, ['1']])(
  '기타 표시자는 값 모양과 무관하게 별도 검토로 보류한다',
  (value) => {
    const field = fields[1]
    expect(
      convertOpeningSubmission(
        planOpeningForm('qa', [field]),
        [{ ...field, value, is_other: true }],
        verified
      )
    ).toEqual({ ok: false, code: 'OTHER_RESPONSE_REVIEW_REQUIRED', index: 0 })
  }
)
it.each(['false', 0, null])('boolean이 아닌 기타 표시자는 잘못된 제출로 거부한다', (is_other) => {
  expect(
    convertOpeningSubmission(
      planOpeningForm('qa', [fields[1]]),
      [{ ...fields[1], value: '1', is_other }],
      verified
    )
  ).toEqual({ ok: false, code: 'INVALID_OTHER_MARKER', index: 0 })
})
it('명시적 false는 일반 선택값만 변환하고 미등록 값은 추측하지 않는다', () => {
  const plan = planOpeningForm('qa', [fields[1]])
  const entry = { ...fields[1], is_other: false }
  expect(convertOpeningSubmission(plan, [{ ...entry, value: '1' }], verified)).toMatchObject({
    ok: true,
    entries: [{ value: '매장 운영' }],
  })
  expect(
    convertOpeningSubmission(plan, [{ ...entry, value: '비공개 기타 응답' }], verified)
  ).toEqual({ ok: false, code: 'UNKNOWN_OPTION', index: 0 })
})
it('기타 허용 폼을 미지원 속성과 구분하고 부분 계획을 반환하지 않는다', () => {
  expect(planOpeningForm('qa', [{ ...fields[1], other_option: true }])).toEqual({
    ok: false,
    code: 'OTHER_OPTION_MAPPING_REQUIRED',
    index: 0,
  })
  expect(planOpeningForm('qa', [{ ...fields[1], other_option: 'false' }])).toEqual({
    ok: false,
    code: 'INVALID_OTHER_MARKER',
    index: 0,
  })
})

it('명시적인 파일 제한을 보존하고 축소가 필요한 정책은 보류한다', () => {
  const file = {
    key: 'resume',
    type: 'file',
    label: '이력서',
    max_file_count: 2,
    max_file_size: 1024,
  }
  const plan = planOpeningForm('qa', [file])
  expect(plan).toMatchObject({ ok: true, fields: [{ maxFileCount: 2, maxFileSize: 1024 }] })
  for (const change of [
    { max_file_count: 0 },
    { max_file_count: 4 },
    { max_file_size: 0 },
    { max_file_size: undefined },
    { max_file_size: 11 * 1024 * 1024 },
  ])
    expect(planOpeningForm('qa', [{ ...file, ...change }])).toMatchObject({
      ok: false,
      code: 'FILE_POLICY_REVIEW_REQUIRED',
    })
  expect(planOpeningForm('qa', [file, { ...file, key: 'portfolio' }])).toMatchObject({
    ok: false,
    code: 'FILE_POLICY_REVIEW_REQUIRED',
  })
})
