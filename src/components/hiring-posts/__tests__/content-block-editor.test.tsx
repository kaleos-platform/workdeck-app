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

function Form({
  appliedTemplate = null,
}: {
  appliedTemplate?: { id: string | null; name: string; at: string | null } | null
}) {
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
      appliedTemplate={appliedTemplate}
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

it.each(['sample', 'missing', 'network'])(
  '%s 템플릿은 덮어쓰기 없이 새 템플릿으로 저장한다',
  async (kind) => {
    global.fetch = jest.fn().mockImplementation(async (_url, options) => {
      if (options?.method === 'POST')
        return { ok: true, json: async () => ({ template: { id: 'new-template' } }) }
      if (kind === 'network') throw Error('network')
      return {
        ok: kind !== 'missing',
        json: async () => ({ templates: [{ id: 'applied', isSample: true }] }),
      }
    })
    render(<Form appliedTemplate={{ id: 'applied', name: 'QA 샘플', at: null }} />)
    fireEvent.click(screen.getByRole('button', { name: '템플릿으로 저장' }))
    await screen.findByRole('dialog', { name: '템플릿으로 저장' })
    expect(screen.queryByRole('radio', { name: /기존 템플릿 덮어쓰기/ })).not.toBeInTheDocument()
    expect(
      screen.getByText(
        kind === 'sample'
          ? '샘플 템플릿은 읽기 전용입니다. 새 템플릿으로 저장해 사용하세요.'
          : '기존 템플릿을 확인할 수 없습니다. 현재 공고를 새 템플릿으로 저장할 수 있습니다.'
      )
    ).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('템플릿 이름'), { target: { value: 'QA 새 템플릿' } })
    fireEvent.click(screen.getByRole('button', { name: /^저장$/ }))
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/hiring-posts/templates',
        expect.objectContaining({ method: 'POST' })
      )
    )
    const request = (fetch as jest.Mock).mock.calls.find(
      ([, options]) => options?.method === 'POST'
    )
    expect(JSON.parse(request[1].body)).toEqual({ name: 'QA 새 템플릿', postingId: 'qa' })
  }
)
it('현재 고객 소유 템플릿은 확인 후 덮어쓰기를 유지한다', async () => {
  global.fetch = jest
    .fn()
    .mockImplementation(async (_url, options) =>
      options?.method === 'POST'
        ? { ok: true, json: async () => ({ template: { id: 'applied' } }) }
        : { ok: true, json: async () => ({ templates: [{ id: 'applied', isSample: false }] }) }
    )
  render(<Form appliedTemplate={{ id: 'applied', name: 'QA 소유 템플릿', at: null }} />)
  fireEvent.click(screen.getByRole('button', { name: '템플릿으로 저장' }))
  expect(await screen.findByRole('radio', { name: /기존 템플릿 덮어쓰기/ })).toBeChecked()
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/hiring-posts/templates',
      expect.objectContaining({ cache: 'no-store' })
    )
  )
  fireEvent.click(screen.getByRole('button', { name: /^저장$/ }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/hiring-posts/templates',
      expect.objectContaining({ method: 'POST' })
    )
  )
  const request = (fetch as jest.Mock).mock.calls.find(([, options]) => options?.method === 'POST')
  expect(JSON.parse(request[1].body)).toMatchObject({ templateId: 'applied' })
})

it('템플릿 조회가 응답하지 않아도 5초 후 새 저장을 제공한다', async () => {
  global.fetch = jest.fn(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('timeout')), {
          once: true,
        })
      })
  ) as jest.Mock
  render(<Form appliedTemplate={{ id: 'applied', name: 'QA 지연 템플릿', at: null }} />)
  fireEvent.click(screen.getByRole('button', { name: '템플릿으로 저장' }))
  expect(fetch).toHaveBeenCalledWith(
    '/api/hiring-posts/templates',
    expect.objectContaining({ signal: expect.any(AbortSignal), cache: 'no-store' })
  )
  await screen.findByText(
    '기존 템플릿을 확인할 수 없습니다. 현재 공고를 새 템플릿으로 저장할 수 있습니다.',
    {},
    { timeout: 7000 }
  )
  expect(screen.queryByRole('radio', { name: /기존 템플릿 덮어쓰기/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^저장$/ })).toBeEnabled()
}, 10000)
