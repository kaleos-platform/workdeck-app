/** @jest-environment node */
import { spawnSync } from 'node:child_process'
import type { PrismaClient } from '@/generated/prisma/client'
import {
  planOpeningTemplate,
  importOpeningTemplate,
  type OpeningTemplatePacket,
} from '../template-import'

const at = '2023-09-04T00:00:00.000Z'
function packet(): OpeningTemplatePacket {
  return {
    sourceSpaceId: '1',
    sourceTemplateId: '19',
    sourceWebOrigin: 'https://opening.work',
    template: {
      id: '19',
      brand_id: '1',
      status: 1,
      name: '합성 템플릿',
      created_at: at,
      updated_at: at,
      image_key: 'cover',
      data: [
        {
          type: 'content_link',
          enabled: true,
          resource_id: '10',
          url: 'https://opening.work/p/old/apply',
        },
      ],
    },
    cover: {
      sourceImageKey: 'cover',
      copiedImagePath: 'space/migration/cover/checksum',
      verified: true,
      sha256: 'a'.repeat(64),
      sizeBytes: 10,
    },
    content: {
      detail: [
        {
          type: 'content_link',
          enabled: true,
          resource_id: '10',
          url: 'https://opening.work/p/old/apply',
        },
      ],
      resources: {
        '10': {
          sourceSpaceId: '1',
          sourceTemplateId: '19',
          sourceImageKey: 'image',
          copiedImagePath: 'space/migration/image/checksum',
          verified: true,
          sha256: 'b'.repeat(64),
          sizeBytes: 20,
          hasSceneSource: true,
          scene: { elements: [], files: {} },
        },
      },
      images: {},
    },
  }
}
const target = { sourceSpaceId: '1', spaceId: 'space', ownerUserId: 'owner' }
it('승인 hash는 같은 이미지 집합이어도 편집 scene의 블록 대응 변경을 감지한다', () => {
  const p = packet()
  p.template.data.push({ type: 'content', enabled: true, resource_id: '11' })
  p.content.detail = p.template.data
  p.content.resources['10'].scene = { elements: [{ type: 'rectangle', id: 'first' }], files: {} }
  p.content.resources['11'] = {
    ...p.content.resources['10'],
    scene: { elements: [{ type: 'rectangle', id: 'second' }], files: {} },
  }
  const before = planOpeningTemplate(p, target)
  const first = p.content.resources['10'].scene
  p.content.resources['10'].scene = p.content.resources['11'].scene
  p.content.resources['11'].scene = first
  const after = planOpeningTemplate(p, target)
  expect(before.blocks.map((b) => b.imagePath)).toEqual(after.blocks.map((b) => b.imagePath))
  expect(before).toHaveProperty('contentHash', expect.stringMatching(/^[a-f0-9]{64}$/))
  expect(before.contentHash).not.toBe(after.contentHash)
})
it('직접 이미지 블록은 원본 image_key에 대응하는 파일만 사용한다', () => {
  const p = packet()
  p.template.data = [{ type: 'image', enabled: true, image_key: 'original', uuid: 'direct' }]
  p.content.detail = p.template.data
  p.content.images['uuid:direct'] = { ...p.cover!, sourceImageKey: 'original' }
  expect(planOpeningTemplate(p, target).blocks).toHaveLength(1)
  p.content.images['index:0'] = { ...p.cover!, sourceImageKey: 'unrelated' }
  expect(() => planOpeningTemplate(p, target)).toThrow('TEMPLATE_IMAGE_SOURCE_MISMATCH')
})
let stored: Record<string, unknown> | null
const tx = {
  spaceMember: { findUnique: jest.fn() },
  hiringDetailTemplate: { findUnique: jest.fn(), create: jest.fn() },
}
const db = { $transaction: jest.fn(async (fn) => fn(tx)) } as unknown as Pick<
  PrismaClient,
  '$transaction'
>
beforeEach(() => {
  jest.clearAllMocks()
  stored = null
  tx.spaceMember.findUnique.mockResolvedValue({ role: 'OWNER' })
  tx.hiringDetailTemplate.findUnique.mockImplementation(async () => stored)
  tx.hiringDetailTemplate.create.mockImplementation(async ({ data }) => {
    stored = { ...data, id: 'template', contents: data.contents.create }
    return stored
  })
})
it('대표 이미지를 본문에 추가하지 않고 지원 링크를 새 공고 form으로 변환한다', () => {
  const p = packet()
  const plan = planOpeningTemplate(p, target)
  expect(plan.blocks).toHaveLength(1)
  expect(plan.blocks[0].data).toMatchObject({ link: { linkType: 'form' } })
  expect(plan.cover?.copiedImagePath).toBe(p.cover?.copiedImagePath)
  expect(p.template.data[0]).toMatchObject({ url: 'https://opening.work/p/old/apply' })
})
it.each(['', 'https://opening.work/p/old'])('지원 링크 %s는 form이다', (url) => {
  const p = packet()
  p.template.data[0] = { ...(p.template.data[0] as object), url }
  p.content.detail = p.template.data
  expect(planOpeningTemplate(p, target).blocks[0].data).toMatchObject({
    link: { linkType: 'form' },
  })
})
it('외부 HTTP 링크는 유지하고 비 HTTP 링크는 차단한다', () => {
  const p = packet()
  p.template.data[0] = { ...(p.template.data[0] as object), url: 'https://example.com/info' }
  p.content.detail = p.template.data
  expect(planOpeningTemplate(p, target).blocks[0].data).toMatchObject({
    link: { linkType: 'url', url: 'https://example.com/info' },
  })
  p.template.data[0] = { ...(p.template.data[0] as object), url: 'javascript:alert(1)' }
  expect(() => planOpeningTemplate(p, target)).toThrow()
})
it.each(['brand', 'status', 'resource', 'path', 'cover', 'checksum', 'detail'])(
  '%s 이탈은 계획에서 차단한다',
  (kind) => {
    const p = packet()
    if (kind === 'brand') p.template.brand_id = '2'
    if (kind === 'status') Object.assign(p.template, { status: 0 })
    if (kind === 'resource') p.content.resources['10'].sourceTemplateId = '20'
    if (kind === 'path') p.content.resources['10'].copiedImagePath = 'other/image/file'
    if (kind === 'cover') p.cover!.sourceImageKey = 'wrong'
    if (kind === 'checksum') p.content.resources['10'].sha256 = 'wrong'
    if (kind === 'detail') p.content.detail = []
    expect(() => planOpeningTemplate(p, target)).toThrow()
  }
)
it('한 transaction에 생성하고 재실행은 추가 생성 없이 확인한다', async () => {
  const p = packet()
  expect((await importOpeningTemplate(db, p, target)).status).toBe('created')
  expect((await importOpeningTemplate(db, p, target)).status).toBe('existing')
  expect(tx.hiringDetailTemplate.create).toHaveBeenCalledTimes(1)
  expect(stored).toMatchObject({
    spaceId: 'space',
    isSample: false,
    sourceRef: 'opening:detail_template:19',
    data: p.template.data,
  })
})
it.each(['name', 'space', 'sample', 'source', 'content', 'owner'])(
  '%s 변경/불일치를 덮어쓰지 않는다',
  async (kind) => {
    const p = packet()
    await importOpeningTemplate(db, p, target)
    if (kind === 'name') stored!.name = '고객 수정'
    if (kind === 'space') stored!.spaceId = 'other'
    if (kind === 'sample') stored!.isSample = true
    if (kind === 'source') p.template.name = '원본 변경'
    if (kind === 'content') (stored!.contents as Array<{ title: string }>)[0].title = '수정'
    if (kind === 'owner') tx.spaceMember.findUnique.mockResolvedValue({ role: 'MEMBER' })
    await expect(importOpeningTemplate(db, p, target)).rejects.toThrow()
    expect(tx.hiringDetailTemplate.create).toHaveBeenCalledTimes(1)
  }
)

it('대표 이미지의 경로 이탈과 본문 대표 이미지 주입을 차단한다', () => {
  const p = packet()
  p.cover!.copiedImagePath = 'space/../other/cover'
  expect(() => planOpeningTemplate(p, target)).toThrow()
  const another = packet()
  Object.assign(another.content, {
    detailImage: { ...another.cover, copiedImagePath: 'other/image/file' },
  })
  expect(() => planOpeningTemplate(another, target)).toThrow()
})
it('새로운 동적 블록과 URL 자격정보는 자동 변환하지 않는다', () => {
  const p = packet()
  p.template.data = [{ type: 'manager', enabled: true }]
  p.content.detail = p.template.data
  expect(() => planOpeningTemplate(p, target)).toThrow()
  const another = packet()
  another.template.data[0] = {
    ...(another.template.data[0] as object),
    url: 'https://user:password@opening.work/p/old',
  }
  another.content.detail = another.template.data
  expect(() => planOpeningTemplate(another, target)).toThrow()
})

it('CLI 기본 dry-run은 키·DB 없이 계획만 출력하고 다른 범위는 차단한다', () => {
  const body = { packet: packet(), target }
  const args = [
    'scripts/import-opening-template.mjs',
    '--source-space',
    '1',
    '--target-space',
    'space',
  ]
  const env = { ...process.env }
  for (const key of Object.keys(env))
    if (
      key.startsWith('ENCRYPTION_') ||
      key.includes('DATABASE_URL') ||
      key.includes('SERVICE_ROLE')
    )
      delete env[key]
  const run = spawnSync(process.execPath, args, {
    input: JSON.stringify(body),
    encoding: 'utf8',
    env,
  })
  expect(run.status).toBe(0)
  expect(JSON.parse(run.stdout)).toMatchObject({
    status: 'PLANNED',
    writes: 0,
    templates: 1,
    contentBlocks: 1,
    hasCover: true,
  })
  expect(run.stdout + run.stderr).not.toContain('합성 템플릿')
  const wrong = spawnSync(process.execPath, [...args.slice(0, -1), 'other'], {
    input: JSON.stringify(body),
    encoding: 'utf8',
    env,
  })
  expect(wrong.status).toBe(1)
  expect(wrong.stderr).toContain('SCOPE_MISMATCH')
  const noTarget = spawnSync(process.execPath, [...args, '--apply'], {
    input: JSON.stringify(body),
    encoding: 'utf8',
    env,
  })
  expect(noTarget.status).toBe(1)
  expect(noTarget.stderr).toContain('EXPLICIT_TARGET_REQUIRED')
})
