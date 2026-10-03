import { planPostingContent, type PostingContentInput } from '../posting-content'

const image = { copiedImagePath: 'tenant/posting/image.png', verified: true }
const base: PostingContentInput = {
  detail: [],
  originalApplyUrl: 'https://opening.work/p/source',
  resources: {},
  images: {},
  postingTitle: '공고 제목',
  companyIntro: '소개\n둘째 줄',
  positionsVerified: true,
  positionConditionsText: '수습 3개월',
  storesText: '근무지\n주소',
  managerText: '담당자',
}
const section = (type: string, extra = {}) => ({ type, enabled: true, ...extra })

test('9가지 section의 순서, 이름, 줄바꿈과 링크 의미를 보존한다', () => {
  const result = planPostingContent({
    ...base,
    detail: [
      'posting_title',
      'company_intro',
      'posting_positions',
      'custom',
      'posting_stores',
      'manager',
      'content',
      'content_link',
      'image',
    ].map((type) =>
      section(type, {
        ...(type === 'custom' ? { items: [{ label: '항목', value: '첫째\n둘째' }] } : {}),
        ...(type.startsWith('content') ? { resource_id: '9007199254740993' } : {}),
        ...(type === 'content_link' ? { url: base.originalApplyUrl } : {}),
        name: '원본 이름',
      })
    ),
    resources: {
      '9007199254740993': { ...image, hasSceneSource: true, scene: { elements: [], files: {} } },
    },
    images: { 'index:8': image },
  })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.blocks.map((b) => b.contentType)).toEqual([
    'text',
    'text',
    'positions',
    'text',
    'text',
    'text',
    'text',
    'design',
    'design',
    'image',
  ])
  expect(result.blocks.map((b) => b.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  expect(result.blocks.every((b) => b.title === '원본 이름')).toBe(true)
  expect(result.blocks[8].data).toMatchObject({ link: { linkType: 'form' } })
  expect(JSON.stringify(result.blocks[1].data)).toContain('둘째 줄')
})

test('재사용 resource는 별도 block이며 외부 URL은 그대로 유지한다', () => {
  const result = planPostingContent({
    ...base,
    detail: [
      section('content_link', { resource_id: 1, url: 'https://example.com/jobs?a=1' }),
      section('content_link', { resource_id: 1 }),
    ],
    resources: { '1': { ...image, hasSceneSource: false } },
  })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.blocks).toHaveLength(2)
  expect(result.blocks[0]).toMatchObject({
    contentType: 'image',
    data: { link: { linkType: 'url', url: 'https://example.com/jobs?a=1' } },
  })
  expect(result.blocks[1].data).toEqual({ link: { linkType: 'none' } })
})

test('비활성 section index를 남기고 알 수 없는 활성 section은 차단한다', () => {
  expect(
    planPostingContent({ ...base, detail: [{ type: 'future', enabled: false, custom: 1 }] })
  ).toEqual({ ok: true, blocks: [], excludedDisabled: [0] })
  expect(planPostingContent({ ...base, detail: [section('future')] })).toEqual({
    ok: false,
    code: 'unsupported_section',
    index: 0,
  })
  expect(planPostingContent({ ...base, detail: [section('manager', { future: 1 })] })).toEqual({
    ok: false,
    code: 'unsupported_attribute',
    index: 0,
  })
})

test.each([
  [{ detail: [section('image')] }, 'missing_image'],
  [{ detail: [section('posting_title')], postingTitle: undefined }, 'missing_dynamic_text'],
  [{ detail: [section('posting_positions')], positionsVerified: false }, 'unverified_positions'],
  [{ detail: [section('content', { resource_id: 9007199254740992 })] }, 'invalid_resource_id'],
  [{ detail: [section('content', { resource_id: '1.0' })] }, 'invalid_resource_id'],
  [{ detail: [section('content', { resource_id: 1 })] }, 'missing_resource'],
  [
    {
      detail: [section('content', { resource_id: 1 })],
      resources: { '1': { ...image, hasSceneSource: false } },
    },
    'missing_scene',
  ],
  [
    {
      detail: [section('content', { resource_id: 1 })],
      resources: {
        '1': {
          ...image,
          hasSceneSource: true,
          scene: { elements: [{ type: 'image', fileId: 'absent' }], files: {} },
        },
      },
    },
    'invalid_scene',
  ],
  [
    { detail: [section('image')], images: { 'index:0': { ...image, verified: false } } },
    'unverified_image',
  ],
  [
    {
      detail: [section('content_link', { resource_id: 1, url: 'javascript:alert(1)' })],
      resources: { '1': { ...image, hasSceneSource: false } },
    },
    'invalid_link',
  ],
])('불완전 입력 전체 계획을 실패시킨다 %#', (patch, code) => {
  expect(planPostingContent({ ...base, ...patch })).toEqual({ ok: false, code, index: 0 })
})

test.each([
  'https://example.com/image.png',
  '/absolute.png',
  '../image.png',
  'tenant/../image.png',
  'tenant/%2e%2e/image.png',
  'tenant\\image.png',
])('복사 asset 경로만 허용한다: %s', (copiedImagePath) => {
  expect(
    planPostingContent({
      ...base,
      detail: [section('image')],
      images: { 'index:0': { verified: true, copiedImagePath } },
    })
  ).toEqual({ ok: false, code: 'invalid_image_path', index: 0 })
})

test('scene의 외부 image 참조를 차단한다', () => {
  expect(
    planPostingContent({
      ...base,
      detail: [section('content', { resource_id: 1 })],
      resources: {
        '1': {
          ...image,
          hasSceneSource: true,
          scene: {
            elements: [{ type: 'image', fileId: 'a' }],
            files: { a: { dataURL: 'https://source/image.png' } },
          },
        },
      },
    })
  ).toEqual({ ok: false, code: 'invalid_scene', index: 0 })
})

test('scene의 사용되지 않은 외부 파일도 보존하지 않는다', () => {
  const result = planPostingContent({
    ...base,
    detail: [section('content', { resource_id: 1 })],
    resources: {
      '1': {
        ...image,
        hasSceneSource: true,
        scene: { elements: [], files: { orphan: { dataURL: 'https://source/private-image.png' } } },
      },
    },
  })
  expect(result).toEqual({ ok: false, code: 'invalid_scene', index: 0 })
})

test('중복 UUID 이미지는 UUID만으로 연결하지 않는다', () => {
  const result = planPostingContent({
    ...base,
    detail: [
      section('image', { uuid: 'same', image_key: 'first' }),
      section('image', { uuid: 'same', image_key: 'second' }),
    ],
    images: { 'uuid:same': image },
  })
  expect(result).toEqual({ ok: false, code: 'ambiguous_image', index: 0 })
})

test('중복 UUID 이미지의 index별 asset을 각각 보존한다', () => {
  const secondImage = { ...image, copiedImagePath: 'tenant/posting/second.png' }
  const result = planPostingContent({
    ...base,
    detail: [
      section('image', { uuid: 'same', image_key: 'first' }),
      section('image', { uuid: 'same', image_key: 'second' }),
    ],
    images: { 'uuid:same': image, 'index:0': image, 'index:1': secondImage },
  })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.blocks.map((block) => block.imagePath)).toEqual([
    image.copiedImagePath,
    secondImage.copiedImagePath,
  ])
})

test('enabled가 누락된 원본 section은 비활성으로 기록한다', () => {
  expect(planPostingContent({ ...base, detail: [{ type: 'future' }] })).toEqual({
    ok: true,
    blocks: [],
    excludedDisabled: [0],
  })
  expect(planPostingContent({ ...base, detail: [{ type: 'manager', enabled: 'true' }] })).toEqual({
    ok: false,
    code: 'invalid_section',
    index: 0,
  })
})

test('전체 detailImage를 모든 section보다 앞에 배치한다', () => {
  const result = planPostingContent({
    ...base,
    detailImage: image,
    detail: [section('posting_title')],
  })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.blocks.map((block) => [block.contentType, block.sortOrder])).toEqual([
    ['image', 0],
    ['text', 1],
  ])
  expect(result.blocks[0].imagePath).toBe(image.copiedImagePath)
})

test('전체 detailImage도 검증이 필요하다', () => {
  expect(planPostingContent({ ...base, detailImage: { ...image, verified: false } })).toEqual({
    ok: false,
    code: 'unverified_image',
  })
})

test.each([undefined, 'different'])(
  'section image_key와 resource 이미지가 다르면 차단한다: %s',
  (sourceImageKey) => {
    expect(
      planPostingContent({
        ...base,
        detail: [section('content_link', { resource_id: 1, image_key: 'original' })],
        resources: { '1': { ...image, hasSceneSource: false, sourceImageKey } },
      })
    ).toEqual({ ok: false, code: 'image_source_mismatch', index: 0 })
  }
)

test('section image_key와 resource 이미지가 일치하면 변환한다', () => {
  expect(
    planPostingContent({
      ...base,
      detail: [section('content_link', { resource_id: 1, image_key: 'original' })],
      resources: { '1': { ...image, hasSceneSource: false, sourceImageKey: 'original' } },
    }).ok
  ).toBe(true)
})

test('section file_key는 원본 편집기가 읽지 않는 복사 metadata로 허용한다', () => {
  expect(
    planPostingContent({
      ...base,
      detail: [section('content', { resource_id: 1, file_key: 'stale-copy-scene' })],
      resources: { '1': { ...image, hasSceneSource: true, scene: { elements: [], files: {} } } },
    }).ok
  ).toBe(true)
})

test('section file_key가 문자열 metadata가 아니면 차단한다', () => {
  expect(
    planPostingContent({ ...base, detail: [section('content', { resource_id: 1, file_key: {} })] })
  ).toEqual({ ok: false, code: 'invalid_section', index: 0 })
})

test('원본에 따로 저장된 표시 이미지와 현재 편집 scene을 각각 보존한다', () => {
  const scene = { elements: [{ type: 'rectangle' }], files: {} }
  const result = planPostingContent({
    ...base,
    detail: [section('content', { resource_id: 1, image_key: 'original-render' })],
    resources: {
      '1': { ...image, hasSceneSource: true, sourceImageKey: 'current-export', scene },
    },
    images: {
      'index:0': {
        copiedImagePath: 'tenant/original-image.png',
        verified: true,
        sourceImageKey: 'original-render',
      },
    },
  })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.blocks[0]).toMatchObject({
    contentType: 'design',
    imagePath: 'tenant/original-image.png',
    data: scene,
  })
})

test('표시 이미지의 원본 키가 일치하지 않으면 대체하지 않는다', () => {
  const result = planPostingContent({
    ...base,
    detail: [section('content_link', { resource_id: 1, image_key: 'original-render' })],
    resources: { '1': { ...image, hasSceneSource: false, sourceImageKey: 'current-export' } },
    images: { 'index:0': { ...image, sourceImageKey: 'different-image' } },
  })
  expect(result).toEqual({ ok: false, code: 'image_source_mismatch', index: 0 })
})

test('원본 키가 일치해도 검증되지 않은 표시 이미지는 거부한다', () => {
  const result = planPostingContent({
    ...base,
    detail: [section('content_link', { resource_id: 1, image_key: 'original-render' })],
    resources: { '1': { ...image, hasSceneSource: false, sourceImageKey: 'current-export' } },
    images: {
      'index:0': { ...image, sourceImageKey: 'original-render', verified: false },
    },
  })
  expect(result).toEqual({ ok: false, code: 'unverified_image', index: 0 })
})
