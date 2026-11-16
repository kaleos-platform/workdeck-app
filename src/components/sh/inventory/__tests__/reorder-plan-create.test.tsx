import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
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
  ownLocations: [
    {
      id: 'wk',
      name: '위킵 (에이엠엘)',
      type: 'THIRD_PARTY',
      onHandQty: 500,
      stockByOption: { o1: 40 },
    },
    { id: 'of', name: '의식주의 사무실', type: 'OWN', onHandQty: 0, stockByOption: {} },
  ],
  options: [
    option({
      optionId: 'o1',
      optionName: '블랙',
      onHandStock: -3,
      checkStock: true,
      ownSalesInWindowQty: 123,
      ownExpectedSalesQty: 50,
      ownSafetyStockQty: 7,
      ownCurrentStockQty: 11,
      ownIncomingQty: 4,
      ownNeedQty: 42,
    }),
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
  fireEvent.click(await screen.findByRole('button', { name: /다음 · 자체·3PL 출고 확인/ }))
  fireEvent.click(await screen.findByRole('button', { name: /다음 · 수량 계산/ }))
  await screen.findByText('예측 모델')
}

describe('발주 위저드 Step ④ — 모델 비교·신상품·재고 확인', () => {
  it('목표 커버일수 입력 중에는 저장하지 않고, 계산 다시 적용은 PATCH 완료 뒤 dryRun 한다', async () => {
    await gotoCalcStep()
    const originalFetch = fetchMock.getMockImplementation()!
    let completePatch!: () => void
    const patchPending = new Promise<void>((resolve) => {
      completePatch = resolve
    })
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') await patchPending
      return originalFetch(url, init)
    })
    const callsBeforeEdit = fetchMock.mock.calls.length
    const coverInput = screen.getByLabelText('목표 커버일수')
    fireEvent.change(coverInput, { target: { value: '4' } })
    fireEvent.change(coverInput, { target: { value: '45' } })
    fireEvent.blur(coverInput)
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeEdit)

    fireEvent.click(screen.getByRole('button', { name: '계산 다시 적용' }))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/sh/inventory/reorder/config/p1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetCoverDays: 45 }),
    })
    expect(planBodies()).toHaveLength(1)
    await act(async () => {
      completePatch()
    })
    await waitFor(() => expect(planBodies()).toHaveLength(2))
    expect(planBodies()[1]).toMatchObject({ dryRun: true })
  })

  it('목표 커버일수 0·366은 안내하고 PATCH·재계산하지 않는다', async () => {
    await gotoCalcStep()
    const callsBeforeEdit = fetchMock.mock.calls.length
    for (const value of ['0', '366']) {
      jest.mocked(toast.error).mockClear()
      fireEvent.change(screen.getByLabelText('목표 커버일수'), { target: { value } })
      fireEvent.click(screen.getByRole('button', { name: '계산 다시 적용' }))
      expect(toast.error).toHaveBeenCalledWith('목표 커버일수는 1~365일로 입력하세요')
      expect(fetchMock).toHaveBeenCalledTimes(callsBeforeEdit)
    }
  })

  it('추천 배지·오차(%)·재고 확인 필요·신상품 참고 문구를 표시한다', async () => {
    await gotoCalcStep()
    const blendRow = screen.getByText('혼합 이동평균').closest('tr')!
    expect(within(blendRow).getByText('추천')).toBeInTheDocument()
    expect(within(blendRow).getByText('12.3%')).toBeInTheDocument()
    const sesRow = screen.getByText('지수평활+추세').closest('tr')!
    expect(within(sesRow).getByText('—')).toBeInTheDocument()
    // 고정이 없으면 추천 모델 행이 기본 선택(별도 자동 행 없음)
    expect(screen.queryByRole('radio', { name: '자동(추천) 선택' })).toBeNull()
    expect(screen.getByRole('radio', { name: '혼합 이동평균 선택' })).toBeChecked()
    expect(screen.getByRole('radio', { name: '이동평균 90일 선택' })).not.toBeChecked()
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

  it('추천 모델 행을 다시 고르면 AUTO 로 보내 고정하지 않는다', async () => {
    await gotoCalcStep()
    fireEvent.click(screen.getByRole('radio', { name: '이동평균 90일 선택' }))
    await waitFor(() => expect(planBodies()).toHaveLength(2))
    expect(screen.getByRole('radio', { name: '이동평균 90일 선택' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: '혼합 이동평균 선택' }))
    await waitFor(() => expect(planBodies()).toHaveLength(3))
    expect(planBodies()[2].modelByProduct).toEqual({ p1: 'AUTO' })
    expect(screen.getByRole('radio', { name: '혼합 이동평균 선택' })).toBeChecked()
  })

  it('재계산해도 사용자가 고친 최종수량은 유지하고 손대지 않은 옵션만 새 기본값으로 갱신한다', async () => {
    await gotoCalcStep()
    fireEvent.change(screen.getByLabelText('블랙 최종수량'), { target: { value: '77' } })
    fireEvent.click(screen.getByRole('radio', { name: '이동평균 90일 선택' }))
    await waitFor(() => expect(planBodies()).toHaveLength(2))
    await waitFor(() => expect(screen.getByLabelText('블랙 최종수량')).toHaveValue(77))
    // 손대지 않은 신상품 옵션은 서버 기본값(0) 그대로
    expect(screen.getByLabelText('화이트 최종수량')).toHaveValue(0)
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

describe('발주 위저드 Step ③ — 자체·3PL 옵션 상세', () => {
  it('옵션별 판매·예측 소진량·안전재고·현재고·입고예정·부족분·발주 수량을 표로 보여 준다', async () => {
    render(<ReorderPlanCreate />)
    fireEvent.click(screen.getByText('pick'))
    await waitFor(() => expect(planBodies()).toHaveLength(1))
    fireEvent.click(await screen.findByRole('button', { name: /다음 · 자체·3PL 출고 확인/ }))
    await screen.findByText('자체·3PL 입고 필요 수량')
    expect(screen.getByText('판매(90일)')).toBeInTheDocument()
    const row = screen
      .getAllByText('블랙')
      .map((el) => el.closest('tr')!)
      .find(Boolean)!
    for (const v of ['123', '50', '7', '11', '4', '42', '30']) {
      expect(within(row).getByText(v)).toBeInTheDocument()
    }
  })
})

describe('발주 위저드 Step ⑤ — 발주 내역 우선·자체·3PL 입고 위치', () => {
  it('발주 내역을 먼저 보여 주고, 재고 많은 위치를 기본 입고 위치로 현재 → 입고 후를 표시하며 생성에 보낸다', async () => {
    render(<ReorderPlanCreate />)
    fireEvent.click(screen.getByText('pick'))
    await waitFor(() => expect(planBodies()).toHaveLength(1))
    fireEvent.click(await screen.findByRole('button', { name: /다음 · 자체·3PL 출고 확인/ }))
    fireEvent.click(await screen.findByRole('button', { name: /다음 · 수량 계산/ }))
    fireEvent.click(await screen.findByRole('button', { name: /다음 · 세트 환산 · 검토/ }))
    const order = await screen.findByText('발주 내역 — 옵션 단위')
    const own = screen.getByText('자체·3PL 입고')
    // 발주 내역이 자체·3PL 입고보다 먼저
    expect(order.compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('→ 위킵 (에이엠엘)')).toBeInTheDocument()
    // 블랙 30개 → 위킵 재고 40 → 70
    expect(screen.getByText('70')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /발주 계획 생성/ }))
    await waitFor(() => expect(push).toHaveBeenCalled())
    expect(planBodies().at(-1).ownLocationId).toBe('wk')
  })
})

describe('발주 위저드 Step ④ — 커버 표시', () => {
  it('예측 판매 0 은 「판매 없음」, 900일 초과는 「900일+」로 보여 준다', async () => {
    const saved = preview.options
    preview.options = [
      option({
        optionId: 'z0',
        optionName: '판매0',
        dailyAvgForecast: 0,
        currentStock: 80,
        finalQty: 0,
      }),
      option({
        optionId: 'z1',
        optionName: '저회전',
        dailyAvgForecast: 0.06,
        currentStock: 87,
        finalQty: 0,
      }),
    ]
    try {
      await gotoCalcStep()
      expect(
        within(screen.getByText('판매0').closest('tr')!).getByText('판매 없음')
      ).toBeInTheDocument()
      expect(
        within(screen.getByText('저회전').closest('tr')!).getByText('900일+')
      ).toBeInTheDocument()
    } finally {
      preview.options = saved
    }
  })
})
