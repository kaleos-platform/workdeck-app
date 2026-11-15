import { render, screen } from '@testing-library/react'
import { BlacklistButton } from '../detail-actions'

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))

it('미등록이면 텍스트 버튼', () => {
  render(<BlacklistButton applicationId="a" blacklisted={false} />)
  expect(screen.getByRole('button', { name: /블랙리스트 추가/ })).toBeEnabled()
})

it('등록돼 있으면 블랙리스트 관리 화면 링크', () => {
  render(<BlacklistButton applicationId="a" blacklisted />)
  expect(screen.getByRole('link', { name: /블랙리스트 등록됨/ })).toHaveAttribute(
    'href',
    '/d/recruiting/blacklist'
  )
})
