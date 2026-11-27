import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { FeedbackDialog } from '../feedback-dialog'
import { compressImage } from '../compress-image'

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('../compress-image', () => ({ compressImage: jest.fn() }))

const reply = (status: number, body: unknown) => {
  global.fetch = jest.fn(async () => ({
    ok: status < 400,
    status,
    json: async () => body,
  })) as unknown as typeof fetch
}
const img = (name: string) => new File(['x'], name, { type: 'image/png' })
const setup = () => {
  const onOpenChange = jest.fn()
  render(<FeedbackDialog open onOpenChange={onOpenChange} />)
  return { onOpenChange }
}
const fill = async () => {
  await userEvent.click(screen.getByRole('radio', { name: '서비스 오류' }))
  await userEvent.type(screen.getByRole('textbox'), '버튼이 안 눌려요')
}
const send = () => userEvent.click(screen.getByRole('button', { name: '보내기' }))
const upload = (...files: File[]) =>
  userEvent.upload(document.querySelector('input[type=file]') as HTMLInputElement, files)

beforeEach(() => {
  jest.clearAllMocks()
  ;(compressImage as jest.Mock).mockImplementation(async () => new Blob(['x']))
  global.URL.createObjectURL = jest.fn(() => 'blob:x')
  global.URL.revokeObjectURL = jest.fn()
})

it('유형 미선택·본문 빈칸이면 보내기가 비활성이다', async () => {
  setup()
  const btn = screen.getByRole('button', { name: '보내기' })
  expect(btn).toBeDisabled()
  await userEvent.click(screen.getByRole('radio', { name: '문의' }))
  expect(btn).toBeDisabled()
  await userEvent.type(screen.getByRole('textbox'), '내용')
  expect(btn).toBeEnabled()
})

it('제출 중에는 버튼이 비활성이라 중복 전송되지 않는다', async () => {
  global.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch
  setup()
  await fill()
  await send()
  expect(screen.getByRole('button', { name: /보내는 중/ })).toBeDisabled()
  expect(global.fetch).toHaveBeenCalledTimes(1)
})

it('4번째 이미지는 추가할 수 없다', async () => {
  setup()
  await upload(img('1.png'), img('2.png'), img('3.png'), img('4.png'))
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: /이미지 제거/ })).toHaveLength(3)
  )
  expect(compressImage).toHaveBeenCalledTimes(3)
  expect(screen.getByRole('button', { name: '이미지 추가' })).toBeDisabled()
})

it('압축 후에도 1 MiB 를 넘으면 파일별 오류를 보이고 전송에서 뺀다', async () => {
  ;(compressImage as jest.Mock).mockImplementation(
    async () => new Blob([new Uint8Array(1_048_577)])
  )
  reply(201, { id: 'f1', attachmentsAccepted: true, attachmentReason: null })
  setup()
  await fill()
  await upload(img('big.png'))
  expect(await screen.findByText(/1MB를 넘어/)).toBeInTheDocument()
  await send()
  await waitFor(() => expect(global.fetch).toHaveBeenCalled())
  const fd = (global.fetch as jest.Mock).mock.calls[0][1].body as FormData
  expect(fd.getAll('files')).toHaveLength(0)
})

it('500 이면 입력을 유지하고 오류 문구를 보인다', async () => {
  reply(500, {})
  const { onOpenChange } = setup()
  await fill()
  await send()
  expect(
    await screen.findByText('의견을 보내지 못했어요. 잠시 후 다시 시도해 주세요.')
  ).toBeInTheDocument()
  expect(screen.getByRole('textbox')).toHaveValue('버튼이 안 눌려요')
  expect(onOpenChange).not.toHaveBeenCalled()
})

it('429 는 잠시 후 다시 보내 달라고 안내한다', async () => {
  reply(429, { message: '요청이 너무 잦습니다' })
  setup()
  await fill()
  await send()
  expect(await screen.findByText('잠시 후 다시 보내 주세요.')).toBeInTheDocument()
})

it('201 이면 토스트·닫힘·초기화하고 pagePath 를 보낸다', async () => {
  reply(201, { id: 'f1', attachmentsAccepted: true, attachmentReason: null })
  window.history.pushState({}, '', '/dashboard/x?q=1')
  const { onOpenChange } = setup()
  await fill()
  await send()
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  expect(toast.success).toHaveBeenCalledWith('의견이 접수됐어요. 확인 후 조치할게요.')
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
  expect(url).toBe('/api/feedback')
  const fd = init.body as FormData
  expect(fd.get('type')).toBe('BUG')
  expect(fd.get('pagePath')).toBe('/dashboard/x')
})

it('attachmentsAccepted:false 면 이미지 미저장 안내를 보인다', async () => {
  reply(201, { id: 'f1', attachmentsAccepted: false, attachmentReason: 'cap' })
  setup()
  await fill()
  await upload(img('a.png'))
  await screen.findByRole('button', { name: /이미지 제거/ })
  await send()
  expect(
    await screen.findByText(/의견은 접수됐지만 이미지는 저장되지 않았어요/)
  ).toBeInTheDocument()
})

it('이미지를 제거하면 미리보기 주소를 해제한다', async () => {
  setup()
  await upload(img('a.png'))
  await userEvent.click(await screen.findByRole('button', { name: /이미지 제거/ }))
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x')
})
