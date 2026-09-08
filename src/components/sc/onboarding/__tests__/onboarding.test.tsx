import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StepReview } from '../step-review'
import { StepGenerate } from '../step-generate'
import { StepResources } from '../step-resources'

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))

const draft = {
  brandProfile: { companyName: '제안 회사', customFields: [{ key: '근거', value: '브랜드 자료' }] },
  products: [
    {
      name: '제품',
      sourceUrl: 'https://example.com/product',
      customFields: [{ key: 'ESG 근거', value: '인증 원문' }],
    },
  ],
  personas: [{ name: 'ESG 담당자', customFields: [{ key: '과제', value: '공급망' }] }],
}
const response = (body: unknown) => ({ ok: true, json: async () => body })

afterEach(() => jest.restoreAllMocks())

test('여러 줄 URL을 각각 등록한다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(response({ resource: { id: 'a' } }))
    .mockResolvedValueOnce(response({ resource: { id: 'b' } }))
  const onResourcesChange = jest.fn()
  render(
    <StepResources
      resources={[]}
      onResourcesChange={onResourcesChange}
      logoUrl={null}
      onLogoChange={jest.fn()}
    />
  )
  fireEvent.change(screen.getByRole('textbox', { name: '홈페이지·네이버 블로그 URL' }), {
    target: { value: 'https://example.com\nhttps://blog.naver.com/example' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'URL 추가' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  expect(JSON.parse((fetch as jest.Mock).mock.calls[1][1].body).url).toBe(
    'https://blog.naver.com/example'
  )
  expect(onResourcesChange).toHaveBeenLastCalledWith([{ id: 'a' }, { id: 'b' }])
})

test('제품 선택 해제 후 Shift 범위 선택을 저장에 반영한다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValue(
      response({ savedProducts: 3, savedPersonas: 1, skippedProducts: 0, skippedPersonas: 0 })
    )
  render(
    <StepReview
      draft={{ ...draft, products: ['첫째', '둘째', '셋째', '넷째'].map((name) => ({ name })) }}
      initial={null}
    />
  )
  fireEvent.click(screen.getByRole('checkbox', { name: '제품 전체 선택' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '첫째 선택' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '셋째 선택' }), { shiftKey: true })
  fireEvent.click(screen.getByRole('button', { name: '선택 항목과 브랜드 저장' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  expect(
    JSON.parse((fetch as jest.Mock).mock.calls[0][1].body).products.map(
      (product: { name: string }) => product.name
    )
  ).toEqual(['첫째', '둘째', '셋째'])
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: '선택 항목과 브랜드 저장' })
    ).not.toBeInTheDocument()
  )
})

test('기존 브랜드와 제품·페르소나 상세 정보를 일괄 저장한다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValue(
      response({ savedProducts: 1, savedPersonas: 1, skippedProducts: 0, skippedPersonas: 0 })
    )
  render(
    <StepReview
      draft={draft}
      initial={{
        companyName: '기존 회사',
        shortDescription: '',
        toneOfVoice: [],
        customFields: [{ key: '기존', value: '보존' }],
      }}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: '선택 항목과 브랜드 저장' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  const body = JSON.parse((fetch as jest.Mock).mock.calls[0][1].body)
  expect(body.brandProfile.companyName).toBe('기존 회사')
  expect(body.brandProfile.customFields).toEqual([{ key: '기존', value: '보존' }])
  expect(body.products[0]).toMatchObject(draft.products[0])
  expect(body.personas[0]).toMatchObject(draft.personas[0])
  await waitFor(() => expect(screen.getByRole('textbox', { name: '회사명' })).toBeDisabled())
  expect(screen.getByRole('link', { name: '저장한 정보 수정' })).toHaveAttribute(
    'href',
    '/d/sales-content/settings'
  )
})

test('빈 보이스·톤 항목을 저장 요청에서 제거한다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValue(
      response({ savedProducts: 1, savedPersonas: 1, skippedProducts: 0, skippedPersonas: 0 })
    )
  render(<StepReview draft={draft} initial={null} />)
  fireEvent.change(screen.getByRole('textbox', { name: '보이스·톤 (쉼표로 구분, 최대 3개)' }), {
    target: { value: '  전문적 , ,' },
  })
  fireEvent.click(screen.getByRole('button', { name: '선택 항목과 브랜드 저장' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body).brandProfile.toneOfVoice).toEqual([
    '전문적',
  ])
})

test('저장한 브랜드를 다음 검토에서 기존 값으로 유지한다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValue(
      response({ savedProducts: 1, savedPersonas: 1, skippedProducts: 0, skippedPersonas: 0 })
    )
  const onSaved = jest.fn()
  const { rerender } = render(
    <StepReview key="first" draft={draft} initial={null} onSaved={onSaved} />
  )
  fireEvent.change(screen.getByRole('textbox', { name: '회사명' }), {
    target: { value: '저장한 최신 회사명' },
  })
  fireEvent.click(screen.getByRole('button', { name: '선택 항목과 브랜드 저장' }))
  await waitFor(() =>
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ companyName: '저장한 최신 회사명' })
    )
  )
  rerender(
    <StepReview
      key="next-analysis"
      draft={{ ...draft, brandProfile: { companyName: '새 AI 제안' } }}
      initial={onSaved.mock.calls[0][0]}
    />
  )
  expect(screen.getByRole('textbox', { name: '회사명' })).toHaveValue('저장한 최신 회사명')
})

test('상세 정보가 50개를 넘으면 삭제 없이 오류를 표시한다', async () => {
  global.fetch = jest.fn()
  render(
    <StepReview
      draft={draft}
      initial={{
        companyName: '회사',
        shortDescription: '',
        toneOfVoice: [],
        customFields: Array.from({ length: 51 }, (_, i) => ({ key: `근거${i}`, value: '보존' })),
      }}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: '선택 항목과 브랜드 저장' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('상세 정보는 항목별 최대 50개')
  expect(fetch).not.toHaveBeenCalled()
})

test('부분 분석 응답 다음 요청을 이어서 최종 초안을 전달한다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(response({ resources: [{ id: 'r', status: 'DONE' }] }))
    .mockResolvedValueOnce(response({ done: false, progress: { completed: 1, total: 2 } }))
    .mockResolvedValueOnce(response({ done: true, draft, draftStatus: 'READY' }))
  const onGenerated = jest.fn()
  render(
    <StepGenerate
      resources={[]}
      draft={null}
      draftStatus={null}
      audience="기업 ESG 담당자"
      onResourcesChange={jest.fn()}
      onGenerated={onGenerated}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: '자료 분석 시작·계속' }))
  await waitFor(() => expect(onGenerated).toHaveBeenCalledWith(draft))
  expect(fetch).toHaveBeenCalledTimes(3)
})

test('중지를 누르면 현재 수집 요청만 마치고 분석을 시작하지 않는다', async () => {
  let finish: (value: ReturnType<typeof response>) => void = () => {}
  const collecting = new Promise((resolve) => {
    finish = resolve
  })
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(response({ resources: [{ id: 'r', status: 'PENDING' }] }))
    .mockReturnValueOnce(collecting)
  const onGenerated = jest.fn()
  render(
    <StepGenerate
      resources={[]}
      draft={null}
      draftStatus={null}
      audience="기업 ESG 담당자"
      onResourcesChange={jest.fn()}
      onGenerated={onGenerated}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: '자료 분석 시작·계속' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  fireEvent.click(screen.getByRole('button', { name: '중지' }))
  await act(async () => {
    finish(response({ resources: [{ id: 'r', status: 'DONE' }], pending: 0 }))
  })
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('중지되었습니다'))
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(onGenerated).not.toHaveBeenCalled()
})

test('분석 설정 오류에 설정 링크를 표시한다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(response({ resources: [{ id: 'r', status: 'DONE' }] }))
    .mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: 'AI 설정 필요', settingsPath: '/settings/ai' }),
    })
  render(
    <StepGenerate
      resources={[]}
      draft={null}
      draftStatus={null}
      audience="기업 ESG 담당자"
      onResourcesChange={jest.fn()}
      onGenerated={jest.fn()}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: '자료 분석 시작·계속' }))
  expect(await screen.findByRole('link', { name: 'AI 설정 확인' })).toHaveAttribute(
    'href',
    '/settings/ai'
  )
})

test('수집 실패가 섞이면 검토 초안에 누락 가능성 경고를 전달한다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(
      response({
        resources: [
          { id: 'r', status: 'DONE' },
          { id: 'f', status: 'FAILED' },
        ],
      })
    )
    .mockResolvedValueOnce(response({ done: true, draft }))
  const onGenerated = jest.fn()
  render(
    <StepGenerate
      resources={[]}
      draft={null}
      draftStatus={null}
      audience="기업 ESG 담당자"
      onResourcesChange={jest.fn()}
      onGenerated={onGenerated}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: '자료 분석 시작·계속' }))
  await waitFor(() =>
    expect(onGenerated).toHaveBeenCalledWith(
      expect.objectContaining({
        warnings: expect.arrayContaining([expect.stringContaining('자료 1건 수집에 실패')]),
      })
    )
  )
})
