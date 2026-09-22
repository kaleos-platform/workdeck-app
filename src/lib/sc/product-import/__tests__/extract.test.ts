/** @jest-environment node */
import { extractSalesProduct, EmptyProductSourceError } from '../extract'
import { generateTextForSpace } from '@/lib/ai/resolve'
import { prepareProductImages } from '../images'

jest.mock('@/lib/ai/resolve', () => ({ generateTextForSpace: jest.fn() }))
jest.mock('../images', () => ({ prepareProductImages: jest.fn() }))
const generate = jest.mocked(generateTextForSpace)
const prepare = jest.mocked(prepareProductImages)

beforeEach(() => jest.resetAllMocks())

it('긴 이미지 출처가 많아도 저장 가능한 50개 필드를 넘지 않는다', async () => {
  const urls = Array.from(
    { length: 51 },
    (_, i) => `https://example.com/${i}/${'a'.repeat(1870)}.jpg`
  )
  prepare.mockResolvedValue({ images: [], readUrls: urls, warnings: [] })
  generate.mockResolvedValue({
    providerName: 'test',
    mode: 'WORKDECK',
    result: { latencyMs: 1, content: JSON.stringify({ name: '수납박스', materials: '펠트' }) },
  })
  const result = await extractSalesProduct('space', { text: '자료'.repeat(30), imageUrls: urls })
  expect(result.draft.customFields.length).toBeLessThanOrEqual(50)
  expect(result.draft.warnings.join(' ')).toContain('출처')
})

it('텍스트가 없는 상품도 이미지의 소재·규격·주문조건과 출처를 저장한다', async () => {
  prepare.mockResolvedValue({
    images: [{ mimeType: 'image/jpeg', data: 'eA==' }],
    readUrls: ['https://shop.example/detail.jpg'],
    warnings: [],
  })
  generate.mockResolvedValue({
    providerName: 'test',
    mode: 'WORKDECK',
    result: {
      latencyMs: 1,
      content: JSON.stringify({
        name: '그린 펠트 수납박스',
        materials: '재생펠트',
        capacity: 'L',
        ordering: '최소 수량 문의',
        missingInfo: ['납기 확인 필요'],
      }),
    },
  })
  const result = await extractSalesProduct(
    'space',
    {
      text: '',
      imageUrls: ['https://shop.example/detail.jpg'],
      sourceUrl: 'https://shop.example/product/62',
    },
    '기업 ESG 담당자'
  )
  expect(generate.mock.calls[0][1].messages[0].images).toHaveLength(1)
  expect(result.draft.customFields).toEqual(
    expect.arrayContaining([
      { key: '소재·구성', value: '재생펠트' },
      { key: '대량 주문 조건', value: '최소 수량 문의' },
      { key: '출처', value: 'https://shop.example/product/62' },
    ])
  )
})

it('이미지와 텍스트를 모두 읽지 못하면 빈 성공을 반환하지 않는다', async () => {
  prepare.mockResolvedValue({ images: [], readUrls: [], warnings: ['이미지 차단'] })
  await expect(
    extractSalesProduct('space', { text: '', imageUrls: ['https://shop.example/image'] })
  ).rejects.toBeInstanceOf(EmptyProductSourceError)
  expect(generate).not.toHaveBeenCalled()
})
