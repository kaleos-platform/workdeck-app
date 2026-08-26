// GET   : 잡 상세(디버그용 rawResponse 포함) — 첨부 파일은 서명 URL로 미리보기 제공.
// DELETE: 잡 삭제. Storage 소재 파일부터 지우고 실패 시 row는 남겨 고아 파일을 만들지 않는다.

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import {
  getProductSourceSignedUrl,
  removeProductSourceFiles,
} from '@/lib/sh/product-source-storage'

type Params = { params: Promise<{ productId: string; jobId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId, jobId } = await params
  const job = await prisma.productExtractionJob.findFirst({
    where: { id: jobId, productId, spaceId: resolved.space.id },
    include: { sources: { orderBy: { createdAt: 'asc' } } },
  })
  if (!job) return errorResponse('작업을 찾을 수 없습니다', 404)

  const sources = await Promise.all(
    job.sources.map(async (s) => {
      if ((s.kind === 'IMAGE' || s.kind === 'PDF') && s.storagePath) {
        try {
          const signedUrl = await getProductSourceSignedUrl(s.storagePath, 600)
          return { ...s, signedUrl }
        } catch (err) {
          console.warn('[extract/[jobId]] 서명 URL 생성 실패', { sourceId: s.id, err })
          return { ...s, signedUrl: null }
        }
      }
      return { ...s, signedUrl: null }
    })
  )

  return NextResponse.json({ job, sources })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId, jobId } = await params
  const job = await prisma.productExtractionJob.findFirst({
    where: { id: jobId, productId, spaceId: resolved.space.id },
    include: { sources: { select: { storagePath: true } } },
  })
  if (!job) return errorResponse('작업을 찾을 수 없습니다', 404)

  const storagePaths = job.sources.map((s) => s.storagePath).filter((p): p is string => Boolean(p))

  if (storagePaths.length > 0) {
    try {
      await removeProductSourceFiles(storagePaths)
    } catch (err) {
      // Storage 삭제가 실패했는데 DB row 를 지우면 고아 파일이 영영 추적 불가능해진다.
      // row 는 남기고 에러를 그대로 보고한다 — 재시도 가능하게.
      const detail = err instanceof Error ? err.message : String(err)
      console.error('[extract/[jobId]] Storage 파일 삭제 실패 — row 보존', { jobId, detail })
      return errorResponse('첨부 파일 삭제에 실패했습니다', 500, { detail })
    }
  }

  await prisma.productExtractionJob.delete({ where: { id: jobId } })
  return new NextResponse(null, { status: 204 })
}
