import { summarizeReorderPreview } from '../reorder-preview-summary'

const opt = (o: Record<string, unknown>) => ({
  optionId: 'x',
  productId: 'p1',
  productName: '머드팬티',
  optionName: '누드 / L',
  sku: 'L',
  finalQty: 0,
  rocketBaselineQty: null,
  dailyAvgForecast: 0,
  onHandStock: 0,
  incomingQty: 0,
  leadTimeDays: 20,
  targetCoverDays: 30,
  recommendedModel: 'MA90',
  selectedModel: 'MA90',
  isNewOption: false,
  ...o,
})

it('위저드 미리보기를 위치 분배·합계·소진일 포함 요약으로 바꾼다', () => {
  const r = summarizeReorderPreview({
    locationName: '쿠팡 로켓그로스',
    ownLocations: [{ id: 'wk', name: '위킵 (에이엠엘)' }],
    linkedSkuAllocation: {
      skus: [
        { name: '3장 세트', optionName: '누드 3P L', allocSets: 20 },
        { name: '5장 세트', optionName: null, allocSets: 0 },
      ],
    },
    options: [
      opt({
        optionId: 'L',
        finalQty: 70,
        rocketBaselineQty: 65,
        dailyAvgForecast: 4,
        onHandStock: 256,
        incomingQty: 0,
      }),
      opt({
        optionId: 'S',
        optionName: '누드 / S',
        finalQty: 90,
        dailyAvgForecast: 6.1,
        onHandStock: -3,
        incomingQty: 10,
      }),
      opt({ optionId: 'M', optionName: '누드 / M', finalQty: 0 }),
    ],
  })
  expect(r.selectedModel).toBe('이동평균 90일')
  expect(r.horizonDays).toBe(50)
  expect(r.ownLocationName).toBe('위킵 (에이엠엘)')
  expect([r.totalOrderQty, r.linkedTotalQty, r.ownTotalQty]).toEqual([160, 65, 95])
  expect(r.options.map((o) => [o.optionId, o.linkedQty, o.ownQty])).toEqual([
    ['L', 65, 5],
    ['S', 0, 90],
  ])
  expect(r.options[0].daysOfCoverWithIncoming).toBe(64)
  expect(r.options[1].stockPlusIncoming).toBe(10) // 음수 재고는 0으로
  expect(r.noOrderOptionCount).toBe(1)
  expect(r.linkedSkuAllocation).toEqual([{ name: '3장 세트', optionName: '누드 3P L', sets: 20 }])
})
