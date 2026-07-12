/**
 * 재무 데이터 등록 — 공유 타입·상수·순수 헬퍼.
 * upload-panel(단일)에서 추출, 다중 파일 업로드에서 공용.
 */
import { BANK_FIELDS, CARD_FIELDS } from '@/lib/finance/parser'
import { matchesAccountNumber } from '@/lib/finance/automap'

// ─── 타입 ────────────────────────────────────────────────────────────────────

export type FinKind = 'BANK' | 'CARD'

export type Preamble = {
  accountNumber?: string
  holder?: string
  periodFrom?: string
  periodTo?: string
}

export type PreviewData = {
  headers: string[]
  sampleRows: string[][]
  totalRows: number
  emptyColumns: number[]
  sheetNames: string[]
  activeSheet: string
  preamble: Preamble
}

export type MappingEntry = { headerName: string; field: string }

/** 매핑 상태: 시스템 필드 → 파일 헤더 인덱스 배열(순서 = 결합 순서). */
export type FieldMapping = Record<string, number[]>

export type MatchedPreset = {
  id: string
  name: string
  institution: string
  kind: string
  mapping: MappingEntry[]
  defaultAccountId: string | null
}

export type Account = {
  id: string
  name: string
  kind: string
  institution: string | null
  holder: string | null
  accountNumber: string | null
  openingBalance?: number | null
  currentBalance?: number | null
  currentBalanceAsOf?: string | null
}

export type PreviewResponse = {
  fileName: string
  preview: PreviewData
  kind: FinKind
  institution: string | null
  suggestedMapping: MappingEntry[]
  matchedPreset: MatchedPreset | null
  accounts: Account[]
}

export type CommitCounts = {
  total: number
  new: number
  dupSame: number
  dupChanged: number
  classified: number
  review: number
  unclassified: number
  parseErrors: number
}

// ─── 다중 파일 상태 머신 ──────────────────────────────────────────────────────

export type UploadFileStatus =
  | 'queued'
  | 'analyzing'
  | 'matched'
  | 'needs_review'
  | 'analyze_failed'
  | 'committing'
  | 'done'
  | 'commit_failed'

export type UploadFileItem = {
  id: string
  file: File
  status: UploadFileStatus
  error?: string
  preview?: PreviewResponse
  kind: FinKind
  accountId: string
  mapping: FieldMapping
  savePreset: boolean
  presetName: string
  result?: { importId: string; counts: CommitCounts }
}

// ─── 상수 ────────────────────────────────────────────────────────────────────

/** 컬럼 select '(선택 안 함)' 센티넬 */
export const NONE_COLUMN = '__none__'
export const NONE_ACCOUNT = '__none__'

/** 다중 컬럼 결합 허용 필드 — 텍스트 필드만(숫자/날짜는 단일 컬럼). */
export const MULTI_COLUMN_FIELDS = new Set<string>(['description'])

// ─── 순수 헬퍼 ────────────────────────────────────────────────────────────────

/** 파일 preamble 계좌/카드번호와 일치하는 등록 계좌·카드(마스킹 와일드카드 허용). 없으면 null. */
export function findMatchedAccount(
  accounts: Account[],
  fileAcctNumber: string | null | undefined
): Account | null {
  const fileNo = (fileAcctNumber ?? '').trim()
  if (!fileNo) return null
  return (
    accounts.find((a) => a.accountNumber && matchesAccountNumber(a.accountNumber, fileNo)) ?? null
  )
}

/** 필드 value → 라벨(검증 메시지용). */
export function fieldLabel(field: string, kind: FinKind): string {
  const defs = kind === 'BANK' ? BANK_FIELDS : CARD_FIELDS
  return defs.find((f) => f.value === field)?.label ?? field
}

/** 기본 필수: txnDate, description; BANK는 deposit|withdrawal 중 하나; CARD는 amount */
export function isMappingValid(
  mapping: FieldMapping,
  kind: FinKind
): { ok: boolean; reason?: string } {
  const has = (f: string) => (mapping[f]?.length ?? 0) > 0
  if (!has('txnDate')) return { ok: false, reason: '거래일시를 매핑해 주세요' }
  if (!has('description'))
    return {
      ok: false,
      reason: kind === 'CARD' ? '가맹점명을 매핑해 주세요' : '적요/내용을 매핑해 주세요',
    }
  if (kind === 'BANK' && !has('deposit') && !has('withdrawal')) {
    return { ok: false, reason: '은행은 입금 또는 출금 컬럼을 매핑해야 합니다' }
  }
  if (kind === 'CARD' && !has('amount')) {
    return { ok: false, reason: '카드는 매출금액을 매핑해야 합니다' }
  }
  // 단일 필드에 컬럼 2개 이상 방어(UI에서 막지만 이중 가드)
  for (const f of Object.keys(mapping)) {
    if (!MULTI_COLUMN_FIELDS.has(f) && (mapping[f]?.length ?? 0) > 1) {
      return { ok: false, reason: `"${fieldLabel(f, kind)}"에는 컬럼을 하나만 지정할 수 있습니다` }
    }
  }
  return { ok: true }
}

/** suggestedMapping/preset.mapping [{headerName, field}] → FieldMapping(필드→헤더 인덱스 배열) */
export function mappingEntriesToState(entries: MappingEntry[], headers: string[]): FieldMapping {
  const result: FieldMapping = {}
  for (const { headerName, field } of entries) {
    const idx = headers.findIndex((h) => h === headerName)
    if (idx < 0) continue
    const arr = (result[field] ??= [])
    if (!arr.includes(idx)) arr.push(idx)
  }
  return result
}

/** state FieldMapping → API [{headerName, field}] (필드별 컬럼 순서 보존) */
export function stateToMappingEntries(mapping: FieldMapping, headers: string[]): MappingEntry[] {
  const entries: MappingEntry[] = []
  for (const [field, cols] of Object.entries(mapping)) {
    for (const idx of cols) {
      const headerName = headers[idx]
      if (headerName) entries.push({ headerName, field })
    }
  }
  return entries
}

/** kind 변경 시 매핑에서 새 kind에 없는 필드 제거 */
export function filterMappingForKind(mapping: FieldMapping, newKind: FinKind): FieldMapping {
  const validFields = new Set<string>(
    (newKind === 'BANK' ? BANK_FIELDS : CARD_FIELDS).map((f) => f.value)
  )
  const result: FieldMapping = {}
  for (const [field, cols] of Object.entries(mapping)) {
    if (validFields.has(field)) result[field] = cols
  }
  return result
}

/**
 * preview 응답으로 파일 항목 초기 상태(kind/accountId/mapping/presetName) 계산.
 * 단일 업로드 handleFile의 자동 인식 로직을 순수 함수로 추출 — 다중 파일에서 파일별 적용.
 */
export function resolveInitialSelection(data: PreviewResponse): {
  kind: FinKind
  accountId: string
  mapping: FieldMapping
  presetName: string
  matchedAccount: Account | null
} {
  const matched = findMatchedAccount(data.accounts, data.preview.preamble.accountNumber)

  // 거래 종류: 매칭 계좌가 있으면 그 계좌의 종류, 없으면 파일 자동 판별
  const resolvedKind: FinKind =
    matched && (matched.kind === 'BANK' || matched.kind === 'CARD')
      ? (matched.kind as FinKind)
      : data.kind

  // 매핑 초기값: matchedPreset > suggestedMapping. 최종 kind에 맞는 필드만 유지
  // (매칭 계좌 kind가 파일 자동판별과 다른 드문 경우 CARD/BANK 필드 혼입 방지).
  const source = data.matchedPreset?.mapping ?? data.suggestedMapping
  const mapping = filterMappingForKind(
    mappingEntriesToState(source, data.preview.headers),
    resolvedKind
  )

  // 계좌 초기 선택(종류 일치 후보만): 파일 계좌/카드번호 매칭 > 프리셋 기본 계좌 > 유일 후보
  const candidates = data.accounts.filter((a) => a.kind === resolvedKind)
  const presetAccount = candidates.find((a) => a.id === data.matchedPreset?.defaultAccountId)
  const defaultAccount =
    matched?.id ?? presetAccount?.id ?? (candidates.length === 1 ? candidates[0]?.id : null)

  return {
    kind: resolvedKind,
    accountId: defaultAccount ?? '',
    mapping,
    presetName: data.institution ?? data.matchedPreset?.name ?? '',
    matchedAccount: matched,
  }
}

/** preview 완료 파일의 상태 판정: 계좌 선택 + 매핑 유효 → matched, 아니면 needs_review */
export function resolveReadiness(
  item: Pick<UploadFileItem, 'accountId' | 'mapping' | 'kind'>
): 'matched' | 'needs_review' {
  if (!item.accountId || item.accountId === NONE_ACCOUNT) return 'needs_review'
  return isMappingValid(item.mapping, item.kind).ok ? 'matched' : 'needs_review'
}

/**
 * 같은 계좌에 기간(preamble periodFrom~To)이 겹치는 파일 id 집합.
 * 겹침 = 중복 스테이징 가능성 경고용(확정 단계 dedup이 최종 방어).
 * 기간 정보 없는 파일은 판정 불가로 제외.
 */
export function findOverlappingFileIds(
  items: Array<{
    id: string
    accountId: string
    preview?: { preview: { preamble: Preamble } }
  }>
): Set<string> {
  const overlapping = new Set<string>()
  const byAccount = new Map<string, Array<{ id: string; from: string; to: string }>>()
  for (const item of items) {
    if (!item.accountId || !item.preview) continue
    const { periodFrom, periodTo } = item.preview.preview.preamble
    if (!periodFrom) continue
    const list = byAccount.get(item.accountId) ?? []
    list.push({ id: item.id, from: periodFrom, to: periodTo ?? periodFrom })
    byAccount.set(item.accountId, list)
  }
  for (const list of byAccount.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!
        const b = list[j]!
        // 문자열 날짜(YYYY-MM-DD 또는 YYYY.MM.DD 등) 사전순 비교로 충분 — 같은 기관 포맷 동일
        if (a.from <= b.to && b.from <= a.to) {
          overlapping.add(a.id)
          overlapping.add(b.id)
        }
      }
    }
  }
  return overlapping
}
