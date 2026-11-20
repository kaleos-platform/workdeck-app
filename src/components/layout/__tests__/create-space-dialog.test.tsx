import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateSpaceDialog } from '../create-space-dialog'

const reply = (status: number, body: unknown) => {
  global.fetch = jest.fn(async () => ({
    ok: status < 400,
    status,
    json: async () => body,
  })) as unknown as typeof fetch
}
const setup = () => {
  const onCreated = jest.fn()
  const onOpenChange = jest.fn()
  render(<CreateSpaceDialog open onOpenChange={onOpenChange} onCreated={onCreated} />)
  return { onCreated, onOpenChange }
}
const submit = async (name: string) => {
  await userEvent.type(screen.getByPlaceholderText('예: 대성산업'), name)
  await userEvent.click(screen.getByRole('button', { name: '만들기' }))
}

it('안내 3줄과 60자 제한이 보인다', () => {
  setup()
  expect(screen.getByText('· 만든 사람이 소유자가 됩니다.')).toBeInTheDocument()
  expect(screen.getByText('· 구독·결제는 작업 공간마다 따로입니다.')).toBeInTheDocument()
  expect(screen.getByPlaceholderText('예: 대성산업')).toHaveAttribute('maxlength', '60')
})

it('이름이 비면 만들기가 비활성이다', () => {
  setup()
  expect(screen.getByRole('button', { name: '만들기' })).toBeDisabled()
})

it('201 이면 새 공간 id 로 onCreated 를 부른다', async () => {
  reply(201, { space: { id: 'sp-new', name: '대성산업' } })
  const { onCreated } = setup()
  await submit('대성산업')
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith('sp-new'))
  expect(global.fetch).toHaveBeenCalledWith(
    '/api/spaces',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: '대성산업' }) })
  )
})

it('409 같은 이름이면 입력란 아래 오류, 전환하지 않는다', async () => {
  reply(409, { spaceId: 'sp-old' })
  const { onCreated } = setup()
  await submit('대성산업')
  expect(await screen.findByText('이미 같은 이름의 작업 공간이 있습니다')).toBeInTheDocument()
  expect(onCreated).not.toHaveBeenCalled()
})

it('409 SPACE_LIMIT 이면 한도 안내', async () => {
  reply(409, { code: 'SPACE_LIMIT' })
  setup()
  await submit('a')
  expect(
    await screen.findByText('소유한 작업 공간은 5개까지입니다. 더 필요하면 문의해 주세요.')
  ).toBeInTheDocument()
})

it('그 밖의 오류는 일반 문구', async () => {
  reply(500, {})
  setup()
  await submit('a')
  expect(await screen.findByText(/작업 공간을 만들지 못했습니다/)).toBeInTheDocument()
})
