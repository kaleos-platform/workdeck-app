/** @jest-environment node */
import { createHash } from 'node:crypto'
import { copyMigrationFile } from '../file-copy'

const bytes = new Uint8Array([1, 2, 3])
const hash = createHash('sha256').update(bytes).digest('hex')
const input = {
  spaceId: 'space-a',
  sourceRef: '["opening","file","9007199254740993"]',
  expectedBytes: 3,
  expectedSha256: hash,
  mimeType: 'application/pdf',
}
let stored: Uint8Array | null
const readSource = jest.fn(async () => bytes)
const readTarget = jest.fn(async () => stored)
const writeTarget = jest.fn(async (_path: string, data: Uint8Array) => {
  stored = data
})
const run = (overrides = {}) =>
  copyMigrationFile({ ...input, ...overrides }, { readSource, readTarget, writeTarget })

beforeEach(() => {
  stored = null
  jest.clearAllMocks()
})

test('검증한 원본을 결정적 경로에 저장하고 반복 실행은 덮어쓰지 않는다', async () => {
  const first = await run()
  expect(first).toEqual({
    path: `space-a/migration/${createHash('sha256').update(input.sourceRef).digest('hex')}/${hash}`,
    bytes: 3,
    sha256: hash,
    status: 'created',
  })
  expect(writeTarget).toHaveBeenCalledWith(first.path, bytes, input.mimeType)
  expect((await run()).status).toBe('existing')
  expect(writeTarget).toHaveBeenCalledTimes(1)
})

test.each([{ expectedBytes: 4 }, { expectedSha256: '0'.repeat(64) }])(
  '원본 크기 또는 해시 불일치 시 쓰지 않는다',
  async (override) => {
    await expect(run(override)).rejects.toThrow('source')
    expect(readTarget).not.toHaveBeenCalled()
    expect(writeTarget).not.toHaveBeenCalled()
  }
)

test('기존 파일 충돌을 덮어쓰지 않는다', async () => {
  stored = new Uint8Array([3, 2, 1])
  await expect(run()).rejects.toThrow('target')
  expect(writeTarget).not.toHaveBeenCalled()
})

test('쓰기 실패를 전파하고 이후 재실행할 수 있다', async () => {
  writeTarget.mockRejectedValueOnce(new Error('write failure'))
  await expect(run()).rejects.toThrow('write failure')
  expect((await run()).status).toBe('created')
})

test('저장은 되었지만 응답이 실패한 경우 재실행은 기존 파일을 검증한다', async () => {
  writeTarget.mockImplementationOnce(async (_path, data) => {
    stored = data
    throw new Error('response failure')
  })
  await expect(run()).rejects.toThrow('response failure')
  expect((await run()).status).toBe('existing')
  expect(writeTarget).toHaveBeenCalledTimes(1)
})

test.each([null, new Uint8Array([3, 2, 1])])(
  '저장 후 누락 또는 손상을 탐지한다',
  async (result) => {
    writeTarget.mockImplementationOnce(async () => {
      stored = result
    })
    await expect(run()).rejects.toThrow('verification')
  }
)

test('조회 오류를 파일 없음으로 해석하지 않는다', async () => {
  readTarget.mockRejectedValueOnce(new Error('storage unavailable'))
  await expect(run()).rejects.toThrow('storage unavailable')
  expect(writeTarget).not.toHaveBeenCalled()
})

test.each([
  { spaceId: undefined },
  { spaceId: '../space' },
  { spaceId: 'space/a' },
  { spaceId: '.' },
  { spaceId: 'a.b' },
  { spaceId: 'a\\b' },
  { sourceRef: '' },
  { expectedSha256: 'bad' },
  { expectedBytes: 0 },
  { expectedBytes: 1.5 },
  { expectedBytes: 20 * 1024 * 1024 + 1 },
  { mimeType: '' },
])('잘못된 입력은 I/O 전에 거부한다: %j', async (override) => {
  await expect(run(override)).rejects.toThrow('input')
  expect(readSource).not.toHaveBeenCalled()
})
