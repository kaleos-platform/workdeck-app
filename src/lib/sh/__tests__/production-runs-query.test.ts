import {
  buildProductionStatusTabs,
  compareProductionRunRows,
  parseProductionRunsQuery,
  type ProductionRunsSortableRow,
} from '@/lib/sh/production-runs-query'

describe('production-runs-query', () => {
  test('정렬 파라미터를 허용 목록으로 제한하고 기본 정렬을 보존한다', () => {
    const query = parseProductionRunsQuery(
      new URLSearchParams({
        page: '-5',
        pageSize: '500',
        sortBy: 'DROP TABLE',
        sortOrder: 'sideways',
      })
    )

    expect(query).toMatchObject({
      page: 1,
      pageSize: 100,
      sortBy: 'orderedConfirmedAt',
      sortOrder: 'desc',
    })
  })

  test('상태 탭 count를 계획중, 진행중, 완료 순서로 만든다', () => {
    const tabs = buildProductionStatusTabs({
      PLANNED: 2,
      ORDERED: 5,
      STOCKED_IN: 3,
    })

    expect(tabs).toEqual([
      { value: 'PLANNED', label: '계획중', count: 2 },
      { value: 'ORDERED', label: '진행중', count: 5 },
      { value: 'STOCKED_IN', label: '완료', count: 3 },
    ])
  })

  test('파생 컬럼인 포함 상품명과 총 수량을 안정적으로 정렬한다', () => {
    const rows: ProductionRunsSortableRow[] = [
      {
        id: 'b',
        runNo: '2026-002',
        status: 'ORDERED',
        orderedConfirmedAt: null,
        stockedInAt: null,
        dueAt: null,
        brandName: 'B',
        firstProductName: '모달 머드팬티',
        memo: null,
        totalQuantity: 20,
        totalCost: 1000,
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 'a',
        runNo: '2026-001',
        status: 'PLANNED',
        orderedConfirmedAt: null,
        stockedInAt: null,
        dueAt: null,
        brandName: 'A',
        firstProductName: '모달 갈나시',
        memo: '중국 입고',
        totalQuantity: 30,
        totalCost: 900,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]

    expect([...rows].sort(compareProductionRunRows('productName', 'asc')).map((r) => r.id)).toEqual(
      ['a', 'b']
    )
    expect(
      [...rows].sort(compareProductionRunRows('totalQuantity', 'desc')).map((r) => r.id)
    ).toEqual(['a', 'b'])
  })

  test('상태 정렬은 화면 탭 순서를 따른다', () => {
    const rows: ProductionRunsSortableRow[] = [
      {
        id: 'done',
        runNo: '2026-003',
        status: 'STOCKED_IN',
        orderedConfirmedAt: null,
        stockedInAt: null,
        dueAt: null,
        brandName: null,
        firstProductName: null,
        memo: null,
        totalQuantity: 1,
        totalCost: null,
        updatedAt: '2026-01-03T00:00:00.000Z',
      },
      {
        id: 'planned',
        runNo: '2026-001',
        status: 'PLANNED',
        orderedConfirmedAt: null,
        stockedInAt: null,
        dueAt: null,
        brandName: null,
        firstProductName: null,
        memo: null,
        totalQuantity: 1,
        totalCost: null,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'ordered',
        runNo: '2026-002',
        status: 'ORDERED',
        orderedConfirmedAt: null,
        stockedInAt: null,
        dueAt: null,
        brandName: null,
        firstProductName: null,
        memo: null,
        totalQuantity: 1,
        totalCost: null,
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ]

    expect([...rows].sort(compareProductionRunRows('status', 'asc')).map((r) => r.id)).toEqual([
      'planned',
      'ordered',
      'done',
    ])
  })
})
