import { render, screen, within } from '@testing-library/react'
import { DeckManagement } from '../deck-management'

test('모든 실제 덱을 표시하고 기능 없는 덱은 링크 없는 상태로 표시한다', () => {
  render(<DeckManagement />)
  for (const name of ['모집 관리', '브랜드 운영', '세일즈 콘텐츠', '재무 관리', '쿠팡 광고 관리']) {
    expect(screen.getByRole('heading', { name, level: 2 })).toBeInTheDocument()
  }
  expect(screen.queryByRole('heading', { name: 'Workdeck' })).not.toBeInTheDocument()
  expect(screen.getAllByText('관리 기능 없음')).toHaveLength(4)
  const finance = screen.getByRole('region', { name: '재무 관리 운영 기능' })
  expect(within(finance).queryByRole('link')).not.toBeInTheDocument()
})

test('모집 관리 기능은 기존 URL로 바로 이동한다', () => {
  render(<DeckManagement />)
  const hiring = screen.getByRole('region', { name: '모집 관리 운영 기능' })
  expect(within(hiring).getByRole('link', { name: /샘플 템플릿/ })).toHaveAttribute(
    'href',
    '/admin/templates'
  )
  expect(within(hiring).getByRole('link', { name: /첨부 정리 이력/ })).toHaveAttribute(
    'href',
    '/admin/hiring-upload-sweep'
  )
  expect(screen.getAllByRole('link')).toHaveLength(2)
})
