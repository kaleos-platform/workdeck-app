import { z } from 'zod'
import { Prisma, type PrismaClient } from '@/generated/prisma/client'
import { createTemplateSchema } from '@/lib/validations/hiring-posts'
import { migrationHash } from './ledger'
import {
  planPostingContent,
  type PostingContentInput,
  type PreparedContentResource,
  type VerifiedContentImage,
} from './posting-content'

const id = z.string().regex(/^[1-9]\d{0,18}$/)
const instant = z.iso.datetime({ offset: true })
const packetSchema = z.object({
  sourceSpaceId: id,
  sourceTemplateId: id,
  sourceWebOrigin: z.url(),
  template: z.object({
    id,
    brand_id: id,
    status: z.literal(1),
    name: createTemplateSchema.shape.name,
    created_at: instant,
    updated_at: instant,
    image_key: z.string(),
    data: z.array(z.unknown()),
  }),
})
type TemplateContent = Omit<PostingContentInput, 'originalApplyUrl' | 'detailImage'> & {
  resources: Record<
    string,
    PreparedContentResource & { sourceSpaceId: string; sourceTemplateId: string }
  >
}
export type OpeningTemplatePacket = z.input<typeof packetSchema> & {
  cover?: VerifiedContentImage
  content: TemplateContent
}
export type OpeningTemplateTarget = { sourceSpaceId: string; spaceId: string; ownerUserId: string }
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
const json = (v: unknown): unknown => JSON.parse(JSON.stringify(v))
const formUrl = 'https://app.workdeck.work/__migration_template_form__'

export function planOpeningTemplate(raw: OpeningTemplatePacket, target: OpeningTemplateTarget) {
  const packet = packetSchema.parse(raw)
  if (
    !z
      .object({
        sourceSpaceId: id,
        spaceId: z.string().regex(/^[A-Za-z0-9_-]+$/),
        ownerUserId: z.string().min(1),
      })
      .safeParse(target).success
  )
    throw Error('TEMPLATE_SCOPE_REQUIRED')
  if (
    packet.sourceSpaceId !== target.sourceSpaceId ||
    packet.template.brand_id !== packet.sourceSpaceId ||
    packet.template.id !== packet.sourceTemplateId ||
    !target.ownerUserId ||
    !/^[A-Za-z0-9_-]+$/.test(target.spaceId)
  )
    throw Error('TEMPLATE_SCOPE_REQUIRED')
  const origin = new URL(packet.sourceWebOrigin)
  if (!['https:', 'http:'].includes(origin.protocol) || origin.origin !== packet.sourceWebOrigin)
    throw Error('INVALID_SOURCE_ORIGIN')
  if (
    !record(raw.content) ||
    !record(raw.content.resources) ||
    !record(raw.content.images) ||
    ('detailImage' in raw.content && raw.content.detailImage !== undefined) ||
    migrationHash(raw.content.detail) !== migrationHash(packet.template.data)
  )
    throw Error('TEMPLATE_CONTENT_MISMATCH')
  for (const resource of Object.values(raw.content.resources))
    if (
      !record(resource) ||
      resource.sourceSpaceId !== packet.sourceSpaceId ||
      resource.sourceTemplateId !== packet.sourceTemplateId
    )
      throw Error('TEMPLATE_RESOURCE_SCOPE_MISMATCH')
  const assets = [
    ...Object.values(raw.content.resources),
    ...Object.values(raw.content.images),
    ...(raw.cover ? [raw.cover] : []),
  ]
  for (const asset of assets)
    if (
      !asset ||
      asset.verified !== true ||
      typeof asset.copiedImagePath !== 'string' ||
      !asset.copiedImagePath.startsWith(target.spaceId + '/') ||
      !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(asset.copiedImagePath) ||
      asset.copiedImagePath.split('/').some((part) => part === '.' || part === '..') ||
      !/^([a-f0-9]{64})$/.test(asset.sha256 ?? '') ||
      !Number.isSafeInteger(asset.sizeBytes) ||
      asset.sizeBytes! < 1 ||
      asset.sizeBytes! > 10 * 1024 * 1024
    )
      throw Error('TEMPLATE_ASSET_MANIFEST_REQUIRED')
  if (
    packet.template.image_key
      ? raw.cover?.sourceImageKey !== packet.template.image_key
      : raw.cover !== undefined
  )
    throw Error('TEMPLATE_COVER_MISMATCH')
  // 원본도 빈 링크와 /p/ 링크를 새 공고의 지원 주소로 치환한다. 외부 링크는 유지한다.
  const detail = packet.template.data.map((section, index) => {
    if (
      record(section) &&
      section.enabled &&
      !['content', 'content_link', 'image'].includes(String(section.type))
    )
      throw Error('UNSUPPORTED_TEMPLATE_SECTION')
    if (record(section) && section.enabled && section.type === 'image') {
      const image =
        raw.content.images['index:' + index] ??
        (typeof section.uuid === 'string' ? raw.content.images['uuid:' + section.uuid] : undefined)
      if (
        typeof section.image_key !== 'string' ||
        !section.image_key ||
        image?.sourceImageKey !== section.image_key
      )
        throw Error('TEMPLATE_IMAGE_SOURCE_MISMATCH')
    }
    if (!record(section) || section.type !== 'content_link') return section
    if (section.url === '') return { ...section, url: formUrl }
    if (typeof section.url === 'string') {
      try {
        const url = new URL(section.url)
        if (url.username || url.password) throw Error('TEMPLATE_UNSAFE_LINK')
        if (url.origin === origin.origin && url.pathname.startsWith('/p/'))
          return { ...section, url: formUrl }
      } catch (error) {
        if (error instanceof Error && error.message === 'TEMPLATE_UNSAFE_LINK') throw error
      }
    }
    return section
  })
  const content = planPostingContent({ ...raw.content, detail, originalApplyUrl: formUrl })
  if (!content.ok) throw Error('TEMPLATE_CONTENT_' + content.code.toUpperCase())
  return {
    packet,
    blocks: content.blocks,
    contentHash: migrationHash({ target, blocks: content.blocks, cover: raw.cover ?? null }),
    excludedDisabled: content.excludedDisabled,
    cover: raw.cover,
    sourceRef: 'opening:detail_template:' + packet.sourceTemplateId,
  }
}

const include = { contents: { orderBy: { sortOrder: 'asc' as const } } }
export async function importOpeningTemplate(
  db: Pick<PrismaClient, '$transaction'>,
  raw: OpeningTemplatePacket,
  target: OpeningTemplateTarget
) {
  const plan = planOpeningTemplate(raw, target)
  const fields = {
    spaceId: target.spaceId,
    name: plan.packet.template.name,
    data: plan.packet.template.data as Prisma.InputJsonValue,
    imagePath: plan.cover?.copiedImagePath ?? null,
    isSample: false,
    sourceRef: plan.sourceRef,
    createdAt: new Date(plan.packet.template.created_at),
    updatedAt: new Date(plan.packet.template.updated_at),
  }
  const blocks = plan.blocks.map((block) => ({
    ...block,
    spaceId: target.spaceId,
    sourceType: 'DETAIL_TEMPLATE' as const,
    postingId: null,
  }))
  const expected = json({ ...fields, contents: blocks })
  return db.$transaction(async (tx) => {
    const owner = await tx.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: target.spaceId, userId: target.ownerUserId } },
      select: { role: true },
    })
    if (owner?.role !== 'OWNER') throw Error('TEMPLATE_OWNER_REQUIRED')
    const existing = await tx.hiringDetailTemplate.findUnique({
      where: { sourceRef: plan.sourceRef },
      include,
    })
    if (existing) {
      const current = json({
        spaceId: existing.spaceId,
        name: existing.name,
        data: existing.data,
        imagePath: existing.imagePath,
        isSample: existing.isSample,
        sourceRef: existing.sourceRef,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
        contents: existing.contents.map((c) => ({
          contentType: c.contentType,
          title: c.title,
          data: c.data,
          imagePath: c.imagePath,
          sortOrder: c.sortOrder,
          spaceId: c.spaceId,
          sourceType: c.sourceType,
          postingId: c.postingId ?? null,
        })),
      })
      if (migrationHash(current) !== migrationHash(expected))
        throw Error('TEMPLATE_SOURCE_OR_TARGET_CONFLICT')
      return { status: 'existing' as const, target: existing }
    }
    const created = await tx.hiringDetailTemplate.create({
      data: {
        ...fields,
        contents: {
          create: blocks.map((block) => ({
            ...block,
            data: block.data === null ? Prisma.JsonNull : (block.data as Prisma.InputJsonValue),
          })),
        },
      },
      include,
    })
    return { status: 'created' as const, target: created }
  })
}
