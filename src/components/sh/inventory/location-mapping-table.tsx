'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  isSyntheticExternalCode,
  syntheticExternalCode,
} from '@/lib/inv/reconciliation-external-code'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  OptionPickerDialog,
  type PickedOptionWithQty,
} from '@/components/sh/products/listings/option-picker-dialog'

type MappingItem = {
  id: string
  optionId: string
  quantity: number
  option: {
    id: string
    name: string
    product: { id: string; name: string }
  }
}

type MappingRow = {
  id: string
  externalCode: string
  externalName: string | null
  externalOptionName: string | null
  items: MappingItem[]
}

type Props = {
  locationId: string
}

/** 신규 매핑 입력값 — 코드 유무에 따라 externalCode 를 직접 받거나 이름으로 합성한다. */
type NewMappingDraft = {
  codeMode: 'code' | 'name'
  externalCode: string
  externalName: string
  externalOptionName: string
}

const EMPTY_DRAFT: NewMappingDraft = {
  codeMode: 'code',
  externalCode: '',
  externalName: '',
  externalOptionName: '',
}

/** 실제 저장에 쓸 externalCode — 코드 모드면 입력값, 이름 모드면 파서와 같은 합성 키. */
export function resolveDraftExternalCode(draft: NewMappingDraft): string {
  if (draft.codeMode === 'code') return draft.externalCode.trim()
  const name = draft.externalName.trim()
  if (!name) return ''
  return syntheticExternalCode(name, draft.externalOptionName.trim() || undefined)
}

export function LocationMappingTable({ locationId }: Props) {
  const [mappings, setMappings] = useState<MappingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingRow, setEditingRow] = useState<MappingRow | null>(null)
  const [patchingId, setPatchingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<NewMappingDraft | null>(null)
  const [draftPickerOpen, setDraftPickerOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/sh/inventory/locations/${locationId}/mappings`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '매핑 조회 실패')
      setMappings(data.mappings ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '매핑 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [locationId])

  useEffect(() => {
    load()
  }, [load])

  async function handleDelete(mappingId: string) {
    if (!confirm('이 매핑을 삭제하시겠습니까?')) return
    setDeletingId(mappingId)
    try {
      const res = await fetch(
        `/api/sh/inventory/locations/${locationId}/mappings?mappingId=${mappingId}`,
        { method: 'DELETE' }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '삭제 실패')
      toast.success('삭제했습니다')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleCreatePickMulti(items: PickedOptionWithQty[]) {
    if (!draft) return
    const externalCode = resolveDraftExternalCode(draft)
    if (!externalCode) {
      toast.error('외부 코드 또는 외부 상품명을 입력하세요')
      return
    }
    setDraftPickerOpen(false)
    setCreating(true)
    try {
      const res = await fetch(`/api/sh/inventory/locations/${locationId}/mappings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          externalCode,
          externalName: draft.externalName.trim() || null,
          externalOptionName: draft.externalOptionName.trim() || null,
          items: items.map((i) => ({ optionId: i.optionId, quantity: i.quantity })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '매핑 추가 실패')
      toast.success('매핑을 추가했습니다')
      setDraft(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '매핑 추가 실패')
    } finally {
      setCreating(false)
    }
  }

  async function handleEditPickMulti(items: PickedOptionWithQty[]) {
    if (!editingRow) return
    const mappingId = editingRow.id
    setPatchingId(mappingId)
    setEditingRow(null)
    try {
      const res = await fetch(
        `/api/sh/inventory/locations/${locationId}/mappings?mappingId=${mappingId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: items.map((i) => ({ optionId: i.optionId, quantity: i.quantity })),
          }),
        }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '수정 실패')
      toast.success('매핑이 수정되었습니다')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '수정 실패')
    } finally {
      setPatchingId(null)
    }
  }

  // MappingItem[] → PickedOptionWithQty[] 변환 (initialItems용)
  function mappingItemsToPickedWithQty(items: MappingItem[]): PickedOptionWithQty[] {
    return items.map((item) => ({
      optionId: item.optionId,
      optionName: item.option.name,
      productId: item.option.product.id,
      productName: item.option.product.name,
      sku: null,
      brandName: null,
      retailPrice: null,
      totalStock: 0,
      quantity: item.quantity,
    }))
  }

  function renderOptionCell(items: MappingItem[]) {
    if (items.length === 0) return <span className="text-muted-foreground">-</span>
    if (items.length === 1) {
      const item = items[0]
      return (
        <span>
          {item.option.product.name} / {item.option.name}
          {item.quantity > 1 && (
            <span className="ml-1 text-xs text-muted-foreground">× {item.quantity}</span>
          )}
        </span>
      )
    }
    return (
      <div className="space-y-0.5">
        {items.map((item) => (
          <div key={item.id} className="text-sm">
            {item.option.product.name} / {item.option.name}
            {item.quantity > 1 && (
              <span className="ml-1 text-xs text-muted-foreground">× {item.quantity}</span>
            )}
          </div>
        ))}
      </div>
    )
  }

  // 수정 다이얼로그에서 현재 매핑의 옵션 ID 제외 (자기 자신은 재선택 허용)
  const editExcludeOptionIds = editingRow
    ? mappings.filter((m) => m.id !== editingRow.id).flatMap((m) => m.items.map((i) => i.optionId))
    : []

  const addButton = (
    <Button variant="outline" size="sm" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
      <Plus className="mr-1 h-4 w-4" />
      매핑 추가
    </Button>
  )

  const draftCode = draft ? resolveDraftExternalCode(draft) : ''
  // POST 는 (위치, 외부코드) 유니크로 upsert 하고 items 를 통째로 교체한다.
  // 같은 코드가 이미 있으면 기존 연결이 조용히 갈아엎히므로 먼저 알린다.
  const draftConflict = draftCode ? mappings.find((m) => m.externalCode === draftCode) : undefined

  return (
    <>
      <div className="mb-2 flex items-center justify-end gap-2">
        {creating && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {addButton}
      </div>

      {loading ? (
        <div className="flex h-16 items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : mappings.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          이 위치에 아직 매핑된 상품이 없습니다. 재고 대조 시 자동 생성되며, [매핑 추가]로 직접
          등록할 수도 있습니다.
        </div>
      ) : (
        <div className="rounded-md border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>외부 코드</TableHead>
                <TableHead>시스템 상품 / 옵션</TableHead>
                <TableHead>외부 상품명 (참조)</TableHead>
                <TableHead className="text-right">액션</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mappings.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-xs">
                    {isSyntheticExternalCode(m.externalCode) ? (
                      // 코드 없는 파일용 합성 키 — 사용자에게 보여줄 값이 아니다(옆 외부 상품명이 대신 읽힌다)
                      <span className="text-muted-foreground/50">—</span>
                    ) : (
                      m.externalCode
                    )}
                  </TableCell>
                  <TableCell>{renderOptionCell(m.items)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {m.externalName ?? '-'}
                    {m.externalOptionName ? ` / ${m.externalOptionName}` : ''}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={patchingId === m.id || deletingId === m.id}
                        onClick={() => setEditingRow(m)}
                        aria-label="매핑 수정"
                      >
                        {patchingId === m.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Pencil className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={deletingId === m.id || patchingId === m.id}
                        onClick={() => handleDelete(m.id)}
                        aria-label="매핑 삭제"
                      >
                        {deletingId === m.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={!!draft && !draftPickerOpen}
        onOpenChange={(v) => {
          if (!v) setDraft(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>매핑 추가</DialogTitle>
            <DialogDescription>
              외부 파일의 식별 값을 입력한 뒤 연결할 상품 옵션을 선택합니다. 등록한 매핑은 이후 재고
              대조에서 이름 매칭보다 먼저 적용됩니다.
            </DialogDescription>
          </DialogHeader>

          {draft && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={draft.codeMode === 'code' ? 'default' : 'outline'}
                  onClick={() => setDraft({ ...draft, codeMode: 'code' })}
                >
                  제품코드 있음
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={draft.codeMode === 'name' ? 'default' : 'outline'}
                  onClick={() => setDraft({ ...draft, codeMode: 'name' })}
                >
                  파일에 코드 없음
                </Button>
              </div>

              {draft.codeMode === 'code' && (
                <div className="space-y-1.5">
                  <Label htmlFor="mapping-external-code">외부 코드</Label>
                  <Input
                    id="mapping-external-code"
                    value={draft.externalCode}
                    onChange={(e) => setDraft({ ...draft, externalCode: e.target.value })}
                    placeholder="예: 10104"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="mapping-external-name">
                  외부 상품명{draft.codeMode === 'name' ? '' : ' (참조용, 선택)'}
                </Label>
                <Input
                  id="mapping-external-name"
                  value={draft.externalName}
                  onChange={(e) => setDraft({ ...draft, externalName: e.target.value })}
                  placeholder="파일의 상품명 칸 값 그대로"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="mapping-external-option">외부 옵션명 (선택)</Label>
                <Input
                  id="mapping-external-option"
                  value={draft.externalOptionName}
                  onChange={(e) => setDraft({ ...draft, externalOptionName: e.target.value })}
                  placeholder="파일의 옵션명 칸 값 그대로"
                />
              </div>

              {draftConflict && (
                <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                  이미 등록된 코드입니다. 계속하면 현재 연결(
                  {draftConflict.items
                    .map((i) => `${i.option.product.name} / ${i.option.name}`)
                    .join(', ') || '없음'}
                  )이 새로 선택한 옵션으로 교체됩니다.
                </p>
              )}

              {draft.codeMode === 'name' && (
                <p className="text-xs text-muted-foreground">
                  코드가 없는 파일은 상품명·옵션명으로 키를 만듭니다. 파일에 적힌 값과 정확히 같아야
                  다음 대조에서 이 매핑이 적용됩니다.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              취소
            </Button>
            <Button disabled={!draftCode} onClick={() => setDraftPickerOpen(true)}>
              {draftConflict ? '기존 매핑 교체' : '상품 옵션 선택'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OptionPickerDialog
        open={draftPickerOpen}
        onOpenChange={(v) => {
          setDraftPickerOpen(v)
        }}
        mode="multi-with-qty"
        onPickMulti={handleCreatePickMulti}
        contextLabel="새 매핑"
        contextValue={
          draft
            ? `${draft.externalName.trim() || draft.externalCode.trim()}${draft.externalOptionName.trim() ? ` / ${draft.externalOptionName.trim()}` : ''}`
            : ''
        }
      />

      <OptionPickerDialog
        open={!!editingRow}
        onOpenChange={(v) => {
          if (!v) setEditingRow(null)
        }}
        mode="multi-with-qty"
        onPickMulti={handleEditPickMulti}
        contextLabel="현재 매핑"
        contextValue={
          editingRow
            ? `${editingRow.externalName ?? editingRow.externalCode}${editingRow.externalOptionName ? ` / ${editingRow.externalOptionName}` : ''}`
            : ''
        }
        excludeOptionIds={editExcludeOptionIds}
        initialItems={editingRow ? mappingItemsToPickedWithQty(editingRow.items) : undefined}
      />
    </>
  )
}
