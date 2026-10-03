import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FileDownloadList } from '../detail-actions'
it('동일 파일명을 항목명으로 구분하고 선택한 ID로 다운로드한다', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ url: 'https://example.test/signed' }) })
  window.open = jest.fn()
  render(
    <FileDownloadList
      applicationId="qa"
      files={[
        { id: 'one', fileName: 'same.pdf', sizeBytes: 1, fieldLabel: '이력서' },
        { id: 'two', fileName: 'same.pdf', sizeBytes: 1, fieldLabel: '포트폴리오' },
        { id: 'old', fileName: 'legacy.pdf', sizeBytes: 1 },
      ]}
    />
  )
  expect(screen.getByText('이력서')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'legacy.pdf 다운로드' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '포트폴리오 · same.pdf 다운로드' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith('/api/hiring-applicants/applications/qa/files/two')
  )
})
