import { act, fireEvent, render, screen } from '@testing-library/react'
import RecruitingLoading from '../../../../app/d/recruiting/loading'
import RecruitingError from '../../../../app/d/recruiting/error'

const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

it('페이지 조회 중에는 접근 가능한 로딩 안내를 제공한다', () => {
  render(<RecruitingLoading />)
  expect(screen.getByRole('status')).toHaveTextContent('모집 관리 화면을 불러오고 있습니다')
})

it('조회 실패 시 내부 오류를 노출하지 않고 서버 조회와 경계 복구를 재시도한다', async () => {
  const reset = jest.fn()
  render(<RecruitingError error={new Error('private database connection detail')} reset={reset} />)
  expect(screen.getByRole('alert')).toHaveTextContent('화면을 불러오지 못했습니다')
  expect(screen.queryByText(/private database/)).not.toBeInTheDocument()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '다시 시도' })))
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(reset).toHaveBeenCalledTimes(1)
})
