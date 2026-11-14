import { render, screen } from '@testing-library/react'
import ApplicationsPage from '../page'
import { resolveDeckContext } from '@/lib/api-helpers'

jest.mock('@/lib/api-helpers', () => ({ resolveDeckContext: jest.fn() }))
// 목록 조회는 async 서버 컴포넌트(공유 섹션)가 하므로 역할 전달만 검증한다.
jest.mock('@/components/hiring-applicants/applications-list-section', () => ({
  ApplicationsListSection: ({ canExportExcel }: { canExportExcel: boolean }) => (
    <span>{canExportExcel ? '다운로드 가능' : '다운로드 불가'}</span>
  ),
}))

test.each([
  ['OWNER', '다운로드 가능'],
  ['ADMIN', '다운로드 가능'],
  ['MEMBER', '다운로드 불가'],
])('%s 역할에 맞는 엑셀 권한을 전달한다', async (role, expected) => {
  jest.mocked(resolveDeckContext).mockResolvedValue({ role, space: { id: 'qa' } } as never)
  render(await ApplicationsPage({ searchParams: Promise.resolve({}) }))
  expect(screen.getByText(expected)).toBeInTheDocument()
})
