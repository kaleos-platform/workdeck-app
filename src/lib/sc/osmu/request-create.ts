// 노션을 열지 않고 발행 요청을 거는 경로(에밀리 sc_request_post).
// 노션 「콘텐츠 발행」 행을 만들거나 재사용해 「작성 요청」으로 두고, 10분 cron 을 기다리지 않고 바로 수신 처리를 돌린다.
// 노션은 계속 기록·확인 창구 — 상태는 기존 projection 이 되쓴다.

import { prisma } from '@/lib/prisma'
import { loadSpaceCredential } from '@/lib/agent/integrations/space-credential'
import { ToolUserError } from '@/lib/agent/tools/errors'
import { NOTION_STATUS, propText, REQUEST_PROPS, SOURCE_PROPS } from './notion-schema'
import { createPage, queryDataSource, updatePageProperties } from './notion'
import { runIntakeForSpace } from './intake'
import { isPublishable } from './media-copy'

export type RequestPostInput = {
  source: string // 소재 제목(일부여도 됨)
  kind: string
  brief?: string
  desiredDate?: string // YYYY-MM-DD
}

const rt = (s: string) => [{ type: 'text', text: { content: s.slice(0, 1900) } }]
// 이 상태의 행은 끝난 것 — 같은 소재·유형이어도 새 행을 만든다.
const CLOSED = new Set<string>([NOTION_STATUS.PUBLISHED, NOTION_STATUS.CANCELED])

export async function requestPost(spaceId: string, input: RequestPostInput, deadline: number) {
  const conn = await prisma.scNotionConnection.findUnique({ where: { spaceId } })
  if (!conn) throw new ToolUserError('노션이 연결되지 않았습니다(세일즈 콘텐츠 설정 > 소재 연결)')
  const { secret } = await loadSpaceCredential<{ token: string }>(spaceId, 'notion', [])
  const token = secret.token

  // 1) 소재 찾기 — 제목 부분 일치, 정확히 1개여야 한다.
  const sources = await queryDataSource(token, conn.sourceDataSourceId, {
    property: SOURCE_PROPS.title,
    title: { contains: input.source.trim() },
  })
  if (sources.length !== 1) {
    const all =
      sources.length > 1
        ? sources
        : await queryDataSource(token, conn.sourceDataSourceId, undefined, 1)
    const titles = all.map((p) => propText(p.properties[SOURCE_PROPS.title])).slice(0, 20)
    throw new ToolUserError(
      `${sources.length === 0 ? '소재를 찾지 못했습니다' : '소재가 여러 개 맞습니다'}. 소재 제목: ${titles.join(' / ') || '(없음)'}`
    )
  }
  const source = sources[0]
  const sourceTitle = propText(source.properties[SOURCE_PROPS.title])

  // 2) 같은 소재·유형의 진행 중 행이 있으면 재사용(에이전트 재시도·중복 요청 방지).
  const existing = (
    await queryDataSource(token, conn.requestDataSourceId, {
      and: [
        { property: REQUEST_PROPS.source, relation: { contains: source.id } },
        { property: REQUEST_PROPS.kind, select: { equals: input.kind } },
      ],
    })
  ).find((p) => !CLOSED.has(propText(p.properties[REQUEST_PROPS.status])))

  let pageId: string
  let reused = false
  if (existing) {
    pageId = existing.id
    reused = true
    // 요청 전(빈 상태)이거나 막혔던 행(확인 필요)이면 다시 요청으로 올린다 — 수신 쪽이 재시작한다.
    // 이미 진행 중(작성 중·승인 대기 등)이면 그대로 둔다.
    const status = propText(existing.properties[REQUEST_PROPS.status])
    if (!status || status === NOTION_STATUS.NEEDS_REVIEW) {
      await updatePageProperties(token, pageId, {
        ...(input.brief && { [REQUEST_PROPS.brief]: { rich_text: rt(input.brief) } }),
        ...(input.desiredDate && {
          [REQUEST_PROPS.desiredDate]: { date: { start: input.desiredDate } },
        }),
        [REQUEST_PROPS.status]: { select: { name: NOTION_STATUS.REQUESTED } },
      })
    }
  } else {
    const page = await createPage(token, conn.requestDataSourceId, {
      [REQUEST_PROPS.title]: { title: rt(`${sourceTitle} ${input.kind}`) },
      [REQUEST_PROPS.source]: { relation: [{ id: source.id }] },
      [REQUEST_PROPS.kind]: { select: { name: input.kind } },
      ...(input.brief && { [REQUEST_PROPS.brief]: { rich_text: rt(input.brief) } }),
      ...(input.desiredDate && {
        [REQUEST_PROPS.desiredDate]: { date: { start: input.desiredDate } },
      }),
      [REQUEST_PROPS.status]: { select: { name: NOTION_STATUS.REQUESTED } },
    })
    pageId = page.id
  }

  // 3) 바로 수신 처리(소재 정리·사진 동기화·남은 시간만큼 사진 설명·노션 되쓰기).
  const report = await runIntakeForSpace(spaceId, deadline)

  const r = await prisma.scPublishRequest.findUnique({
    where: { spaceId_notionPageId: { spaceId, notionPageId: pageId } },
    select: { id: true, state: true, lastError: true, sourceId: true },
  })
  const media = r?.sourceId
    ? await prisma.scMedia.findMany({
        where: { spaceId, sourceId: r.sourceId, removedAt: null },
        select: {
          faceStatus: true,
          md5: true,
          allowedMd5: true,
          removedAt: true,
          describedAt: true,
        },
      })
    : []
  return {
    requestId: r?.id ?? null,
    state: r?.state ?? 'RECEIVED',
    source: sourceTitle,
    reusedExistingRow: reused,
    lastError: r?.lastError ?? null,
    photos: media.length,
    photosDescribed: media.filter((m) => m.describedAt).length,
    publishablePhotos: media.filter(isPublishable).length,
    intakeErrors: report.errors.slice(0, 3),
  }
}
