import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'
import { parseExcelBuffer, detectPeriod } from '@/lib/excel-parser'

// POST /api/reports/upload — multipart/form-data 엑셀 업로드
export async function POST(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  // multipart/form-data 파싱
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return errorResponse('multipart/form-data 파싱에 실패했습니다', 400)
  }

  const file = formData.get('file')
  if (!file || !(file instanceof File)) {
    return errorResponse('파일을 첨부해주세요', 400)
  }

  if (!file.name.endsWith('.xlsx')) {
    return errorResponse('.xlsx 파일만 업로드할 수 있습니다', 400)
  }

  // Excel 파싱
  let rows
  try {
    const buffer = await file.arrayBuffer()
    rows = parseExcelBuffer(buffer)
  } catch {
    return errorResponse('Excel 파일 파싱에 실패했습니다', 400)
  }

  if (rows.length === 0) {
    return errorResponse(
      '파싱된 데이터가 없습니다. 쿠팡 광고 리포트 형식의 파일인지 확인해주세요',
      400
    )
  }

  const { periodStart, periodEnd } = detectPeriod(rows)

  // 500행 청크로 분할하여 삽입 (reportUpload.create도 try-catch 안으로 이동)
  const chunkSize = 500
  let inserted = 0

  try {
    // 업로드 이력 생성 (실패 시 고아 레코드 없음)
    const upload = await prisma.reportUpload.create({
      data: {
        fileName: file.name,
        periodStart,
        periodEnd,
        workspaceId: workspace.id,
      },
    })

    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize)

      // upsert 대신 createMany + skipDuplicates 사용
      // → compound unique where 절에 null 전달 문제 완전히 제거
      const chunkData = chunk.map((row) => ({
        workspaceId: workspace.id,
        reportId: upload.id,
        date: row.date,
        adType: row.adType,
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        adGroup: row.adGroup,
        placement: row.placement,
        productName: row.productName,
        optionId: row.optionId,
        keyword: row.keyword,
        impressions: row.impressions,
        clicks: row.clicks,
        adCost: row.adCost,
        ctr: row.ctr,
        orders1d: row.orders1d,
        revenue1d: row.revenue1d,
        roas1d: row.roas1d,
        orders14d: row.orders14d,
        revenue14d: row.revenue14d,
        roas14d: row.roas14d,
      }))

      const result = await prisma.adRecord.createMany({ data: chunkData, skipDuplicates: true })
      inserted += result.count
    }

    return NextResponse.json(
      {
        uploadId: upload.id,
        inserted,
        skipped: 0,
        errors: [],
      },
      { status: 201 }
    )
  } catch (err) {
    console.error('업로드 처리 중 오류:', err)
    return errorResponse('데이터 저장 중 오류가 발생했습니다', 500)
  }
}
