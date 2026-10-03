import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/api-helpers'
import { fileFieldError } from '@/lib/hiring/file-fields'
import { typedSubmissionError } from '@/lib/hiring/form-values'
import { buildApplicationPii, type ApplicationEntryValue } from '@/lib/hiring/pii'
import { checkRateLimit } from '@/lib/hiring/applications'
import { publicRequestKey } from '@/lib/hiring/public-request'
import {
  completeUploadSchema,
  storedUploadFilesSchema,
  uploadTokenHash,
  submissionHash,
} from '@/lib/hiring/upload-protocol'
import { inspectApplicantUpload, ALLOWED_APPLICANT_MIME } from '@/lib/hiring/storage'
import { parseApplicationEntriesSchema } from '@/lib/validations/hiring-applicants'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  if (!checkRateLimit(`complete:${publicRequestKey(req)}`))
    return errorResponse('요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요', 429)
  const parsed = completeUploadSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errorResponse('지원서 입력값이 올바르지 않습니다', 400)
  const body = parsed.data
  const tokenHash = uploadTokenHash(body.uploadToken)
  const session = await prisma.hiringUploadSession.findFirst({
    where: { id: body.uploadSessionId, tokenHash },
  })
  if (!session) return errorResponse('첨부 업로드가 만료되었습니다. 파일을 다시 선택해 주세요', 410)
  const requestHash = submissionHash(body)
  if (session.completedAt) {
    if (session.requestHash !== requestHash || !session.applicationId)
      return errorResponse('이미 다른 지원서로 제출된 첨부입니다', 409)
    const app = await prisma.hiringApplication.findFirst({
      where: { id: session.applicationId, spaceId: session.spaceId },
      select: { uuid: true },
    })
    return app
      ? NextResponse.json({ uuid: app.uuid }, { status: 201 })
      : errorResponse('제출 결과를 확인할 수 없습니다', 409)
  }
  if (session.expiresAt <= new Date() || !session.postingId)
    return errorResponse('첨부 업로드가 만료되었습니다. 다시 제출해 주세요', 410)
  const posting = await prisma.hiringPosting.findUnique({
    where: { id: session.postingId },
    include: { positions: { select: { id: true } }, stores: { select: { storeId: true } } },
  })
  if (
    !posting ||
    posting.spaceId !== session.spaceId ||
    posting.uuid !== body.postingUuid ||
    posting.status !== 'ACTIVE'
  )
    return errorResponse('지원 가능한 공고가 아닙니다', 410)
  const fields = parseApplicationEntriesSchema(posting.applicationEntries)
  const valuesError = typedSubmissionError(fields, body.entries)
  if (valuesError) return errorResponse(valuesError, 400)
  const stored = storedUploadFilesSchema.safeParse(session.files)
  if (!stored.success) return errorResponse('첨부 연결 정보를 확인할 수 없습니다', 409)
  const files = stored.data
  const fileError = fileFieldError(
    fields,
    files.map((file) => file.fieldKey),
    files.length,
    files.map((file) => file.sizeBytes)
  )
  if (fileError) return errorResponse(fileError, 400)
  if (files.some((file) => !ALLOWED_APPLICANT_MIME.has(file.mimeType)))
    return errorResponse('허용되지 않는 파일 형식입니다', 400)
  if (
    body.postingPositionId &&
    !posting.positions.some((position) => position.id === body.postingPositionId)
  )
    return errorResponse('공고에 없는 모집 분야입니다', 400)
  if (body.storeIds?.some((id) => !posting.stores.some((store) => store.storeId === id)))
    return errorResponse('공고에 없는 근무지입니다', 400)
  try {
    for (const file of files) {
      if (!file.path.startsWith(`${session.spaceId}/applications/${session.id}/`))
        return errorResponse('첨부 연결이 올바르지 않습니다', 409)
      const actual = await inspectApplicantUpload(file.path)
      if (actual.sizeBytes !== file.sizeBytes || actual.mimeType !== file.mimeType)
        return errorResponse('첨부 크기나 형식이 일치하지 않습니다. 파일을 다시 선택해 주세요', 400)
    }
  } catch {
    return errorResponse('첨부 업로드가 완료되지 않았습니다. 잠시 후 다시 제출하세요', 409)
  }
  const entries: ApplicationEntryValue[] = body.entries
    .filter((entry) => entry.type !== 'file')
    .map((entry) => ({ ...entry, label: fields.find((field) => field.key === entry.key)?.label }))
  for (const field of fields.filter((field) => field.type === 'file')) {
    const attached = files.filter((file) => file.fieldKey === field.key)
    entries.push({
      key: field.key,
      type: 'file',
      label: field.label,
      value: attached.map((file) => file.fileName),
      fileIds: attached.map((file) => file.id),
    })
  }
  try {
    const { columns, sanitizedEntries } = buildApplicationPii(entries)
    const result = await prisma.$transaction(async (tx) => {
      // 원자적 claim과 지원서 생성으로 동시 제출·응답 유실 재시도를 처리한다.
      const claimed = await tx.hiringUploadSession.updateMany({
        where: {
          id: session.id,
          tokenHash,
          claimedAt: null,
          completedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { claimedAt: new Date(), requestHash },
      })
      if (!claimed.count) {
        const previous = await tx.hiringUploadSession.findUnique({ where: { id: session.id } })
        if (previous?.completedAt && previous.requestHash === requestHash && previous.applicationId)
          return tx.hiringApplication.findUniqueOrThrow({
            where: { id: previous.applicationId },
            select: { uuid: true },
          })
        throw Error('conflict')
      }
      const recent = await tx.hiringApplication.count({
        where: { postingId: posting.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
      })
      if (recent >= 60) throw Error('capacity')
      const duplicated = columns.phoneHash
        ? !!(await tx.hiringApplication.findFirst({
            where: { postingId: posting.id, phoneHash: columns.phoneHash, deletedAt: null },
            select: { id: true },
          }))
        : false
      const app = await tx.hiringApplication.create({
        data: {
          id: session.id,
          uuid: randomUUID(),
          spaceId: session.spaceId,
          postingId: posting.id,
          postingPositionId: body.postingPositionId ?? null,
          applicationEntries: sanitizedEntries as unknown as object,
          ...columns,
          privacyAgreedAt: new Date(),
          duplicated,
          referrer: body.referrer ?? null,
          stores: body.storeIds?.length
            ? { create: [...new Set(body.storeIds)].map((storeId) => ({ storeId })) }
            : undefined,
          files: {
            create: files.map((file) => ({
              id: file.id,
              spaceId: session.spaceId,
              fileName: file.fileName,
              filePath: file.path,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
            })),
          },
        },
        select: { id: true, uuid: true },
      })
      await tx.hiringUploadSession.update({
        where: { id: session.id },
        data: { applicationId: app.id, completedAt: new Date() },
      })
      return app
    })
    return NextResponse.json({ uuid: result.uuid }, { status: 201 })
  } catch {
    return errorResponse('지원서를 저장하지 못했습니다. 잠시 후 같은 내용으로 다시 제출하세요', 409)
  }
}
