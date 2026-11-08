// 노션 「콘텐츠 소재」 페이지 → ScSource / ScSourceVersion(정규화·버전).
// 항목(행사일·장소·기관·상품·폴더)은 노션 속성에서 결정적으로, 사실·인용만 AI 가 뽑고 근거를 substring 검증한다.

import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { generateTextForSpace } from '@/lib/ai/resolve'
import { blocksToText } from './notion-blocks'
import { normalizedSourceSchema, verifyEvidence, type NormalizedSource } from './evidence'
import { driveFolderIdFromUrl, propText, SOURCE_PROPS } from './notion-schema'
import { getPage, listPageBlocks } from './notion'

const SYSTEM = `너는 행사 기록에서 사실과 인용을 뽑는 편집자다. 입력 원문에 있는 내용만 쓴다.
JSON 으로만 답한다: {"facts":[{"text":"사실 한 문장","evidence":"원문에서 그대로 복사한 근거 구절"}],"quotes":[{"speaker":"말한 사람 또는 null","text":"인용","evidence":"원문에서 그대로 복사한 구절"}]}
- evidence 는 원문을 한 글자도 바꾸지 말고 연속된 구절로 복사한다(요약·띄어쓰기 수정 금지).
- 원문에 없는 수치·이름·평가를 만들지 않는다. 확실하지 않으면 빼라.`

export type ImportResult = {
  sourceId: string
  versionId: string
  created: boolean
  dropped: number
}

export async function importSource(
  spaceId: string,
  token: string,
  notionPageId: string
): Promise<ImportResult> {
  const [page, blocks] = await Promise.all([
    getPage(token, notionPageId),
    listPageBlocks(token, notionPageId),
  ])
  const p = page.properties
  const title = propText(p[SOURCE_PROPS.title]).trim() || '(제목 없음)'
  const folderUrl = propText(p[SOURCE_PROPS.mediaFolder])
  const fields: NormalizedSource['fields'] = {
    eventDate: propText(p[SOURCE_PROPS.eventDate]) || null,
    place: propText(p[SOURCE_PROPS.place]) || null,
    org: propText(p[SOURCE_PROPS.org]) || null,
    products: propText(p[SOURCE_PROPS.products])
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  }
  const { text: rawText, segments } = blocksToText(blocks)
  const contentHash = createHash('sha256')
    .update(JSON.stringify({ title, fields, rawText }))
    .digest('hex')

  const source = await prisma.scSource.upsert({
    where: { spaceId_notionPageId: { spaceId, notionPageId } },
    create: {
      spaceId,
      notionPageId,
      title,
      driveFolderId: driveFolderIdFromUrl(folderUrl),
    },
    update: { title, driveFolderId: driveFolderIdFromUrl(folderUrl) },
    select: { id: true },
  })

  // 같은 내용이면 기존 버전 재사용(AI 호출 없음).
  const same = await prisma.scSourceVersion.findUnique({
    where: { sourceId_contentHash: { sourceId: source.id, contentHash } },
    select: { id: true },
  })
  if (same) {
    await prisma.scSource.update({ where: { id: source.id }, data: { lastImportedAt: new Date() } })
    return { sourceId: source.id, versionId: same.id, created: false, dropped: 0 }
  }

  let normalized: NormalizedSource = { fields, facts: [], quotes: [] }
  if (rawText.trim()) {
    const { result } = await generateTextForSpace(
      spaceId,
      {
        system: SYSTEM,
        messages: [{ role: 'user', content: `제목: ${title}\n\n원문:\n${rawText}` }],
        responseFormat: 'json',
        temperature: 0,
        maxTokens: 4000,
      },
      { actor: { type: 'system', id: 'sc-osmu-import' } }
    )
    const parsed = normalizedSourceSchema.safeParse({ fields, ...safeJson(result.content) })
    if (!parsed.success) throw new Error('소재 정규화 응답 형식 오류')
    normalized = parsed.data
  }
  const { data, dropped } = verifyEvidence(normalized, rawText, segments)

  // 버전 번호는 행 잠금 대신 unique(sourceId, version) 충돌 시 재시도로 정한다.
  for (let i = 0; ; i++) {
    try {
      const version = await prisma.$transaction(async (tx) => {
        const s = await tx.scSource.update({
          where: { id: source.id },
          data: { latestVersion: { increment: 1 }, lastImportedAt: new Date() },
          select: { latestVersion: true },
        })
        return tx.scSourceVersion.create({
          data: {
            sourceId: source.id,
            version: s.latestVersion,
            data: data as never,
            rawText,
            contentHash,
          },
          select: { id: true },
        })
      })
      return { sourceId: source.id, versionId: version.id, created: true, dropped }
    } catch (err) {
      // 동시 가져오기가 같은 해시를 먼저 만들었으면 그것을 쓴다.
      const raced = await prisma.scSourceVersion.findUnique({
        where: { sourceId_contentHash: { sourceId: source.id, contentHash } },
        select: { id: true },
      })
      if (raced) return { sourceId: source.id, versionId: raced.id, created: false, dropped }
      if (i >= 2) throw err
    }
  }
}

function safeJson(text: string): Record<string, unknown> {
  const m = text.match(/\{[\s\S]*\}/)
  try {
    return m ? (JSON.parse(m[0]) as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
