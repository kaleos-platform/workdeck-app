'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { fetchWithMfa, redirectIfMfaRequired } from '@/lib/auth/mfa-client'

export type OpeningMigrationJobRow = {
  id: string
  openingBrandId: string
  userEmail: string | null
  targetSpaceName: string | null
  status: string
  // auto-job 이 저장한 summary(brandName·prepare·warnings). snapshot 은 서버에서 제거한다.
  summary: Record<string, unknown>
  // 승인 기준 snapshot 존재 여부(없으면 승인 불가). snapshot 자체는 서버에서 제거한다.
  hasSnapshot: boolean
  blockReasons: string[]
  // 복호화된 연락처 조각, 없으면 null, 복호화 실패면 'DECRYPT_FAILED'
  contactHits: { kind: string; id: string; title: string; fragments: string[] }[] | string | null
  error: string | null
  createdAt: string
  // 낡은 화면 승인 방지용 — approve 요청에 함께 보낸다.
  updatedAt: string
}

const STATUS_LABELS: Record<string, string> = {
  MATCHED: '대조됨 — 계획 대기',
  PLANNED: '승인 대기',
  BLOCKED: '차단',
  // 자동 적용(2차)이 아직 없어 승인 뒤에는 운영자가 수동으로 적용한다.
  APPROVED: '승인됨 — 수동 적용 대기',
  APPLYING: '적용 중',
  APPLIED: '적용됨',
  GRANTED: '보장가 부여됨',
  GRANT_MANUAL: '보장가 수동 확인 필요',
  DONE: '완료',
  FAILED: '실패',
  HELD: '보류',
}

// auto-job.ts classifyPlan·대조 단계의 blockReasons 코드 전체. 모르는 코드는 원문을 그대로 보여 준다.
const CODE_LABELS: Record<string, string> = {
  OWNERSHIP_MISMATCH: '자산 소유 불일치',
  MULTI_BRAND: '여러 브랜드',
  MULTI_USER: '여러 가입자',
  LEDGER_CONFLICT: '이미 이전된 항목 충돌',
  TARGET_HAS_DATA: '대상 Space에 기존 데이터',
  NO_TARGET_SPACE: '모집 관리 Space 없음',
  IMPORT_REFUSED: '이전 거부 항목',
  REVIEW_INCOMPLETE: '검토 미완료',
  SIBLING_ASSET: '형제 브랜드 자산',
}
// summary.warnings 키(opening-import.ts safeMigrationSummary 의 reasons·warningCodes, 매장·직무 heldReasons, prepare 경고).
// 차단 코드와 같은 표를 쓴다. 모르는 코드는 원문을 그대로 보여 준다.
Object.assign(CODE_LABELS, {
  CONTACT_PATTERN: '연락처 감지',
  HELD_CONTACT_PATTERN: '연락처 감지로 보류',
  SENSITIVE_URL: '민감 URL 감지',
  HELD_SENSITIVE_URL: '민감 URL로 보류',
  EMBEDDED_IMAGE_REVIEW_REQUIRED: '내장 이미지 검토 필요',
  REVIEW_STALE: '검토 결과가 낡음',
  STORE_UNAVAILABLE: '매장 사용 불가',
  POSITION_UNAVAILABLE: '직무 사용 불가',
  PACKET_SCHEMA_REJECTED: '자료 형식 거부',
  PLAN_BLOCKED: '계획 차단',
  DESIGN_TOO_LARGE: '디자인 용량 초과 제외',
  ASSET_FILE_MISSING: '자산 파일 없음',
  ASSET_FILE_REJECTED: '자산 파일 거부',
  ASSET_SCOPE_MISMATCH: '자산 소유 불일치',
  ASSET_SCOPE_UNKNOWN: '자산 소유 확인 불가',
  ASSET_REVIEW_STALE: '자산 검토 결과가 낡음',
  ASSET_READ_FAILED: '자산 읽기 실패',
  ASSET_KEY_MISSING: '자산 키 없음',
  ASSET_TOO_LARGE: '자산 용량 초과',
  ASSET_UNSUPPORTED_TYPE: '지원하지 않는 자산 형식',
  SVG_EXTERNAL_REF: 'SVG 외부 참조',
  SCENE_INVALID: '디자인 장면 오류',
  SCENE_IMAGE_MALFORMED: '디자인 이미지 오류',
  CONTENT_INVALID_DETAIL: '공고 내용 오류',
  CONTENT_INVALID_SECTION: '공고 섹션 오류',
  CONTENT_UNSUPPORTED_ATTRIBUTE: '지원하지 않는 속성',
  CONTENT_UNSUPPORTED_SECTION: '지원하지 않는 섹션',
  CONTENT_MISSING_RESOURCE: '공고 리소스 없음',
  CONTENT_MISSING_SCENE: '공고 디자인 장면 없음',
  RESOURCE_UNSUPPORTED: '지원하지 않는 리소스',
  RESOURCE_SCOPE_MISMATCH: '리소스 소유 불일치',
  TEMPLATE_UNSUPPORTED_SECTION: '템플릿 지원하지 않는 섹션',
  DELETED: '삭제된 항목',
  OUT_OF_WINDOW: '이전 기간 밖',
  NO_TITLE: '제목 없음',
  OPENING_URL_REMAINS: '오프닝 URL 잔존',
  JOB_TYPE_UNMAPPED: '고용 형태 미매핑',
  PAY_FREQUENCY_UNMAPPED: '급여 주기 미매핑',
  EXPERIENCE_UNMAPPED: '경력 미매핑',
  EDUCATION_UNMAPPED: '학력 미매핑',
  WORK_DAYS_UNMAPPED: '근무 요일 미매핑',
  SIBLING_BRAND_UNVERIFIED: '형제 브랜드 미확인',
  SOURCE_BRAND_NOT_FOUND: '오프닝 브랜드 없음',
  FORMAT: '형식 오류',
  OTHER: '기타',
})
const codeLabel = (code: string) => CODE_LABELS[code] ?? code

// 탭 분류. 운영자가 직접 확인해야 하는 FAILED·GRANT_MANUAL 은 '차단'에 함께 둔다.
// MATCHED(대조만 끝나 자동 계획을 기다리는 중)는 막힌 것이 아니라 진행 중이라 '진행 중'에 둔다.
const TABS = [
  { value: 'pending', label: '승인 대기', statuses: ['PLANNED'] },
  { value: 'blocked', label: '차단', statuses: ['BLOCKED', 'FAILED', 'GRANT_MANUAL'] },
  {
    value: 'progress',
    label: '진행 중',
    statuses: ['MATCHED', 'APPROVED', 'APPLYING', 'APPLIED', 'GRANTED'],
  },
  { value: 'done', label: '완료', statuses: ['DONE'] },
  { value: 'held', label: '보류', statuses: ['HELD'] },
] as const

// POST hold 가 API 에서 허용되는 상태(app/api/admin/opening-migrations/[id]/route.ts 와 동일)
const HOLDABLE = ['MATCHED', 'PLANNED', 'BLOCKED', 'FAILED']

const WARNING_CLASS =
  'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400'

type Counts = Record<string, number>
const group = (summary: Record<string, unknown>, key: string): Counts => {
  const prepare = summary.prepare as Record<string, Counts> | undefined
  return prepare?.[key] ?? {}
}
const brandName = (job: OpeningMigrationJobRow) => String(job.summary.brandName ?? '')
const hasCodes = (job: OpeningMigrationJobRow) =>
  job.blockReasons.length > 0 ||
  warnings(job).length > 0 ||
  (Array.isArray(job.contactHits)
    ? job.contactHits.length > 0
    : job.contactHits === 'DECRYPT_FAILED')
const warnings = (job: OpeningMigrationJobRow) =>
  Object.entries((job.summary.warnings as Counts | undefined) ?? {})
const date = (value: string) => new Date(value).toLocaleDateString('ko-KR')

function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABELS[status] ?? status
  if (status === 'BLOCKED' || status === 'FAILED')
    return <Badge variant="destructive">{label}</Badge>
  if (status === 'PLANNED' || status === 'GRANT_MANUAL')
    return <Badge className={WARNING_CLASS}>{label}</Badge>
  return <Badge variant="secondary">{label}</Badge>
}

function CodeBadges({ job }: { job: OpeningMigrationJobRow }) {
  return (
    <div className="flex flex-wrap gap-1">
      {job.blockReasons.map((code) => (
        <Badge key={code} variant="destructive">
          {codeLabel(code)}
        </Badge>
      ))}
      {warnings(job).map(([code, count]) => (
        <Badge key={code} className={WARNING_CLASS}>
          {codeLabel(code)} {count}
        </Badge>
      ))}
      {job.contactHits === 'DECRYPT_FAILED' ? (
        <Badge className={WARNING_CLASS}>연락처 복호화 실패</Badge>
      ) : (
        Array.isArray(job.contactHits) &&
        job.contactHits.length > 0 && (
          <Badge className={WARNING_CLASS}>연락처 조각 확인 {job.contactHits.length}건</Badge>
        )
      )}
    </div>
  )
}

function Detail({
  job,
  busy,
  onApprove,
  onHold,
}: {
  job: OpeningMigrationJobRow
  busy: boolean
  onApprove: () => void
  onHold: () => void
}) {
  const postings = group(job.summary, 'postings')
  const templates = group(job.summary, 'templates')
  const stores = group(job.summary, 'stores')
  const positions = group(job.summary, 'positions')
  const images = group(job.summary, 'images')
  const assets = group(job.summary, 'assets')
  const hits = job.contactHits
  return (
    <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4 text-sm">
      <section className="flex flex-col gap-1">
        <div>
          {brandName(job)} #{job.openingBrandId} → {job.targetSpaceName ?? '대상 Space 없음'}
        </div>
        <div className="text-muted-foreground">가입자 {job.userEmail ?? '—'}</div>
        <div>
          <StatusBadge status={job.status} />
        </div>
      </section>
      <section className="flex flex-col gap-1">
        <h3 className="font-medium">이전 건수</h3>
        <div>
          공고 {postings.included ?? 0}건 (제외·보류{' '}
          {(postings.held ?? 0) + (postings.excluded ?? 0)}
          건)
        </div>
        <div>
          템플릿 {templates.included ?? 0}건 (제외·보류 {templates.held ?? 0}건)
        </div>
        <div>
          매장 {stores.active ?? 0}건 (보류 {stores.held ?? 0}건)
        </div>
        <div>
          직무 {positions.active ?? 0}건 (보류 {positions.held ?? 0}건)
        </div>
        <div>
          이미지 {images.total ?? 0}건 · 자산 {assets.total ?? 0}건
        </div>
      </section>
      {hasCodes(job) && (
        <section className="flex flex-col gap-1">
          <h3 className="font-medium">경고·차단</h3>
          <CodeBadges job={job} />
        </section>
      )}
      {job.error && <p className="text-destructive">오류 코드: {job.error}</p>}
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">연락처 감지 조각</h3>
        {hits === 'DECRYPT_FAILED' ? (
          <p className="text-destructive">
            연락처 조각을 복호화하지 못했습니다. 암호화 키 설정을 확인하세요.
          </p>
        ) : Array.isArray(hits) && hits.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {hits.map((item) => (
              <li key={`${item.kind}:${item.id}`} className="rounded-md border p-2">
                <div className="font-medium">{item.title || `${item.kind} ${item.id}`}</div>
                <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                  {item.fragments.map((fragment, index) => (
                    <li key={index}>{fragment}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">감지된 연락처 조각이 없습니다.</p>
        )}
        <p className="text-xs text-muted-foreground">(완료·보류 시 삭제)</p>
      </section>
      <div className="flex gap-2">
        {job.status === 'PLANNED' && job.hasSnapshot && (
          <Button disabled={busy} onClick={onApprove}>
            승인
          </Button>
        )}
        {HOLDABLE.includes(job.status) && (
          <Button variant="outline" disabled={busy} onClick={onHold}>
            보류
          </Button>
        )}
      </div>
    </div>
  )
}

export function OpeningMigrationsQueue({ jobs }: { jobs: OpeningMigrationJobRow[] }) {
  const router = useRouter()
  const [tab, setTab] = useState<(typeof TABS)[number]['value']>('pending')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<'approve' | 'hold' | null>(null)
  const [busy, setBusy] = useState(false)

  const current = TABS.find((item) => item.value === tab) ?? TABS[0]
  const rows = jobs.filter((job) => (current.statuses as readonly string[]).includes(job.status))
  const selected = jobs.find((job) => job.id === selectedId) ?? null

  async function act(job: OpeningMigrationJobRow, action: 'approve' | 'hold') {
    setBusy(true)
    try {
      const res = await fetchWithMfa(`/api/admin/opening-migrations/${job.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'approve' ? { action, updatedAt: job.updatedAt } : { action }
        ),
      })
      if (await redirectIfMfaRequired(res)) return
      if (!res.ok) {
        // 2단계 인증 취소·실패는 mfa-client 가 이미 안내 토스트를 띄웠다.
        const body = await res
          .clone()
          .json()
          .catch(() => null)
        if (res.status === 403 && String(body?.code ?? '').startsWith('MFA_')) return
        toast.error(
          res.status === 409
            ? '이미 처리되었거나 상태가 바뀌었습니다. 목록을 새로고침합니다'
            : '처리하지 못했습니다. 잠시 후 다시 시도해 주세요'
        )
        if (res.status === 409) router.refresh()
        return
      }
      toast.success(action === 'approve' ? '승인했습니다' : '보류했습니다')
      setConfirming(null)
      setSelectedId(null)
      router.refresh()
    } catch {
      toast.error('처리하지 못했습니다. 잠시 후 다시 시도해 주세요')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList>
          {TABS.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>
              {item.label}{' '}
              {
                jobs.filter((job) => (item.statuses as readonly string[]).includes(job.status))
                  .length
              }
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>가입자 이메일</TableHead>
            <TableHead>오프닝 브랜드</TableHead>
            <TableHead>대상 Space</TableHead>
            <TableHead>상태</TableHead>
            <TableHead>공고/템플릿/매장/직무</TableHead>
            <TableHead>이미지/자산</TableHead>
            <TableHead>경고·차단</TableHead>
            <TableHead>계획일</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                {jobs.length === 0
                  ? '대조된 가입자가 없습니다'
                  : `${current.label} 항목이 없습니다`}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((job) => (
              <TableRow
                key={job.id}
                className="cursor-pointer"
                onClick={() => setSelectedId(job.id)}
              >
                <TableCell>{job.userEmail ?? '—'}</TableCell>
                <TableCell>
                  <button
                    type="button"
                    className="text-left underline-offset-2 hover:underline focus-visible:underline"
                    aria-label={`${brandName(job)} #${job.openingBrandId} 상세 열기`}
                    onClick={() => setSelectedId(job.id)}
                  >
                    {brandName(job)} #{job.openingBrandId}
                  </button>
                </TableCell>
                <TableCell>{job.targetSpaceName ?? '—'}</TableCell>
                <TableCell>
                  <StatusBadge status={job.status} />
                </TableCell>
                <TableCell>
                  {group(job.summary, 'postings').included ?? 0}/
                  {group(job.summary, 'templates').included ?? 0}/
                  {group(job.summary, 'stores').active ?? 0}/
                  {group(job.summary, 'positions').active ?? 0}
                </TableCell>
                <TableCell>
                  {group(job.summary, 'images').total ?? 0}/
                  {group(job.summary, 'assets').total ?? 0}
                </TableCell>
                <TableCell>
                  <CodeBadges job={job} />
                </TableCell>
                <TableCell>{date(job.createdAt)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>오프닝 이전 상세</SheetTitle>
            <SheetDescription>브랜드 1개 단위 이전 계획입니다.</SheetDescription>
          </SheetHeader>
          {selected && (
            <Detail
              job={selected}
              busy={busy}
              onApprove={() => setConfirming('approve')}
              onHold={() => setConfirming('hold')}
            />
          )}
        </SheetContent>
      </Sheet>

      <Dialog
        open={confirming !== null && !!selected}
        onOpenChange={(open) => !open && setConfirming(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirming === 'hold' ? '이전을 보류할까요?' : '이전을 승인할까요?'}
            </DialogTitle>
            <DialogDescription>
              브랜드 {selected ? `${brandName(selected)} #${selected.openingBrandId}` : ''}
              {confirming === 'approve' && ` / 가입자 ${selected?.userEmail ?? '—'}`}
              <br />
              {confirming === 'hold'
                ? '보류하면 자동 이전 대상에서 빠지고 되돌릴 수 없습니다. 연락처 조각도 삭제됩니다.'
                : '승인 대상이 맞는지 한 번 더 확인하세요. 적용은 아직 수동으로 진행됩니다.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)}>
              취소
            </Button>
            <Button
              variant={confirming === 'hold' ? 'destructive' : 'default'}
              disabled={busy}
              onClick={() => selected && confirming && void act(selected, confirming)}
            >
              {confirming === 'hold' ? '보류 확정' : '승인 확정'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
