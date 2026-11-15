import { act, fireEvent, render, screen } from '@testing-library/react'
import { SmsSender } from '../sms-sender'

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))

const props = {
  phone: '010-1234-5678',
  name: '홍길동',
  postingTitle: '홀 모집',
  positionName: '서빙',
}

function setup(items: unknown[], coarse = true) {
  window.matchMedia = jest.fn(() => ({ matches: coarse })) as unknown as typeof window.matchMedia
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ items }) })) as never
}
async function openDialog() {
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /문자 보내기/ })))
}

it('메시지를 선택하면 치환된 본문으로 sms 링크를 만든다', async () => {
  setup([{ id: 't1', title: '합격', content: '{이름}님 {공고명} {직무}' }])
  render(<SmsSender {...props} />)
  await openDialog()
  await act(async () => fireEvent.click(await screen.findByRole('button', { name: '합격' })))
  expect(screen.getByLabelText('문자 내용')).toHaveValue('홍길동님 홀 모집 서빙')
  expect(screen.getByRole('link', { name: '문자 앱 열기' })).toHaveAttribute(
    'href',
    `sms:01012345678?&body=${encodeURIComponent('홍길동님 홀 모집 서빙')}`
  )
  expect(screen.getByText(/010-1234-5678/)).toBeInTheDocument()
})

it('번호가 올바르지 않거나 터치 기기가 아니면 문자 앱 버튼을 숨기고 복사는 남긴다', async () => {
  setup([{ id: 't1', title: '합격', content: 'x' }])
  const { unmount } = render(<SmsSender {...props} phone="12" />)
  await openDialog()
  expect(screen.queryByRole('link', { name: '문자 앱 열기' })).toBeNull()
  expect(screen.getByRole('button', { name: /메시지 복사/ })).toBeInTheDocument()
  unmount()

  setup([{ id: 't1', title: '합격', content: 'x' }], false)
  render(<SmsSender {...props} />)
  await openDialog()
  expect(screen.queryByRole('link', { name: '문자 앱 열기' })).toBeNull()
})

it('메시지가 없으면 메시지 관리 링크를 보인다', async () => {
  setup([])
  render(<SmsSender {...props} />)
  await openDialog()
  expect(await screen.findByRole('link', { name: /메시지 관리/ })).toHaveAttribute(
    'href',
    '/d/recruiting/settings/messages'
  )
})

it('창을 열어도 문자 내용 입력란에 자동 포커스하지 않는다(휴대폰 키보드 방지)', async () => {
  setup([{ id: 't1', title: '합격', content: '안녕하세요' }])
  render(<SmsSender {...props} />)
  await openDialog()
  await screen.findByRole('button', { name: '합격' })
  expect(screen.getByLabelText('문자 내용')).not.toHaveFocus()
})
