import { createRef } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { StepForm, type StepFormHandle } from '../step-form'
import { ApplicationFormPreview } from '../application-form-preview'
import { ApplyForm } from '@/components/hiring-public/apply-form'

jest.mock('sonner', () => ({ toast: { error: jest.fn(), info: jest.fn() } }))
const fields = [
  {
    key: 'custom_n',
    type: 'number' as const,
    label: '경력',
    required: false,
    placeholder: '0',
    description: '년 단위',
    errorMessage: '세 자리 이내로 입력하세요',
    minLength: 1,
    maxLength: 3,
  },
  { key: 'custom_d', type: 'date' as const, label: '시작일', required: true },
  {
    key: 'custom_f',
    type: 'file' as const,
    label: '자료',
    required: false,
    maxFileCount: 2,
    maxFileSize: 1024,
  },
]
it('다른 항목을 편집해도 날짜·숫자와 설명 속성을 저장한다', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
  const ref = createRef<StepFormHandle>()
  render(<StepForm ref={ref} postingId="qa" initialFields={fields} onChange={() => {}} />)
  fireEvent.change(screen.getByDisplayValue('경력'), { target: { value: '경력 연수' } })
  await act(async () => {
    await ref.current?.flush()
  })
  const body = JSON.parse((fetch as jest.Mock).mock.calls.at(-1)[1].body)
  expect(body.fields).toEqual(
    expect.arrayContaining([{ ...fields[0], label: '경력 연수' }, fields[1], fields[2]])
  )
})
it('공개 화면과 미리보기는 날짜·숫자 입력과 설명을 표시한다', () => {
  const { unmount } = render(
    <ApplyForm postingUuid="qa" fields={fields} positions={[]} stores={[]} preview />
  )
  expect(screen.getByLabelText('경력')).toHaveAttribute('type', 'number')
  expect(screen.getByLabelText('시작일', { exact: false })).toHaveAttribute('type', 'date')
  expect(screen.getByText('년 단위')).toBeInTheDocument()
  unmount()
  render(<ApplicationFormPreview title="QA" closingDate="" fields={fields} />)
  expect(screen.getByLabelText('경력')).toHaveAttribute('type', 'number')
  expect(screen.getByLabelText('시작일')).toHaveAttribute('type', 'date')
})

it('공개 폼은 초과 입력을 자르지 않고 오류와 원문을 유지한다', async () => {
  const { container } = render(
    <ApplyForm
      postingUuid="qa"
      fields={[
        {
          key: 'intro',
          type: 'text',
          label: '소개',
          required: false,
          minLength: 2,
          maxLength: 3,
          errorMessage: '세 글자 이내로 입력하세요',
        },
      ]}
      positions={[]}
      stores={[]}
    />
  )
  fireEvent.change(screen.getByLabelText('소개'), { target: { value: '1234' } })
  await act(async () => fireEvent.submit(container.querySelector('form')!))
  expect(screen.getByLabelText('소개')).toHaveValue('1234')
  expect(screen.getByText('세 글자 이내로 입력하세요')).toBeInTheDocument()
})

it('파일 항목을 문자열로 바꾸면 호환되지 않는 제한을 제거한 값으로 저장한다', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
  const ref = createRef<StepFormHandle>()
  render(<StepForm ref={ref} postingId="qa" initialFields={[fields[2]]} onChange={() => {}} />)
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('option', { name: '한 줄 입력' }))
  await act(async () => {
    await ref.current?.flush()
  })
  const saved = JSON.parse((fetch as jest.Mock).mock.calls.at(-1)[1].body).fields.find(
    (f: { key: string }) => f.key === 'custom_f'
  )
  expect(saved.type).toBe('string')
  expect(saved).not.toHaveProperty('maxFileCount')
  expect(saved).not.toHaveProperty('maxFileSize')
})
