import { useRef, useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ContentBlockEditor } from '../content-block-editor'
import type { WizardContentData } from '../build-types'
import { BlockEditOverlay } from '../block-edit-overlay'
import type { SaveHandle } from '../use-queued-save'

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('../posting-preview', () => ({ ContentBlockPreview: () => null }))
jest.mock('next/dynamic', () => () => () => null)
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
jest.mock('@/components/sc/editor/editor', () => ({ Editor: () => null }))

function Form({ kind, save }: { kind: 'button' | 'image'; save: () => Promise<unknown> }) {
  const ref = useRef<SaveHandle>(null)
  const [open, setOpen] = useState(true)
  return (
    <BlockEditOverlay
      ref={ref}
      open={open}
      content={{
        id: 'qa',
        contentType: kind,
        title: null,
        data: null,
        imagePath: null,
        sortOrder: 0,
      }}
      postingId="qa"
      positions={[]}
      spacePositions={[]}
      onPositionsChange={() => {}}
      onClose={() => {
        void ref.current
          ?.flush()
          .then(() => setOpen(false))
          .catch(() => {})
      }}
      onTextChange={() => {}}
      onButtonSave={save}
      onImageLinkSave={save}
      onImageSelect={async () => {}}
      onDesignSave={async () => {}}
      onDesignLinkSave={save}
    />
  )
}

it('버튼 저장 실패 후 편집창과 마지막 제목을 유지하고 완료로 재시도한다', async () => {
  const save = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  render(<Form kind="button" save={save} />)
  fireEvent.change(screen.getByLabelText('버튼 제목'), { target: { value: '최신 버튼' } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '완료' }))
  })
  expect(save).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('버튼 제목')).toHaveValue('최신 버튼')
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '완료' }))
  })
  expect(save).toHaveBeenLastCalledWith('qa', expect.objectContaining({ title: '최신 버튼' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('잘못된 이미지 링크는 닫기를 막고 수정한 URL의 저장 응답까지 기다린다', async () => {
  let finish!: () => void
  const save = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  render(<Form kind="image" save={save} />)
  fireEvent.click(screen.getByRole('radio', { name: 'URL 직접 입력' }))
  fireEvent.change(screen.getByPlaceholderText('https://example.com'), {
    target: { value: 'invalid' },
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '완료' }))
  })
  expect(screen.getByPlaceholderText('https://example.com')).toHaveValue('invalid')
  expect(save).not.toHaveBeenCalled()
  fireEvent.change(screen.getByPlaceholderText('https://example.com'), {
    target: { value: 'https://example.com/qa' },
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '완료' }))
  })
  expect(save).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await act(async () => {
    finish()
  })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('편집기 외부에서 언마운트돼도 예약된 버튼 입력의 마지막 저장을 시도한다', async () => {
  const save = jest.fn().mockResolvedValue(undefined)
  const { unmount } = render(<Form kind="button" save={save} />)
  fireEvent.change(screen.getByLabelText('버튼 제목'), { target: { value: '이탈 전 제목' } })
  await act(async () => {
    unmount()
  })
  expect(save).toHaveBeenCalledWith('qa', expect.objectContaining({ title: '이탈 전 제목' }))
})

it('실제 카드 편집기의 완료는 버튼 PATCH 실패 시 열린 상태를 유지한다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValue({ ok: true, json: async () => ({ content: {} }) })
  function Cards() {
    const [contents, setContents] = useState<WizardContentData[]>([
      {
        id: 'button',
        contentType: 'button',
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
  fireEvent.change(screen.getByLabelText('버튼 제목'), { target: { value: '저장 확인 버튼' } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '완료' }))
  })
  expect(screen.getByLabelText('버튼 제목')).toHaveValue('저장 확인 버튼')
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '완료' }))
  })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(JSON.parse((fetch as jest.Mock).mock.calls[1][1].body).data.title).toBe('저장 확인 버튼')
})
