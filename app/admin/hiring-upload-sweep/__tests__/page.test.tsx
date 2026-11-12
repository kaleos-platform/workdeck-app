import { render, screen } from '@testing-library/react'
import Page from '../page'

const findMany = jest.fn()
const requireOperator = jest.fn()
jest.mock('@/lib/prisma', () => ({
  prisma: { cronRun: { findMany: (...args: unknown[]) => findMany(...args) } },
}))
jest.mock('@/lib/admin/auth', () => ({ requireOperator: () => requireOperator() }))
jest.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
  redirect: () => {
    throw new Error('REDIRECT')
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  requireOperator.mockResolvedValue({ ok: true })
})

test('권한이 없으면 조회하지 않는다', async () => {
  requireOperator.mockResolvedValue({ ok: false, reason: 'NOT_OPERATOR' })
  await expect(Page()).rejects.toThrow('NOT_FOUND')
  expect(findMany).not.toHaveBeenCalled()
})

test('부분 실패와 중단을 구분하고 민감 내용을 표시하지 않는다', async () => {
  findMany.mockResolvedValue([
    {
      startedAt: new Date('2026-01-01T00:00:00Z'),
      ok: false,
      error: null,
      detail: {
        scanned: 2,
        deleted: 1,
        failed: 1,
        remaining: 0,
        truncated: false,
        path: 'secret-path',
      },
    },
    { startedAt: new Date('2026-01-02T00:00:00Z'), ok: false, error: 'secret-error', detail: null },
  ])
  render(await Page())
  expect(screen.getByText('부분 실패')).toBeInTheDocument()
  expect(screen.getByText('중단')).toBeInTheDocument()
  expect(screen.queryByText(/secret/)).not.toBeInTheDocument()
})

test('기록 없음과 조회 실패를 구분한다', async () => {
  findMany.mockResolvedValueOnce([])
  const first = render(await Page())
  expect(screen.getByText(/실행 기록이 없습니다/)).toBeInTheDocument()
  first.unmount()
  findMany.mockRejectedValueOnce(new Error('secret-error'))
  render(await Page())
  expect(screen.getByText(/조회하지 못했습니다/)).toBeInTheDocument()
  expect(screen.queryByText(/secret-error/)).not.toBeInTheDocument()
})

test('MFA가 필요하면 조회 전에 인증으로 이동한다', async () => {
  requireOperator.mockResolvedValue({ ok: false, reason: 'MFA_REQUIRED' })
  await expect(Page()).rejects.toThrow('REDIRECT')
  expect(findMany).not.toHaveBeenCalled()
})

test('이전 성공 기록의 실패 건수를 반영하고 불완전한 상세는 미확인으로 표시한다', async () => {
  findMany.mockResolvedValue([
    {
      startedAt: new Date(),
      ok: true,
      error: null,
      detail: { scanned: 2, deleted: 1, failed: 1, remaining: 0, truncated: false },
    },
    { startedAt: new Date(), ok: true, error: null, detail: { scanned: 'sensitive' } },
  ])
  render(await Page())
  expect(screen.getByText('부분 실패')).toBeInTheDocument()
  expect(screen.getByText('미확인')).toBeInTheDocument()
  expect(screen.queryByText(/sensitive/)).not.toBeInTheDocument()
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { path: '/api/cron/hiring-upload-sweep' }, take: 20 })
  )
})

test('상세 누락이나 모순된 건수는 미확인으로 표시한다', async () => {
  findMany.mockResolvedValue([
    { startedAt: new Date(), ok: false, error: null, detail: null },
    {
      startedAt: new Date(),
      ok: true,
      error: null,
      detail: { scanned: 1, deleted: 2, failed: 0, remaining: 0, truncated: false },
    },
    {
      startedAt: new Date(),
      ok: true,
      error: null,
      detail: { scanned: 1, deleted: 1, failed: 0, remaining: 1, truncated: false },
    },
  ])
  render(await Page())
  expect(screen.getAllByText('미확인')).toHaveLength(3)
})

test('남은 대상이 있으면 정리 대상 남음을 표시한다', async () => {
  findMany.mockResolvedValue([
    {
      startedAt: new Date(),
      ok: true,
      error: null,
      detail: { scanned: 1, deleted: 1, failed: 0, remaining: 2, truncated: true },
    },
  ])
  render(await Page())
  expect(screen.getByText('있음')).toBeInTheDocument()
})

test('실패 상태인데 실패 건수가 0이면 미확인으로 표시한다', async () => {
  findMany.mockResolvedValue([
    {
      startedAt: new Date(),
      ok: false,
      error: null,
      detail: { scanned: 2, deleted: 1, failed: 0, remaining: 0, truncated: false },
    },
  ])
  render(await Page())
  expect(screen.getByText('미확인')).toBeInTheDocument()
})

test('성공 상태에 오류가 함께 있으면 미확인으로 표시한다', async () => {
  findMany.mockResolvedValue([{ startedAt: new Date(), ok: true, error: 'secret', detail: null }])
  render(await Page())
  expect(screen.getByText('미확인')).toBeInTheDocument()
  expect(screen.queryByText(/secret/)).not.toBeInTheDocument()
})
