'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AddMaterialDialog } from './add-material-dialog'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getBlogOpsPostPath } from '@/lib/deck-routes'

// ─── 타입 ─────────────────────────────────────────────────────────────────────

type MaterialStatus = 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'ARCHIVED'

type OutlineSection = { section: string; description: string }

type Material = {
  id: string
  title: string
  appealPoint: string
  angle: string
  outline: OutlineSection[]
  targetKeyword: string | null
  status: MaterialStatus
  approvedAt: string | null
  createdAt: string
  updatedAt: string
  product: { id: string; name: string }
}

type Product = { id: string; name: string }

interface MaterialsBoardProps {
  products: Product[]
}

// ─── 상태 배지 설정 ───────────────────────────────────────────────────────────

const STATUS_LABEL: Record<MaterialStatus, string> = {
  PROPOSED: '검토 대기',
  APPROVED: '승인',
  REJECTED: '반려',
  ARCHIVED: '보관',
}

const STATUS_CLASS: Record<MaterialStatus, string> = {
  PROPOSED: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  APPROVED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  REJECTED: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  ARCHIVED: 'bg-secondary text-secondary-foreground',
}

// ─── 컴포넌트 ────────────────────────────────────────────────────────────────

export function MaterialsBoard({ products }: MaterialsBoardProps) {
  const router = useRouter()
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<MaterialStatus | 'ALL'>('ALL')
  const [productFilter, setProductFilter] = useState<string>('ALL')
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [draftingIds, setDraftingIds] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'ALL') params.set('status', statusFilter)
      if (productFilter !== 'ALL') params.set('productId', productFilter)

      const res = await fetch(`/api/bo/materials?${params.toString()}`)
      if (!res.ok) throw new Error('소재 목록을 불러오지 못했습니다')
      const data = (await res.json()) as { materials: Material[] }
      setMaterials(data.materials)
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류 발생')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, productFilter])

  useEffect(() => {
    void load()
  }, [load])

  async function changeStatus(id: string, newStatus: MaterialStatus) {
    setPendingIds((prev) => new Set(prev).add(id))
    try {
      const res = await fetch(`/api/bo/materials/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { message?: string }).message ?? '상태 변경에 실패했습니다')
      }
      // 낙관적 업데이트
      setMaterials((prev) => prev.map((m) => (m.id === id ? { ...m, status: newStatus } : m)))
    } catch (err) {
      alert(err instanceof Error ? err.message : '상태 변경 실패')
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  async function createDraft(materialId: string) {
    setDraftingIds((prev) => new Set(prev).add(materialId))
    try {
      const res = await fetch('/api/bo/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ materialId }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string }
        throw new Error(data.message ?? '초안 생성에 실패했습니다')
      }
      const data = (await res.json()) as { post: { id: string } }
      router.push(getBlogOpsPostPath(data.post.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '초안 생성 실패')
      setDraftingIds((prev) => {
        const next = new Set(prev)
        next.delete(materialId)
        return next
      })
    }
  }

  const allStatuses: MaterialStatus[] = ['PROPOSED', 'APPROVED', 'REJECTED', 'ARCHIVED']

  return (
    <div className="space-y-4">
      {/* 필터 + 등록 버튼 */}
      <div className="flex flex-wrap items-center gap-3">
        {/* 상태 필터 탭 */}
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant={statusFilter === 'ALL' ? 'default' : 'outline'}
            onClick={() => setStatusFilter('ALL')}
          >
            전체
          </Button>
          {allStatuses.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={statusFilter === s ? 'default' : 'outline'}
              onClick={() => setStatusFilter(s)}
            >
              {STATUS_LABEL[s]}
            </Button>
          ))}
        </div>

        {/* 제품 필터 */}
        {products.length > 0 && (
          <Select value={productFilter} onValueChange={setProductFilter}>
            <SelectTrigger className="h-8 w-40 text-sm">
              <SelectValue placeholder="제품 필터" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">전체 제품</SelectItem>
              {products.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="ml-auto">
          <AddMaterialDialog products={products} onSuccess={() => void load()} />
        </div>
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          로딩 중...
        </div>
      ) : error ? (
        <p className="py-4 text-sm text-destructive">{error}</p>
      ) : materials.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">조건에 맞는 소재가 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {materials.map((m) => {
            const isPending = pendingIds.has(m.id)
            const outlineSections = Array.isArray(m.outline) ? m.outline : []

            return (
              <Card key={m.id} className="text-sm">
                <CardHeader className="px-4 pt-4 pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="line-clamp-2 leading-snug font-medium">{m.title}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[m.status]}`}
                        >
                          {STATUS_LABEL[m.status]}
                        </span>
                        <span className="text-xs text-muted-foreground">{m.product.name}</span>
                        {m.targetKeyword && (
                          <Badge variant="secondary" className="text-xs">
                            {m.targetKeyword}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 px-4 pb-4">
                  <div className="space-y-1">
                    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      소구점
                    </p>
                    <p className="line-clamp-2">{m.appealPoint}</p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      앵글
                    </p>
                    <p className="line-clamp-2 text-muted-foreground">{m.angle}</p>
                  </div>

                  {outlineSections.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        아웃라인
                      </p>
                      <ul className="space-y-0.5 text-muted-foreground">
                        {outlineSections.slice(0, 3).map((sec, i) => (
                          <li key={i} className="line-clamp-1">
                            <span className="font-medium text-foreground">{sec.section}</span>
                            {sec.description ? ` — ${sec.description}` : ''}
                          </li>
                        ))}
                        {outlineSections.length > 3 && (
                          <li className="text-xs">+{outlineSections.length - 3}개 섹션</li>
                        )}
                      </ul>
                    </div>
                  )}

                  {/* 액션 버튼 */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {m.status === 'PROPOSED' && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950"
                          disabled={isPending}
                          onClick={() => changeStatus(m.id, 'APPROVED')}
                        >
                          승인
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
                          disabled={isPending}
                          onClick={() => changeStatus(m.id, 'REJECTED')}
                        >
                          반려
                        </Button>
                      </>
                    )}
                    {m.status === 'REJECTED' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => changeStatus(m.id, 'PROPOSED')}
                      >
                        재검토
                      </Button>
                    )}
                    {m.status === 'APPROVED' && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950"
                          disabled={isPending || draftingIds.has(m.id)}
                          onClick={() => void createDraft(m.id)}
                        >
                          {draftingIds.has(m.id) ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            '초안 생성'
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-muted-foreground"
                          disabled={isPending || draftingIds.has(m.id)}
                          onClick={() => changeStatus(m.id, 'ARCHIVED')}
                        >
                          보관
                        </Button>
                      </>
                    )}
                    {isPending && (
                      <Loader2 className="h-4 w-4 animate-spin self-center text-muted-foreground" />
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
