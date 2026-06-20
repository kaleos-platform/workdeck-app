export type KeywordSortKey =
  | 'keyword'
  | 'adCost'
  | 'ctr'
  | 'cvr'
  | 'roas'
  | 'orders1d'
  | 'revenue1d'

export type KeywordFilter = 'all' | 'zero' | 'orders'

export type KeywordQuery = {
  page: number
  pageSize: number
  search: string
  filter: KeywordFilter
  excludeRemoved: boolean
  sortBy: KeywordSortKey
  sortOrder: 'asc' | 'desc'
}

const SORT_KEYS = new Set<KeywordSortKey>([
  'keyword',
  'adCost',
  'ctr',
  'cvr',
  'roas',
  'orders1d',
  'revenue1d',
])

export function parseKeywordQuery(searchParams: URLSearchParams): KeywordQuery {
  const parsedPage = Number(searchParams.get('page') ?? 1)
  const parsedPageSize = Number(searchParams.get('pageSize') ?? 50)
  const sortByParam = searchParams.get('sortBy') as KeywordSortKey | null
  const filterParam = searchParams.get('filter')

  return {
    page: Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    pageSize:
      Number.isInteger(parsedPageSize) && parsedPageSize > 0 ? Math.min(parsedPageSize, 100) : 50,
    search: (searchParams.get('search') ?? '').trim().slice(0, 100),
    filter: filterParam === 'zero' || filterParam === 'orders' ? filterParam : 'all',
    excludeRemoved: searchParams.get('excludeRemoved') === 'true',
    sortBy: sortByParam && SORT_KEYS.has(sortByParam) ? sortByParam : 'adCost',
    sortOrder: searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc',
  }
}
