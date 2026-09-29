/** @jest-environment node */

import * as XLSX from 'xlsx'
import { verifyDownloadedFile } from '../orchestrator'

function xlsxWithDates(dates: string[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(dates.map((d) => ({ 날짜: d.replace(/-/g, '') })))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

describe('verifyDownloadedFile', () => {
  const upTo28 = xlsxWithDates(['2026-09-27', '2026-09-28'])

  it('종료일이 있으면 통과', () => {
    expect(() => verifyDownloadedFile(upTo28, 'f', '2026-09-28')).not.toThrow()
  })

  it('하루 지연은 수동 수집에서만 허용', () => {
    expect(() => verifyDownloadedFile(upTo28, 'f', '2026-09-29', true)).not.toThrow()
    expect(() => verifyDownloadedFile(upTo28, 'f', '2026-09-29')).toThrow('요청한 종료일')
  })

  it('이틀 이상 지연은 수동이어도 실패', () => {
    expect(() => verifyDownloadedFile(upTo28, 'f', '2026-09-30', true)).toThrow('요청한 종료일')
  })
})
