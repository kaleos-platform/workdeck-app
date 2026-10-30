/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import * as XLSX from 'xlsx'
import { prisma } from '@/lib/prisma'
import { listApplications } from '@/lib/hiring/applications'
import { GET as exportApplications } from '../../../../app/api/hiring-applicants/applications/export/route'

jest.mock('@/lib/api-helpers', () => {
  const actual = jest.requireActual('@/lib/api-helpers')
  return {
    ...actual,
    resolveDeckContext: async () => ({ space: { id: process.env.QA_ORDER_SPACE }, role: 'ADMIN' }),
  }
})

it('같은 접수 시각의 지원자는 페이지와 Excel에서 같은 순서로 한 번씩 표시한다', async () => {
  const ref = 'tumkfkfgzkmisguyaghn'
  if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname !== `${ref}.supabase.co`)
    throw Error('DEV_PROJECT_REQUIRED')
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
    throw Error('DEV_DATABASE_REQUIRED')
  const spaceId = `qa-order-${randomUUID()}`
  process.env.QA_ORDER_SPACE = spaceId
  try {
    await prisma.space.create({ data: { id: spaceId, name: '[QA] 동시각 페이지' } })
    const posting = await prisma.hiringPosting.create({
      data: { spaceId, title: '[QA]', status: 'DRAFT' },
    })
    await prisma.hiringApplication.createMany({
      data: Array.from({ length: 101 }, (_, index) => {
        const id = randomUUID()
        return {
          id,
          spaceId,
          postingId: posting.id,
          maskedName: `합성${index}`,
          createdAt: new Date('2026-09-27T00:00:00Z'),
          applicationEntries: [{ key: 'qa', type: 'string', label: '검증 ID', value: id }],
        }
      }),
    })
    const pages = await Promise.all(
      [1, 2, 3].map((page) => listApplications(spaceId, { page, pageSize: 50 }))
    )
    const ids = pages.flatMap((page) => page.rows.map((row) => row.id))
    expect(ids).toHaveLength(101)
    expect(new Set(ids).size).toBe(101)
    const singlePages = await Promise.all(
      Array.from({ length: 101 }, (_, index) =>
        listApplications(spaceId, { page: index + 1, pageSize: 1 })
      )
    )
    expect(singlePages.flatMap((page) => page.rows.map((row) => row.id))).toEqual(ids)
    const response = await exportApplications(new NextRequest('http://localhost/export'))
    if (!response) throw new Error('Excel 응답이 없습니다')
    expect(response.status).toBe(200)
    const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: 'buffer' })
    const rows = XLSX.utils.sheet_to_json<{ '검증 ID': string }>(workbook.Sheets['지원자'])
    expect(rows.map((row) => row['검증 ID'])).toEqual(ids)
  } finally {
    await prisma.space.deleteMany({ where: { id: spaceId } })
    expect(await prisma.space.count({ where: { id: spaceId } })).toBe(0)
    await prisma.$disconnect()
    delete process.env.QA_ORDER_SPACE
  }
})
