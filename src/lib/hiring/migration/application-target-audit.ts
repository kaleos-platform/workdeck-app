import type { HiringMigrationRecord, Prisma } from '@/generated/prisma/client'
import { buildApplicationPii, decryptApplicationPii } from '@/lib/hiring/pii'
import { recoverOpeningApplication } from './application-recovery'
import { planOpeningApplication } from './application-import'
import { migrationHash } from './ledger'

export type ApplicationAuditTarget = Prisma.HiringApplicationGetPayload<{
  include: {
    files: true
    posting: { select: { spaceId: true } }
    postingPosition: { select: { spaceId: true; postingId: true } }
    stores: { include: { store: { select: { spaceId: true } } } }
  }
}>
const groups = [
  'identity',
  'pii',
  'derivedPii',
  'state',
  'operational',
  'relations',
  'entries',
  'dates',
  'files',
] as const
export type ApplicationAuditGroup = (typeof groups)[number]
type AuditResult = {
  status: 'verified' | 'different' | 'failed' | 'missing'
  physicalHashMatches: boolean
  differentGroups: ApplicationAuditGroup[]
}
const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value))
const pick = (value: object, keys: readonly string[]) =>
  Object.fromEntries(keys.map((key) => [key, (value as Record<string, unknown>)[key] ?? null]))
const same = (a: unknown, b: unknown) => migrationHash(json(a)) === migrationHash(json(b))

// 읽기 전용 진단이다. 의미가 같아도 기존 targetHash를 바꾸거나 재이전을 허용하지 않는다.
export function compareOpeningApplicationTarget(
  record: HiringMigrationRecord,
  current: ApplicationAuditTarget | null,
  scope: { spaceId: string; sourceSpaceId: string }
): AuditResult {
  try {
    const recovered = recoverOpeningApplication(record, scope)
    const { input, app, operational, piiEntries } = planOpeningApplication(recovered)
    if (!current) return { status: 'missing', physicalHashMatches: false, differentGroups: [] }
    // 다른 고객의 개인정보는 복호화하기 전에 차단한다.
    if (current.id !== record.targetId || current.spaceId !== scope.spaceId)
      return { status: 'different', physicalHashMatches: false, differentGroups: ['identity'] }
    const expectedPii = buildApplicationPii(piiEntries).columns
    const pairs = ['name', 'phone', 'email', 'address'] as const
    const validPairs = pairs.every((key) => {
      const enc = current[`${key}Enc`]
      const iv = current[`${key}Iv`]
      return (
        (enc === null && iv === null) ||
        (typeof enc === 'string' && enc.length > 0 && typeof iv === 'string' && iv.length > 0)
      )
    })
    if (!validPairs) throw Error('INVALID_CIPHER_PAIR')
    const derived = ['nameHash', 'maskedName', 'phoneHash', 'phoneLastDigitsHash', 'emailHash']
    const checks: Record<ApplicationAuditGroup, boolean> = {
      identity: true,
      pii: same(decryptApplicationPii(current), decryptApplicationPii(expectedPii)),
      derivedPii: same(pick(current, derived), pick(expectedPii, derived)),
      state: same(
        pick(current, ['stage', 'hiringStage']),
        pick(input.state, ['stage', 'hiringStage'])
      ),
      operational: same(pick(current, ['memo', 'referrer', 'duplicated', 'directRegistration']), {
        memo: operational.memo ?? null,
        referrer: operational.referrer ?? null,
        duplicated: operational.duplicated ?? false,
        directRegistration: operational.direct_registration ?? false,
      }),
      relations:
        current.posting?.spaceId === scope.spaceId &&
        (current.postingPositionId === null
          ? current.postingPosition === null
          : current.postingPosition?.spaceId === scope.spaceId &&
            current.postingPosition.postingId === current.postingId) &&
        current.stores.every((s) => s.store?.spaceId === scope.spaceId) &&
        same(
          {
            postingId: current.postingId,
            postingPositionId: current.postingPositionId,
            stores: current.stores
              .map((s) => pick(s, ['storeId', 'applicationId']))
              .sort((a, b) => String(a.storeId).localeCompare(String(b.storeId))),
          },
          {
            postingId: input.postingId,
            postingPositionId: input.position?.targetId ?? null,
            stores: input.stores
              .map((s) => ({ storeId: s.targetId, applicationId: current.id }))
              .sort((a, b) => a.storeId.localeCompare(b.storeId)),
          }
        ),
      entries: same(current.applicationEntries, []),
      dates: same(pick(current, ['createdAt', 'privacyAgreedAt', 'canceledAt', 'deletedAt']), {
        createdAt: new Date(app.created_at),
        privacyAgreedAt: app.required_privacy_agreed_at
          ? new Date(app.required_privacy_agreed_at)
          : null,
        canceledAt: app.cancelled_at ? new Date(app.cancelled_at) : null,
        deletedAt: app.deleted_at ? new Date(app.deleted_at) : null,
      }),
      files: same(
        current.files
          .map((f) =>
            pick(f, [
              'id',
              'spaceId',
              'applicationId',
              'fileName',
              'filePath',
              'mimeType',
              'sizeBytes',
            ])
          )
          .sort((a, b) => String(a.id).localeCompare(String(b.id))),
        input.files
          .map((f) => ({
            id: f.id,
            spaceId: scope.spaceId,
            applicationId: current.id,
            fileName: f.fileName,
            filePath: f.path,
            mimeType: f.mimeType,
            sizeBytes: f.bytes,
          }))
          .sort((a, b) => a.id.localeCompare(b.id))
      ),
    }
    const differentGroups = groups.filter((group) => !checks[group])
    const { posting, postingPosition, stores, ...physicalFields } = current
    void posting
    void postingPosition
    const physical = {
      ...physicalFields,
      stores: stores.map(({ store, ...link }) => {
        void store
        return link
      }),
    }
    return {
      status: differentGroups.length ? 'different' : 'verified',
      physicalHashMatches: migrationHash(json(physical)) === record.targetHash,
      differentGroups,
    }
  } catch {
    // 원문·키·암호화 오류를 응답이나 로그에 내보내지 않는다.
    return { status: 'failed', physicalHashMatches: false, differentGroups: [] }
  }
}
