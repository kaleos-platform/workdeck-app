'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type MappingRow = {
  id: string
  externalCode: string
  externalName: string | null
  externalOptionName: string | null
  option: {
    id: string
    name: string
    product: { id: string; name: string; code: string | null }
  }
}

type Props = {
  locationId: string
}

export function LocationMappingTable({ locationId }: Props) {
  const [mappings, setMappings] = useState<MappingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/inv/locations/${locationId}/mappings`)
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
      const res = await fetch(`/api/inv/locations/${locationId}/mappings?mappingId=${mappingId}`, {
        method: 'DELETE',
      })
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

  if (loading) {
    return (
      <div className="flex h-16 items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    )
  }

  if (mappings.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        이 위치에 아직 매핑된 상품이 없습니다. 재고 대조 시 자동 생성됩니다.
      </div>
    )
  }

  return (
    <div className="rounded-md border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>외부 코드</TableHead>
            <TableHead>시스템 상품명</TableHead>
            <TableHead>옵션명</TableHead>
            <TableHead>외부 상품명 (참조)</TableHead>
            <TableHead className="text-right">액션</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mappings.map((m) => (
            <TableRow key={m.id}>
              <TableCell className="font-mono text-xs">{m.externalCode}</TableCell>
              <TableCell>{m.option.product.name}</TableCell>
              <TableCell className="text-muted-foreground">{m.option.name}</TableCell>
              <TableCell className="text-muted-foreground">
                {m.externalName ?? '-'}
                {m.externalOptionName ? ` / ${m.externalOptionName}` : ''}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deletingId === m.id}
                  onClick={() => handleDelete(m.id)}
                >
                  {deletingId === m.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
