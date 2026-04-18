'use client'

import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type OrderProduct = {
  name: string
  quantity: number
}

type OrderProductFieldsProps = {
  value: OrderProduct[]
  onChange: (products: OrderProduct[]) => void
  maxItems?: number
  invalid?: boolean
}

const trimStart = (v: string) => v.replace(/^\s+/, '')

export function OrderProductFields({
  value,
  onChange,
  maxItems = 10,
  invalid = false,
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
            className={cn(
              'h-7 text-xs',
              invalid && !product.name && 'ring-2 ring-destructive/50 border-destructive/50',
            )}
            value={product.name}
            onChange={(e) => updateProduct(i, 'name', trimStart(e.target.value))}
            placeholder={invalid ? '상품명 *' : '상품명'}
          />
          <Input
            className="h-7 w-14 text-xs text-center [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [appearance:textfield]"
            type="number"
            min={1}
            value={product.quantity}
            onChange={(e) => {
              const n = Number(e.target.value)
              updateProduct(i, 'quantity', n >= 1 ? n : 1)
            }}
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
          className={cn('h-6 text-xs', invalid && value.length === 0 && 'text-destructive')}
          onClick={addProduct}
        >
          <Plus className="mr-1 h-3 w-3" />{invalid && value.length === 0 ? '상품 추가 *' : '상품 추가'}
        </Button>
      )}
    </div>
  )
}
