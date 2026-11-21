/**
 * 실 DB(dev) — config.credVersion 조건부 쓰기가 Postgres 에서 기대대로 동작하는지.
 *  - 키 없는 기존 행(수동 토큰 시절)은 버전 0 으로 읽고 IS NULL 조건으로 첫 쓰기가 성공한다(equals 0 은 안 맞는다)
 *  - 같은 버전으로 두 번 쓰면 한 번만 성공, 동시 쓰기는 정확히 하나만 이긴다
 *  - 최초 등록 동시 생성은 @@unique 충돌을 false 로 돌려준다
 * 실행: DATABASE_URL 이 있어야 돈다 — `jest -c jest.config.e2e.ts src/lib/integrations/__tests__/google-marketing-store.e2e.test.ts`
 */
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { encryptField } from '@/lib/crypto/field-crypto'
import { createGoogle, readGoogle, registerGoogle, writeGoogleIf } from '../google-marketing-store'

// 운영 키가 아닌 일회용 키 — 이 테스트가 쓰는 행만 이 키로 암호화된다.
process.env.ENCRYPTION_KEY_V1 ??= 'ab'.repeat(32)
process.env.ENCRYPTION_WRITE_VERSION = 'v1'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip

const SP = 'e2e00000-0000-4000-8000-00000900a101'
const SEC = { clientId: 'cid-1234567', clientSecret: 'secret-1234567', refreshToken: 'RT-1234567' }
const CFG = { defaultBrand: 'a', brands: { a: { ga4_property_id: '1' } } }

d('구글 마케팅 조건부 쓰기(dev DB)', () => {
  beforeAll(async () => {
    await prisma.space.upsert({
      where: { id: SP },
      update: {},
      create: { id: SP, name: 'E2E google', type: 'PERSONAL' },
    })
    await prisma.spaceCredential.deleteMany({ where: { spaceId: SP } })
  })
  afterAll(async () => {
    await prisma.spaceCredential.deleteMany({ where: { spaceId: SP } })
    await prisma.space.deleteMany({ where: { id: SP } })
  })

  it('credVersion 키가 없는 기존 행: 버전 0 으로 읽고 첫 쓰기가 성공, 같은 버전 두 번째는 0행', async () => {
    const { encrypted, iv } = encryptField('space-credential', JSON.stringify(SEC))
    await prisma.spaceCredential.create({
      data: {
        spaceId: SP,
        provider: 'google-marketing',
        encryptedPayload: encrypted,
        iv,
        config: CFG,
      },
    })
    const cur = (await readGoogle(SP))!
    expect(cur.config.credVersion).toBe(0)
    expect(cur.config.status).toBeUndefined() // 기존 행은 상태를 만들어 붙이지 않는다

    // 대조: JSON path equals 0 은 키 없는 행과 맞지 않는다(그래서 IS NULL 조건을 쓴다).
    const eq0 = await prisma.spaceCredential.count({
      where: { id: cur.id, config: { path: ['credVersion'], equals: 0 } },
    })
    expect(eq0).toBe(0)
    const isNull = await prisma.spaceCredential.count({
      where: { id: cur.id, config: { path: ['credVersion'], equals: Prisma.DbNull } },
    })
    expect(isNull).toBe(1)

    expect(
      await writeGoogleIf(cur, { ...cur.secret, refreshToken: 'A1-1234567' }, cur.config)
    ).toBe(true)
    expect(
      await writeGoogleIf(cur, { ...cur.secret, refreshToken: 'A2-1234567' }, cur.config)
    ).toBe(false)
    const after = (await readGoogle(SP))!
    expect(after.secret.refreshToken).toBe('A1-1234567')
    expect(after.config.credVersion).toBe(1)
  })

  it('버전이 있는 행: 동시 쓰기 다섯 개 중 정확히 하나만 성공한다', async () => {
    const cur = (await readGoogle(SP))!
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        writeGoogleIf(cur, { ...cur.secret, refreshToken: `P${n}-1234567` }, cur.config)
      )
    )
    expect(results.filter(Boolean)).toHaveLength(1)
    expect((await readGoogle(SP))!.config.credVersion).toBe(cur.config.credVersion + 1)
  })

  it('기존 행(키 없음)을 registerGoogle 로 처음 저장하면 성공하고 버전 1', async () => {
    await prisma.spaceCredential.deleteMany({ where: { spaceId: SP } })
    const { encrypted, iv } = encryptField('space-credential', JSON.stringify(SEC))
    await prisma.spaceCredential.create({
      data: {
        spaceId: SP,
        provider: 'google-marketing',
        encryptedPayload: encrypted,
        iv,
        config: CFG,
      },
    })
    expect(
      await registerGoogle(SP, {
        clientId: SEC.clientId,
        clientSecret: 'new-secret-1234567',
        config: CFG,
      })
    ).toBe('ok')
    const row = (await readGoogle(SP))!
    expect(row.config.credVersion).toBe(1)
    expect(row.secret.refreshToken).toBe(SEC.refreshToken) // 같은 clientId → 토큰 유지
    expect(row.secret.clientSecret).toBe('new-secret-1234567')
  })

  it('동시 최초 등록은 하나만 만들고 나머지는 false', async () => {
    await prisma.spaceCredential.deleteMany({ where: { spaceId: SP } })
    const results = await Promise.all(
      [1, 2, 3].map((n) =>
        createGoogle(
          SP,
          { clientId: `cid-${n}-1234567`, clientSecret: 'secret-1234567' },
          {
            ...CFG,
            status: 'needs_auth',
          }
        )
      )
    )
    expect(results.filter(Boolean)).toHaveLength(1)
    expect((await readGoogle(SP))?.config).toMatchObject({ credVersion: 1, status: 'needs_auth' })
  })
})
