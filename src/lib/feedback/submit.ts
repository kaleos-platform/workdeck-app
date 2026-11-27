import 'server-only'
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errorResponse, resolveRequestedSpaceContext } from '@/lib/api-helpers'
import { checkRateLimit } from '@/lib/hiring/applications'
import { sniffImage } from '@/lib/hiring/storage'
import {
  MAX_FILES,
  MAX_FILE_BYTES,
  feedbackInputSchema,
  storageCapBytes,
} from '@/lib/feedback/policy'
import {
  assertFeedbackBucket,
  removeFeedbackFiles,
  uploadFeedbackFile,
} from '@/lib/feedback/storage'
import { notifyFeedbackSlack } from '@/lib/feedback/notify'
import { after } from 'next/server'

const EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const
const MAX_REQUEST_BYTES = 4_000_000

type User = { id: string; email?: string | null }

export async function submitFeedback(req: Request, user: User): Promise<NextResponse> {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_REQUEST_BYTES)
    return errorResponse('요청이 너무 큽니다', 413)
  const form = await req.formData().catch(() => null)
  if (!form) return errorResponse('잘못된 요청입니다', 400)

  const parsed = feedbackInputSchema.omit({ pagePath: true }).safeParse({
    type: form.get('type'),
    body: form.get('body'),
  })
  if (!parsed.success) return errorResponse('입력한 내용을 확인해 주세요', 400)
  // 화면 주소는 부가 정보 — 잘못돼도 의견 자체는 받는다
  const path = feedbackInputSchema.shape.pagePath.safeParse(form.get('pagePath') ?? undefined)
  const pagePath = path.success ? (path.data ?? null) : null

  const raw = form.getAll('files').filter((f): f is File => typeof f !== 'string' && f.size > 0)
  if (raw.length > MAX_FILES)
    return errorResponse(`이미지는 ${MAX_FILES}장까지 첨부할 수 있습니다`, 400)
  if (raw.some((f) => f.size > MAX_FILE_BYTES))
    return errorResponse('이미지는 장당 1MB 이하여야 합니다', 413)
  const files: { data: Uint8Array; mime: keyof typeof EXT }[] = []
  for (const f of raw) {
    const data = new Uint8Array(await f.arrayBuffer())
    const mime = sniffImage(data)
    if (!mime) return errorResponse('png, jpg, webp, gif 이미지만 첨부할 수 있습니다', 400)
    files.push({ data, mime })
  }

  if (!checkRateLimit(`feedback:${user.id}`))
    return errorResponse('요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요', 429)

  // 작업 공간이 없는 사용자도 제출할 수 있다(404 → null). 비구성원 403 등은 그대로 거절.
  const ctx = await resolveRequestedSpaceContext(null)
  let space: { id: string; name: string } | null = null
  if ('error' in ctx) {
    if (ctx.error.status !== 404) return ctx.error
  } else space = ctx.space

  // ponytail: 상한 검사는 lock 없음 — 동시 요청 시 수 MB 초과 가능, 포함량 100GB 대비 무시. 정밀 상한 필요 시 advisory lock.
  const bytes = files.reduce((s, f) => s + f.data.length, 0)
  let capReached = false
  if (files.length) {
    const [a, l] = await Promise.all([
      prisma.userFeedbackAttachment.aggregate({
        where: { deletedAt: null },
        _sum: { sizeBytes: true },
      }),
      prisma.feedbackFileDeletion.aggregate({ _sum: { bytes: true } }),
    ])
    capReached = (a._sum.sizeBytes ?? 0) + (l._sum.bytes ?? 0) + bytes > storageCapBytes()
    if (!capReached) {
      try {
        await assertFeedbackBucket()
      } catch (e) {
        console.error('[feedback]', (e as Error).message)
        return errorResponse('이미지를 첨부할 수 없습니다. 잠시 후 다시 시도해 주세요', 503)
      }
    }
  }

  const fb = await prisma.userFeedback.create({
    data: {
      userId: user.id,
      spaceId: space?.id ?? null,
      type: parsed.data.type,
      body: parsed.data.body,
      pagePath,
      userAgent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
    },
    select: { id: true },
  })

  const upload = files.length > 0 && !capReached
  if (upload) {
    const items = files.map((f) => ({ ...f, path: `${fb.id}/${randomUUID()}.${EXT[f.mime]}` }))
    const paths = items.map((i) => i.path)
    // 경로는 업로드 전에 원장에 예약 — 어디서 끊겨도 cron이 정리한다
    const ledger = await prisma.feedbackFileDeletion.create({
      data: { paths, bytes },
      select: { id: true },
    })
    const uploaded: string[] = []
    try {
      for (const i of items) {
        await uploadFeedbackFile(i.path, i.data, i.mime)
        uploaded.push(i.path)
      }
      await prisma.$transaction([
        prisma.userFeedbackAttachment.createMany({
          data: items.map((i) => ({
            feedbackId: fb.id,
            path: i.path,
            mimeType: i.mime,
            sizeBytes: i.data.length,
          })),
        }),
        prisma.feedbackFileDeletion.delete({ where: { id: ledger.id } }),
      ])
    } catch (e) {
      console.error('[feedback] 첨부 저장 실패:', (e as Error).message)
      // 정리에 모두 성공한 경우에만 원장 삭제 — 아니면 원장이 남아 cron이 재시도(실패한 업로드 경로 포함)
      const r = await removeFeedbackFiles(paths).catch(() => ({ failed: paths }))
      if (r.failed.length === 0)
        await prisma.feedbackFileDeletion.delete({ where: { id: ledger.id } }).catch(() => null)
      await prisma.userFeedback.delete({ where: { id: fb.id } }).catch(() => null)
      return errorResponse('의견을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요', 500)
    }
  }

  after(() =>
    notifyFeedbackSlack({
      id: fb.id,
      type: parsed.data.type,
      userEmail: user.email ?? '(이메일 없음)',
      spaceName: space?.name ?? null,
      pagePath,
      body: parsed.data.body,
      attachmentCount: upload ? files.length : 0,
      capReached,
    })
  )
  return NextResponse.json(
    { id: fb.id, attachmentsAccepted: !capReached, attachmentReason: capReached ? 'cap' : null },
    { status: 201 }
  )
}
