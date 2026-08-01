'use client'

/**
 * 업로드 파일 관리 다이얼로그 — 파일(임포트) 단위 일괄삭제.
 * 스테이징 행은 항상 함께 삭제되고, "저장된 거래도 함께 삭제"를 체크하면 이 파일에서
 * 확정된 거래까지 지워 처음부터 재작업할 수 있다(재업로드 시 중복 비교 대상이 사라짐).
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type ImportItem = {
  id: string
  fileName: string
  institution: string | null
  status: 'DRAFT' | 'COMMITTED'
  totalRows: number
  committedRows: number
  createdAt: string
  account: { id: string; name: string } | null
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
  // 인라인 확인 상태 — 확인 중인 임포트 id + 거래 포함 여부
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [includeTransactions, setIncludeTransactions] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/finance/imports?limit=50')
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
      setConfirmId(null)
      setIncludeTransactions(false)
      void load()
    }
  }, [open, load])

  const handleDelete = async (id: string) => {
    if (deleting) return
    setDeleting(true)
    try {
      const res = await fetch(
        `/api/finance/imports/${id}?includeTransactions=${includeTransactions ? '1' : '0'}`,
        { method: 'DELETE' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '삭제 실패')
      const staged = data.deletedStaged ?? 0
      const txns = data.deletedTransactions ?? 0
      toast.success(
        txns > 0
          ? `대기 ${staged}건 · 저장된 거래 ${txns}건을 삭제했습니다`
          : `대기 ${staged}건을 삭제했습니다`
      )
      setConfirmId(null)
      setIncludeTransactions(false)
      onDeleted(txns)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    } finally {
      setDeleting(false)
    }
  }

  return (
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
          <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
            {items.map((imp) => (
              <div key={imp.id} className="rounded-md border px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium" title={imp.fileName}>
                      {imp.fileName}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {[imp.account?.name, imp.createdAt.slice(0, 10)].filter(Boolean).join(' · ')}
                      {' · '}
                      {imp.totalRows}행{imp.committedRows > 0 && ` · 저장 ${imp.committedRows}건`}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {imp.status === 'DRAFT' ? '처리 중' : '저장됨'}
                  </Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      setConfirmId(confirmId === imp.id ? null : imp.id)
                      setIncludeTransactions(false)
                    }}
                    disabled={deleting}
                    aria-label="파일 삭제"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                {confirmId === imp.id && (
                  <div className="mt-2 space-y-2 border-t pt-2">
                    <label className="flex items-start gap-2 text-xs">
                      <Checkbox
                        checked={includeTransactions}
                        onCheckedChange={(v) => setIncludeTransactions(v === true)}
                        className="mt-0.5"
                      />
                      <span>
                        저장된 거래도 함께 삭제
                        {imp.committedRows > 0 && ` (${imp.committedRows}건)`}
                        <span className="block text-[11px] text-muted-foreground">
                          {includeTransactions
                            ? '이 파일에서 저장된 거래를 지우고 월말 잔고를 다시 계산합니다. 되돌릴 수 없습니다.'
                            : '체크하지 않으면 저장된 거래는 유지됩니다.'}
                        </span>
                      </span>
                    </label>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => setConfirmId(null)}
                        disabled={deleting}
                      >
                        취소
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 text-xs"
                        onClick={() => void handleDelete(imp.id)}
                        disabled={deleting}
                      >
                        {deleting ? '삭제 중...' : '삭제'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
