import { useImperativeHandle, type Ref } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { BuildWizard } from '../build-wizard'
import type { WizardData } from '../build-types'
const flush = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
jest.mock('../content-block-editor', () => ({
  ContentBlockEditor: ({ ref }: { ref: Ref<unknown> }) => {
    useImperativeHandle(ref, () => ({ flush }))
    return <div>카드</div>
  },
}))
jest.mock('../step-basic', () => ({ StepBasic: () => null }))
jest.mock('../step-positions', () => ({ StepPositions: () => null }))
jest.mock('../step-stores', () => ({ StepStores: () => null }))
jest.mock('../posting-preview', () => ({ PostingPreview: () => null }))
const data = {
  posting: {
    id: 'qa',
    uuid: 'qa',
    title: 'QA',
    status: 'DRAFT',
    closingDate: null,
    notificationEnabled: false,
    positions: [{ id: 'position' }],
    storeIds: [],
    contents: [],
    formFields: [{ key: 'name' }, { key: 'phone' }],
    appliedTemplateId: null,
    appliedTemplateName: null,
    appliedTemplateAt: null,
  },
  spaceStores: [],
  spacePositions: [],
} as unknown as WizardData
beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ posting: { status: 'ACTIVE' } }) })
})

it('발행 요청은 저장 성공 후 한 번만 전송한다', async () => {
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
  fireEvent.click(screen.getByRole('button', { name: '공고 등록' }))
  expect(fetch).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '공고 등록' })).toBeDisabled()
  await act(async () => {
    finish()
  })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body)).toEqual({ action: 'publish' })
})

it('저장 실패 시 발행 요청을 보내지 않고 다시 발행할 수 있다', async () => {
  flush.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  render(<BuildWizard data={data} />)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /공고 꾸미기/ }))
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '공고 등록' }))
  })
  expect(fetch).not.toHaveBeenCalled()
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '공고 등록' }))
  })
  expect(fetch).toHaveBeenCalledTimes(1)
})
