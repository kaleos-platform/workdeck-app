'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
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
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type OptionDraft = { name: string; sku: string; costPrice: string; retailPrice: string }
type Brand = { id: string; name: string }
type Group = { id: string; name: string }

type Props = {
  onCreated?: () => void
}

function emptyOption(): OptionDraft {
  return { name: '', sku: '', costPrice: '', retailPrice: '' }
}

export function ShProductCreateDialog({ onCreated }: Props) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  // 기본 정보
  const [name, setName] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [code, setCode] = useState('')
  const [brandId, setBrandId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [manufacturer, setManufacturer] = useState('')
  const [msrp, setMsrp] = useState('')

  // 옵션 목록
  const [options, setOptions] = useState<OptionDraft[]>([emptyOption()])

  // 선택지
  const [brands, setBrands] = useState<Brand[]>([])
  const [groups, setGroups] = useState<Group[]>([])

  useEffect(() => {
    if (!open) return
    Promise.all([
      fetch('/api/sh/brands').then((res) => (res.ok ? res.json() : null)),
      fetch('/api/inv/product-groups').then((res) => (res.ok ? res.json() : null)),
    ]).then(([bData, gData]) => {
      setBrands(bData?.brands ?? [])
      setGroups(gData?.groups ?? [])
    })
  }, [open])

  function reset() {
    setName('')
    setNameEn('')
    setCode('')
    setBrandId('')
    setGroupId('')
    setManufacturer('')
    setMsrp('')
    setOptions([emptyOption()])
  }

  const addOption = () => setOptions((prev) => [...prev, emptyOption()])
  const removeOption = (idx: number) => setOptions((prev) => prev.filter((_, i) => i !== idx))
  const updateOption = (idx: number, field: keyof OptionDraft, value: string) =>
    setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, [field]: value } : o)))

  async function handleSave() {
    if (!name.trim()) {
      toast.error('상품명을 입력해 주세요')
      return
    }
    const validOptions = options.filter((o) => o.name.trim())
    if (validOptions.length === 0) {
      toast.error('최소 1개의 옵션명을 입력해 주세요')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/sh/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          nameEn: nameEn.trim() || undefined,
          code: code.trim() || undefined,
          brandId: brandId || undefined,
          groupId: groupId || undefined,
          manufacturer: manufacturer.trim() || undefined,
          msrp: msrp ? parseFloat(msrp) : undefined,
          options: validOptions.map((o) => ({
            name: o.name.trim(),
            sku: o.sku.trim() || undefined,
            costPrice: o.costPrice ? parseFloat(o.costPrice) : undefined,
            retailPrice: o.retailPrice ? parseFloat(o.retailPrice) : undefined,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '상품 생성 실패')
      toast.success('상품이 생성되었습니다')
      setOpen(false)
      reset()
      onCreated?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '생성 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          상품 생성
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>새 상품 생성</DialogTitle>
          <DialogDescription>상품 기본 정보와 옵션을 입력하세요</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {/* 기본 정보 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1 sm:col-span-1">
              <Label htmlFor="prod-name">상품명 (한국어) *</Label>
              <Input
                id="prod-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="상품명"
              />
            </div>
            <div className="col-span-2 space-y-1 sm:col-span-1">
              <Label htmlFor="prod-name-en">상품명 (영문)</Label>
              <Input
                id="prod-name-en"
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                placeholder="Product Name"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="prod-code">제품코드</Label>
              <Input
                id="prod-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="(선택)"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="prod-msrp">소비자가 (원)</Label>
              <Input
                id="prod-msrp"
                type="number"
                min="0"
                value={msrp}
                onChange={(e) => setMsrp(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>브랜드</Label>
              <Select
                value={brandId || '__none__'}
                onValueChange={(v) => setBrandId(v === '__none__' ? '' : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="브랜드 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">(없음)</SelectItem>
                  {brands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>상품 그룹</Label>
              <Select
                value={groupId || '__none__'}
                onValueChange={(v) => setGroupId(v === '__none__' ? '' : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="그룹 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">(기본)</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="prod-manufacturer">제조사</Label>
            <Input
              id="prod-manufacturer"
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
              placeholder="제조사명 (선택)"
            />
          </div>

          {/* 옵션 섹션 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>옵션</Label>
              <Button type="button" variant="ghost" size="sm" onClick={addOption}>
                <Plus className="mr-1 h-3 w-3" />
                옵션 추가
              </Button>
            </div>
            <div className="space-y-2">
              {options.map((opt, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[1fr_1fr_80px_80px_auto] items-center gap-2"
                >
                  <Input
                    placeholder="옵션명 *"
                    value={opt.name}
                    onChange={(e) => updateOption(idx, 'name', e.target.value)}
                  />
                  <Input
                    placeholder="SKU"
                    value={opt.sku}
                    onChange={(e) => updateOption(idx, 'sku', e.target.value)}
                  />
                  <Input
                    type="number"
                    min="0"
                    placeholder="원가"
                    value={opt.costPrice}
                    onChange={(e) => updateOption(idx, 'costPrice', e.target.value)}
                  />
                  <Input
                    type="number"
                    min="0"
                    placeholder="소비자가"
                    value={opt.retailPrice}
                    onChange={(e) => updateOption(idx, 'retailPrice', e.target.value)}
                  />
                  {options.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => removeOption(idx)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  ) : (
                    <div className="h-8 w-8" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
