/** @jest-environment node */
/**
 * 미분류 거래 AI 계정 제안 단위 테스트.
 * Gemini API(@google/genai)만 mock하고 파싱/검증 로직을 검증한다.
 * - 유효 number → 해당 후보, 0/범위밖/파싱실패 → null(미분류 유지)
 * - 코드블록 감싼 JSON 방어, 후보 없음/적요 없음/키 없음/API throw → null & 미호출/graceful
 */
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn(),
}))

import { GoogleGenAI } from '@google/genai'
import { suggestCategory, type SuggestCandidate } from '@/lib/finance/ai-suggest'

const MockedGenAI = GoogleGenAI as unknown as jest.Mock
const mockGenerateContent = jest.fn()

const candidates: SuggestCandidate[] = [
  { id: 'c1', name: '택배비', group: '물류·배송', kind: '지출' },
  { id: 'c2', name: '광고비', group: '마케팅·광고', kind: '지출' },
  { id: 'c3', name: '임차료', group: '사무·운영', kind: '지출' },
]

const input = {
  description: '씨제이대한통운 택배',
  counterparty: null,
  amount: 3000,
  direction: 'OUT' as const,
}

function reply(text: string) {
  mockGenerateContent.mockResolvedValue({ text })
}

beforeEach(() => {
  mockGenerateContent.mockReset()
  MockedGenAI.mockReset()
  MockedGenAI.mockImplementation(() => ({ models: { generateContent: mockGenerateContent } }))
  delete process.env.GEMINI_API_KEY
  process.env.GOOGLE_AI_API_KEY = 'test-key'
})

test('유효 number → 해당 후보(1-based 인덱스) 반환', async () => {
  reply('{"number": 1, "reason": "택배 배송 비용"}')
  const r = await suggestCategory(input, candidates)
  expect(r).toEqual({ categoryId: 'c1', categoryName: '택배비', reason: '택배 배송 비용' })
})

test('number 0(해당없음) → null', async () => {
  reply('{"number": 0, "reason": "모호함"}')
  expect(await suggestCategory(input, candidates)).toBeNull()
})

test('범위 밖 number → null', async () => {
  reply('{"number": 9, "reason": "x"}')
  expect(await suggestCategory(input, candidates)).toBeNull()
})

test('코드블록으로 감싼 JSON도 파싱', async () => {
  reply('```json\n{"number": 2, "reason": "광고 집행"}\n```')
  const r = await suggestCategory(input, candidates)
  expect(r?.categoryId).toBe('c2')
})

test('JSON 아님 → null', async () => {
  reply('잘 모르겠습니다')
  expect(await suggestCategory(input, candidates)).toBeNull()
})

test('reason 누락 시 기본 문구로 대체', async () => {
  reply('{"number": 3}')
  const r = await suggestCategory(input, candidates)
  expect(r?.categoryId).toBe('c3')
  expect(r?.reason).toBe('AI 추천')
})

test('후보 없음 → null & API 미호출', async () => {
  expect(await suggestCategory(input, [])).toBeNull()
  expect(mockGenerateContent).not.toHaveBeenCalled()
})

test('적요·거래처 모두 빈 값 → null & API 미호출', async () => {
  expect(
    await suggestCategory({ ...input, description: null, counterparty: null }, candidates)
  ).toBeNull()
  expect(mockGenerateContent).not.toHaveBeenCalled()
})

test('키(GEMINI_API_KEY/GOOGLE_AI_API_KEY) 미설정 → null & API 미호출', async () => {
  delete process.env.GEMINI_API_KEY
  delete process.env.GOOGLE_AI_API_KEY
  expect(await suggestCategory(input, candidates)).toBeNull()
  expect(mockGenerateContent).not.toHaveBeenCalled()
})

test('API throw → null(throw 전파 안 함)', async () => {
  mockGenerateContent.mockRejectedValue(new Error('quota'))
  expect(await suggestCategory(input, candidates)).toBeNull()
})
