import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Prisma, type PrismaClient } from '@/generated/prisma/client'
import { encryptPii } from '@/lib/del/encryption'
import { postingPositionSchema } from '@/lib/validations/hiring-posts'
import { planOpeningForm } from '@/lib/hiring/opening-form-migration'
import { importMigrationRecord } from './ledger'
import { planPostingContent, type PostingContentInput } from './posting-content'

const sourceId = z.string().regex(/^[1-9]\d{0,18}$/)
const instant = z.iso.datetime({ offset: true })
const packetSchema = z.object({
  sourceSpaceId: sourceId,
  sourcePostingId: sourceId,
  sourceMemberId: sourceId.nullable(),
  sourceSnapshotAt: instant,
  posting: z.object({
    uuid: z.uuid(),
    title: z.string().min(1).max(200),
    status: z.number().int().min(0).max(4),
    createdAt: instant,
    updatedAt: instant,
    closingDate: instant.nullable(),
    publishedAt: instant.nullable(),
    applicationEntries: z.unknown(),
    managerName: z.string().nullable(),
    managerPhone: z.string().nullable(),
  }),
  positions: z.array(
    z.object({ sourceId, fields: postingPositionSchema, createdAt: instant, updatedAt: instant })
  ),
  storeIds: z.array(z.string().min(1)),
  rawSnapshot: z.unknown(),
})
export type OpeningPostingPacket = z.input<typeof packetSchema> & { content: PostingContentInput }
export type OpeningPostingTarget = {
  sourceSpaceId: string
  spaceId: string
  author: { sourceMemberId: string; userId: string } | null
}
const graphInclude = {
  positions: { orderBy: { id: 'asc' as const } },
  stores: { orderBy: { storeId: 'asc' as const }, include: { store: true } },
  contents: { orderBy: { sortOrder: 'asc' as const } },
}

/**
 * 검증 환경 전용 executor. 호출자는 검증용 DB 연결을 명시적으로 제공한다.
 * 원본 추출/복호화와 파일 복사를 마친 packet만 받으며 공개·알림·결제 경로를 호출하지 않는다.
 */
export function planOpeningPosting(input: OpeningPostingPacket, target: OpeningPostingTarget) {
  const packet = packetSchema.parse(input)
  if (packet.sourceSpaceId !== target.sourceSpaceId || !target.spaceId)
    throw Error('Migration space mapping required')
  if (packet.posting.status === 0) throw Error('Deleted posting policy required')
  if (packet.sourceMemberId !== (target.author?.sourceMemberId ?? null))
    throw Error('Migration author mapping required')
  if (
    new Set(packet.positions.map((p) => p.sourceId)).size !== packet.positions.length ||
    new Set(packet.storeIds).size !== packet.storeIds.length
  )
    throw Error('Duplicate migration relation')
  const form = planOpeningForm(
    `opening.work:posting:${packet.sourcePostingId}`,
    packet.posting.applicationEntries
  )
  if (!form.ok) throw Error(`Migration form blocked: ${form.code}`)
  const content = planPostingContent(input.content)
  if (!content.ok) throw Error(`Migration content blocked: ${content.code}`)
  if (input.content.positionsVerified && packet.positions.length === 0)
    throw Error('Migration positions required')
  if (
    content.blocks.some(
      (block) =>
        block.imagePath &&
        (!block.imagePath.startsWith(`${target.spaceId}/`) ||
          block.imagePath.split('/').some((part) => part === '..' || part === '.'))
    )
  )
    throw Error('Migration asset outside space')
  const assets = [
    ...Object.values(input.content.resources),
    ...Object.values(input.content.images),
    ...(input.content.detailImage ? [input.content.detailImage] : []),
  ]
  for (const block of content.blocks.filter((item) => item.contentType === 'design')) {
    const bytes = assets.find((asset) => asset.copiedImagePath === block.imagePath)?.sizeBytes ?? 0
    // 현재 디자인 편집기의 scene + export PNG 저장 한도(4 MiB)를 넘는 이전은 보류한다.
    if (
      Buffer.byteLength(JSON.stringify(block.data), 'utf8') + Math.ceil(bytes / 3) * 4 + 22 >
      4 * 1024 * 1024
    )
      throw Error('Migration design exceeds editable size')
  }
  return { packet, form, content }
}

export async function importOpeningPosting(
  db: Pick<PrismaClient, '$transaction'>,
  input: OpeningPostingPacket,
  target: OpeningPostingTarget
) {
  const { packet, form, content } = planOpeningPosting(input, target)
  const managerName = packet.posting.managerName ? encryptPii(packet.posting.managerName) : null
  const managerPhone = packet.posting.managerPhone ? encryptPii(packet.posting.managerPhone) : null
  return db.$transaction(async (tx) => {
    if (!(await tx.space.findUnique({ where: { id: target.spaceId }, select: { id: true } })))
      throw Error('Migration space missing')
    if (
      target.author &&
      !(await tx.spaceMember.findUnique({
        where: { spaceId_userId: { spaceId: target.spaceId, userId: target.author.userId } },
        select: { id: true },
      }))
    )
      throw Error('Migration author outside space')
    const stores = await tx.hiringStore.count({
      where: { id: { in: packet.storeIds }, spaceId: target.spaceId, isActive: true },
    })
    if (stores !== packet.storeIds.length) throw Error('Migration store outside space or inactive')
    const positionIds = packet.positions.flatMap((p) =>
      p.fields.positionId ? [p.fields.positionId] : []
    )
    if (
      positionIds.length &&
      (await tx.hiringPosition.count({
        where: { id: { in: [...new Set(positionIds)] }, spaceId: target.spaceId },
      })) !== new Set(positionIds).size
    )
      throw Error('Migration position outside space')
    const positionMap = packet.positions.map((p) => ({
      sourceId: p.sourceId,
      targetId: randomUUID(),
    }))
    const result = await importMigrationRecord(
      tx,
      {
        sourceSystem: 'opening.work',
        sourceTable: 'posting',
        sourceId: packet.sourcePostingId,
        occurrence: '0',
        spaceId: target.spaceId,
        sourceSnapshotAt: new Date(packet.sourceSnapshotAt),
        transformVersion: 'posting-v1',
        snapshot: { ...packet, content: input.content, target },
        targetModel: 'HiringPosting',
      },
      {
        create: (transaction) =>
          transaction.hiringPosting.create({
            data: {
              uuid: packet.posting.uuid,
              spaceId: target.spaceId,
              title: packet.posting.title,
              status: 'DRAFT',
              notificationEnabled: false,
              authorUserId: target.author?.userId ?? null,
              closingDate: packet.posting.closingDate ? new Date(packet.posting.closingDate) : null,
              publishedAt: packet.posting.publishedAt ? new Date(packet.posting.publishedAt) : null,
              createdAt: new Date(packet.posting.createdAt),
              updatedAt: new Date(packet.posting.updatedAt),
              managerNameEnc: managerName?.encrypted ?? null,
              managerNameIv: managerName?.iv ?? null,
              managerPhoneEnc: managerPhone?.encrypted ?? null,
              managerPhoneIv: managerPhone?.iv ?? null,
              applicationEntries: form.fields as Prisma.InputJsonValue,
              positions: {
                create: packet.positions.map((position, index) => ({
                  ...position.fields,
                  id: positionMap[index].targetId,
                  spaceId: target.spaceId,
                  createdAt: new Date(position.createdAt),
                  updatedAt: new Date(position.updatedAt),
                })),
              },
              stores: { create: packet.storeIds.map((storeId) => ({ storeId })) },
              contents: {
                create: content.blocks.map((block) => ({
                  ...block,
                  data:
                    block.data === null ? Prisma.JsonNull : (block.data as Prisma.InputJsonValue),
                  spaceId: target.spaceId,
                  sourceType: 'POSTING_DETAIL',
                })),
              },
            },
            include: graphInclude,
          }),
        read: (transaction, id) =>
          transaction.hiringPosting.findUnique({ where: { id }, include: graphInclude }),
        // 관계와 암호문까지 포함해 고객 편집·관계 변경을 덮어쓰지 않는다.
        snapshot: (posting) => JSON.parse(JSON.stringify(posting)),
      }
    )
    if (result.status === 'created') {
      result.record = await tx.hiringMigrationRecord.update({
        where: { id: result.record.id },
        data: {
          metadata: {
            sourceStatus: packet.posting.status,
            excludedDisabled: content.excludedDisabled,
            positionMap,
          },
        },
      })
    }
    return result
  })
}
