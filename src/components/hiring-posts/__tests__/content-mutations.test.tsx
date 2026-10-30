import { createRef, useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ContentBlockEditor, type ContentBlockEditorHandle } from '../content-block-editor'
import type { WizardContentData } from '../build-types'
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
jest.mock('../posting-preview', () => ({ ContentBlockPreview: () => null }))
jest.mock('../block-edit-overlay', () => ({
  BlockEditOverlay: ({
    open,
    onTextChange,
  }: {
    open: boolean
    onTextChange: (id: string, data: unknown) => void
  }) =>
    open ? (
      <button onClick={() => onTextChange('a', { text: '최신 본문' })}>본문 변경</button>
    ) : null,
}))
const editorRef = createRef<ContentBlockEditorHandle>()
function Form({ initialVersion }: { initialVersion?: string } = {}) {
  const [contents, setContents] = useState<WizardContentData[]>(
    ['a', 'b'].map((id, sortOrder) => ({
      id,
      sortOrder,
      title: null,
      contentType: 'text',
      data: null,
      imagePath: null,
      updatedAt: initialVersion,
    }))
  )
  return (
    <>
      <output data-testid="order">{contents.map((c) => c.id).join(',')}</output>
      <ContentBlockEditor
        ref={editorRef}
        postingId="qa"
        contents={contents}
        positions={[]}
        spacePositions={[]}
        onPositionsChange={() => {}}
        appliedTemplate={null}
        onChange={setContents}
      />
    </>
  )
}
it('정렬 응답 전 순서를 확정하지 않고 실패하면 기존 순서를 유지한다', async () => {
  let finish!: (value: unknown) => void
  global.fetch = jest.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  ) as jest.Mock
  render(<Form />)
  await act(async () => {
    fireEvent.click(screen.getAllByRole('button', { name: '카드 아래로 이동' })[0])
  })
  expect(screen.getByTestId('order')).toHaveTextContent('a,b')
  expect(fetch).toHaveBeenCalledTimes(1)
  await act(async () => {
    finish({ ok: false, json: async () => ({ message: 'offline' }) })
  })
  expect(screen.getByTestId('order')).toHaveTextContent('a,b')
})
it('템플릿 교체 전에 본문 저장을 기다리고 실패하면 교체 요청을 보내지 않는다', async () => {
  global.fetch = jest.fn(async (url) => {
    if (url === '/api/hiring-posts/templates')
      return {
        ok: true,
        json: async () => ({
          templates: [
            {
              id: 't',
              name: 'QA 템플릿',
              isSample: false,
              updatedAt: null,
              _count: { contents: 1 },
            },
          ],
        }),
      }
    if (url === '/api/hiring-posts/templates/t')
      return { ok: true, json: async () => ({ contents: [] }) }
    return { ok: false }
  }) as jest.Mock
  render(<Form />)
  fireEvent.click(screen.getAllByRole('button', { name: '편집' })[0])
  fireEvent.click(screen.getByText('본문 변경'))
  await act(async () => {
    fireEvent.click(screen.getByText('템플릿 불러오기'))
  })
  await act(async () => {
    fireEvent.click(screen.getByText('QA 템플릿'))
  })
  fireEvent.click(screen.getByRole('radio', { name: '기존 블록 교체' }))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '적용' }))
  })
  expect((fetch as jest.Mock).mock.calls.some(([url]) => String(url).endsWith('/contents/a'))).toBe(
    true
  )
  expect(
    (fetch as jest.Mock).mock.calls.some(([url]) => String(url).endsWith('/apply-template'))
  ).toBe(false)
  expect(screen.getByTestId('order')).toHaveTextContent('a,b')
})

it('진행 중인 정렬을 기다린 뒤 저장 완료를 반환하고 순서를 반영한다', async () => {
  let finish!: (value: unknown) => void
  global.fetch = jest.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  ) as jest.Mock
  render(<Form />)
  await act(async () => {
    fireEvent.click(screen.getAllByRole('button', { name: '카드 아래로 이동' })[0])
  })
  let flushed = false
  const pending = editorRef.current!.flush().then(() => {
    flushed = true
  })
  expect(flushed).toBe(false)
  await act(async () => {
    finish({ ok: true })
    await pending
  })
  expect(flushed).toBe(true)
  expect(screen.getByTestId('order')).toHaveTextContent('b,a')
  expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body)).toMatchObject({
    contentIds: ['b', 'a'],
  })
})

it('카드 제목 저장 실패 시 입력을 유지하고 완료 flush로 재시도한다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValue({ ok: true, json: async () => ({ content: {} }) })
  render(<Form />)
  fireEvent.click(screen.getAllByRole('button', { name: '제목 편집' })[0])
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '마지막 카드 제목' } })
  await act(async () => {
    fireEvent.blur(screen.getByRole('textbox'))
  })
  expect(screen.getByRole('textbox')).toHaveValue('마지막 카드 제목')
  await act(async () => {
    await editorRef.current!.flush()
  })
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.getByText('마지막 카드 제목')).toBeInTheDocument()
})

it('카드 순서를 바꾼 뒤 다음 편집에는 같은 정렬로 갱신된 버전을 전송한다', async () => {
  const initial = '2026-10-29T12:00:00.000Z'
  const updated = '2026-10-29T12:00:01.000Z'
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        versions: [
          { id: 'a', previousUpdatedAt: initial, updatedAt: updated },
          { id: 'b', previousUpdatedAt: initial, updatedAt: updated },
        ],
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: { updatedAt: '2026-10-29T12:00:02.000Z' } }),
    })
  render(<Form initialVersion={initial} />)
  await act(async () => {
    fireEvent.click(screen.getAllByRole('button', { name: '카드 아래로 이동' })[0])
    await editorRef.current!.flush()
  })
  fireEvent.click(screen.getAllByRole('button', { name: '편집' })[0])
  fireEvent.click(screen.getByText('본문 변경'))
  await act(async () => {
    await editorRef.current!.flush()
  })
  const body = JSON.parse((fetch as jest.Mock).mock.calls[1][1].body)
  expect(body.expectedUpdatedAt).toBe(updated)
})

it('다른 창에서 변경된 카드를 정렬한 경우 그 변경을 본 것으로 간주하지 않는다', async () => {
  const initial = '2026-10-29T12:00:00.000Z'
  const changedElsewhere = '2026-10-29T12:00:01.000Z'
  const afterReorder = '2026-10-29T12:00:02.000Z'
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        versions: [{ id: 'a', previousUpdatedAt: changedElsewhere, updatedAt: afterReorder }],
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: { updatedAt: '2026-10-29T12:00:03.000Z' } }),
    })
  render(<Form initialVersion={initial} />)
  await act(async () => {
    fireEvent.click(screen.getAllByRole('button', { name: '카드 아래로 이동' })[0])
    await editorRef.current!.flush()
  })
  fireEvent.click(screen.getAllByRole('button', { name: '편집' })[0])
  fireEvent.click(screen.getByText('본문 변경'))
  await act(async () => {
    await editorRef.current!.flush()
  })
  expect(JSON.parse((fetch as jest.Mock).mock.calls[1][1].body).expectedUpdatedAt).toBe(initial)
})
