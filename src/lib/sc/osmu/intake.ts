// 노션 「콘텐츠 발행」 수신 → ScPublishRequest 진행 → 노션 상태 되쓰기(projection).
// 클레임은 DB(조건부 update + lease)로만 한다. 노션 상태는 DB 상태를 매번 덮어쓰는 결과물이다(§10).

import { prisma } from '@/lib/prisma'
import { buildAppUrl } from '@/lib/domain'
import { loadSpaceCredential } from '@/lib/agent/integrations/space-credential'
import { maskSecrets } from '@/lib/agent/audit'
import {
  NOTION_STATUS,
  readRequestSnapshot,
  REQUEST_PROPS,
  type RequestSnapshot,
} from './notion-schema'
import { queryDataSource, updatePageProperties } from './notion'
import { canCancel, notionStatusFor } from './projection'
import { importSource } from './source-import'
import { describePendingMedia, syncSourceMedia } from './media-sync'

const LEASE_MS = 5 * 60_000
const MAX_ATTEMPTS = 5
// 사진이 꼭 있어야 하는 유형(P1 은 블로그만 작성).
const NEEDS_PHOTOS = new Set(['블로그'])
const SUPPORTED_KINDS = new Set(['블로그'])

export type IntakeReport = {
  received: number
  canceled: number
  processed: number
  projected: number
  described: number
  errors: string[]
}

function errText(err: unknown) {
  return maskSecrets(err instanceof Error ? err.message : String(err)).slice(0, 500)
}

export async function runIntakeForSpace(spaceId: string, deadline: number): Promise<IntakeReport> {
  const report: IntakeReport = {
    received: 0,
    canceled: 0,
    processed: 0,
    projected: 0,
    described: 0,
    errors: [],
  }
  const conn = await prisma.scNotionConnection.findUnique({ where: { spaceId } })
  if (!conn) return report
  const audit: string[] = []
  const { secret } = await loadSpaceCredential<{ token: string }>(spaceId, 'notion', audit)
  const token = secret.token

  // 1) 수신: 「작성 요청」 행을 요청 테이블에 등록.
  //    이미 있는 행: 막혔던 요청(확인 필요·실패·승인 전 취소)이면 사람이 고친 뒤 다시 요청한 것 → 새 snapshot 으로 재시작.
  //    그 밖이면 노션만 사람이 바꾼 것 → projectedStatus 를 지워 이번 되쓰기에서 실제 상태로 덮어쓴다.
  const requested = await queryDataSource(token, conn.requestDataSourceId, {
    property: REQUEST_PROPS.status,
    select: { equals: NOTION_STATUS.REQUESTED },
  })
  for (const page of requested) {
    const where = { spaceId_notionPageId: { spaceId, notionPageId: page.id } }
    const existing = await prisma.scPublishRequest.findUnique({
      where,
      select: { state: true, contentId: true },
    })
    const snapshot = readRequestSnapshot(page) as never
    if (!existing) {
      const created = await prisma.scPublishRequest.createMany({
        data: [{ spaceId, notionPageId: page.id, snapshot, revision: page.last_edited_time }],
        skipDuplicates: true,
      })
      report.received += created.count
    } else if (isRestartable(existing)) {
      await prisma.scPublishRequest.update({
        where,
        data: {
          state: 'RECEIVED',
          snapshot,
          revision: page.last_edited_time,
          attempts: 0,
          lastError: null,
          nextAttemptAt: null,
          leaseUntil: null,
          projectedStatus: null,
        },
      })
      report.received++
    } else {
      await prisma.scPublishRequest.update({ where, data: { projectedStatus: null } })
    }
  }

  // 2) 취소: 사람이 「취소」로 바꾼 행은 승인 전일 때만 반영. 이후면 되쓰기로 실제 상태를 다시 보여준다.
  const canceled = await queryDataSource(token, conn.requestDataSourceId, {
    property: REQUEST_PROPS.status,
    select: { equals: NOTION_STATUS.CANCELED },
  })
  for (const page of canceled) {
    const r = await prisma.scPublishRequest.findUnique({
      where: { spaceId_notionPageId: { spaceId, notionPageId: page.id } },
      select: { id: true, state: true },
    })
    if (!r || r.state === 'CANCELED') continue
    if (canCancel(r.state)) {
      await prisma.scPublishRequest.update({ where: { id: r.id }, data: { state: 'CANCELED' } })
      report.canceled++
    } else {
      // ponytail: 「취소 무시됨」 전용 표시 없이 실제 상태로 되돌려 쓴다. 필요하면 1회성 「확인 필요」 플래그 추가.
      await prisma.scPublishRequest.update({ where: { id: r.id }, data: { projectedStatus: null } })
    }
  }

  // 3) 진행: RECEIVED 를 lease 로 선점해 소재 가져오기·미디어 동기화 → READY / NEEDS_INPUT.
  while (Date.now() < deadline) {
    const now = new Date()
    const next = await prisma.scPublishRequest.findFirst({
      where: {
        spaceId,
        state: 'RECEIVED',
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
        AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }],
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, attempts: true, leaseUntil: true },
    })
    if (!next) break
    const claimed = await prisma.scPublishRequest.updateMany({
      where: { id: next.id, state: 'RECEIVED', leaseUntil: next.leaseUntil },
      data: { leaseUntil: new Date(Date.now() + LEASE_MS), attempts: { increment: 1 } },
    })
    if (claimed.count === 0) continue
    try {
      await processRequest(spaceId, token, next.id)
      report.processed++
    } catch (err) {
      const attempts = next.attempts + 1
      report.errors.push(`${next.id}: ${errText(err)}`)
      await prisma.scPublishRequest.update({
        where: { id: next.id },
        data: {
          leaseUntil: null,
          lastError: errText(err),
          ...(attempts >= MAX_ATTEMPTS
            ? { state: 'FAILED' }
            : { nextAttemptAt: new Date(Date.now() + 2 ** attempts * 60_000) }),
        },
      })
    }
  }

  // 4) 사진 설명(남은 시간만큼).
  if (Date.now() < deadline - 60_000) {
    try {
      report.described = await describePendingMedia(spaceId, 10)
    } catch (err) {
      report.errors.push(`describe: ${errText(err)}`)
    }
  }

  // 5) 노션 되쓰기.
  report.projected = await projectToNotion(spaceId, token, deadline, report.errors)
  await prisma.scNotionConnection.update({
    where: { spaceId },
    data: { lastPolledAt: new Date(), lastError: report.errors[0] ?? null },
  })
  return report
}

function isRestartable(r: { state: string; contentId: string | null }) {
  return (
    r.state === 'NEEDS_INPUT' || r.state === 'FAILED' || (r.state === 'CANCELED' && !r.contentId)
  )
}

async function processRequest(spaceId: string, token: string, requestId: string) {
  const r = await prisma.scPublishRequest.findUniqueOrThrow({ where: { id: requestId } })
  const snap = r.snapshot as unknown as RequestSnapshot
  const needsInput = (lastError: string) =>
    prisma.scPublishRequest.update({
      where: { id: requestId },
      data: { state: 'NEEDS_INPUT', leaseUntil: null, lastError },
    })

  if (!SUPPORTED_KINDS.has(snap.kind))
    return needsInput(`아직 지원하지 않는 유형입니다: ${snap.kind || '(없음)'}`)
  if (snap.sourcePageIds.length !== 1) return needsInput('소재를 정확히 1개 연결하세요')

  const imported = await importSource(spaceId, token, snap.sourcePageIds[0])
  const drive = await prisma.scDriveConnection.findUnique({
    where: { spaceId },
    select: { id: true },
  })
  const photos = drive ? await syncSourceMedia(spaceId, imported.sourceId) : 0

  await prisma.scPublishRequest.update({
    where: { id: requestId },
    data: { sourceId: imported.sourceId, sourceVersionId: imported.versionId },
  })
  if (NEEDS_PHOTOS.has(snap.kind) && photos === 0) {
    return needsInput('소재의 미디어 폴더에 사진이 없습니다(드라이브 폴더 링크·공유 확인)')
  }
  await prisma.scPublishRequest.update({
    where: { id: requestId },
    data: { state: 'READY', leaseUntil: null, lastError: null, nextAttemptAt: null },
  })
}

/** DB 상태를 노션에 덮어쓴다. 마지막으로 쓴 라벨과 같으면 건너뛴다(멱등). */
async function projectToNotion(
  spaceId: string,
  token: string,
  deadline: number,
  errors: string[]
): Promise<number> {
  const rows = await prisma.scPublishRequest.findMany({
    where: {
      spaceId,
      OR: [
        { projectedStatus: null },
        { projectedStatus: { notIn: [NOTION_STATUS.PUBLISHED, NOTION_STATUS.CANCELED] } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    include: {
      content: {
        select: {
          id: true,
          deployments: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { status: true, platformUrl: true },
          },
        },
      },
    },
  })
  let written = 0
  for (const r of rows) {
    if (Date.now() > deadline) break
    const deployment = r.content?.deployments[0] ?? null
    const label = notionStatusFor({ state: r.state, deployment })
    if (label === r.projectedStatus) continue
    try {
      await updatePageProperties(token, r.notionPageId, {
        [REQUEST_PROPS.status]: { select: { name: label } },
        ...(r.content && {
          [REQUEST_PROPS.workdeckUrl]: {
            url: buildAppUrl(`/d/sales-content/contents/${r.content.id}`),
          },
        }),
        ...(label === NOTION_STATUS.PUBLISHED && {
          [REQUEST_PROPS.resultUrl]: { url: deployment!.platformUrl },
        }),
      })
      await prisma.scPublishRequest.update({
        where: { id: r.id },
        data: { projectedStatus: label, projectedAt: new Date() },
      })
      written++
    } catch (err) {
      errors.push(`project ${r.id}: ${errText(err)}`)
    }
  }
  return written
}
