import { fireEvent, render, screen } from '@testing-library/react'
import { ErrorsTable, type ErrorRow } from '../errors-table'
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }))

const row = (over: Partial<ErrorRow>): ErrorRow => ({
  id: 'i',
  shortId: 'APP-1',
  title: 'Error',
  culprit: '',
  permalink: 'https://sentry.invalid/1',
  count: 1,
  userCount: 0,
  lastSeen: '2026-11-20T00:00:00Z',
  service: 'web',
  autofix: { kind: 'none' },
  ...over,
})
const rows = [
  row({
    id: 'a',
    shortId: 'APP-A',
    title: '나 오류',
    count: 5,
    userCount: 2,
    lastSeen: '2026-11-21T00:00:00Z',
  }),
  row({
    id: 'b',
    shortId: 'APP-B',
    title: '가 오류',
    count: 50,
    userCount: 1,
    lastSeen: '2026-11-23T00:00:00Z',
    service: 'worker',
  }),
  row({
    id: 'c',
    shortId: 'APP-C',
    title: '다 오류',
    count: 9,
    userCount: 3,
    lastSeen: '2026-11-22T00:00:00Z',
  }),
]
const order = () => screen.getAllByRole('link', { name: /오류$/ }).map((a) => a.textContent)
const head = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) })

it('기본은 받은 순서(사용자 많은 순)를 유지하고 컬럼을 눌러 정렬한다', () => {
  render(
    <ErrorsTable
      rows={rows}
      service="all"
      status="all"
      counts={{ web: 2, worker: 1 }}
      lastActivity={null}
    />
  )
  expect(order()).toEqual(['나 오류', '가 오류', '다 오류'])

  fireEvent.click(head('발생'))
  expect(order()).toEqual(['가 오류', '다 오류', '나 오류'])
  expect(screen.getByRole('columnheader', { name: /발생/ })).toHaveAttribute(
    'aria-sort',
    'descending'
  )
  fireEvent.click(head('발생'))
  expect(order()).toEqual(['나 오류', '다 오류', '가 오류'])

  fireEvent.click(head('사용자'))
  expect(order()).toEqual(['다 오류', '나 오류', '가 오류'])

  fireEvent.click(head('마지막'))
  expect(order()).toEqual(['가 오류', '다 오류', '나 오류'])

  fireEvent.click(head('오류'))
  expect(order()).toEqual(['가 오류', '나 오류', '다 오류'])
})
