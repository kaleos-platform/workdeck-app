import { parseKeywordQuery } from '@/lib/coupang-ads/keyword-query'

describe('parseKeywordQuery', () => {
  test('페이지 크기와 정렬 필드를 안전한 범위로 제한한다', () => {
    const query = parseKeywordQuery(
      new URLSearchParams({
        page: '-1',
        pageSize: '5000',
        sortBy: 'DROP TABLE',
        sortOrder: 'invalid',
      })
    )

    expect(query).toMatchObject({
      page: 1,
      pageSize: 100,
      sortBy: 'adCost',
      sortOrder: 'desc',
    })
  })

  test('검색·필터·제거 제외 값을 파싱한다', () => {
    const query = parseKeywordQuery(
      new URLSearchParams({
        search: '팬티',
        filter: 'orders',
        excludeRemoved: 'true',
        sortBy: 'revenue1d',
        sortOrder: 'asc',
      })
    )

    expect(query).toMatchObject({
      search: '팬티',
      filter: 'orders',
      excludeRemoved: true,
      sortBy: 'revenue1d',
      sortOrder: 'asc',
    })
  })
})
