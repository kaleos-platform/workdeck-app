// 지원자 첨부 서명 다운로드 URL 발급 — 쓰기 권한(hiring-applicants) + spaceId 스코프.
// 서명 URL 은 짧은 만료(기본 10분). 비공개 버킷 직접 노출 없음.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { getApplicantFileSignedUrl } from '@/lib/hiring/storage'

type Params = { params: Promise<{ id: string; fileId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('hiring-applicants')
  if ('error' in resolved) return resolved.error
  const { id, fileId } = await params

  const file = await prisma.hiringApplicationFile.findFirst({
    where: { id: fileId, applicationId: id, spaceId: resolved.space.id },
    select: { filePath: true, fileName: true },
  })
  if (!file) return errorResponse('파일을 찾을 수 없습니다', 404)

  try {
    const url = await getApplicantFileSignedUrl(file.filePath)
    return NextResponse.json({ url, fileName: file.fileName })
  } catch {
    return errorResponse('다운로드 링크 생성에 실패했습니다', 500)
  }
}
