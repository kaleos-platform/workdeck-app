import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPriceChange } from '../price-change.js'

// client 를 최소 stub 으로 대체 — 네트워크를 타지 않는다.
function stubClient(behaviour: {
  status?: (id: string) => { salePrice: number }
  put?: (id: string) => void
}) {
  return {
    get: async (path: string) => {
      const id = path.split('/vendor-items/')[1].split('/')[0]
      const s = behaviour.status?.(id) ?? { salePrice: 0 }
      return { data: { sellerItemId: Number(id), amountInStock: 1, ...s, onSale: true } }
    },
    put: async (path: string) => {
      const id = path.split('/vendor-items/')[1].split('/')[0]
      behaviour.put?.(id)
      return {
        body: { code: '200', message: '', data: { code: 'SUCCESS', message: '', data: 1 } },
        status: 200,
      }
    },
  } as never
}

const payload = {
  channelAxis: 'RG',
  apActive: true,
  targets: [
    { listingId: 'L1', vendorItemId: '111', targetPrice: 1000, apMinSalePrice: 900 },
    { listingId: 'L2', vendorItemId: '222', targetPrice: 2000, apMinSalePrice: 1800 },
  ],
}

test('타깃마다 observedPrice 를 기록하고 PUT 한다', async () => {
  const puts: string[] = []
  const results = await runPriceChange(
    stubClient({ status: () => ({ salePrice: 999 }), put: (id) => puts.push(id) }),
    payload
  )
  assert.deepEqual(puts, ['111', '222'])
  assert.equal(results.length, 2)
  assert.equal(results[0].observedPrice, 999)
  assert.equal(results[0].ok, true)
})

test('현재가가 목표가와 달라도 중단하지 않는다 — 자동조정이 가격을 움직인다', async () => {
  const results = await runPriceChange(
    stubClient({ status: () => ({ salePrice: 12345 }) }),
    payload
  )
  assert.equal(
    results.every((r) => r.ok),
    true
  )
})

test('한 타깃이 실패해도 나머지를 계속 처리한다', async () => {
  const client = {
    get: async () => ({ data: { salePrice: 100 } }),
    put: async (path: string) => {
      if (path.includes('/111/')) throw new Error('쿠팡 쓰기 실패: 삭제된 상품')
      return {
        body: { code: '200', message: '', data: { code: 'SUCCESS', message: '', data: 1 } },
        status: 200,
      }
    },
  } as never
  const results = await runPriceChange(client, payload)
  assert.equal(results[0].ok, false)
  assert.match(results[0].error ?? '', /삭제된 상품/)
  assert.equal(results[1].ok, true)
})

test('현재가 조회가 실패해도 PUT 은 시도한다 — 조회는 감사용이다', async () => {
  const puts: string[] = []
  const client = {
    get: async () => {
      throw new Error('일시 오류')
    },
    put: async (path: string) => {
      puts.push(path)
      return {
        body: { code: '200', message: '', data: { code: 'SUCCESS', message: '', data: 1 } },
        status: 200,
      }
    },
  } as never
  const results = await runPriceChange(client, payload)
  assert.equal(puts.length, 2)
  assert.equal(results[0].observedPrice, null)
  assert.equal(results[0].ok, true)
})
