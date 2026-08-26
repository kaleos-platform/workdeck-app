/** @jest-environment node */

process.env.CRON_SECRET = 'test-cron-secret'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

type StorageItem = { name: string; id: string | null; created_at: string | null }

// jest mock factory가 import 전에 평가되므로 var로 hoist 가능한 mock 저장소를 둔다.
// eslint-disable-next-line no-var
var listMock: jest.Mock
// eslint-disable-next-line no-var
var removeMock: jest.Mock
// eslint-disable-next-line no-var
var cronRunCreateMock: jest.Mock
// eslint-disable-next-line no-var
var sourceFindManyMock: jest.Mock

jest.mock('@supabase/supabase-js', () => {
  listMock = jest.fn()
  removeMock = jest.fn().mockResolvedValue({ error: null })
  const fromMock = jest.fn(() => ({ list: listMock, remove: removeMock }))
  return {
    createClient: jest.fn(() => ({ storage: { from: fromMock } })),
  }
})

jest.mock('@/lib/prisma', () => {
  cronRunCreateMock = jest.fn().mockResolvedValue(undefined)
  sourceFindManyMock = jest.fn().mockResolvedValue([])
  return {
    prisma: {
      cronRun: { create: (...args: unknown[]) => cronRunCreateMock(...args) },
      productExtractionSource: {
        findMany: (...args: unknown[]) => sourceFindManyMock(...args),
      },
    },
  }
})

import { GET } from '../route'

/** Storage 트리를 path -> 항목배열 맵으로 정의하면 list()가 offset/limit로 알아서 페이지네이션한다. */
function mockStorageTree(tree: Record<string, StorageItem[]>) {
  listMock.mockImplementation((path: string, opts?: { limit?: number; offset?: number }) => {
    const all = tree[path] ?? []
    const limit = opts?.limit ?? 100
    const offset = opts?.offset ?? 0
    return Promise.resolve({ data: all.slice(offset, offset + limit), error: null })
  })
}

function folder(name: string): StorageItem {
  return { name, id: null, created_at: null }
}

function file(name: string, createdAt: Date): StorageItem {
  return { name, id: `id-${name}`, created_at: createdAt.toISOString() }
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

function cronRequest() {
  return {
    headers: { get: (key: string) => (key === 'authorization' ? 'Bearer test-cron-secret' : null) },
  } as unknown as Parameters<typeof GET>[0]
}

async function runCron() {
  const response = (await GET(cronRequest()))!
  return response.json() as Promise<Record<string, unknown>>
}

beforeEach(() => {
  jest.clearAllMocks()
  removeMock.mockResolvedValue({ error: null })
  cronRunCreateMock.mockResolvedValue(undefined)
  sourceFindManyMock.mockResolvedValue([])
})

describe('GET /api/cron/product-source-orphan-sweep', () => {
  test('참조가 있는 파일은 오래되었어도 삭제하지 않는다', async () => {
    mockStorageTree({
      '': [folder('space-1')],
      'space-1': [folder('products')],
      'space-1/products': [folder('product-1')],
      'space-1/products/product-1': [file('a.png', daysAgo(30))],
    })
    sourceFindManyMock.mockResolvedValue([{ storagePath: 'space-1/products/product-1/a.png' }])

    const body = await runCron()

    expect(removeMock).not.toHaveBeenCalled()
    expect(body).toMatchObject({ scanned: 1, orphans: 0, deleted: 0, skippedRecent: 0 })
  })

  test('컷오프보다 어린 고아는 삭제하지 않고 skippedRecent로 잡는다', async () => {
    mockStorageTree({
      '': [folder('space-1')],
      'space-1': [folder('products')],
      'space-1/products': [folder('product-1')],
      'space-1/products/product-1': [file('b.png', daysAgo(1))],
    })
    sourceFindManyMock.mockResolvedValue([])

    const body = await runCron()

    expect(removeMock).not.toHaveBeenCalled()
    expect(body).toMatchObject({ scanned: 1, orphans: 0, deleted: 0, skippedRecent: 1 })
    // 컷오프 미만 파일은 DB 조회 대상에도 들어가지 않는다.
    expect(sourceFindManyMock).not.toHaveBeenCalled()
  })

  test('컷오프보다 오래된 고아만 삭제한다', async () => {
    mockStorageTree({
      '': [folder('space-1')],
      'space-1': [folder('products')],
      'space-1/products': [folder('product-1')],
      'space-1/products/product-1': [
        file('old-orphan.png', daysAgo(10)),
        file('old-referenced.png', daysAgo(10)),
        file('recent-orphan.png', daysAgo(1)),
      ],
    })
    sourceFindManyMock.mockResolvedValue([
      { storagePath: 'space-1/products/product-1/old-referenced.png' },
    ])

    const body = await runCron()

    expect(removeMock).toHaveBeenCalledTimes(1)
    expect(removeMock).toHaveBeenCalledWith(['space-1/products/product-1/old-orphan.png'])
    expect(body).toMatchObject({ scanned: 3, orphans: 1, deleted: 1, skippedRecent: 1 })
  })

  test('100건 초과 응답은 페이지네이션으로 끝까지 읽는다', async () => {
    const manyFiles = Array.from({ length: 150 }, (_, i) => file(`f${i}.png`, daysAgo(30)))
    mockStorageTree({
      '': [folder('space-1')],
      'space-1': [folder('products')],
      'space-1/products': [folder('product-1')],
      'space-1/products/product-1': manyFiles,
    })
    sourceFindManyMock.mockResolvedValue([])

    const body = await runCron()

    expect(body).toMatchObject({ scanned: 150, orphans: 150 })
    // list()가 offset 0, 100 두 번 호출되어야 150건 전부를 읽는다.
    const fileLevelCalls = listMock.mock.calls.filter(
      ([path]) => path === 'space-1/products/product-1'
    )
    expect(fileLevelCalls.length).toBe(2)
  })

  test('삭제 상한에 걸리면 truncated로 드러난다', async () => {
    const manyFiles = Array.from({ length: 501 }, (_, i) => file(`orphan${i}.png`, daysAgo(30)))
    mockStorageTree({
      '': [folder('space-1')],
      'space-1': [folder('products')],
      'space-1/products': [folder('product-1')],
      'space-1/products/product-1': manyFiles,
    })
    sourceFindManyMock.mockResolvedValue([])

    const body = await runCron()

    expect(body).toMatchObject({ scanned: 501, orphans: 501, deleted: 500, truncated: true })
    expect(removeMock).toHaveBeenCalledTimes(1)
    expect((removeMock.mock.calls[0][0] as string[]).length).toBe(500)
  })
})
