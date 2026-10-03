// 서버 상세 화면 전용. 전체 원문은 반환하거나 로그에 기록하지 않는다.
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { decodeMigrationSnapshot } from './ledger'

const isoDate = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.toISOString() === value
})
export const openingApplicationSnapshotSchema = z.object({
  schemaVersion: z.literal('opening-application-v1'),
  application: z.object({
    id: z.string().min(1),
    application_entries: z.array(z.unknown()),
    status: z.number().int(),
    stage: z.number().int(),
    hiring_stage: z.number().int(),
    created_at: isoDate,
    updated_at: isoDate,
    required_privacy_agreed_at: isoDate.nullable(),
    optional_privacy_agreed_at: isoDate.nullable(),
    cancelled_at: isoDate.nullable(),
    deleted_at: isoDate.nullable(),
  }),
  entryInterpretation: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      status: z.enum(['verified', 'unresolved']),
      evidenceRef: z.string().optional(),
      verifiedLabels: z.array(z.string()).optional(),
    })
  ),
  fileMappings: z.array(
    z.object({
      entryIndex: z.number().int().nonnegative(),
      sourceFileKey: z.string().min(1),
      targetFileId: z.string().min(1),
      sha256: z.string(),
      sizeBytes: z.number(),
      verified: z.boolean().optional(),
    })
  ),
})
export type OpeningApplicationSnapshotV1 = z.infer<typeof openingApplicationSnapshotSchema>
type Primitive = string | number | boolean | null
type Value =
  | { kind: 'missing' }
  | { kind: 'unsupported' }
  | { kind: 'scalar'; value: Primitive }
  | { kind: 'array'; values: Primitive[] }
type HistoryFile = { id: string; fileName: string; sizeBytes: number }
export type HistoryEntry = {
  index: number
  label: string | null
  sourceType: string | null
  otherMarker: 'missing' | 'true' | 'false' | 'invalid'
} & (
  | {
      kind: 'value'
      value: Value
      interpretation: 'raw' | 'verified' | 'unresolved'
      verifiedLabels?: string[]
    }
  | { kind: 'files'; files: HistoryFile[]; unresolvedCount: number }
)
export type ApplicationHistoryView = {
  sourceSnapshotAt: string
  entries: HistoryEntry[]
  sourceStatus: number
  sourceStage: number
  sourceHiringStage: number
  createdAt: string
  updatedAt: string
  requiredPrivacyAgreedAt: string | null
  optionalPrivacyAgreedAt: string | null
  canceledAt: string | null
  deletedAt: string | null
}
export type ApplicationHistoryResult =
  | { status: 'absent' }
  | { status: 'unavailable' }
  | { status: 'available'; history: ApplicationHistoryView }
type Context = {
  applicationId: string
  spaceId: string
  sourceSnapshotAt: string
  files: (HistoryFile & { applicationId: string; spaceId: string })[]
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const primitive = (value: unknown): value is Primitive =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' &&
    Number.isFinite(value) &&
    (!Number.isInteger(value) || Number.isSafeInteger(value)))

export function projectApplicationHistory(
  snapshot: unknown,
  context: Context
): ApplicationHistoryView | null {
  const parsed = openingApplicationSnapshotSchema.safeParse(snapshot)
  if (!parsed.success || !isoDate.safeParse(context.sourceSnapshotAt).success) return null
  const source = parsed.data
  const entries: HistoryEntry[] = source.application.application_entries.map((raw, index) => {
    const entry = object(raw) ? raw : {}
    const base = {
      index,
      label: typeof entry.label === 'string' ? entry.label : null,
      sourceType: typeof entry.type === 'string' ? entry.type : null,
      otherMarker: (!('is_other' in entry)
        ? 'missing'
        : entry.is_other === true
          ? 'true'
          : entry.is_other === false
            ? 'false'
            : 'invalid') as HistoryEntry['otherMarker'],
    }
    if (entry.type === 'file') {
      // 원본 선택 첨부의 null·누락·빈 문자열은 파일 없음이다. 배열 내부의 잘못된 키는 보류한다.
      const keys =
        entry.value == null || entry.value === ''
          ? []
          : Array.isArray(entry.value)
            ? entry.value
            : [entry.value]
      const files: HistoryFile[] = []
      let unresolvedCount = 0
      for (const key of keys) {
        const matches = source.fileMappings.filter(
          (mapping) => mapping.entryIndex === index && mapping.sourceFileKey === key
        )
        const mapping = matches.length === 1 ? matches[0] : undefined
        const uniqueKey = keys.filter((value) => value === key).length === 1
        const uniqueTarget =
          mapping &&
          source.fileMappings.filter((item) => item.targetFileId === mapping.targetFileId)
            .length === 1
        const target =
          mapping &&
          context.files.find(
            (file) =>
              file.id === mapping.targetFileId &&
              file.applicationId === context.applicationId &&
              file.spaceId === context.spaceId
          )
        if (
          typeof key !== 'string' ||
          !uniqueKey ||
          !uniqueTarget ||
          !mapping ||
          mapping.verified !== true ||
          !/^[a-f0-9]{64}$/.test(mapping.sha256) ||
          !Number.isSafeInteger(mapping.sizeBytes) ||
          mapping.sizeBytes < 1 ||
          !target ||
          target.sizeBytes !== mapping.sizeBytes
        ) {
          unresolvedCount++
          continue
        }
        files.push({ id: target.id, fileName: target.fileName, sizeBytes: target.sizeBytes })
      }
      return { ...base, kind: 'files', files, unresolvedCount }
    }
    const value: Value = !object(raw)
      ? { kind: 'unsupported' }
      : !('value' in entry)
        ? { kind: 'missing' }
        : primitive(entry.value)
          ? { kind: 'scalar', value: entry.value }
          : Array.isArray(entry.value) && entry.value.every(primitive)
            ? { kind: 'array', values: entry.value }
            : { kind: 'unsupported' }
    const interpretations = source.entryInterpretation.filter((item) => item.index === index)
    const evidence = interpretations.length === 1 ? interpretations[0] : undefined
    const choice = entry.type === 'select' || entry.type === 'multiselect'
    const uncertain = base.otherMarker === 'true' || base.otherMarker === 'invalid'
    const verified =
      choice &&
      !uncertain &&
      evidence?.status === 'verified' &&
      !!evidence.evidenceRef?.trim() &&
      !!evidence.verifiedLabels?.length
    return {
      ...base,
      kind: 'value',
      value,
      interpretation: verified ? 'verified' : choice || uncertain ? 'unresolved' : 'raw',
      ...(verified ? { verifiedLabels: evidence.verifiedLabels } : {}),
    }
  })
  const app = source.application
  return {
    sourceSnapshotAt: context.sourceSnapshotAt,
    entries,
    sourceStatus: app.status,
    sourceStage: app.stage,
    sourceHiringStage: app.hiring_stage,
    createdAt: app.created_at,
    updatedAt: app.updated_at,
    requiredPrivacyAgreedAt: app.required_privacy_agreed_at,
    optionalPrivacyAgreedAt: app.optional_privacy_agreed_at,
    canceledAt: app.cancelled_at,
    deletedAt: app.deleted_at,
  }
}

// 페이지의 Deck 권한 검사 이후 호출한다. 방어적으로 지원서 소유권도 재확인한다.
export async function getApplicationHistory(
  spaceId: string,
  applicationId: string
): Promise<ApplicationHistoryResult> {
  try {
    const app = await prisma.hiringApplication.findFirst({
      where: { id: applicationId, spaceId, deletedAt: null },
      select: {
        id: true,
        files: {
          select: { id: true, applicationId: true, spaceId: true, fileName: true, sizeBytes: true },
        },
      },
    })
    if (!app) return { status: 'absent' }
    const record = await prisma.hiringMigrationRecord.findFirst({
      where: { spaceId, targetModel: 'HiringApplication', targetId: applicationId },
      select: {
        sourceSnapshotAt: true,
        sourceSnapshotEnc: true,
        sourceSnapshotIv: true,
        sourceHash: true,
      },
    })
    if (!record) return { status: 'absent' }
    const history = projectApplicationHistory(decodeMigrationSnapshot(record), {
      applicationId,
      spaceId,
      sourceSnapshotAt: record.sourceSnapshotAt.toISOString(),
      files: app.files,
    })
    return history ? { status: 'available', history } : { status: 'unavailable' }
  } catch {
    return { status: 'unavailable' }
  }
}
