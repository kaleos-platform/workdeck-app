import test from 'node:test'
import assert from 'node:assert/strict'
import { CoupangApiClient } from '../client.js'

// paginate() 가 페이징 토큰을 어떤 쿼리 이름으로 보내는지 고정한다.
// 정산(revenue-history)은 'token' 을 요구하는데 'nextToken' 으로 보내면 서버가 매번
// 첫 페이지와 같은 nextToken 을 돌려줘 maxPages 까지 무한 반복한다(실제로 12일 조회가
// 500페이지를 넘겨 죽었다). 타입 에러가 안 나는 종류라 테스트로 고정한다.
function stubClient(pages: Array<{ data: string[]; nextToken?: string }>) {
  const client = new CoupangApiClient({ vendorId: 'A1', accessKey: 'k', secretKey: 's' })
  const calls: Array<Record<string, unknown>> = []
  let i = 0
  // 네트워크 대신 미리 정한 페이지를 돌려준다.
  ;(client as unknown as { get: unknown }).get = async (_p: string, q: Record<string, unknown>) => {
    calls.push(q)
    return pages[i++]
  }
  return { client, calls }
}

test('paginate — 기본 토큰 이름은 nextToken', async () => {
  const { client, calls } = stubClient([{ data: ['a'], nextToken: 't1' }, { data: ['b'] }])
  const items = await client.paginate<string, { data: string[]; nextToken?: string }>(
    '/p',
    { vendorId: 'A1' },
    (r) => ({ items: r.data, nextToken: r.nextToken })
  )
  assert.deepEqual(items, ['a', 'b'])
  assert.equal(calls[1].nextToken, 't1')
  assert.equal(calls[1].token, undefined)
})

test('paginate — tokenParam 지정 시 그 이름으로 보낸다 (정산 = token)', async () => {
  const { client, calls } = stubClient([{ data: ['a'], nextToken: 't1' }, { data: ['b'] }])
  await client.paginate<string, { data: string[]; nextToken?: string }>(
    '/p',
    { vendorId: 'A1' },
    (r) => ({ items: r.data, nextToken: r.nextToken }),
    undefined,
    'token'
  )
  assert.equal(calls[1].token, 't1')
  assert.equal(calls[1].nextToken, undefined)
})

test('paginate — 첫 페이지 토큰은 빈 문자열 (정산은 누락 시 400)', async () => {
  const { client, calls } = stubClient([{ data: ['a'] }])
  await client.paginate<string, { data: string[]; nextToken?: string }>(
    '/p',
    { vendorId: 'A1' },
    (r) => ({ items: r.data, nextToken: r.nextToken }),
    undefined,
    'token'
  )
  assert.equal(calls[0].token, '')
})
