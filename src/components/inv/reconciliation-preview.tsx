'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Match entry types (mirror of server)
type ParsedRow = {
  externalCode: string
  externalName?: string
  externalOptionName?: string
  quantity: number
}

type SuggestionOption = {
  optionId: string
  productName: string
  optionName: string
}

type MatchEntry =
  | {
      status: 'matched-diff'
      row: ParsedRow
      optionId: string
      productName: string
      optionName: string
      systemQuantity: number
      fileQuantity: number
      delta: number
    }
  | {
      status: 'matched-equal'
      row: ParsedRow
      optionId: string
      productName: string
      optionName: string
      systemQuantity: number
    }
  | {
      status: 'file-only'
      row: ParsedRow
      suggestions: SuggestionOption[]
    }
  | {
      status: 'system-only'
      optionId: string
      productName: string
      optionName: string
      systemQuantity: number
    }

type Reconciliation = {
  id: string
  fileName: string
  snapshotDate: string
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED'
  totalItems: number
  matchedItems: number
  adjustedItems: number
  location: { id: string; name: string }
  matchResults: MatchEntry[]
}

type Props = {
  reconciliationId: string
  onClose: () => void
  onConfirmed: () => void
}

export function ReconciliationPreview({
  reconciliationId,
  onClose,
  onConfirmed,
}: Props) {
  const [recon, setRecon] = useState<Reconciliation | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  // selected matched-diff optionIds (default: all)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // manual mappings (externalCode → optionId) chosen by user
  const [manualMap, setManualMap] = useState<Record<string, string>>({})
  // applied manual map selectedAlso (adjust these too)
  const [applyMapped, setApplyMapped] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/inv/reconciliation/${reconciliationId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '조회 실패')
      const r = data.reconciliation as Reconciliation
      setRecon(r)
      const diffIds = (r.matchResults ?? [])
        .filter((e): e is Extract<MatchEntry, { status: 'matched-diff' }> =>
          e.status === 'matched-diff'
        )
        .map((e) => e.optionId)
      setSelected(new Set(diffIds))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [reconciliationId])

  useEffect(() => {
    load()
  }, [load])

  const entries = recon?.matchResults ?? []
  const diffEntries = useMemo(
    () =>
      entries.filter(
        (e): e is Extract<MatchEntry, { status: 'matched-diff' }> =>
          e.status === 'matched-diff'
      ),
    [entries]
  )
  const equalEntries = useMemo(
    () => entries.filter((e) => e.status === 'matched-equal'),
    [entries]
  )
  const fileOnlyEntries = useMemo(
    () =>
      entries.filter(
        (e): e is Extract<MatchEntry, { status: 'file-only' }> =>
          e.status === 'file-only'
      ),
    [entries]
  )
  const systemOnlyEntries = useMemo(
    () =>
      entries.filter(
        (e): e is Extract<MatchEntry, { status: 'system-only' }> =>
          e.status === 'system-only'
      ),
    [entries]
  )

  function toggle(optionId: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(optionId)) next.delete(optionId)
      else next.add(optionId)
      return next
    })
  }

  async function handleConfirm() {
    if (!recon) return
    setSubmitting(true)
    try {
      const manualMappings = Object.entries(manualMap)
        .filter(([, v]) => !!v)
        .map(([externalCode, optionId]) => ({ externalCode, optionId }))

      const selectedOptionIds = [...selected]
      // file-only 항목 중 사용자가 "적용" 체크한 것만 selectedOptionIds에 포함
      for (const [externalCode, optionId] of Object.entries(manualMap)) {
        if (optionId && applyMapped[externalCode]) {
          selectedOptionIds.push(optionId)
        }
      }

      const res = await fetch(`/api/inv/reconciliation/${recon.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm',
          selectedOptionIds,
          manualMappings,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '확정 실패')
      toast.success(`${data.adjustedCount}건 조정 완료`)
      onConfirmed()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '확정 실패')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCancel() {
    if (!recon) return
    if (!confirm('이 대조를 취소하시겠습니까?')) return
    try {
      const res = await fetch(`/api/inv/reconciliation/${recon.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? '취소 실패')
      toast.success('취소되었습니다')
      onConfirmed()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '취소 실패')
    }
  }

  if (loading || !recon) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  const isPending = recon.status === 'PENDING'

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">{recon.fileName}</h2>
          <p className="text-sm text-muted-foreground">
            {recon.location.name} · 기준일{' '}
            {new Date(recon.snapshotDate).toISOString().slice(0, 10)} ·{' '}
            <Badge variant="outline">{recon.status}</Badge>
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            총 {recon.totalItems}건 · 자동매칭 {recon.matchedItems}건 · 조정{' '}
            {recon.adjustedItems}건
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>
          닫기
        </Button>
      </div>

      <Tabs defaultValue="diff">
        <TabsList>
          <TabsTrigger value="diff">
            차이있음 <Badge variant="secondary" className="ml-2">{diffEntries.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="equal">
            일치 <Badge variant="secondary" className="ml-2">{equalEntries.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="file-only">
            미매칭 <Badge variant="secondary" className="ml-2">{fileOnlyEntries.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="system-only">
            파일 누락 <Badge variant="secondary" className="ml-2">{systemOnlyEntries.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="diff">
          {diffEntries.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              차이가 있는 항목이 없습니다
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>상품명</TableHead>
                    <TableHead>옵션명</TableHead>
                    <TableHead className="text-right">시스템</TableHead>
                    <TableHead className="text-right">파일</TableHead>
                    <TableHead className="text-right">차이</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {diffEntries.map((e) => (
                    <TableRow key={e.optionId}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(e.optionId)}
                          onCheckedChange={() => toggle(e.optionId)}
                          disabled={!isPending}
                        />
                      </TableCell>
                      <TableCell>{e.productName}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {e.optionName}
                      </TableCell>
                      <TableCell className="text-right">
                        {e.systemQuantity}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {e.fileQuantity}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono ${
                          e.delta > 0 ? 'text-emerald-600' : 'text-red-600'
                        }`}
                      >
                        {e.delta > 0 ? '+' : ''}
                        {e.delta}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="equal">
          <p className="p-6 text-center text-sm text-muted-foreground">
            {equalEntries.length}건이 시스템 재고와 일치합니다.
          </p>
        </TabsContent>

        <TabsContent value="file-only">
          {fileOnlyEntries.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              모든 행이 매칭되었습니다
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>외부 코드</TableHead>
                    <TableHead>외부 상품명</TableHead>
                    <TableHead className="text-right">수량</TableHead>
                    <TableHead>매핑 옵션 선택</TableHead>
                    <TableHead className="w-16">적용</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fileOnlyEntries.map((e) => {
                    const code = e.row.externalCode
                    return (
                      <TableRow key={code}>
                        <TableCell className="font-mono text-xs">
                          {code}
                        </TableCell>
                        <TableCell>
                          {e.row.externalName ?? '-'}
                          {e.row.externalOptionName
                            ? ` / ${e.row.externalOptionName}`
                            : ''}
                        </TableCell>
                        <TableCell className="text-right">
                          {e.row.quantity}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={manualMap[code] ?? ''}
                            onValueChange={(v) =>
                              setManualMap((m) => ({ ...m, [code]: v }))
                            }
                            disabled={!isPending || e.suggestions.length === 0}
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue
                                placeholder={
                                  e.suggestions.length === 0
                                    ? '후보 없음'
                                    : '후보 선택'
                                }
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {e.suggestions.map((s) => (
                                <SelectItem key={s.optionId} value={s.optionId}>
                                  {s.productName} / {s.optionName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Checkbox
                            checked={!!applyMapped[code]}
                            disabled={!isPending || !manualMap[code]}
                            onCheckedChange={(v) =>
                              setApplyMapped((m) => ({
                                ...m,
                                [code]: v === true,
                              }))
                            }
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="system-only">
          {systemOnlyEntries.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              없음
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>상품명</TableHead>
                    <TableHead>옵션명</TableHead>
                    <TableHead className="text-right">시스템 재고</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {systemOnlyEntries.map((e) => (
                    <TableRow key={e.optionId}>
                      <TableCell>{e.productName}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {e.optionName}
                      </TableCell>
                      <TableCell className="text-right">
                        {e.systemQuantity}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {isPending && (
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={handleCancel} disabled={submitting}>
            대조 취소
          </Button>
          <Button onClick={handleConfirm} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            적용 ({selected.size}건 조정)
          </Button>
        </div>
      )}
    </div>
  )
}
