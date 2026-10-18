/** @jest-environment node */
import { prisma } from '@/lib/prisma'
import { generateTextForSpace } from '../resolve'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    spaceAiSetting: { findUnique: jest.fn(), update: jest.fn() },
    usageEvent: { create: jest.fn() },
  },
}))
jest.mock('../credit', () => ({ checkTextQuota: jest.fn(), recordTextUsage: jest.fn() }))
// 로컬 CLI 가 설치된 개발 장비에서도 WORKDECK 경로를 타도록 막는다.
jest.mock('../providers/text-codex', () => ({
  CodexCliProvider: jest.fn().mockImplementation(() => ({ isConfigured: () => false })),
}))
jest.mock('../providers/text-gemini', () => ({
  GeminiCliProvider: jest.fn().mockImplementation(() => ({ isConfigured: () => false })),
}))
const mockGenerate = jest.fn()
// mockGenerate 는 팩토리 실행 시점이 아니라 generate 호출 시점에 참조된다(호이스팅 TDZ 회피).
jest.mock('../providers/text-gemini-api', () => ({
  GeminiApiProvider: class {
    name = 'gemini-api'
    isConfigured = () => true
    generate = (r: unknown) => mockGenerate(r)
  },
}))
jest.mock('../providers/text-openai', () => ({ OpenAiProvider: class {} }))
jest.mock('../providers/text-anthropic', () => ({
  AnthropicProvider: class {
    name = 'anthropic'
    isConfigured = () => true
    generate = (r: unknown) => mockGenerate(r)
  },
}))
jest.mock('@/lib/crypto/field-crypto', () => ({ decryptField: () => 'sk-test' }))
jest.mock('@/lib/crypto/reencrypt', () => ({ upgradeIfLegacy: jest.fn() }))

const mock = prisma as unknown as {
  spaceAiSetting: { findUnique: jest.Mock; update: jest.Mock }
  usageEvent: { create: jest.Mock }
}
const req = { messages: [{ role: 'user' as const, content: 'hi' }] }

beforeEach(() => {
  jest.clearAllMocks()
  mockGenerate.mockResolvedValue({
    content: 'ok',
    model: 'gemini-2.5-flash',
    usage: { inputTokens: 10, outputTokens: 5 },
    latencyMs: 1,
  })
})

test('WORKDECK 모드는 payg 로 기록하고 호출자 actor 를 남긴다', async () => {
  mock.spaceAiSetting.findUnique.mockResolvedValue(null)

  await generateTextForSpace('s1', req, { actor: { type: 'user', id: 'u1' }, workId: 'w1' })

  expect(mock.usageEvent.create).toHaveBeenCalledWith({
    data: {
      spaceId: 's1',
      source: 'workdeck',
      provider: 'gemini-api',
      planClass: 'payg',
      model: 'gemini-2.5-flash',
      actorType: 'user',
      actorId: 'u1',
      inputTokens: 10,
      outputTokens: 5,
      workId: 'w1',
      requesterUserId: undefined,
    },
  })
})

test('BYOK 는 고객 키 비용이라 byok 로 구분하고, actor 가 없으면 system', async () => {
  mock.spaceAiSetting.findUnique.mockResolvedValue({
    mode: 'BYOK',
    provider: 'ANTHROPIC',
    model: null,
    encryptedApiKey: 'x',
    apiKeyIv: 'v1',
  })

  await generateTextForSpace('s1', req)

  expect(mock.usageEvent.create.mock.calls[0][0].data).toMatchObject({
    provider: 'anthropic',
    planClass: 'byok',
    actorType: 'system',
    actorId: 'workdeck-app',
  })
})

test('UsageEvent 기록 실패는 생성 결과를 막지 않는다', async () => {
  mock.spaceAiSetting.findUnique.mockResolvedValue(null)
  mock.usageEvent.create.mockRejectedValueOnce(new Error('db'))
  jest.spyOn(console, 'error').mockImplementation(() => {})

  const { result } = await generateTextForSpace('s1', req)

  expect(result.content).toBe('ok')
})
