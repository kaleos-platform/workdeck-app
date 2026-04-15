'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type OptionRow = {
  id: string
  name: string
  sku: string | null
  totalStock: number
}

type MovementRow = {
  id: string
  type: string
  quantity: number
  movementDate: string
  optionName: string
  locationName: string
  toLocationName: string | null
}

type ProductDetailData = {
  id: string
  name: string
  code: string | null
  options: OptionRow[]
  movements: MovementRow[]
}

const MOVEMENT_TYPE_LABEL: Record<string, string> = {
  INBOUND: '입고',
  OUTBOUND: '출고',
  TRANSFER: '이동',
  ADJUSTMENT: '조정',
  RETURN: '반품',
}

export function ProductDetail({
  productId,
  onClose,
}: {
  productId: string
  onClose: () => void
}) {
  const [data, setData] = useState<ProductDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [nameDraft, setNameDraft] = useState('')
  const [codeDraft, setCodeDraft] = useState('')
  const [optionDrafts, setOptionDrafts] = useState<
    Record<string, { name: string; sku: string }>
  >({})

  const fetchDetail = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/inv/products/${productId}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.message ?? '상품을 불러오지 못했습니다')
        return
      }
      const json: ProductDetailData = await res.json()
      setData(json)
      setNameDraft(json.name)
      setCodeDraft(json.code ?? '')
      const drafts: Record<string, { name: string; sku: string }> = {}
      json.options.forEach((o) => {
        drafts[o.id] = { name: o.name, sku: o.sku ?? '' }
      })
      setOptionDrafts(drafts)
    } finally {
      setLoading(false)
    }
  }, [productId])

  useEffect(() => {
    void fetchDetail()
  }, [fetchDetail])

  const saveProduct = async () => {
    if (!data) return
    setSaving(true)
    try {
      const body: { name?: string; code?: string | null } = {}
      if (nameDraft.trim() !== data.name) body.name = nameDraft.trim()
      const newCode = codeDraft.trim() === '' ? null : codeDraft.trim()
      if (newCode !== data.code) body.code = newCode
      if (Object.keys(body).length === 0) {
        toast.info('변경 사항이 없습니다')
        return
      }
      const res = await fetch(`/api/inv/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.message ?? '저장에 실패했습니다')
        return
      }
      toast.success('상품 정보를 저장했습니다')
      await fetchDetail()
    } finally {
      setSaving(false)
    }
  }

  const saveOption = async (optionId: string) => {
    if (!data) return
    const draft = optionDrafts[optionId]
    if (!draft) return
    const original = data.options.find((o) => o.id === optionId)
    if (!original) return

    const body: { name?: string; sku?: string | null } = {}
    if (draft.name.trim() !== original.name) body.name = draft.name.trim()
    const newSku = draft.sku.trim() === '' ? null : draft.sku.trim()
    if (newSku !== original.sku) body.sku = newSku
    if (Object.keys(body).length === 0) {
      toast.info('변경 사항이 없습니다')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(
        `/api/inv/products/${productId}/options/${optionId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.message ?? '옵션 저장에 실패했습니다')
        return
      }
      toast.success('옵션 정보를 저장했습니다')
      await fetchDetail()
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="py-10 text-center text-muted-foreground">
        불러오는 중...
      </div>
    )
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <DialogHeader>
          <DialogTitle>상품을 찾을 수 없습니다</DialogTitle>
        </DialogHeader>
        <Button onClick={onClose}>닫기</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <DialogHeader>
        <DialogTitle>상품 수정</DialogTitle>
        <DialogDescription>
          상품명과 제품코드, 옵션 정보를 수정할 수 있습니다.
        </DialogDescription>
      </DialogHeader>

      <section className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              상품명
            </label>
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              제품코드
            </label>
            <Input
              value={codeDraft}
              placeholder="(없음)"
              onChange={(e) => setCodeDraft(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={saveProduct} disabled={saving} size="sm">
            상품 저장
          </Button>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">옵션 ({data.options.length})</h3>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>옵션명</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="w-20 text-right">동작</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.options.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="py-6 text-center text-muted-foreground"
                  >
                    등록된 옵션이 없습니다
                  </TableCell>
                </TableRow>
              ) : (
                data.options.map((o) => {
                  const draft = optionDrafts[o.id] ?? { name: o.name, sku: o.sku ?? '' }
                  return (
                    <TableRow key={o.id}>
                      <TableCell>
                        <Input
                          value={draft.name}
                          onChange={(e) =>
                            setOptionDrafts((prev) => ({
                              ...prev,
                              [o.id]: { ...draft, name: e.target.value },
                            }))
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={draft.sku}
                          placeholder="(없음)"
                          onChange={(e) =>
                            setOptionDrafts((prev) => ({
                              ...prev,
                              [o.id]: { ...draft, sku: e.target.value },
                            }))
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={saving}
                          onClick={() => saveOption(o.id)}
                        >
                          저장
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">
          최근 재고 이동 ({data.movements.length})
        </h3>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>날짜</TableHead>
                <TableHead>타입</TableHead>
                <TableHead className="text-right">수량</TableHead>
                <TableHead>위치</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.movements.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-6 text-center text-muted-foreground"
                  >
                    이동 기록이 없습니다
                  </TableCell>
                </TableRow>
              ) : (
                data.movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {new Date(m.movementDate).toLocaleDateString('ko-KR')}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {MOVEMENT_TYPE_LABEL[m.type] ?? m.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {m.quantity.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {m.locationName}
                      {m.toLocationName ? ` → ${m.toLocationName}` : ''}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <div className="flex justify-end">
        <Button variant="outline" onClick={onClose}>
          닫기
        </Button>
      </div>
    </div>
  )
}
