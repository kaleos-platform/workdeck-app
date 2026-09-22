import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { CoupangApiClient } from '../client.js'
import { changeVendorItemPrice, fetchVendorItemStatus } from '../endpoints.js'
import { CoupangWriteError } from '../write-result.js'

const realFetch = globalThis.fetch
let calls: Array<{ url: string; method: string }> = []

function stubFetch(status: number, body: unknown) {
  calls = []
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' })
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response
  }) as typeof fetch
}

function makeClient() {
  return new CoupangApiClient({ vendorId: 'A00000000', accessKey: 'ak', secretKey: 'sk' })
}

afterEach(() => {
  globalThis.fetch = realFetch
})

test('changeVendorItemPrice — PUT + apActive·apMinSalePrice 쿼리', async () => {
  stubFetch(200, { code: '200', message: '', data: { code: 'SUCCESS', message: '', data: 99 } })
  const result = await changeVendorItemPrice(makeClient(), {
    vendorItemId: 96037831212,
    price: 65790,
    apActive: true,
    apMinSalePrice: 58200,
  })
  assert.equal(result, 99)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'PUT')
  assert.match(
    calls[0].url,
    /\/marketplace\/vendor-items\/96037831212\/prices\/65790\?apActive=true&apMinSalePrice=58200$/
  )
})

test('changeVendorItemPrice — HTTP 400 이면 쿠팡 문구를 담아 던진다', async () => {
  stubFetch(400, {
    code: '400',
    message: '최소 10원 단위로 입력가능합니다',
  })
  await assert.rejects(
    () =>
      changeVendorItemPrice(makeClient(), {
        vendorItemId: 1,
        price: 1001,
        apActive: true,
        apMinSalePrice: 900,
      }),
    (err: unknown) =>
      err instanceof CoupangWriteError && err.coupangMessage === '최소 10원 단위로 입력가능합니다'
  )
})

test('fetchVendorItemStatus — 4필드를 그대로 돌려준다', async () => {
  stubFetch(200, {
    code: 200,
    message: '',
    data: { sellerItemId: 96037831212, amountInStock: 12, salePrice: 65790, onSale: true },
  })
  const s = await fetchVendorItemStatus(makeClient(), 96037831212)
  assert.equal(s.salePrice, 65790)
  assert.equal(s.onSale, true)
  assert.equal(calls[0].method, 'GET')
})
