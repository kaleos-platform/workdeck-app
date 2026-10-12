/** 신규 가입 경로가 Workspace.spaceId를 채우는지 — 실 DB */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { prisma } from '@/lib/prisma'
import { ensureWorkspaceForUser } from '@/lib/workspace'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip
const USER_ID = 'e2e00000-0000-4000-8000-0000000000b1'

d('ensureWorkspaceForUser → Workspace.spaceId', () => {
  afterAll(async () => {
    const ws = await prisma.workspace.findUnique({ where: { ownerId: USER_ID } })
    if (ws?.spaceId) await prisma.space.delete({ where: { id: ws.spaceId } }).catch(() => undefined)
    await prisma.user.delete({ where: { id: USER_ID } }).catch(() => undefined)
    await prisma.$disconnect()
  })

  it('신규 계정은 새 PERSONAL Space에 연결된다', async () => {
    const { workspace } = await ensureWorkspaceForUser({
      id: USER_ID,
      email: 'e2e-link@throwaway.test',
    })
    const row = await prisma.workspace.findUnique({
      where: { id: workspace.id },
      select: { spaceId: true },
    })
    expect(row?.spaceId).toBeTruthy()
    const member = await prisma.spaceMember.findFirst({
      where: { userId: USER_ID, spaceId: row!.spaceId! },
    })
    expect(member?.role).toBe('OWNER')
  })
})

// 마이그레이션 백필(UPDATE 2개)을 그대로 읽어 트랜잭션 안에서 돌리고 롤백한다.
function backfillStatements(): string[] {
  const dir = path.join(process.cwd(), 'prisma/migrations')
  const name = readdirSync(dir).find((n) => n.endsWith('_workspace_space_fk'))!
  const sql = readFileSync(path.join(dir, name, 'migration.sql'), 'utf8')
  const body = sql.slice(sql.indexOf('UPDATE'), sql.indexOf('-- CreateIndex'))
  return body
    .split(';')
    .map((st) =>
      st
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n')
        .trim()
    )
    .filter(Boolean)
}

class Rollback extends Error {}

d('Workspace.spaceId 백필 1순위', () => {
  afterAll(() => prisma.$disconnect())

  it('여러 Space가 같이 쓰는 키는 연결하지 않고, 단일 Space 키는 연결한다', async () => {
    const stmts = backfillStatements()
    expect(stmts).toHaveLength(2)
    let shared: string | null | undefined
    let single: string | null | undefined
    let singleSpace = ''
    await prisma
      .$transaction(async (tx) => {
        const mk = async (tag: string) => {
          const u = await tx.user.create({
            data: {
              id: `e2e00000-0000-4000-8000-0000000000${tag}`,
              email: `e2e-bf-${tag}@throwaway.test`,
            },
          })
          return tx.workspace.create({ data: { name: `bf-${tag}`, ownerId: u.id } })
        }
        const wsShared = await mk('c1')
        const wsSingle = await mk('c2')
        const loc = (key: string) => ({
          name: 'RG',
          externalSource: 'coupang_rocket_growth',
          externalIntegrationKey: key,
        })
        // 같은 키를 두 Space가 사용 → 모호
        await tx.space.create({
          data: { name: 'bf-s1', invLocations: { create: loc(wsShared.id) } },
        })
        await tx.space.create({
          data: { name: 'bf-s2', invLocations: { create: loc(wsShared.id) } },
        })
        const s3 = await tx.space.create({
          data: { name: 'bf-s3', invLocations: { create: loc(wsSingle.id) } },
        })
        singleSpace = s3.id

        for (const st of stmts) await tx.$executeRawUnsafe(st)

        const read = (id: string) =>
          tx.workspace
            .findUnique({ where: { id }, select: { spaceId: true } })
            .then((r) => r?.spaceId)
        shared = await read(wsShared.id)
        single = await read(wsSingle.id)
        throw new Rollback()
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e
      })

    expect(shared).toBeNull()
    expect(single).toBe(singleSpace)
  })
})
