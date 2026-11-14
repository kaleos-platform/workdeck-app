import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ReconciliationFileUploadButton } from '../reconciliation-upload'

jest.mock('../reconciliation-template-download', () => ({
  ReconciliationTemplateDownload: () => <button>포맷 템플릿 다운로드</button>,
}))

it('업로드 전에 빈 위치에 적용할 보관 장소를 선택하고 파일과 함께 전송한다', async () => {
  const onUploaded = jest.fn()
  const fetchMock = jest.fn().mockImplementation(async (_url, options) => ({
    ok: true,
    json: async () =>
      options?.method === 'POST'
        ? { id: 'reconciliation', totalItems: 1, matchedItems: 1 }
        : { locations: [{ id: 'warehouse', name: '본사', isActive: true }] },
  }))
  global.fetch = fetchMock
  render(<ReconciliationFileUploadButton onUploaded={onUploaded} />)
  fireEvent.click(screen.getByRole('button', { name: '파일 업로드' }))
  const locationSelect = await screen.findByRole('combobox', { name: '위치가 없는 행의 보관 장소' })
  fireEvent.click(locationSelect)
  fireEvent.click(await screen.findByRole('option', { name: '본사' }))
  const input = document.querySelector('input[type="file"]')!
  fireEvent.change(input, { target: { files: [new File(['test'], '재고.xlsx')] } })
  fireEvent.click(screen.getByRole('button', { name: '업로드 및 분석' }))
  await waitFor(() => expect(onUploaded).toHaveBeenCalledWith('reconciliation'))
  const [, options] = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')!
  expect(options.body.get('locationId')).toBe('warehouse')
  expect(options.body.get('file').name).toBe('재고.xlsx')
})

it('위치를 고르지 않고 올린 파일에 빈 위치가 있으면 위치 선택 창으로 안내한다', async () => {
  global.fetch = jest.fn().mockImplementation(async (_url, options) => ({
    ok: options?.method !== 'POST',
    json: async () =>
      options?.method === 'POST'
        ? {
            code: 'LOCATION_REQUIRED',
            message: '위치명이 비어 있습니다',
            details: { missingCount: 1, totalRows: 2 },
          }
        : { locations: [{ id: 'warehouse', name: '본사', isActive: true }] },
  }))
  render(<ReconciliationFileUploadButton onUploaded={jest.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '파일 업로드' }))
  fireEvent.change(document.querySelector('input[type="file"]')!, {
    target: { files: [new File(['test'], '재고.xlsx')] },
  })
  fireEvent.click(screen.getByRole('button', { name: '업로드 및 분석' }))
  const dialog = await screen.findByRole('dialog', { name: '보관 장소 선택' })
  expect(within(dialog).getByRole('combobox')).toBeInTheDocument()
  expect(within(dialog).getByText(/위치명이 적힌 1건은 파일의 위치를 유지/)).toBeInTheDocument()
})
