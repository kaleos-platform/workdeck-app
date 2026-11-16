import { createRef } from 'react'
import type { SaveHandle } from '../use-queued-save'
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import type { ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types'
import { ExcalidrawCanvas } from '../excalidraw-canvas'
import { DesignBlock } from '../block-editors'
import { FONT_FAMILY } from '@excalidraw/excalidraw'

jest.mock('next/dynamic', () => () => jest.requireActual('../excalidraw-canvas').ExcalidrawCanvas)
jest.mock('@/components/sc/editor/editor', () => ({ Editor: () => null }))

let mockElements: Record<string, unknown>[] = []
jest.mock('@excalidraw/excalidraw', () => ({
  FONT_FAMILY: { Virgil: 1 },
  __workdeckFonts: {
    registered: new Map(),
    register: jest.fn(function (family, metadata, ...faces) {
      this.registered.set((FONT_FAMILY as Record<string, number>)[family], {
        metadata,
        fontFaces: faces.map(() => ({ fontFace: {} })),
      })
    }),
  },
  Excalidraw: (props: {
    initialData: { elements: Record<string, unknown>[] }
    excalidrawAPI: (api: unknown) => void
    onChange: (elements: unknown[], appState: object) => void
  }) => {
    const React = jest.requireActual('react')
    React.useEffect(() => {
      mockElements = props.initialData.elements
      props.excalidrawAPI({
        getSceneElements: () => mockElements,
        getAppState: () => ({}),
        getFiles: () => ({}),
        scrollToContent: jest.fn(),
      })
      props.onChange(mockElements, {})
      // 편집기 API와 초기 scene 전달은 실제 편집기처럼 최초 마운트에 한 번 수행한다.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return (
      <button
        data-testid="editor"
        onClick={() => {
          mockElements = mockElements.map((element) =>
            element.type === 'text' ? { ...element, fontFamily: 2 } : element
          )
          props.onChange(mockElements, {})
        }}
      >
        native font
      </button>
    )
  },
  convertToExcalidrawElements: (elements: unknown[]) => elements,
  sceneCoordsToViewportCoords: () => ({ x: 0, y: 0 }),
  CaptureUpdateAction: {},
  exportToBlob: jest.fn(async () => new Blob(['image'])),
}))
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }))
const legacy = {
  source: 'https://opening.work',
  elements: [
    {
      type: 'text',
      fontFamily: 1,
      fontWeight: 600,
      fontSize: 20,
      lineHeight: 1.4,
      x: 1,
      y: 2,
      width: 100,
      height: 28,
      baseline: 21,
      text: '채용 ABC',
    },
  ],
  files: {},
  appState: {},
}
function canvas(initialData: unknown, onSave = jest.fn(), onBusyChange = jest.fn()) {
  return (
    <ExcalidrawCanvas
      initialData={initialData as ExcalidrawInitialDataState}
      canvasHeight={800}
      saving={false}
      onSave={onSave}
      onBusyChange={onBusyChange}
    />
  )
}
function fonts(load: jest.Mock) {
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add: jest.fn(), load } })
}

it('글꼴 로드 실패는 편집기·저장을 차단하고 사용자 재시도 성공 후에만 편집기를 연다', async () => {
  const load = jest.fn().mockRejectedValueOnce(new Error('font offline')).mockResolvedValue([{}])
  fonts(load)
  const busy = jest.fn()
  render(canvas(legacy, jest.fn(), busy))
  expect(screen.queryByTestId('editor')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '카드저장' })).toBeDisabled()
  await screen.findByRole('alert')
  expect(screen.queryByTestId('editor')).not.toBeInTheDocument()
  expect(busy).toHaveBeenCalledWith(true)
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  await screen.findByTestId('editor')
  expect(mockElements.find((element) => element.type === 'text')!.fontFamily).toBe(11600)
  await waitFor(() => expect(screen.getByRole('button', { name: '카드저장' })).toBeEnabled())
})

it('native 폰트로 바꾸어 저장한 뒤 재편집해도 원본 번호로 재해석하지 않는다', async () => {
  fonts(jest.fn().mockResolvedValue([{}]))
  const save = jest.fn().mockResolvedValue(undefined)
  const view = render(canvas(legacy, save))
  fireEvent.click(await screen.findByTestId('editor'))
  fireEvent.click(screen.getByRole('button', { name: '카드저장' }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  const scene = save.mock.calls[0][0]
  expect(scene.source).toBeUndefined()
  expect(
    scene.elements.find((element: Record<string, unknown>) => element.type === 'text').fontFamily
  ).toBe(2)
  view.unmount()
  render(canvas(scene))
  expect(screen.getByTestId('editor')).toBeInTheDocument()
  expect(mockElements.find((element) => element.type === 'text')!.fontFamily).toBe(2)
})

it('저장 직전 실제 scene 글꼴 로드가 실패하면 서버 저장을 호출하지 않는다', async () => {
  fonts(jest.fn().mockResolvedValueOnce([{}]).mockRejectedValue(new Error('save offline')))
  const save = jest.fn()
  render(canvas(legacy, save))
  await screen.findByTestId('editor')
  fireEvent.click(screen.getByRole('button', { name: '카드저장' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '카드저장' })).toBeEnabled())
  expect(save).not.toHaveBeenCalled()
})

it('이전 입력의 지연된 로드는 새 입력의 편집기를 열지 않는다', async () => {
  let finish!: (faces: object[]) => void
  fonts(
    jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      .mockRejectedValue(new Error('new offline'))
  )
  const view = render(canvas(legacy))
  view.rerender(canvas({ ...legacy, elements: [{ ...legacy.elements[0], text: '새 공고' }] }))
  await screen.findByRole('alert')
  await act(async () => finish([{}]))
  expect(screen.queryByTestId('editor')).not.toBeInTheDocument()
})

it('글꼴 로드 실패 상태에서도 수정사항이 없으면 편집창을 닫을 수 있다', async () => {
  fonts(jest.fn().mockRejectedValue(new Error('font offline')))
  const ref = createRef<SaveHandle>()
  const busy = jest.fn()
  render(
    <ExcalidrawCanvas
      ref={ref}
      initialData={legacy as unknown as ExcalidrawInitialDataState}
      canvasHeight={800}
      saving={false}
      onSave={jest.fn()}
      onBusyChange={busy}
    />
  )
  await screen.findByRole('alert')
  await expect(ref.current!.flush()).resolves.toBeUndefined()
  expect(busy).toHaveBeenLastCalledWith(false)
})

it('실제 DesignBlock 경로에서도 원본 source를 전달해 글꼴을 변환한다', async () => {
  const load = jest.fn().mockResolvedValue([{}])
  fonts(load)
  render(<DesignBlock scene={legacy} onSave={jest.fn()} onLinkSave={jest.fn()} />)
  await screen.findByTestId('editor')
  expect(load).toHaveBeenCalledWith('600 16px "Pretendard-600"', '채용 ABC')
  expect(mockElements.find((element) => element.type === 'text')!.fontFamily).toBe(11600)
})
