import { createRef, useState } from 'react'
import { exportToBlob } from '@excalidraw/excalidraw'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ContentBlockEditor } from '../content-block-editor'
import type { WizardContentData } from '../build-types'
import { DesignBlock } from '../block-editors'
import { ExcalidrawCanvas } from '../excalidraw-canvas'
import type { SaveHandle } from '../use-queued-save'

let mockElements = [{ id: 'shape', type: 'rectangle', x: 0, version: 1 }]
let mockChange: (elements: unknown[], state: object) => void
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('../posting-preview', () => ({ ContentBlockPreview: () => null }))
jest.mock('next/dynamic', () => () => jest.requireActual('../excalidraw-canvas').ExcalidrawCanvas)
jest.mock('@/components/sc/editor/editor', () => ({ Editor: () => null }))
jest.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: (props: { excalidrawAPI: (api: unknown) => void; onChange: typeof mockChange }) => {
    const React = jest.requireActual('react')
    React.useEffect(() => {
      props.excalidrawAPI({
        getSceneElements: () => mockElements,
        getAppState: () => ({}),
        getFiles: () => ({}),
      })
      props.onChange(mockElements, {})
      // 실제 편집기처럼 최초 마운트 때 API와 초기 scene을 전달한다.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    mockChange = props.onChange
    return <div data-testid="canvas" />
  },
  convertToExcalidrawElements: (elements: unknown[]) => elements,
  sceneCoordsToViewportCoords: () => ({ x: 0, y: 0 }),
  CaptureUpdateAction: {},
  exportToBlob: jest.fn(async () => new Blob(['image'], { type: 'image/png' })),
}))
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }))

beforeEach(() => {
  mockElements = [{ id: 'shape', type: 'rectangle', x: 0, version: 1 }]
})

function edit() {
  act(() => {
    mockElements = [{ ...mockElements[0], x: 20, version: 2 }]
    mockChange(mockElements, {})
  })
}

it('시점 이동은 경고하지 않고 실제 수정은 닫기 취소와 새로고침 경고로 보호한다', async () => {
  const ref = createRef<SaveHandle>()
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false)
  render(
    <ExcalidrawCanvas
      ref={ref}
      initialData={null}
      canvasHeight={800}
      saving={false}
      onSave={async () => {}}
    />
  )
  act(() => mockChange(mockElements, { scrollX: 100 }))
  await ref.current!.flush()
  expect(confirm).not.toHaveBeenCalled()
  edit()
  await expect(ref.current!.flush()).rejects.toThrow('카드저장')
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  confirm.mockReturnValue(true)
  await ref.current!.flush()
  confirm.mockRestore()
})

it('저장 실패는 미저장 상태를 유지하고 성공 응답 후에만 해제한다', async () => {
  const save = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  render(<ExcalidrawCanvas initialData={null} canvasHeight={800} saving={false} onSave={save} />)
  edit()
  fireEvent.click(screen.getByRole('button', { name: '카드저장' }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(screen.getByRole('button', { name: '카드저장' })).toBeEnabled())
  expect(screen.getByText('저장하지 않은 변경사항')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '카드저장' }))
  await waitFor(() => expect(screen.queryByText('저장하지 않은 변경사항')).not.toBeInTheDocument())
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
})

it('DesignBlock의 닫기 검증이 캔버스의 미저장 확인까지 전달된다', async () => {
  const ref = createRef<SaveHandle>()
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false)
  render(<DesignBlock ref={ref} scene={null} onSave={async () => {}} onLinkSave={async () => {}} />)
  edit()
  await act(async () => {
    await expect(ref.current!.flush()).rejects.toThrow('카드저장')
  })
  expect(confirm).toHaveBeenCalledTimes(1)
  confirm.mockRestore()
})

it('저장 요청 중 편집을 잠그고 닫기를 막는다', async () => {
  let finish!: () => void
  const save = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  const ref = createRef<SaveHandle>()
  render(
    <ExcalidrawCanvas
      ref={ref}
      initialData={null}
      canvasHeight={800}
      saving={false}
      onSave={save}
    />
  )
  edit()
  fireEvent.click(screen.getByRole('button', { name: '카드저장' }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  expect(screen.getByTestId('canvas').parentElement).toHaveAttribute('inert')
  await expect(ref.current!.flush()).rejects.toThrow('저장이 진행 중')
  await act(async () => finish())
  expect(screen.getByTestId('canvas').parentElement).not.toHaveAttribute('inert')
})

it('요소 삭제도 감지하고 실행 취소로 원래 디자인이 되면 경고를 해제한다', () => {
  render(
    <ExcalidrawCanvas
      initialData={null}
      canvasHeight={800}
      saving={false}
      onSave={async () => {}}
    />
  )
  act(() => mockChange([{ ...mockElements[0], isDeleted: true }], {}))
  expect(screen.getByText('저장하지 않은 변경사항')).toBeInTheDocument()
  act(() => mockChange([{ ...mockElements[0], version: 3, updated: 123, versionNonce: 2 }], {}))
  expect(screen.queryByText('저장하지 않은 변경사항')).not.toBeInTheDocument()
})

it('실제 카드 편집창은 링크를 먼저 저장해도 디자인 닫기 취소를 유지한다', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ content: {} }) })
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false)
  function Cards() {
    const [contents, setContents] = useState<WizardContentData[]>([
      {
        id: 'design',
        contentType: 'design',
        title: null,
        data: null,
        imagePath: null,
        sortOrder: 0,
      },
    ])
    return (
      <ContentBlockEditor
        postingId="qa"
        contents={contents}
        positions={[]}
        spacePositions={[]}
        onPositionsChange={() => {}}
        appliedTemplate={null}
        onChange={setContents}
      />
    )
  }
  render(<Cards />)
  fireEvent.click(screen.getByRole('button', { name: '편집' }))
  edit()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Close' })))
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  confirm.mockRestore()
})

it('이미지 변환 실패는 서버 저장을 호출하지 않고 미저장 상태를 유지한다', async () => {
  const save = jest.fn()
  jest.mocked(exportToBlob).mockRejectedValueOnce(new Error('export failed'))
  render(<ExcalidrawCanvas initialData={null} canvasHeight={800} saving={false} onSave={save} />)
  edit()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '카드저장' })))
  expect(save).not.toHaveBeenCalled()
  expect(screen.getByText('저장하지 않은 변경사항')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '카드저장' })).toBeEnabled()
})
