import { isHiringDeadlinePassed } from '@/lib/hiring/closing-date'
import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/api-helpers'
import { checkRateLimit } from '@/lib/hiring/applications'
import { fileFieldError } from '@/lib/hiring/file-fields'
import { publicRequestKey } from '@/lib/hiring/public-request'
import { uploadIntentSchema, newUploadToken, uploadTokenHash } from '@/lib/hiring/upload-protocol'
import { ALLOWED_APPLICANT_MIME, createApplicantUploadUrl, extFromMime } from '@/lib/hiring/storage'
import { parseApplicationEntriesSchema } from '@/lib/validations/hiring-applicants'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  if (!checkRateLimit(`uploads:${publicRequestKey(req)}`))
    return errorResponse('요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요', 429)
  const parsed = uploadIntentSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errorResponse('첨부 정보가 올바르지 않습니다', 400)
  const { postingUuid, files } = parsed.data
  const posting = await prisma.hiringPosting.findUnique({
    where: { uuid: postingUuid },
    select: { id: true, spaceId: true, status: true, closingDate: true, applicationEntries: true },
  })
  if (!posting || posting.status !== 'ACTIVE' || isHiringDeadlinePassed(posting.closingDate))
    return errorResponse('지원 가능한 공고가 아닙니다', 404)
  const error = fileFieldError(
    parseApplicationEntriesSchema(posting.applicationEntries),
    files.map((file) => file.fieldKey),
    files.length,
    files.map((file) => file.sizeBytes)
  )
  if (error) return errorResponse(error, 400)
  if (files.some((file) => !ALLOWED_APPLICANT_MIME.has(file.mimeType)))
    return errorResponse('허용되지 않는 파일 형식입니다', 400)
  const recent = await prisma.hiringUploadSession.count({
    where: { postingId: posting.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  })
  if (recent >= 120)
    return errorResponse('첨부 요청이 몰리고 있습니다. 잠시 후 다시 시도해 주세요', 429)
  const id = randomUUID()
  const token = newUploadToken()
  const storedFiles = files.map((file) => {
    const fileId = randomUUID()
    return {
      ...file,
      id: fileId,
      path: `${posting.spaceId}/applications/${id}/${fileId}.${extFromMime(file.mimeType)}`,
    }
  })
  // 서명 URL은 최대 2시간 유효하다. 정리는 그 이후에만 수행한다.
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000)
  try {
    const uploads = await Promise.all(
      storedFiles.map(async (file) => ({
        fieldKey: file.fieldKey,
        fileName: file.fileName,
        url: await createApplicantUploadUrl(file.path),
      }))
    )
    await prisma.hiringUploadSession.create({
      data: {
        id,
        postingId: posting.id,
        spaceId: posting.spaceId,
        tokenHash: uploadTokenHash(token),
        files: storedFiles,
        expiresAt,
      },
    })
    return NextResponse.json(
      { uploadSessionId: id, uploadToken: token, expiresAt, uploads },
      { status: 201 }
    )
  } catch {
    return errorResponse('첨부 업로드를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요', 503)
  }
}
