/**
 * 카페24 테스트용 메모리 SpaceCredential — prisma.spaceCredential 의 findUnique·findMany·updateMany·update·create·delete 와
 * $transaction(throw 시 행 롤백)·$executeRaw(advisory 잠금은 무시)를 흉내 낸다.
 * updateMany 는 config.credVersion 조건(JSON path equals)을 실제 DB 처럼 평가한다.
 * 암호화는 항등으로 대체한다(field-crypto 를 jest.mock 으로 바꾼다).
 */
type Row = {
  id: string
  spaceId: string
  provider: string
  encryptedPayload: string
  iv: string
  config: Record<string, unknown>
  lastError: string | null
}

export const fakeDb = {
  rows: [] as Row[],
  /** updateMany 직전에 실행 — 지연·경쟁 변경 주입용 */
  beforeUpdateMany: null as null | ((data: Record<string, unknown>) => Promise<void> | void),
  reset() {
    this.rows = []
    this.settings = []
    this.beforeUpdateMany = null
  },
  /** 채널 관측 설정(삭제 가드 테스트용) */
  settings: [] as Array<{
    spaceId: string
    adapter: string
    observeEnabled: boolean
    storeKey: string | null
  }>,
  /** provider 생략 = 레거시 `cafe24` 행 */
  seed(spaceId: string, secret: object, config: Record<string, unknown>, provider = 'cafe24'): Row {
    const row: Row = {
      id: `cred-${this.rows.length + 1}`,
      spaceId,
      provider,
      encryptedPayload: JSON.stringify(secret),
      iv: 'v1',
      config,
      lastError: null,
    }
    this.rows.push(row)
    return row
  },
  get row(): Row {
    return this.rows[0]
  },
  get secret(): Record<string, string | undefined> {
    return JSON.parse(this.row.encryptedPayload)
  },
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

type Where = {
  spaceId?: string
  provider?: string | { in?: string[]; startsWith?: string }
  OR?: Where[]
}
const matches = (r: Row, w: Where): boolean => {
  if (w.spaceId !== undefined && r.spaceId !== w.spaceId) return false
  const p = w.provider
  if (typeof p === 'string' && r.provider !== p) return false
  if (p && typeof p === 'object') {
    if (p.in && !p.in.includes(r.provider)) return false
    if (p.startsWith !== undefined && !r.provider.startsWith(p.startsWith)) return false
  }
  return !w.OR || w.OR.some((x) => matches(r, x))
}

export const fakePrisma: Record<string, unknown> & { spaceCredential: Record<string, jest.Mock> } =
  {
    spaceCredential: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: { spaceId_provider: { spaceId: string; provider: string } }
        }) => {
          const { spaceId, provider } = where.spaceId_provider
          const r = fakeDb.rows.find((x) => x.spaceId === spaceId && x.provider === provider)
          return r ? clone(r) : null
        }
      ),
      findMany: jest.fn(async ({ where }: { where?: Where } = {}) =>
        fakeDb.rows
          .filter((r) => matches(r, where ?? {}))
          .map((r) => ({ healthError: null, healthAlertedAt: null, ...clone(r) }))
      ),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        fakeDb.rows = fakeDb.rows.filter((x) => x.id !== where.id)
        return {}
      }),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; provider: string; config: { path: string[]; equals: number } }
          data: Record<string, unknown>
        }) => {
          await fakeDb.beforeUpdateMany?.(data)
          const r = fakeDb.rows.find((x) => x.id === where.id && x.provider === where.provider)
          if (!r || r.config[where.config.path[0]] !== where.config.equals) return { count: 0 }
          Object.assign(r, clone(data))
          return { count: 1 }
        }
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const r = fakeDb.rows.find((x) => x.id === where.id)
          if (!r) throw new Error('not found')
          Object.assign(r, data)
          return clone(r)
        }
      ),
      create: jest.fn(async ({ data }: { data: Omit<Row, 'id' | 'lastError'> }) => {
        if (fakeDb.rows.some((x) => x.spaceId === data.spaceId && x.provider === data.provider)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' })
        }
        fakeDb.rows.push({ id: `cred-${fakeDb.rows.length + 1}`, lastError: null, ...clone(data) })
        return {}
      }),
    },
    channelFulfillmentSetting: {
      findMany: jest.fn(async ({ where }: { where: { spaceId: string; adapter: string } }) =>
        fakeDb.settings.filter(
          (x) => x.spaceId === where.spaceId && x.adapter === where.adapter && x.observeEnabled
        )
      ),
    },
    $executeRaw: jest.fn(async () => 0),
    /** throw 하면 행을 되돌린다(DB 롤백) */
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => {
      const snapshot = clone(fakeDb.rows)
      try {
        return await fn(fakePrisma)
      } catch (err) {
        fakeDb.rows = snapshot
        throw err
      }
    }),
  }
