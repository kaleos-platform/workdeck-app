/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { listPostingPage } from '../posting-list'
import { listPostings } from '../postings'

it('합성 고객의 장소·직무·고용 형태로 공고를 정확히 찾는다', async () => {
  const ref = 'tumkfkfgzkmisguyaghn'
  if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname !== `${ref}.supabase.co`)
    throw new Error('DEV_PROJECT_REQUIRED')
  const urls = [process.env.DATABASE_URL, process.env.DIRECT_URL].filter(Boolean) as string[]
  if (
    !urls.length ||
    urls.some((value) => {
      const url = new URL(value)
      return (
        url.hostname !== `db.${ref}.supabase.co` &&
        !(
          url.hostname.endsWith('.pooler.supabase.com') &&
          decodeURIComponent(url.username).endsWith(`.${ref}`)
        )
      )
    })
  )
    throw new Error('DEV_DATABASE_REQUIRED')
  const spaces = [`qa-filter-${randomUUID()}`, `qa-filter-${randomUUID()}`]
  try {
    for (const id of spaces) await prisma.space.create({ data: { id, name: '[QA] 공고 필터' } })
    const store = await prisma.hiringStore.create({
      data: { spaceId: spaces[0], name: '합성 강남점' },
    })
    const matched = await prisma.hiringPosting.create({
      data: {
        spaceId: spaces[0],
        title: '합성 공고',
        stores: { create: { storeId: store.id } },
        positions: { create: { spaceId: spaces[0], name: '홀 서빙', jobType: 'PART_TIME' } },
      },
    })
    await prisma.hiringPosting.create({
      data: {
        spaceId: spaces[0],
        title: '서로 다른 직무',
        positions: {
          create: [
            { spaceId: spaces[0], name: '홀 서빙', jobType: 'FULL_TIME' },
            { spaceId: spaces[0], name: '주방', jobType: 'PART_TIME' },
          ],
        },
      },
    })
    await prisma.hiringPosting.create({
      data: {
        spaceId: spaces[1],
        title: '다른 고객',
        positions: { create: { spaceId: spaces[1], name: '홀 서빙', jobType: 'PART_TIME' } },
      },
    })
    const filtered = await listPostingPage(spaces[0], {
      store: '강남',
      position: '서빙',
      jobType: 'PART_TIME',
    })
    expect(filtered.total).toBe(1)
    expect(filtered.rows.map((row) => row.id)).toEqual([matched.id])
    const positions = await listPostingPage(spaces[0], { position: '서빙', jobType: 'PART_TIME' })
    expect(positions.rows.map((row) => row.id)).toEqual([matched.id])
    expect(positions.total).toBe(1)
    await prisma.hiringPosting.update({
      where: { id: matched.id },
      data: { title: '합성%_\\공고' },
    })
    await prisma.hiringStore.update({ where: { id: store.id }, data: { name: '합성%_\\강남점' } })
    await prisma.hiringPostingPosition.updateMany({
      where: { postingId: matched.id },
      data: { name: '홀%_\\서빙' },
    })
    for (const term of ['%', '_', '\\']) {
      for (const field of ['q', 'store', 'position'] as const) {
        const result = await listPostingPage(spaces[0], { [field]: term })
        expect(result.rows.map((row) => row.id)).toEqual([matched.id])
      }
    }
    const foreignStore = await prisma.hiringStore.create({
      data: { spaceId: spaces[1], name: '다른 고객 매장' },
    })
    await prisma.hiringPostingStore.create({
      data: { postingId: matched.id, storeId: foreignStore.id },
    })
    await prisma.hiringPostingPosition.create({
      data: {
        spaceId: spaces[1],
        postingId: matched.id,
        name: '다른 고객 직무',
        jobType: 'FREELANCER',
      },
    })
    await prisma.hiringApplication.create({ data: { spaceId: spaces[1], postingId: matched.id } })
    expect((await listPostingPage(spaces[0], { store: '다른 고객' })).total).toBe(0)
    expect((await listPostingPage(spaces[0], { position: '다른 고객' })).total).toBe(0)
    expect((await listPostingPage(spaces[0], { jobType: 'FREELANCER' })).total).toBe(0)
    expect(
      (await listPostingPage(spaces[0], { q: '합성%_\\공고' })).rows[0]._count.applications
    ).toBe(0)
    expect(
      (await listPostings(spaces[0])).find((item) => item.id === matched.id)?._count.applications
    ).toBe(0)
    const ids = Array.from({ length: 1000 }, () => randomUUID())
    await prisma.hiringPosting.createMany({
      data: ids.map((id) => ({ id, spaceId: spaces[0], title: '합성 대량 공고' })),
    })
    await prisma.hiringPostingPosition.createMany({
      data: ids.map((postingId) => ({
        postingId,
        spaceId: spaces[0],
        name: '홀 서빙',
        jobType: 'PART_TIME',
      })),
    })
    await prisma.hiringPostingStore.createMany({
      data: ids.map((postingId) => ({ postingId, storeId: store.id })),
    })
    const timings = []
    for (let i = 0; i < 4; i++) {
      const start = performance.now()
      const page = await listPostingPage(spaces[0], {
        store: '강남',
        position: '서빙',
        jobType: 'PART_TIME',
      })
      expect(page.total).toBe(1001)
      expect(page.rows).toHaveLength(50)
      timings.push(Math.round(performance.now() - start))
    }
    console.info('합성 공고 1002건 필터 조회 ms:', timings)
  } finally {
    await prisma.hiringPosting.deleteMany({ where: { spaceId: { in: spaces } } })
    await prisma.space.deleteMany({ where: { id: { in: spaces } } })
    expect(await prisma.space.count({ where: { id: { in: spaces } } })).toBe(0)
    await prisma.$disconnect()
  }
})
