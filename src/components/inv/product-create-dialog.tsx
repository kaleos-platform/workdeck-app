'use client'

import { useState } from 'react'
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
import { Loader2, Plus, X } from 'lucide-react'

type OptionDraft = { name: string; sku: string }

type Props = {
  onCreated?: () => void
}

function emptyOption(): OptionDraft {
  return { name: '', sku: '' }
}

export function ProductCreateDialog({ onCreated }: Props) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [options, setOptions] = useState<OptionDraft[]>([emptyOption()])

  const reset = () => {
    setName('')
    setCode('')
    setOptions([emptyOption()])
  }

  const addOption = () => {
    setOptions((prev) => [...prev, emptyOption()])
  }

  const removeOption = (index: number) => {
    setOptions((prev) => prev.filter((_, i) => i !== index))
  }

  const updateOption = (index: number, field: keyof OptionDraft, value: string) => {
    setOptions((prev) =>
      prev.map((o, i) => (i === index ? { ...o, [field]: value } : o)),
    )
  }

  const handleSave = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error('상품명을 입력해주세요')
      return
    }

    const validOptions = options.filter((o) => o.name.trim())
    if (validOptions.length === 0) {
      toast.error('최소 1개의 옵션명을 입력해주세요')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/inv/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          code: code.trim() || undefined,
          options: validOptions.map((o) => ({
            name: o.name.trim(),
            sku: o.sku.trim() || undefined,
          })),
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.message ?? '상품 생성에 실패했습니다')
        return
      }

      toast.success('상품이 생성되었습니다')
      setOpen(false)
      reset()
      onCreated?.()
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
          상품 추가
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>상품 추가</DialogTitle>
          <DialogDescription>
            상품명과 옵션을 입력하세요. 옵션은 최소 1개 이상 필요합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="product-name">상품명 *</Label>
            <Input
              id="product-name"
              placeholder="상품명을 입력하세요"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="product-code">제품코드</Label>
            <Input
              id="product-code"
              placeholder="(선택) 제품코드"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>

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
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    placeholder="옵션명 *"
                    value={opt.name}
                    onChange={(e) => updateOption(idx, 'name', e.target.value)}
                    className="flex-1"
                  />
                  <Input
                    placeholder="SKU"
                    value={opt.sku}
                    onChange={(e) => updateOption(idx, 'sku', e.target.value)}
                    className="flex-1"
                  />
                  {options.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => removeOption(idx)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
