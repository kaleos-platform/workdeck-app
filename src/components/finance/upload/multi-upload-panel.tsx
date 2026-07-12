'use client'

/**
 * 재무 관리 Deck — 데이터 등록 패널 (다중 파일 업로드).
 * 파일 여러 개 드롭 → 병렬 preview 분석 + 계좌 자동 매칭 → 파일별 결과 일괄 확인
 * → 미매칭만 개별 지정 → "전체 등록"으로 commit-staging 순차 실행.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight, Upload } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { CoverageMatrix } from '@/components/finance/coverage-matrix'
import { FINANCE_IMPORTS_PATH, FINANCE_TRANSACTIONS_PATH } from '@/lib/deck-routes'

import { FileItemCard } from './file-item-card'
import {
  findOverlappingFileIds,
  resolveInitialSelection,
  resolveReadiness,
  stateToMappingEntries,
  type Account,
  type CommitCounts,
  type PreviewResponse,
  type UploadFileItem,
} from './types'

/** preview 병렬 분석 동시성 — 서버 xlsx 파싱이 CPU 작업이라 제한 */
const ANALYZE_CONCURRENCY = 3

let fileItemSeq = 0

export function MultiUploadPanel() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [items, setItems] = useState<UploadFileItem[]>([])
  // 전체 계좌 목록 — preview 응답들에서 병합, 새 계좌 등록 시 추가(모든 파일 후보에 반영)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [batchRunning, setBatchRunning] = useState(false)
  // 등록 완료 시 증가 → 커버리지 매트릭스 재조회
  const [coverageToken, setCoverageToken] = useState(0)

  // 커밋 루프에서 최신 items를 읽기 위한 미러
  const itemsRef = useRef<UploadFileItem[]>(items)
  itemsRef.current = items

  // ─── 상태 갱신 헬퍼 ──────────────────────────────────────────────────────

  const patchItem = useCallback((id: string, patch: Partial<UploadFileItem>) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it
        const next = { ...it, ...patch }
        // 편집 가능한 상태에서 kind/accountId/mapping이 바뀌면 준비 상태 재판정
        if (
          (next.status === 'matched' || next.status === 'needs_review') &&
          ('kind' in patch || 'accountId' in patch || 'mapping' in patch)
        ) {
          next.status = resolveReadiness(next)
        }
        return next
      })
    )
  }, [])

  // ─── 파일 추가 + 분석 ─────────────────────────────────────────────────────

  const enqueueFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return

      // 파일 바이트를 선택 즉시 메모리로 스냅샷 — 매핑/계좌 등록 중 디스크 파일이
      // 변경(엑셀 저장·재다운로드·클라우드 sync)되면 원본 File 핸들 재전송이
      // ERR_UPLOAD_FILE_CHANGED 로 실패한다. 이후 preview/commit 요청은 스냅샷 사용.
      const snapshots = await Promise.all(
        files.map(async (f) => new File([await f.arrayBuffer()], f.name, { type: f.type }))
      )

      const newItems: UploadFileItem[] = snapshots.map((file) => ({
        id: `f${++fileItemSeq}`,
        file,
        status: 'queued',
        kind: 'BANK',
        accountId: '',
        mapping: {},
        savePreset: false,
        presetName: '',
      }))
      setItems((prev) => [...prev, ...newItems])

      // 동시성 제한 pool로 순번 분석
      const queue = [...newItems]
      const workers = Array.from({ length: Math.min(ANALYZE_CONCURRENCY, queue.length) }, () =>
        (async () => {
          for (;;) {
            const next = queue.shift()
            if (!next) return
            await analyzeItem(next.id, next.file)
          }
        })()
      )
      await Promise.allSettled(workers)
    },

    []
  )

  async function analyzeItem(id: string, file: File) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, status: 'analyzing', error: undefined } : it))
    )
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/finance/imports/preview', { method: 'POST', body: fd })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '파일 미리보기 실패')
      }
      const data: PreviewResponse = await res.json()
      const initial = resolveInitialSelection(data)

      // 계좌 목록 병합(id 기준 dedup)
      setAccounts((prev) => {
        const known = new Set(prev.map((a) => a.id))
        const added = data.accounts.filter((a) => !known.has(a.id))
        return added.length > 0 ? [...prev, ...added] : prev
      })

      setItems((prev) =>
        prev.map((it) => {
          if (it.id !== id) return it
          const next: UploadFileItem = {
            ...it,
            preview: data,
            kind: initial.kind,
            accountId: initial.accountId,
            mapping: initial.mapping,
            presetName: initial.presetName,
          }
          next.status = resolveReadiness(next)
          return next
        })
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : '파일 처리 실패'
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, status: 'analyze_failed', error: message } : it))
      )
    }
  }

  function handleRetryAnalyze(id: string) {
    const item = itemsRef.current.find((it) => it.id === id)
    if (item) void analyzeItem(id, item.file)
  }

  function handleRemove(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }

  function handleAccountCreated(itemId: string, account: Account) {
    setAccounts((prev) => (prev.some((a) => a.id === account.id) ? prev : [...prev, account]))
    // 등록한 파일에서 자동 선택. 사용자가 폼에서 종류를 바꿨으면 kind도 따라감(commit 400 방지)
    const patch: Partial<UploadFileItem> =
      account.kind === 'BANK' || account.kind === 'CARD'
        ? { accountId: account.id, kind: account.kind }
        : { accountId: account.id }
    patchItem(itemId, patch)
  }

  // ─── 전체 등록 (commit-staging 순차) ─────────────────────────────────────

  async function commitOne(id: string): Promise<boolean> {
    const item = itemsRef.current.find((it) => it.id === id)
    if (!item || !item.preview) return false

    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, status: 'committing', error: undefined } : it))
    )
    try {
      const fd = new FormData()
      fd.append('file', item.file)
      fd.append('accountId', item.accountId)
      fd.append('kind', item.kind)
      fd.append(
        'mapping',
        JSON.stringify(stateToMappingEntries(item.mapping, item.preview.preview.headers))
      )
      fd.append('institution', item.preview.institution ?? '')
      fd.append('savePreset', item.savePreset ? 'true' : '')
      if (item.savePreset && item.presetName.trim()) {
        fd.append('presetName', item.presetName.trim())
      }

      const res = await fetch('/api/finance/imports/commit-staging', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '가져오기 실패')

      const { importId, counts } = data as { importId: string; counts: CommitCounts }
      setItems((prev) =>
        prev.map((it) =>
          it.id === id ? { ...it, status: 'done', result: { importId, counts } } : it
        )
      )
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : '가져오기 실패'
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, status: 'commit_failed', error: message } : it))
      )
      return false
    }
  }

  async function handleCommitAll() {
    const targets = itemsRef.current.filter(
      (it) => it.status === 'matched' || it.status === 'commit_failed'
    )
    if (targets.length === 0) return

    setBatchRunning(true)
    let ok = 0
    let failed = 0
    try {
      // 순차 실행: 파일별 에러 격리 + 프리셋 upsert 동시 충돌 회피
      for (const target of targets) {
        const success = await commitOne(target.id)
        if (success) ok++
        else failed++
      }
    } finally {
      setBatchRunning(false)
      setCoverageToken((v) => v + 1)
    }

    const after = itemsRef.current
    const dupSame = after.reduce((sum, it) => sum + (it.result?.counts.dupSame ?? 0), 0)
    if (failed > 0) {
      toast.warning(`${ok}건 등록, ${failed}건 실패 — 실패 파일을 확인 후 다시 등록하세요`, {
        duration: 6000,
      })
    } else {
      toast.success(`${ok}개 파일 등록 완료`)
    }
    if (dupSame > 0) {
      toast.warning(`중복 판정 ${dupSame}건 — 확인·처리 탭 중복에서 확인하세요`, { duration: 6000 })
    }
  }

  // ─── 파생 상태 ────────────────────────────────────────────────────────────

  const analyzing = items.some((it) => it.status === 'queued' || it.status === 'analyzing')
  const readyCount = items.filter((it) => it.status === 'matched').length
  const retryCount = items.filter((it) => it.status === 'commit_failed').length
  const reviewCount = items.filter((it) => it.status === 'needs_review').length
  const doneCount = items.filter((it) => it.status === 'done').length
  const totalRows = items
    .filter((it) => it.status === 'matched' || it.status === 'commit_failed')
    .reduce((sum, it) => sum + (it.preview?.preview.totalRows ?? 0), 0)
  const canCommit = !batchRunning && !analyzing && readyCount + retryCount > 0

  const overlapIds = useMemo(
    () =>
      findOverlappingFileIds(
        items
          .filter((it) => it.status !== 'done')
          .map((it) => ({
            id: it.id,
            accountId: it.accountId,
            preview: it.preview,
          }))
      ),
    [items]
  )

  // ─── 렌더 ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* 드롭존 */}
      <Card>
        <CardContent className={cn(items.length > 0 ? 'py-4' : 'pt-6')}>
          <div
            className={cn(
              'flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-8 text-center transition-colors',
              items.length > 0 ? 'py-5' : 'py-10',
              dragOver ? 'border-primary/60 bg-primary/5' : 'border-border'
            )}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDragOver(false)
              const files = Array.from(e.dataTransfer.files ?? [])
              if (files.length > 0 && !batchRunning) void enqueueFiles(files)
            }}
          >
            <Upload
              className={cn(
                'text-muted-foreground/50',
                items.length > 0 ? 'mb-2 size-6' : 'mb-3 size-8'
              )}
            />
            <p className="text-sm text-muted-foreground">
              파일을 드래그하거나 선택하세요 — 여러 개 동시 등록 가능
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Excel(.xlsx, .xls) 또는 CSV</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => fileRef.current?.click()}
              disabled={batchRunning}
            >
              파일 선택
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              if (files.length > 0) void enqueueFiles(files)
              e.target.value = ''
            }}
          />
        </CardContent>
      </Card>

      {/* 파일 목록 */}
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => (
            <FileItemCard
              key={item.id}
              item={item}
              accounts={accounts}
              overlapWarning={overlapIds.has(item.id)}
              batchLocked={batchRunning}
              onChange={patchItem}
              onRemove={handleRemove}
              onRetryAnalyze={handleRetryAnalyze}
              onAccountCreated={handleAccountCreated}
            />
          ))}

          {/* 기간 겹침 안내 */}
          {overlapIds.size > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              같은 계좌에 기간이 겹치는 파일이 있습니다 — 중복 행은 등록 시 중복으로 판정되어 저장
              단계에서 걸러집니다
            </p>
          )}

          {/* 하단 액션 바 */}
          <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {analyzing
                ? '파일 분석 중...'
                : [
                    readyCount + retryCount > 0 && `등록 대기 ${readyCount + retryCount}개`,
                    reviewCount > 0 && `확인 필요 ${reviewCount}개`,
                    doneCount > 0 && `완료 ${doneCount}개`,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '등록할 파일이 없습니다'}
            </p>
            <div className="flex items-center gap-2">
              {doneCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(FINANCE_TRANSACTIONS_PATH)}
                >
                  거래내역에서 확인·저장
                  <ArrowRight className="ml-1 size-3.5" />
                </Button>
              )}
              <Button onClick={handleCommitAll} disabled={!canCommit}>
                {batchRunning
                  ? '등록 중...'
                  : retryCount > 0
                    ? `전체 등록 (${readyCount + retryCount}개 파일)`
                    : `전체 등록 (${readyCount}개 파일 · ${totalRows}건)`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 월별 등록 현황 요약 — 방금 등록분은 저장 전이라 "검토중"으로 표시됨 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>월별 등록 현황</CardTitle>
            <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
              <Link href={FINANCE_IMPORTS_PATH}>
                전체 이력 보기
                <ArrowRight className="ml-1 size-3.5" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <CoverageMatrix months={6} refreshToken={coverageToken} />
        </CardContent>
      </Card>
    </div>
  )
}
