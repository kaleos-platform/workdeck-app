export type ProductionRunStatus = 'PLANNED' | 'ORDERED' | 'STOCKED_IN'

export type ProductionRunsSortBy =
  | 'runNo'
  | 'status'
  | 'orderedConfirmedAt'
  | 'stockedInAt'
  | 'dueAt'
  | 'brandName'
  | 'productName'
  | 'memo'
  | 'totalQuantity'
  | 'totalCost'

export type ProductionRunsSortOrder = 'asc' | 'desc'

export type ProductionRunsQuery = {
  page: number
  pageSize: number
  search: string
  status: ProductionRunStatus | null
  brandId: string | null
  sortBy: ProductionRunsSortBy
  sortOrder: ProductionRunsSortOrder
}

export type ProductionStatusTab = {
  value: ProductionRunStatus
  label: string
  count: number
}

export type ProductionRunsSortableRow = {
  id: string
  runNo: string
  status: ProductionRunStatus
  orderedConfirmedAt: string | null
  stockedInAt: string | null
  dueAt: string | null
  brandName: string | null
  firstProductName: string | null
  memo: string | null
  totalQuantity: number
  totalCost: number | null
  updatedAt: string
}

export const PRODUCTION_STATUS_LABEL: Record<ProductionRunStatus, string> = {
  PLANNED: '계획중',
  ORDERED: '진행중',
  STOCKED_IN: '완료',
}

export const PRODUCTION_STATUS_ORDER: ProductionRunStatus[] = ['PLANNED', 'ORDERED', 'STOCKED_IN']

const SORT_KEYS = new Set<ProductionRunsSortBy>([
  'runNo',
  'status',
  'orderedConfirmedAt',
  'stockedInAt',
  'dueAt',
  'brandName',
  'productName',
  'memo',
  'totalQuantity',
  'totalCost',
])

const STATUS_KEYS = new Set<ProductionRunStatus>(PRODUCTION_STATUS_ORDER)

export function parseProductionRunsQuery(searchParams: URLSearchParams): ProductionRunsQuery {
  const parsedPage = Number(searchParams.get('page') ?? 1)
  const parsedPageSize = Number(searchParams.get('pageSize') ?? 20)
  const statusParam = searchParams.get('status') as ProductionRunStatus | null
  const sortByParam = searchParams.get('sortBy') as ProductionRunsSortBy | null

  return {
    page: Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    pageSize:
      Number.isInteger(parsedPageSize) && parsedPageSize > 0 ? Math.min(parsedPageSize, 100) : 20,
    search: (searchParams.get('search') ?? '').trim(),
    status: statusParam && STATUS_KEYS.has(statusParam) ? statusParam : null,
    brandId: searchParams.get('brandId')?.trim() || null,
    sortBy: sortByParam && SORT_KEYS.has(sortByParam) ? sortByParam : 'orderedConfirmedAt',
    sortOrder: searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc',
  }
}

export function buildProductionStatusTabs(
  counts: Partial<Record<ProductionRunStatus, number>>
): ProductionStatusTab[] {
  return PRODUCTION_STATUS_ORDER.map((status) => ({
    value: status,
    label: PRODUCTION_STATUS_LABEL[status],
    count: counts[status] ?? 0,
  }))
}

export function compareProductionRunRows(
  sortBy: ProductionRunsSortBy,
  sortOrder: ProductionRunsSortOrder
) {
  return (a: ProductionRunsSortableRow, b: ProductionRunsSortableRow) => {
    const direction = sortOrder === 'asc' ? 1 : -1
    const compared = compareValues(sortValue(a, sortBy), sortValue(b, sortBy))
    if (compared !== 0) return compared * direction

    return compareValues(a.updatedAt, b.updatedAt) * -1
  }
}

function sortValue(row: ProductionRunsSortableRow, sortBy: ProductionRunsSortBy) {
  switch (sortBy) {
    case 'status':
      return PRODUCTION_STATUS_ORDER.indexOf(row.status)
    case 'brandName':
      return row.brandName
    case 'productName':
      return row.firstProductName
    default:
      return row[sortBy]
  }
}

function compareValues(a: string | number | null, b: string | number | null) {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1

  if (typeof a === 'number' && typeof b === 'number') {
    return a - b
  }

  return String(a).localeCompare(String(b), 'ko-KR', { numeric: true, sensitivity: 'base' })
}
