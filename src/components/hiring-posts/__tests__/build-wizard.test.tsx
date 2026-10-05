import { useImperativeHandle, type Ref } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { BuildWizard } from '../build-wizard'
import type { WizardData } from '../build-types'

const push = jest.fn()
const flush = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: jest.fn() }) }))
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }))
jest.mock('../content-block-editor', () => ({
  ContentBlockEditor: ({ ref }: { ref: Ref<unknown> }) => {
    useImperativeHandle(ref, () => ({ flush }))
    return <div>본문 편집</div>
  },
}))
jest.mock('../step-basic', () => ({ StepBasic: () => null }))
jest.mock('../step-positions', () => ({ StepPositions: () => null }))
jest.mock('../step-stores', () => ({ StepStores: () => null }))
jest.mock('../posting-preview', () => ({ PostingPreview: () => null }))

const data: WizardData = {
  posting: {
    id: 'qa',
    uuid: 'public',
    title: 'QA',
    status: 'DRAFT',
    closingDate: null,
    notificationEnabled: false,
    positions: [],
    storeIds: [],
    contents: [],
    formFields: [],
    appliedTemplateId: null,
    appliedTemplateName: null,
    appliedTemplateAt: null,
  },
  spaceStores: [],
  spacePositions: [],
}

beforeEach(() => {
  jest.clearAllMocks()
  flush.mockReset().mockResolvedValue(undefined)
})

it('완료는 본문 flush를 기다린 뒤 상세 화면으로 이동한다', async () => {
  let finish!: () => void
  flush.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  render(<BuildWizard data={data} />)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /공고 꾸미기/ }))
  })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(push).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '저장 중…' })).toBeDisabled()
  await act(async () => {
    finish()
  })
  expect(screen.queryByRole('button', { name: '공고 등록' })).not.toBeInTheDocument()
  expect(push).toHaveBeenCalledWith('/d/recruiting/postings/qa')
})

it('저장이 실패하면 이동하지 않고 완료 재시도가 가능하다', async () => {
  flush.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  render(<BuildWizard data={data} />)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /공고 꾸미기/ }))
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
  })
  expect(push).not.toHaveBeenCalled()
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
  })
  expect(push).toHaveBeenCalledWith('/d/recruiting/postings/qa')
})

it('기본 정보의 다음은 지원서 설정을 거치지 않고 공고 꾸미기로 이동한다', async () => {
  render(<BuildWizard data={data} />)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '다음' })))
  expect(screen.getByText('본문 편집')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '저장' })).toBeInTheDocument()
  expect(screen.queryByText('지원서 마감일')).not.toBeInTheDocument()
  expect(screen.getByText(/지원서 설정은 HTML 공고 작성과 별도로 관리합니다/)).toBeInTheDocument()
})

it('이전된 초안도 과거 발행 이력이 있으면 지원서를 읽기 전용으로 보여준다', async () => {
  render(
    <BuildWizard
      data={{ ...data, posting: { ...data.posting, publishedAt: '2023-11-15T00:00:00Z' } }}
    />
  )
  expect(
    screen.getByText(/최초 발행 후에는 모집 조건과 지원서 설정을 변경할 수 없습니다/)
  ).toBeInTheDocument()
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: '지원서 설정 (읽기 전용)' }))
  )
  expect(screen.queryByRole('button', { name: '항목 추가' })).not.toBeInTheDocument()
  expect(screen.getByText(/지원서 설정은 읽기 전용입니다/)).toBeInTheDocument()
})
