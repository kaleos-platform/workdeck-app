/**
 * 카페24 테스트용 메모리 SpaceCredential — prisma.spaceCredential 의 findUnique·updateMany·update·create 만 흉내 낸다.
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
    this.beforeUpdateMany = null
  },
  seed(spaceId: string, secret: object, config: Record<string, unknown>): Row {
    const row: Row = {
      id: `cred-${this.rows.length + 1}`,
      spaceId,
      provider: 'cafe24',
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

export const fakePrisma = {
  spaceCredential: {
    findUnique: jest.fn(
      async ({ where }: { where: { spaceId_provider: { spaceId: string; provider: string } } }) => {
        const { spaceId, provider } = where.spaceId_provider
        const r = fakeDb.rows.find((x) => x.spaceId === spaceId && x.provider === provider)
        return r ? clone(r) : null
      }
    ),
    findMany: jest.fn(async () =>
      fakeDb.rows.map((r) => ({ ...clone(r), healthError: null, healthAlertedAt: null }))
    ),
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
}
