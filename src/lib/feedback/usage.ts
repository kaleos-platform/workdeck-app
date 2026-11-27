import 'server-only'
import { prisma } from '@/lib/prisma'

/** 사용 중 Storage 바이트 = 미삭제 첨부 + 삭제 대기(원장) */
export async function feedbackStorageUsedBytes(
  db: Pick<typeof prisma, 'userFeedbackAttachment' | 'feedbackFileDeletion'> = prisma
): Promise<number> {
  const [a, l] = await Promise.all([
    db.userFeedbackAttachment.aggregate({ where: { deletedAt: null }, _sum: { sizeBytes: true } }),
    db.feedbackFileDeletion.aggregate({ _sum: { bytes: true } }),
  ])
  return (a._sum.sizeBytes ?? 0) + (l._sum.bytes ?? 0)
}
