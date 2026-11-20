/**
 * 실 DB(dev) — Prisma JSON path 조건부 쓰기(config.credVersion)가 Postgres 에서 기대대로 동작하는지.
 *  - 같은 버전으로 두 번 쓰면 한 번만 성공(0행 = 경쟁 패배), 버전은 1씩 오른다
 *  - 동시 쓰기는 정확히 하나만 이긴다
 *  - 최초 등록 동시 생성은 @@unique 충돌을 false 로 돌려준다
 *  - 암호화 왕복(field-crypto 실제 키)
 */
import { prisma } from '@/lib/prisma'
import { createCafe24, readCafe24, registerCafe24, writeCafe24If } from '../store'

// 운영 키가 아닌 일회용 키 — 이 테스트가 쓰는 행만 이 키로 암호화된다.
process.env.ENCRYPTION_KEY_V1 ??= 'ab'.repeat(32)
process.env.ENCRYPTION_WRITE_VERSION = 'v1'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip

const SP = 'e2e00000-0000-4000-8000-00000cafe241'

d('카페24 조건부 쓰기(dev DB)', () => {
  beforeAll(async () => {
    await prisma.space.upsert({
      where: { id: SP },
      update: {},
      create: { id: SP, name: 'E2E cafe24', type: 'PERSONAL' },
    })
    await prisma.spaceCredential.deleteMany({ where: { spaceId: SP } })
  })
  afterAll(async () => {
    await prisma.spaceCredential.deleteMany({ where: { spaceId: SP } })
    await prisma.space.deleteMany({ where: { id: SP } })
  })

  it('동시 최초 등록은 하나만 만들고 나머지는 false', async () => {
    const results = await Promise.all(
      [1, 2, 3].map((n) =>
        createCafe24(
          SP,
          { clientId: `cid-${n}-1234567`, clientSecret: 'secret-1234567' },
          { mallId: 'myshop24', status: 'needs_auth' }
        )
      )
    )
    expect(results.filter(Boolean)).toHaveLength(1)
    const row = await readCafe24(SP)
    expect(row?.config).toMatchObject({ credVersion: 1, status: 'needs_auth' })
    expect(row?.secret.clientSecret).toBe('secret-1234567') // 암호화 왕복
  })

  it('같은 버전으로 두 번 쓰면 두 번째는 0행, 버전은 1씩 오른다', async () => {
    const cur = (await readCafe24(SP))!
    expect(await writeCafe24If(cur, { ...cur.secret, accessToken: 'A1' }, cur.config)).toBe(true)
    expect(await writeCafe24If(cur, { ...cur.secret, accessToken: 'A2' }, cur.config)).toBe(false)
    const after = (await readCafe24(SP))!
    expect(after.secret.accessToken).toBe('A1')
    expect(after.config.credVersion).toBe(cur.config.credVersion + 1)
  })

  it('동시 쓰기 다섯 개 중 정확히 하나만 성공한다', async () => {
    const cur = (await readCafe24(SP))!
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        writeCafe24If(cur, { ...cur.secret, accessToken: `P${n}` }, cur.config)
      )
    )
    expect(results.filter(Boolean)).toHaveLength(1)
    expect((await readCafe24(SP))!.config.credVersion).toBe(cur.config.credVersion + 1)
  })

  it('다른 컬럼(healthError) 갱신은 버전을 건드리지 않는다', async () => {
    const cur = (await readCafe24(SP))!
    await prisma.spaceCredential.update({
      where: { id: cur.id },
      data: { healthError: 'x', lastError: 'y' },
    })
    expect((await readCafe24(SP))!.config.credVersion).toBe(cur.config.credVersion)
    expect(await writeCafe24If(cur, cur.secret, cur.config, true)).toBe(true)
  })

  it('재등록: clientId 변경 시 토큰이 폐기된다', async () => {
    expect(
      await registerCafe24(SP, {
        clientId: 'brand-new-client',
        clientSecret: 'secret-7654321',
        mallId: 'myshop24',
      })
    ).toBe('ok')
    const row = (await readCafe24(SP))!
    expect(row.secret).toEqual({ clientId: 'brand-new-client', clientSecret: 'secret-7654321' })
    expect(row.config.status).toBe('needs_auth')
  })
})
