'use client'

import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export type OrderProduct = {
  name: string
  quantity: number
}

type OrderProductFieldsProps = {
  value: OrderProduct[]
  onChange: (products: OrderProduct[]) => void
  maxItems?: number
}

export function OrderProductFields({
  value,
  onChange,
  maxItems = 10,
}: OrderProductFieldsProps) {
  function addProduct() {
    if (value.length >= maxItems) return
    onChange([...value, { name: '', quantity: 1 }])
  }

  function removeProduct(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }

  function updateProduct(index: number, field: keyof OrderProduct, val: string | number) {
    const next = value.map((p, i) =>
      i === index ? { ...p, [field]: val } : p
    )
    onChange(next)
  }

  return (
    <div className="space-y-1">
      {value.map((product, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input
            className="h-7 text-xs"
            value={product.name}
            onChange={(e) => updateProduct(i, 'name', e.target.value)}
            placeholder="상품명"
          />
          <Input
            className="h-7 w-16 text-xs"
            type="number"
            min={1}
            value={product.quantity}
            onChange={(e) => updateProduct(i, 'quantity', Number(e.target.value) || 1)}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={() => removeProduct(i)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
      {value.length < maxItems && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs"
          onClick={addProduct}
        >
          <Plus className="mr-1 h-3 w-3" />상품 추가
        </Button>
      )}
    </div>
  )
}
