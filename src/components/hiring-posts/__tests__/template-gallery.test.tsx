import { act, fireEvent, render, screen } from '@testing-library/react'
import { TemplateGallery, createTemplateBlockStore, type TemplateRow } from '../template-gallery'

const mine: TemplateRow = {
  id: 'm1',
  name: '내 양식',
  blockCount: 1,
  updatedAt: '2026-09-27',
  isSample: false,
}
const prov: TemplateRow = {
  id: 's1',
  name: '제공 양식',
  blockCount: 2,
  updatedAt: '2026-09-01',
  isSample: true,
}
const block = {
  id: 'b',
  contentType: 'text',
  title: null,
  data: null,
  imagePath: null,
  sortOrder: 0,
}

function mockFetch() {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ contents: [block] }),
  })) as jest.Mock
}
function renderGallery(templates: TemplateRow[], onSelect = jest.fn()) {
  const store = createTemplateBlockStore()
  render(<TemplateGallery templates={templates} store={store} onSelect={onSelect} />)
  return { store, onSelect }
}

let observers: Array<{ cb: IntersectionObserverCallback; el: Element }> = []
beforeEach(() => {
  observers = []
  mockFetch()
})
afterEach(() => {
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
})

it('내 템플릿이 있으면 내 템플릿 탭이 기본이고 개수를 보여준다', () => {
  renderGallery([mine, prov])
  expect(screen.getByRole('tab', { name: '내 템플릿 1' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tab', { name: '워크덱 제공 1' })).toBeInTheDocument()
  expect(screen.getByText('내 양식')).toBeInTheDocument()
  expect(screen.queryByText('제공 양식')).not.toBeInTheDocument()
})

it('내 템플릿이 없으면 워크덱 제공 탭이 기본이다', () => {
  renderGallery([prov])
  expect(screen.getByRole('tab', { name: '워크덱 제공 1' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(screen.getByText('워크덱 제공', { selector: '[data-slot=badge]' })).toBeInTheDocument()
})

it('내 템플릿 탭 빈 상태 안내와 워크덱 제공 이동 버튼', async () => {
  renderGallery([prov])
  await act(async () => {
    fireEvent.mouseDown(screen.getByRole('tab', { name: '내 템플릿 0' }), { button: 0 })
  })
  expect(
    screen.getByText(
      '아직 저장한 템플릿이 없습니다. 공고 꾸미기에서 ‘템플릿으로 저장’하면 여기에 모입니다.'
    )
  ).toBeInTheDocument()
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: '워크덱 제공 템플릿 보기' }))
  )
  expect(screen.getByText('제공 양식')).toBeInTheDocument()
})

it('카드를 누르면 onSelect 를 호출한다', () => {
  const { onSelect } = renderGallery([mine])
  fireEvent.click(screen.getByRole('button', { name: '내 양식' }))
  expect(onSelect).toHaveBeenCalledWith(mine)
})

it('화면에 보일 때만 불러오고 같은 템플릿은 캐시를 재사용한다', async () => {
  class IO {
    cb: IntersectionObserverCallback
    constructor(cb: IntersectionObserverCallback) {
      this.cb = cb
    }
    observe(el: Element) {
      observers.push({ cb: this.cb, el })
    }
    disconnect() {}
    unobserve() {}
  }
  ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = IO
  const { store } = renderGallery([mine])
  expect(fetch).not.toHaveBeenCalled()
  await act(async () => {
    observers[0].cb(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    )
  })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledWith('/api/hiring-posts/templates/m1')
  await store.load('m1')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('동시 요청은 4개로 제한하고 실패는 캐시하지 않는다', async () => {
  const resolvers: Array<() => void> = []
  global.fetch = jest.fn(
    () =>
      new Promise((resolve) => {
        resolvers.push(() => resolve({ ok: true, json: async () => ({ contents: [] }) }))
      })
  ) as jest.Mock
  const store = createTemplateBlockStore()
  const all = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => store.load(id))
  expect(fetch).toHaveBeenCalledTimes(4)
  await act(async () => {
    resolvers[0]()
    await all[0]
  })
  expect(fetch).toHaveBeenCalledTimes(5)

  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ contents: [] }),
    })
  const s2 = createTemplateBlockStore()
  await expect(s2.load('x')).rejects.toThrow()
  await expect(s2.load('x')).resolves.toEqual([])
})
