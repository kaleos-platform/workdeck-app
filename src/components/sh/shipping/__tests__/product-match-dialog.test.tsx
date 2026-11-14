import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ProductMatchDialog } from '../product-match-dialog'

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))

test('N배송 바코드별 매칭 — 바코드마다 옵션을 골라 barcodeOptions 로 저장', async () => {
  const fetchMock = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PATCH') return { ok: true, json: async () => ({ ok: true }) }
    return {
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'p1',
            name: '캐미솔',
            code: null,
            options: [
              { id: 'opt-black', name: '블랙', sku: null },
              { id: 'opt-white', name: '화이트', sku: null },
            ],
          },
        ],
      }),
    }
  })
  global.fetch = fetchMock as unknown as typeof fetch
  const onMatched = jest.fn()

  render(
    <ProductMatchDialog
      open
      onOpenChange={jest.fn()}
      orderId="o1"
      itemId="i1"
      rawName="[2장 세트] 캐미솔"
      orderQty={2}
      channelId="ch"
      channelSet
      forceAlias
      barcodes={[
        { nsBarcode: 'NSA', pickingQuantityPerOrder: 1 },
        { nsBarcode: 'NSB', pickingQuantityPerOrder: 1 },
      ]}
      onMatched={onMatched}
    />
  )

  const save = screen.getByRole('button', { name: '바코드 매칭 저장' })
  expect(save).toBeDisabled()
  fireEvent.click(await screen.findByText(/블랙/))
  fireEvent.click(screen.getByText(/화이트/))
  expect(save).toBeEnabled()
  fireEvent.click(save)

  await waitFor(() => expect(onMatched).toHaveBeenCalled())
  const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!
  expect(String(patch[0])).toBe('/api/sh/shipping/orders/o1/items/i1/match')
  expect(JSON.parse(String(patch[1]!.body))).toEqual({
    barcodeOptions: [
      { nsBarcode: 'NSA', optionId: 'opt-black' },
      { nsBarcode: 'NSB', optionId: 'opt-white' },
    ],
  })
})
