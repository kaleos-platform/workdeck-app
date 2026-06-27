import { plannedStockQty, sumIncomingProductionQtyByOption } from '../planned-stock'

describe('sumIncomingProductionQtyByOption', () => {
  it('진행중 생산차수 수량만 입고예정에 포함한다', () => {
    const incoming = sumIncomingProductionQtyByOption([
      {
        status: 'PLANNED',
        items: [
          { optionId: 'option-1', quantity: 10 },
          { optionId: 'option-2', quantity: 7 },
        ],
      },
      {
        status: 'ORDERED',
        items: [
          { optionId: 'option-1', quantity: 3 },
          { optionId: 'option-2', quantity: 4 },
        ],
      },
      {
        status: 'STOCKED_IN',
        items: [{ optionId: 'option-1', quantity: 100 }],
      },
    ])

    expect(incoming.get('option-1')).toBe(3)
    expect(incoming.get('option-2')).toBe(4)
  })
})

describe('plannedStockQty', () => {
  it('현재 보유 재고와 입고예정 수량을 합산한다', () => {
    expect(plannedStockQty({ onHandQty: 5, incomingQty: 10 })).toBe(15)
  })
})
