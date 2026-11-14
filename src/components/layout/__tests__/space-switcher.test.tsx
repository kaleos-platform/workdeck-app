import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import * as mod from '../space-switcher'

const assign = jest.fn()
beforeEach(() => {
  jest.resetAllMocks()
  // 전환 중 상태는 모듈 단위(사이드바·홈 공유)라 테스트마다 푼다.
  mod.resetSpaceSwitchForTest()
})

const two = [
  { id: 'sp-a', name: 'Space A', role: 'OWNER' as const },
  { id: 'sp-b', name: 'Space B', role: 'MEMBER' as const },
]
const postStatus = (status: number) => {
  global.fetch = jest.fn(async () => ({ ok: status < 400, status })) as unknown as typeof fetch
}

describe('SpaceSwitcher (사이드바)', () => {
  it('하나면 이름·권한만 보이고 전환 버튼이 없다', () => {
    const { SpaceSwitcher } = mod
    render(<SpaceSwitcher spaces={[two[0]]} currentSpaceId="sp-a" navigate={assign} />)
    expect(screen.getByText('Space A')).toBeInTheDocument()
    expect(screen.getByText('소유자')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /작업 공간 전환/ })).toBeNull()
  })

  it('목록이 없으면(레거시 계정) 아무것도 그리지 않는다', () => {
    const { SpaceSwitcher } = mod
    const { container } = render(
      <SpaceSwitcher spaces={[]} currentSpaceId={null} navigate={assign} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('여러 개면 메뉴에서 고르고 → POST 성공 후 /my-deck 로 이동', async () => {
    postStatus(204)
    const { SpaceSwitcher } = mod
    render(<SpaceSwitcher spaces={two} currentSpaceId="sp-a" navigate={assign} />)
    await userEvent.click(screen.getByRole('button', { name: /작업 공간 전환/ }))
    const current = await screen.findByRole('menuitemradio', { name: /Space A/ })
    expect(current).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Space B/ }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/my-deck'))
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/spaces/current',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ spaceId: 'sp-b' }) })
    )
  })

  it('접힘 상태는 아바타 버튼에 이름·권한을 접근 가능한 이름으로 준다', () => {
    const { SpaceSwitcher } = mod
    render(<SpaceSwitcher spaces={two} currentSpaceId="sp-a" collapsed navigate={assign} />)
    expect(
      screen.getByRole('button', { name: '작업 공간 전환 — 현재 Space A (소유자)' })
    ).toBeInTheDocument()
  })
})

describe('SpaceChips (내 워크덱 홈)', () => {
  it('현재 작업 공간은 선택 상태, 권한 설명을 글로 보여 준다', () => {
    const { SpaceChips } = mod
    render(<SpaceChips spaces={two} currentSpaceId="sp-a" navigate={assign} />)
    expect(screen.getByRole('button', { name: /Space A/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Space B/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText(/결제·구독/)).toBeInTheDocument()
  })

  it('다른 칩을 누르면 전환, 요청 중에는 모든 칩이 비활성', async () => {
    let resolve!: (v: unknown) => void
    global.fetch = jest.fn(() => new Promise((r) => (resolve = r))) as unknown as typeof fetch
    const { SpaceChips } = mod
    render(<SpaceChips spaces={two} currentSpaceId="sp-a" navigate={assign} />)
    await userEvent.click(screen.getByRole('button', { name: /Space B/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Space A/ })).toBeDisabled())
    await userEvent.click(screen.getByRole('button', { name: /Space B/ }))
    expect(global.fetch).toHaveBeenCalledTimes(1)
    resolve({ ok: true, status: 204 })
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/my-deck'))
  })

  it('실패(404)면 이동하지 않고 안내 후 다시 누를 수 있다', async () => {
    postStatus(404)
    const { SpaceChips } = mod
    render(<SpaceChips spaces={two} currentSpaceId="sp-a" navigate={assign} />)
    await userEvent.click(screen.getByRole('button', { name: /Space B/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('소속되어 있지 않습니다')
    expect(screen.getByRole('button', { name: /Space B/ })).toBeEnabled()
    expect(assign).not.toHaveBeenCalled()
  })

  it('네트워크 오류도 안내', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    const { SpaceChips } = mod
    render(<SpaceChips spaces={two} currentSpaceId="sp-a" navigate={assign} />)
    await userEvent.click(screen.getByRole('button', { name: /Space B/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('다시 시도')
  })
})
