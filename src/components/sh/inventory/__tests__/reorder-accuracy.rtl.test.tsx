import { render, screen, within } from '@testing-library/react'
import { ReorderPlanAccuracyCard } from '../reorder-plan-accuracy-card'
import { ReorderMonitor, type MonitorAccuracy } from '../reorder-monitor'

const rows: MonitorAccuracy[] = [
  {
    optionId: 'normal',
    optionName: '일반',
    sku: null,
    forecastModel: 'MA30',
    actualOutbound: 10,
    forecastOutbound: 15,
    wape: 0.5,
    bias: 0.5,
    stockoutDays: 1,
    overstockDays: 2,
  },
  {
    optionId: 'manual',
    optionName: '수동',
    sku: null,
    forecastModel: 'MANUAL',
    actualOutbound: 5,
    forecastOutbound: 5,
    wape: 0,
    bias: 0,
    stockoutDays: 3,
    overstockDays: 4,
  },
  {
    optionId: 'zero',
    optionName: '무판매',
    sku: null,
    forecastModel: 'MA30',
    actualOutbound: 0,
    forecastOutbound: 5,
    wape: 0,
    bias: 0,
    stockoutDays: 5,
    overstockDays: 6,
  },
]

function card(accuracies: MonitorAccuracy[]) {
  return <ReorderPlanAccuracyCard accuracies={accuracies} planNo="RP-1" biasAdjustApplied={null} />
}

test('카드는 수동 입력과 판매 없는 행을 평균에서 제외하고 재고 일수는 모두 합산한다', () => {
  render(card(rows))
  expect(screen.getByText('50.0%')).toBeInTheDocument()
  expect(screen.getByText('+50.0%')).toBeInTheDocument()
  expect(screen.getByText(/평가 1개 · 제외 2개/)).toBeInTheDocument()
  expect(screen.getByText(/수동 입력·실판매 0건 제외/)).toBeInTheDocument()
  expect(screen.getByText('9일')).toBeInTheDocument()
  expect(screen.getByText('12일')).toBeInTheDocument()
})

test('카드의 모든 행이 제외되면 0% 성공 표시 없이 평가 대상 없음을 표시한다', () => {
  render(card(rows.slice(1)))
  expect(screen.getAllByText('평가 대상 없음')).toHaveLength(2)
  expect(screen.queryByText('0.0%')).not.toBeInTheDocument()
  expect(screen.getByText(/평가 0개 · 제외 2개/)).toBeInTheDocument()
  expect(screen.getByText('8일')).toBeInTheDocument()
  expect(screen.getByText('10일')).toBeInTheDocument()
})

test('monitor 정확 판정은 평가 대상만 분모로 사용하고 제외 행의 WAPE와 판정을 설명한다', () => {
  render(
    <ReorderMonitor
      data={{
        planNo: 'RP-1',
        biasAdjustApplied: null,
        accuracies: [{ ...rows[0], wape: 0.1 }, ...rows.slice(1)],
      }}
    />
  )
  expect(screen.getByText('1/1')).toBeInTheDocument()
  expect(screen.getAllByText('정확')).toHaveLength(1)
  const manual = screen.getByText('수동').closest('tr')!
  const zero = screen.getByText('무판매').closest('tr')!
  expect(within(manual).getAllByText('수동 입력')).toHaveLength(2)
  expect(within(zero).getAllByText('판매 없음')).toHaveLength(2)
  expect(within(manual).queryByText('0.0%')).not.toBeInTheDocument()
  expect(within(zero).queryByText('0.0%')).not.toBeInTheDocument()
})

test('monitor 평가 대상이 없으면 정확 판정 옵션에 평가 대상 없음을 표시한다', () => {
  render(
    <ReorderMonitor data={{ planNo: 'RP-1', biasAdjustApplied: null, accuracies: rows.slice(1) }} />
  )
  expect(screen.getByText('평가 대상 없음')).toBeInTheDocument()
  expect(screen.queryByText('정확')).not.toBeInTheDocument()
})
