import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ReorderPlanCreate } from '../reorder-plan-create'

const push = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
// 상품 선택 팝업 — 버튼 한 번으로 p1 을 고른다
jest.mock('@/components/sh/products/listings/option-picker-dialog', () => ({
  OptionPickerDialog: ({
    open,
    onPickProduct,
  }: {
    open: boolean
    onPickProduct: (id: string, opts: { productName: string; brandName: string | null }[]) => void
  }) =>
    open ? (
      <button
        onClick={() => onPickProduct('p1', [{ productName: '테스트 상품', brandName: null }])}
      >
        pick
      </button>
    ) : null,
}))

const models = (base: number) => ({
  MA30: { dailyRate: base, qty: 10 },
  MA90: { dailyRate: base * 2, qty: 20 },
  MA_BLEND: { dailyRate: base * 3, qty: 30 },
  SES_TREND: { dailyRate: base * 4, qty: 40 },
  CROSTON: { dailyRate: base * 5, qty: 50 },
})

const option = (over: Record<string, unknown>) => ({
  productId: 'p1',
  sku: null,
  productName: '테스트 상품',
  costPrice: null,
  currentStock: 5,
  onHandStock: 5,
  incomingQty: 0,
  safetyStockQty: 0,
  dailyAvgForecast: 1,
  leadTimeDays: 20,
  analysisWindowDays: 90,
  suggestedQty: 30,
  roundedSuggestedQty: 30,
  rocketBaselineQty: null,
  directGrossQty: null,
  linkedLocationExpectedSalesQty: null,
  linkedLocationSafetyStockQty: null,
  linkedLocationNeedQty: null,
  linkedLocationCurrentStockQty: null,
  linkedLocationIncomingQty: null,
  finalQty: 30,
  models: models(1),
  backtestWape: { MA30: 0.2, MA90: 0.15, MA_BLEND: 0.123, SES_TREND: null, CROSTON: 0.4 },
  recommendedModel: 'MA_BLEND',
  selectedModel: 'MA_BLEND',
  targetCoverDays: 30,
  checkStock: false,
  isNewOption: false,
  siblingAvgRate: 2.5,
  ...over,
})

const preview = {
  isLayered: false,
  qualifies: false,
  locationName: null,
  sets: [],
  options: [
    option({ optionId: 'o1', optionName: '블랙', onHandStock: -3, checkStock: true }),
    option({
      optionId: 'o2',
      optionName: '화이트',
      isNewOption: true,
      selectedModel: 'MANUAL',
      finalQty: 0,
    }),
  ],
}

let fetchMock: jest.Mock

beforeEach(() => {
  push.mockReset()
  fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    const json = (body: unknown) => ({ ok: true, json: async () => body })
    if (url.startsWith('/api/sh/inventory/locations')) return json({ locations: [] })
    if (url.startsWith('/api/sh/inventory/reorder/config/'))
      return json({ targetCoverDays: 30, excludeFromForecast: false })
    if (url === '/api/sh/inventory/reorder/plan') {
      const body = JSON.parse(String(init?.body))
      return json(body.dryRun ? preview : { planId: 'plan1' })
    }
    throw new Error(`unexpected fetch ${url}`)
  })
  global.fetch = fetchMock as unknown as typeof fetch
})

const planBodies = () =>
  fetchMock.mock.calls
    .filter(([url]) => url === '/api/sh/inventory/reorder/plan')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)))

async function gotoCalcStep() {
  render(<ReorderPlanCreate />)
  fireEvent.click(screen.getByText('pick'))
  await waitFor(() => expect(planBodies()).toHaveLength(1))
  fireEvent.click(await screen.findByRole('button', { name: /다음 · 자체 출고 확인/ }))
  fireEvent.click(await screen.findByRole('button', { name: /다음 · 수량 계산/ }))
  await screen.findByText('예측 모델')
}

describe('발주 위저드 Step ④ — 모델 비교·신상품·재고 확인', () => {
  it('추천 배지·오차(%)·재고 확인 필요·신상품 참고 문구를 표시한다', async () => {
    await gotoCalcStep()
    const blendRow = screen.getByText('혼합 이동평균').closest('tr')!
    expect(within(blendRow).getByText('추천')).toBeInTheDocument()
    expect(within(blendRow).getByText('12.3%')).toBeInTheDocument()
    const sesRow = screen.getByText('지수평활+추세').closest('tr')!
    expect(within(sesRow).getByText('—')).toBeInTheDocument()
    // 고정이 없으면 자동(추천)이 기본 선택
    expect(screen.getByRole('radio', { name: '자동(추천) 선택' })).toBeChecked()
    expect(screen.getByRole('radio', { name: '혼합 이동평균 선택' })).not.toBeChecked()
    // 신상품 옵션은 발주량 합계에서 빠진다 (o1 만: MA90 qty 20)
    expect(
      within(screen.getByText('이동평균 90일').closest('tr')!).getByText('20')
    ).toBeInTheDocument()
    expect(screen.getByText('재고 확인 필요')).toBeInTheDocument()
    expect(screen.getByText('같은 상품 평균 하루 2.5개')).toBeInTheDocument()
  })

  it('모델 라디오를 바꾸면 modelByProduct 로 dryRun 을 다시 부르고, 생성에도 보낸다', async () => {
    await gotoCalcStep()
    fireEvent.click(screen.getByRole('radio', { name: '이동평균 90일 선택' }))
    await waitFor(() => expect(planBodies()).toHaveLength(2))
    expect(planBodies()[1]).toMatchObject({ dryRun: true, modelByProduct: { p1: 'MA90' } })
    // 첫 dryRun 은 사용자 선택이 없으므로 비어 있어야 한다(추천을 설정에 고정하지 않음)
    expect(planBodies()[0].modelByProduct).toEqual({})

    fireEvent.click(await screen.findByRole('button', { name: /다음 · 세트 환산 · 검토/ }))
    fireEvent.click(await screen.findByRole('button', { name: /발주 계획 생성/ }))
    await waitFor(() => expect(push).toHaveBeenCalled())
    const create = planBodies().at(-1)
    expect(create.dryRun).toBeUndefined()
    expect(create.modelByProduct).toEqual({ p1: 'MA90' })
  })

  it('자동(추천)·추천과 같은 모델 선택은 AUTO 로 보내 고정하지 않는다', async () => {
    await gotoCalcStep()
    fireEvent.click(screen.getByRole('radio', { name: '이동평균 90일 선택' }))
    await waitFor(() => expect(planBodies()).toHaveLength(2))
    fireEvent.click(screen.getByRole('radio', { name: '자동(추천) 선택' }))
    await waitFor(() => expect(planBodies()).toHaveLength(3))
    expect(planBodies()[2].modelByProduct).toEqual({ p1: 'AUTO' })
    fireEvent.click(screen.getByRole('radio', { name: '이동평균 90일 선택' }))
    await waitFor(() => expect(planBodies()).toHaveLength(4))
    fireEvent.click(screen.getByRole('radio', { name: '혼합 이동평균 선택' }))
    await waitFor(() => expect(planBodies()).toHaveLength(5))
    expect(planBodies()[4].modelByProduct).toEqual({ p1: 'AUTO' })
  })

  it('신상품 옵션 수량 입력은 manualQtyByOption 으로 전송된다', async () => {
    await gotoCalcStep()
    fireEvent.change(screen.getByLabelText('화이트 최종수량'), { target: { value: '15' } })
    fireEvent.click(screen.getByRole('radio', { name: '이동평균 30일 선택' }))
    await waitFor(() => expect(planBodies()).toHaveLength(2))
    // 재계산에도 수동 수량을 실어 보내야 입력값이 0 으로 초기화되지 않는다
    expect(planBodies()[1].manualQtyByOption).toEqual({ o2: 15 })
  })
})
