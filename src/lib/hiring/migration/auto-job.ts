/**
 * 오프닝 고객 자동 이전 job 순수 로직(DB·네트워크 없음). 워커(scripts/opening-auto-migrate.ts)와
 * 어드민 API가 공유한다. 계획: docs/superpowers/plans/2026-11-18-opening-auto-migration.md
 */
import { createHmac } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { migrationHash } from './ledger'
import { CONTACT_PATTERNS } from './opening-packet'

export const JOB_STATUSES = [
  'MATCHED',
  'PLANNED',
  'BLOCKED',
  'APPROVED',
  'APPLYING',
  'APPLIED',
  'GRANTED',
  'DONE',
  'GRANT_MANUAL',
  'FAILED',
  'HELD',
] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

// 허용 전이. BLOCKED→BLOCKED 는 재계획 결과가 다시 차단일 때다.
const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  MATCHED: ['PLANNED', 'BLOCKED', 'HELD', 'FAILED'],
  PLANNED: ['APPROVED', 'BLOCKED', 'HELD'],
  BLOCKED: ['PLANNED', 'BLOCKED', 'HELD', 'FAILED'],
  // 1차: 적용은 수동이라 운영자가 DONE(수동 적용 완료)·HELD 로 닫고, 승인 뒤 MULTI_USER 가 발견되면 BLOCKED 로 되돌린다.
  APPROVED: ['APPLYING', 'PLANNED', 'FAILED', 'BLOCKED', 'DONE', 'HELD'],
  APPLYING: ['APPLIED', 'PLANNED', 'FAILED'],
  APPLIED: ['GRANTED', 'GRANT_MANUAL', 'FAILED'],
  GRANTED: ['DONE', 'FAILED'],
  GRANT_MANUAL: [],
  DONE: [],
  FAILED: ['HELD'],
  HELD: [],
}

export const canTransition = (from: JobStatus, to: JobStatus) => TRANSITIONS[from].includes(to)

// 오프닝 member.email_hash 는 HMAC-SHA256(hex). 워크덱 이메일의 흔한 변형을 모두 계산해 일치를 본다.
export function emailHashVariants(email: string, hmacKey: string): string[] {
  const trimmed = email.trim()
  const variants = new Set([email, trimmed, email.toLowerCase(), trimmed.toLowerCase()])
  return [...variants].map((value) => createHmac('sha256', hmacKey).update(value).digest('hex'))
}

export type SpaceCandidate = {
  id: string
  role: string
  // SpaceMember.createdAt — Space 자체에는 생성 시각이 없어 가입 순서로 "가장 오래된"을 판정한다.
  memberSince: Date
  // DeckInstance(deckAppId='recruiting').isActive
  recruitingActive: boolean
}

// 사용자가 OWNER이고 모집 관리가 켜진 가장 오래된 Space. 없으면 null.
export function pickTargetSpace(spaces: SpaceCandidate[]): string | null {
  const eligible = spaces
    .filter((space) => space.role === 'OWNER' && space.recruitingActive)
    .sort((a, b) => a.memberSince.getTime() - b.memberSince.getTime())
  return eligible[0]?.id ?? null
}

export type PlanInput = {
  targetSpaceId: string | null
  // 같은 사용자에게 매칭된 오프닝 브랜드 수
  brandCount: number
  // prepare summary 중 분류에 쓰는 부분
  summary: {
    postings?: { reasons?: Record<string, number> }
    templates?: { reasons?: Record<string, number> }
    siblingOwned?: { files?: number; contents?: number }
  }
  // import dry-run 의 충돌 건수(dry-run 을 못 한 경우 0)
  conflicts: number
  // import dry-run 이 거부(refused)한 항목 수
  refused?: number
  // 자동 review 반복 후에도 연락처 검토 대기 항목이 남았는지
  reviewIncomplete?: boolean
  targetHasData: boolean
}

const OWNERSHIP_REASONS = ['ASSET_SCOPE_MISMATCH', 'ASSET_SCOPE_UNKNOWN', 'RESOURCE_SCOPE_MISMATCH']
const SIBLING_REASONS = ['SIBLING_BRAND_UNVERIFIED']

export type PlanClassification = {
  blockReasons: string[]
  // 승인 가능한 표시용 경고(제외·보류 사유 코드별 건수)
  warnings: Record<string, number>
}

export function classifyPlan(input: PlanInput): PlanClassification {
  const reasons: Record<string, number> = {}
  for (const group of [input.summary.postings?.reasons, input.summary.templates?.reasons])
    for (const [code, count] of Object.entries(group ?? {}))
      reasons[code] = (reasons[code] ?? 0) + count
  const has = (codes: string[]) => codes.some((code) => (reasons[code] ?? 0) > 0)
  const sibling =
    (input.summary.siblingOwned?.files ?? 0) + (input.summary.siblingOwned?.contents ?? 0)

  const blockReasons: string[] = []
  if (!input.targetSpaceId) blockReasons.push('NO_TARGET_SPACE')
  if (input.brandCount > 1) blockReasons.push('MULTI_BRAND')
  if (has(OWNERSHIP_REASONS)) blockReasons.push('OWNERSHIP_MISMATCH')
  // 워커는 siblingBrandIds 를 넘기지 않으므로 형제 브랜드 자산은 보통 ASSET_SCOPE_MISMATCH(=OWNERSHIP_MISMATCH)로
  // 막힌다. SIBLING_ASSET 은 siblingOwned 집계가 생기는 경우(향후 형제 지정)를 위한 방어 분류다.
  if (sibling > 0 || has(SIBLING_REASONS)) blockReasons.push('SIBLING_ASSET')
  if (input.reviewIncomplete) blockReasons.push('REVIEW_INCOMPLETE')
  if ((input.refused ?? 0) > 0) blockReasons.push('IMPORT_REFUSED')
  if (input.conflicts > 0) blockReasons.push('LEDGER_CONFLICT')
  if (input.targetHasData) blockReasons.push('TARGET_HAS_DATA')

  const blockCodes = new Set([...OWNERSHIP_REASONS, ...SIBLING_REASONS])
  const warnings = Object.fromEntries(
    Object.entries(reasons).filter(([code]) => !blockCodes.has(code))
  )
  return { blockReasons, warnings }
}

export type Candidates = {
  sourceSpaceId: string
  items: { kind: 'posting' | 'template'; id: string; contentHash: string; hits: { url: number } }[]
  images: { sha256: string; owners: string[] }[]
}

// 자동 review.json. 운영자 승인을 전제로 한 후보다 — 승인 없이는 apply가 일어나지 않는다.
// 소유권 등으로 막힌 항목·이미지는 prepare 가 candidates 에 올리지 않으므로 여기서 따로 거르지 않는다.
// 민감 URL 적중 항목만 항상 뺀다.
export function buildAutoReview(candidates: Candidates, jobId: string, reviewedAt: string) {
  const items = candidates.items.filter((item) => !item.hits.url)
  return {
    sourceSpaceId: candidates.sourceSpaceId,
    reviewer: `auto:${jobId}`,
    reviewedAt,
    items: items.map(({ kind, id, contentHash }) => ({ kind, id, contentHash })),
    images: candidates.images.map((image) => image.sha256),
    assetScopes: [],
  }
}

export type ContactFragments = { kind: string; id: string; title: string; fragments: string[] }

const CONTEXT = 20

// 연락처 감지 항목의 제목 + 감지 문구 앞뒤 20자 조각만. 운영자 전용(암호화 저장)이다.
export function extractContactFragments(
  items: {
    kind: string
    id: string
    title?: string
    texts: { path: string; text: string; flagged: boolean }[]
  }[]
): ContactFragments[] {
  return items.map((item) => {
    const fragments: string[] = []
    for (const { path, text, flagged } of item.texts) {
      if (!flagged) continue
      const value = text.normalize('NFKC')
      // 지원서 폼의 표준 문항명(연락처)은 개인 연락처가 아니다(scanContacts 와 같은 기준).
      const inForm = path.split('.').includes('applicationEntries')
      for (const [name, pattern] of Object.entries(CONTACT_PATTERNS)) {
        if (name === 'keyword' && inForm) continue
        for (const match of value.matchAll(pattern)) {
          const start = match.index ?? 0
          fragments.push(
            value.slice(Math.max(0, start - CONTEXT), start + match[0].length + CONTEXT)
          )
        }
      }
    }
    return {
      kind: item.kind,
      id: item.id,
      title: item.title ?? '',
      // 자르지 않는다: 표시되지 않은 연락처는 운영자가 검토할 수 없다(승인 전제).
      fragments: [...new Set(fragments)],
    }
  })
}

export type PacketSnapshot = {
  items: { kind: string; sourceId: string; contentHash: string }[]
  images: string[]
  meta: { userId: string | null; targetSpaceId: string | null; adminMatched: boolean }
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))

// packet 폴더의 이전 대상 전체를 정규화해 해시한다. 스냅샷 시각 등 실행 메타는 제외한다.
export function buildSnapshot(packetDir: string, meta: PacketSnapshot['meta']): PacketSnapshot {
  const items: PacketSnapshot['items'] = []
  for (const [folder, kind, idKey] of [
    ['postings', 'posting', 'sourcePostingId'],
    ['templates', 'template', 'sourceTemplateId'],
  ] as const)
    for (const name of readdirSync(join(packetDir, folder)).filter((f) => f.endsWith('.json'))) {
      const packet = readJson(join(packetDir, folder, name)) as Record<string, unknown>
      items.push({
        kind,
        sourceId: String(packet[idKey]),
        contentHash: migrationHash({ ...packet, sourceSnapshotAt: null }),
      })
    }
  const org = readJson(join(packetDir, 'org.json')) as {
    stores: { sourceId: string }[]
    positions: { sourceId: string }[]
  }
  for (const [kind, list] of [
    ['store', org.stores],
    ['position', org.positions],
  ] as const)
    for (const entry of list)
      items.push({ kind, sourceId: entry.sourceId, contentHash: migrationHash(entry) })
  items.sort((a, b) => `${a.kind}:${a.sourceId}`.localeCompare(`${b.kind}:${b.sourceId}`))
  return { items, images: readdirSync(join(packetDir, 'assets')).sort(), meta }
}

export type MatchedUser = { id: string }
export type ExistingJob = { openingBrandId: string; userId: string | null }
export type MatchPlan = {
  creates: {
    openingBrandId: string
    userId: string
    status: 'MATCHED' | 'BLOCKED'
    blockReasons: string[]
  }[]
  // 이미 다른 사용자에게 예약된 브랜드 — 기존 job 에 MULTI_USER 를 추가해야 한다.
  blockExisting: string[]
  checkedUserIds: string[]
}

// 매칭 결과로 job 생성·차단을 정한다. 사용자가 브랜드 2개 이상 = MULTI_BRAND,
// 한 브랜드에 사용자 2명 이상(이번 실행 또는 기존 job) = MULTI_USER.
export function planMatches(
  users: MatchedUser[],
  brandsByUser: Map<string, string[]>,
  existing: ExistingJob[]
): MatchPlan {
  const existingByBrand = new Map(existing.map((job) => [job.openingBrandId, job]))
  const usersByBrand = new Map<string, Set<string>>()
  for (const [userId, brands] of brandsByUser)
    for (const brand of brands)
      usersByBrand.set(brand, (usersByBrand.get(brand) ?? new Set()).add(userId))

  const creates = new Map<string, MatchPlan['creates'][number]>()
  const blockExisting = new Set<string>()
  const checkedUserIds: string[] = []
  for (const user of users) {
    checkedUserIds.push(user.id)
    const brands = brandsByUser.get(user.id) ?? []
    for (const brand of brands) {
      const job = existingByBrand.get(brand)
      if (job) {
        if (job.userId && job.userId !== user.id) blockExisting.add(brand)
        continue
      }
      if (creates.has(brand)) continue
      const blockReasons = [
        ...(brands.length > 1 ? ['MULTI_BRAND'] : []),
        ...((usersByBrand.get(brand)?.size ?? 0) > 1 ? ['MULTI_USER'] : []),
      ]
      creates.set(brand, {
        openingBrandId: brand,
        userId: user.id,
        status: blockReasons.length ? 'BLOCKED' : 'MATCHED',
        blockReasons,
      })
    }
  }
  return { creates: [...creates.values()], blockExisting: [...blockExisting], checkedUserIds }
}

// backfill 쓰기 전 원장 대조. spaces = 원장에서 이 브랜드 행이 있는 Space id 목록.
// DONE 은 정확히 {space}, HELD/none 은 0건이어야 한다. (sourceRef 에는 브랜드 id 가 없어
// 호출자가 원장 스냅샷의 sourceSpaceId 로 이 목록을 만든다.)
export function assertBackfillMatches(status: 'DONE' | 'HELD', space: string, spaces: string[]) {
  const found = new Set(spaces)
  const ok =
    status === 'DONE' && space !== 'none' ? found.size === 1 && found.has(space) : found.size === 0
  if (!ok) throw Error('BACKFILL_LEDGER_MISMATCH')
}
