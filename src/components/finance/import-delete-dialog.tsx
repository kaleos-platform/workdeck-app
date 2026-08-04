'use client'

/**
 * 업로드 파일 관리 다이얼로그 — 파일(임포트) 단위 일괄삭제(다중 선택).
 * 스테이징 행은 항상 함께 삭제되고, "저장된 거래도 함께 삭제"를 체크하면 선택한 파일에서
 * 확정된 거래까지 지워 처음부터 재작업할 수 있다(재업로드 시 중복 비교 대상이 사라짐).
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type ImportItem = {
  id: string
  fileName: string
  institution: string | null
  status: 'DRAFT' | 'COMMITTED'
  committed: boolean // 파생: 잔여 스테이징 행 0 = 저장됨
  totalRows: number
  committedRows: number
  createdAt: string
  account: { id: string; name: string } | null
}

/** ISO 문자열 → "YYYY-MM-DD HH:MM"(업로드 시각). */
function fmtUploadedAt(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
}

export function ImportDeleteDialog({
  open,
  onOpenChange,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 삭제 성공 후 호출 — 저장된 거래까지 지운 건수 전달(0이면 스테이징만) */
  onDeleted: (deletedTransactions: number) => void
}) {
  const [items, setItems] = useState<ImportItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [includeTransactions, setIncludeTransactions] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // 삭제 관리 다이얼로그는 저장됨 파일도 선택·삭제해야 하므로 전체 조회.
      const res = await fetch('/api/finance/imports?limit=50&includeCommitted=1')
      if (!res.ok) throw new Error('업로드 이력 조회 실패')
      const data = await res.json()
      setItems(data.imports ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '업로드 이력 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setSelectedIds(new Set())
      setIncludeTransactions(false)
      setConfirmOpen(false)
      void load()
    }
  }, [open, load])

  const ids = items.map((i) => i.id)
  const allSelected = ids.length > 0 && ids.every((id) => selectedIds.has(id))
  const selectedItems = items.filter((i) => selectedIds.has(i.id))
  const selectedCommitted = selectedItems.reduce((sum, i) => sum + i.committedRows, 0)

  const toggleOne = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleAll = () => setSelectedIds(() => (allSelected ? new Set() : new Set(ids)))

  const runDelete = async () => {
    if (deleting || selectedItems.length === 0) return
    setDeleting(true)
    let staged = 0
    let txns = 0
    let ok = 0
    let failed = 0
    for (const item of selectedItems) {
      try {
        const res = await fetch(
          `/api/finance/imports/${item.id}?includeTransactions=${includeTransactions ? '1' : '0'}`,
          { method: 'DELETE' }
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.message ?? '삭제 실패')
        staged += data.deletedStaged ?? 0
        txns += data.deletedTransactions ?? 0
        ok += 1
      } catch {
        failed += 1
      }
    }
    setDeleting(false)
    setConfirmOpen(false)
    setSelectedIds(new Set())
    setIncludeTransactions(false)
    if (ok > 0) {
      toast.success(
        txns > 0
          ? `파일 ${ok}개 · 대기 ${staged}건 · 저장 거래 ${txns}건을 삭제했습니다`
          : `파일 ${ok}개 · 대기 ${staged}건을 삭제했습니다`
      )
    }
    if (failed > 0) toast.error(`${failed}개 파일 삭제에 실패했습니다`)
    onDeleted(txns)
    void load()
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !deleting && onOpenChange(o)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>업로드 파일 관리</DialogTitle>
            <DialogDescription>
              파일 단위로 처리 대기 내역을 일괄 삭제합니다. 잘못 분류한 파일은 저장된 거래까지 함께
              삭제해야 재업로드 시 중복으로 제외되지 않고 처음부터 다시 작업할 수 있습니다.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">불러오는 중...</p>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">업로드 이력이 없습니다</p>
          ) : (
            <>
              {/* 전체 선택 헤더 */}
              <div className="flex items-center gap-2 border-b pb-1.5 text-xs text-muted-foreground">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  aria-label="전체 선택"
                  disabled={deleting}
                />
                <span>{selectedIds.size > 0 ? `${selectedIds.size}개 선택` : '전체 선택'}</span>
              </div>

              <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
                {items.map((imp) => (
                  <label
                    key={imp.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 hover:bg-accent/40"
                  >
                    <Checkbox
                      checked={selectedIds.has(imp.id)}
                      onCheckedChange={() => toggleOne(imp.id)}
                      aria-label="파일 선택"
                      disabled={deleting}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium" title={imp.fileName}>
                        {imp.fileName}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        업로드 {fmtUploadedAt(imp.createdAt)}
                        {imp.account?.name && ` · ${imp.account.name}`}
                        {` · ${imp.totalRows}행`}
                        {imp.committedRows > 0 && ` · 저장 ${imp.committedRows}건`}
                      </p>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {imp.committed ? '저장됨' : '처리 중'}
                    </Badge>
                  </label>
                ))}
              </div>

              {/* 하단 삭제 바 — 선택 시에만 */}
              {selectedIds.size > 0 && (
                <div className="space-y-2 border-t pt-2">
                  <label className="flex items-start gap-2 text-xs">
                    <Checkbox
                      checked={includeTransactions}
                      onCheckedChange={(v) => setIncludeTransactions(v === true)}
                      className="mt-0.5"
                      disabled={deleting}
                    />
                    <span>
                      저장된 거래도 함께 삭제
                      {selectedCommitted > 0 && ` (${selectedCommitted}건)`}
                      <span className="block text-[11px] text-muted-foreground">
                        {includeTransactions
                          ? '선택한 파일의 저장된 거래를 지우고 월말 잔고를 다시 계산합니다. 되돌릴 수 없습니다.'
                          : '체크하지 않으면 저장된 거래는 유지됩니다.'}
                      </span>
                    </span>
                  </label>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 text-xs"
                      onClick={() => setConfirmOpen(true)}
                      disabled={deleting}
                    >
                      {selectedIds.size}개 삭제
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 삭제 확인 — 되돌릴 수 없음 */}
      <Dialog open={confirmOpen} onOpenChange={(o) => !deleting && setConfirmOpen(o)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>업로드 파일 삭제</DialogTitle>
            <DialogDescription>
              선택한 <strong>{selectedItems.length}개</strong> 파일의 처리 대기 내역을 삭제합니다.
              {includeTransactions && selectedCommitted > 0 && (
                <>
                  {' '}
                  저장된 거래 <strong>{selectedCommitted}건</strong>도 함께 삭제되고 월말 잔고가
                  다시 계산됩니다.
                </>
              )}{' '}
              되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              취소
            </Button>
            <Button variant="destructive" onClick={() => void runDelete()} disabled={deleting}>
              {deleting ? '삭제 중...' : `${selectedItems.length}개 삭제`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
