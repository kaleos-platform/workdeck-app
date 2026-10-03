import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ContentBlockEditor } from '../content-block-editor'
import type { WizardContentData } from '../build-types'

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
jest.mock('../posting-preview', () => ({ ContentBlockPreview: () => null }))
jest.mock('../block-editors', () => ({
  CONTENT_TYPE_META: { text: { label: '텍스트', icon: () => null } },
}))
jest.mock('../block-edit-overlay', () => ({
  BlockEditOverlay: ({
    open,
    onClose,
    onTextChange,
    onDesignSave,
    onImageSelect,
  }: {
    open: boolean
    onClose: () => void
    onTextChange: (id: string, doc: unknown) => void
    onDesignSave: (id: string, scene: { elements: never[] }, image: string) => Promise<void>
    onImageSelect: (id: string, file: File) => Promise<void>
  }) =>
    open ? (
      <div data-testid="text-editor">
        <button onClick={() => onTextChange('text', { text: '최신 본문' })}>본문 변경</button>
        <button
          onClick={() => {
            void onDesignSave('text', { elements: [] }, 'data:image/png;base64,QA').catch(() => {})
          }}
        >
          디자인 저장
        </button>
        <button
          onClick={() => {
            void onImageSelect('text', new File(['QA'], 'qa.png', { type: 'image/png' })).catch(
              () => {}
            )
          }}
        >
          이미지 저장
        </button>
        <button onClick={onClose}>편집 완료</button>
      </div>
    ) : null,
}))

function Form() {
  const [contents, setContents] = useState<WizardContentData[]>([
    { id: 'text', contentType: 'text', title: null, data: null, imagePath: null, sortOrder: 0 },
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

it('편집 완료는 본문 저장 응답이 끝날 때까지 편집기를 유지한다', async () => {
  let finish!: (value: unknown) => void
  global.fetch = jest.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  ) as jest.Mock
  render(<Form />)
  fireEvent.click(screen.getByRole('button', { name: '편집' }))
  fireEvent.click(screen.getByRole('button', { name: '본문 변경' }))
  fireEvent.click(screen.getByRole('button', { name: '편집 완료' }))
  expect(screen.getByTestId('text-editor')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(1)
  await act(async () => {
    finish({ ok: true, json: async () => ({ content: {} }) })
  })
  await waitFor(() => expect(screen.queryByTestId('text-editor')).not.toBeInTheDocument())
})

it('저장 실패 시 편집기를 유지하고 완료 재시도로 최신 본문을 저장한다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValue({ ok: true, json: async () => ({ content: {} }) })
  render(<Form />)
  fireEvent.click(screen.getByRole('button', { name: '편집' }))
  fireEvent.click(screen.getByRole('button', { name: '본문 변경' }))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '편집 완료' }))
  })
  expect(screen.getByTestId('text-editor')).toBeInTheDocument()
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '편집 완료' }))
  })
  await waitFor(() => expect(screen.queryByTestId('text-editor')).not.toBeInTheDocument())
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(JSON.parse((fetch as jest.Mock).mock.calls[1][1].body)).toEqual({
    data: { text: '최신 본문' },
  })
})

it('템플릿 생성은 진행 중인 본문 PATCH가 성공한 뒤 실행한다', async () => {
  let finish!: (value: unknown) => void
  global.fetch = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    .mockResolvedValue({ ok: true, json: async () => ({ template: { id: 'template' } }) })
  render(<Form />)
  fireEvent.click(screen.getByRole('button', { name: '편집' }))
  fireEvent.click(screen.getByRole('button', { name: '본문 변경' }))
  fireEvent.click(screen.getByRole('button', { name: '템플릿으로 저장' }))
  fireEvent.change(screen.getByLabelText('템플릿 이름'), { target: { value: 'QA 템플릿' } })
  fireEvent.click(screen.getByRole('button', { name: /^저장$/ }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  await act(async () => {
    finish({ ok: true, json: async () => ({ content: {} }) })
  })
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  expect((fetch as jest.Mock).mock.calls[1][0]).toBe('/api/hiring-posts/templates')
})

it('본문 저장이 실패하면 템플릿 생성 요청을 보내지 않는다', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false })
  render(<Form />)
  fireEvent.click(screen.getByRole('button', { name: '편집' }))
  fireEvent.click(screen.getByRole('button', { name: '본문 변경' }))
  fireEvent.click(screen.getByRole('button', { name: '템플릿으로 저장' }))
  fireEvent.change(screen.getByLabelText('템플릿 이름'), { target: { value: 'QA 실패 템플릿' } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^저장$/ }))
  })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect((fetch as jest.Mock).mock.calls[0][0]).toContain('/contents/text')
  expect(screen.getByLabelText('템플릿 이름')).toHaveValue('QA 실패 템플릿')
})

it('디자인 저장 실패 후 편집기를 유지하고 카드 저장 재시도 성공 후 닫는다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValue({ ok: true, json: async () => ({ content: { imagePath: 'qa.png' } }) })
  render(<Form />)
  fireEvent.click(screen.getByRole('button', { name: '편집' }))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '디자인 저장' }))
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '편집 완료' }))
  })
  expect(screen.getByTestId('text-editor')).toBeInTheDocument()
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '디자인 저장' }))
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '편집 완료' }))
  })
  expect(screen.queryByTestId('text-editor')).not.toBeInTheDocument()
})

it('이미지 업로드 응답을 기다린 후 편집기를 닫는다', async () => {
  let finish!: (value: unknown) => void
  global.fetch = jest.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  ) as jest.Mock
  render(<Form />)
  fireEvent.click(screen.getByRole('button', { name: '편집' }))
  fireEvent.click(screen.getByRole('button', { name: '이미지 저장' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '편집 완료' }))
  })
  expect(screen.getByTestId('text-editor')).toBeInTheDocument()
  await act(async () => {
    finish({ ok: true, json: async () => ({ content: { imagePath: 'qa.png' } }) })
  })
  await waitFor(() => expect(screen.queryByTestId('text-editor')).not.toBeInTheDocument())
})
