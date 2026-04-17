'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Download, Link2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { getLastNDaysRangeKst } from '@/lib/date-range'

type IntegrationType = 'SALES' | 'INVENTORY'

interface PreviewSummary {
  totalOrders: number
  totalItems: number
  channels: string[]
}

interface Location {
  id: string
  name: string
  isActive: boolean
}

interface IntegrationResult {
  totalOrders: number
  createdMovements: number
  skippedOrders: number
  errors: { orderId: string; message: string }[]
}

interface HistoryRecord {
  id: string
  type: string
  dateFrom: string
  dateTo: string
  totalOrders: number
  createdAt: string
}

export function IntegrationPanel() {
  const defaultRange = getLastNDaysRangeKst(7)
  const [dateFrom, setDateFrom] = useState(defaultRange.from)
  const [dateTo, setDateTo] = useState(defaultRange.to)
  const [type, setType] = useState<IntegrationType>('SALES')
  const [preview, setPreview] = useState<PreviewSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [history, setHistory] = useState<HistoryRecord[]>([])

  // Push dialog state
  const [pushDialogOpen, setPushDialogOpen] = useState(false)
  const [locations, setLocations] = useState<Location[]>([])
  const [selectedLocationId, setSelectedLocationId] = useState('')
  const [pushing, setPushing] = useState(false)
  const [pushResult, setPushResult] = useState<IntegrationResult | null>(null)

  // Fetch preview summary
  const fetchPreview = useCallback(async () => {
    if (!dateFrom || !dateTo) return
    setLoading(true)
    setPreview(null)
    try {
      const params = new URLSearchParams({
        status: 'COMPLETED',
        page: '1',
        pageSize: '1000',
      })
      const res = await fetch(`/api/del/batches?${params}`)
      if (!res.ok) throw new Error('조회 실패')
      const json = await res.json()

      // Filter batches by date and count orders
      const from = new Date(dateFrom)
      const to = new Date(dateTo)
      to.setHours(23, 59, 59, 999)

      const filteredBatches = (json.data as { completedAt: string | null; orderCount: number }[]).filter(
        (b: { completedAt: string | null }) => {
          if (!b.completedAt) return false
          const d = new Date(b.completedAt)
          return d >= from && d <= to
        },
      )

      const totalOrders = filteredBatches.reduce(
        (sum: number, b: { orderCount: number }) => sum + b.orderCount,
        0,
      )

      setPreview({
        totalOrders,
        totalItems: 0, // Not available from batch summary
        channels: [],
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  // Fetch integration history
  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/del/integration/history')
      if (!res.ok) return
      const json = await res.json()
      setHistory(json.data ?? [])
    } catch {
      // silent
    }
  }, [])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  // Download file
  const handleDownload = async (format: 'EXCEL' | 'CSV') => {
    if (!dateFrom || !dateTo) {
      toast.error('날짜 범위를 선택하세요')
      return
    }
    setDownloading(true)
    try {
      const res = await fetch('/api/del/integration/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, dateFrom, dateTo, format }),
      })
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson.message ?? '다운로드 실패')
      }
      const blob = await res.blob()
      const ext = format === 'CSV' ? 'csv' : 'xlsx'
      const label = type === 'SALES' ? '매출' : '재고'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${label}_데이터_${dateFrom}_${dateTo}.${ext}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('다운로드 완료')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '다운로드 실패')
    } finally {
      setDownloading(false)
    }
  }

  // Open push dialog
  const openPushDialog = async () => {
    setPushResult(null)
    setSelectedLocationId('')
    setPushDialogOpen(true)
    try {
      const res = await fetch('/api/inv/locations?isActive=true')
      if (!res.ok) throw new Error('보관 장소 조회 실패')
      const json = await res.json()
      setLocations(json.locations ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '보관 장소 조회 실패')
      setLocations([])
    }
  }

  // Execute push
  const handlePush = async () => {
    if (!selectedLocationId) {
      toast.error('보관 장소를 선택하세요')
      return
    }
    setPushing(true)
    setPushResult(null)
    try {
      const res = await fetch('/api/del/integration/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateFrom, dateTo, locationId: selectedLocationId }),
      })
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson.message ?? '연동 실패')
      }
      const result: IntegrationResult = await res.json()
      setPushResult(result)
      toast.success(
        `연동 완료: ${result.createdMovements}건 생성, ${result.skippedOrders}건 건너뜀`,
      )
      fetchHistory()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '연동 실패')
    } finally {
      setPushing(false)
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="space-y-6">
      {/* Date Range & Type Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">데이터 조회</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm">시작일</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">종료일</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">연동 유형</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as IntegrationType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SALES">매출 관리</SelectItem>
                  <SelectItem value="INVENTORY">재고 관리</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={fetchPreview} disabled={loading || !dateFrom || !dateTo}>
              {loading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              조회
            </Button>
          </div>

          {/* Preview Summary */}
          {preview && (
            <div className="rounded-md border p-4 bg-muted/30">
              <p className="text-sm">
                완료된 주문: <strong>{preview.totalOrders}건</strong>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">내보내기</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => handleDownload('EXCEL')}
              disabled={downloading || !dateFrom || !dateTo}
            >
              <Download className="mr-1.5 h-4 w-4" />
              Excel 다운로드
            </Button>
            <Button
              variant="outline"
              onClick={() => handleDownload('CSV')}
              disabled={downloading || !dateFrom || !dateTo}
            >
              <Download className="mr-1.5 h-4 w-4" />
              CSV 다운로드
            </Button>

            {type === 'INVENTORY' && (
              <Button
                onClick={openPushDialog}
                disabled={!dateFrom || !dateTo}
              >
                <Link2 className="mr-1.5 h-4 w-4" />
                워크덱 통합 재고관리 연동
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Integration History */}
      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">연동 이력</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {history.map((record) => (
                <div
                  key={record.id}
                  className="flex items-center justify-between rounded-md border p-3 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{record.type}</Badge>
                    <span>
                      {record.dateFrom.split('T')[0]} ~ {record.dateTo.split('T')[0]}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground text-xs">
                    <span>{record.totalOrders}건</span>
                    <span>{formatDate(record.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Push to Inventory Dialog */}
      <Dialog open={pushDialogOpen} onOpenChange={setPushDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>통합 재고관리 연동</DialogTitle>
            <DialogDescription>
              배송 관리 데이터를 재고 관리 덱으로 전송합니다.
            </DialogDescription>
          </DialogHeader>

          {!pushResult ? (
            <div className="space-y-4 py-2">
              <div className="rounded-md border p-3 bg-muted/30 text-sm space-y-1">
                <p>
                  기간: <strong>{dateFrom}</strong> ~ <strong>{dateTo}</strong>
                </p>
                {preview && (
                  <p>
                    대상 주문: <strong>{preview.totalOrders}건</strong>
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">보관 장소</Label>
                {locations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    활성화된 보관 장소가 없습니다. 재고 관리 덱에서 먼저 보관 장소를 등록하세요.
                  </p>
                ) : (
                  <Select
                    value={selectedLocationId}
                    onValueChange={setSelectedLocationId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="보관 장소 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map((loc) => (
                        <SelectItem key={loc.id} value={loc.id}>
                          {loc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setPushDialogOpen(false)}
                >
                  취소
                </Button>
                <Button
                  onClick={handlePush}
                  disabled={pushing || !selectedLocationId}
                >
                  {pushing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  연동 실행
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="rounded-md border p-3 bg-muted/30 text-sm space-y-1">
                <p>
                  전체 주문: <strong>{pushResult.totalOrders}건</strong>
                </p>
                <p>
                  생성된 이동: <strong>{pushResult.createdMovements}건</strong>
                </p>
                <p>
                  건너뛴 주문: <strong>{pushResult.skippedOrders}건</strong>
                </p>
              </div>

              {pushResult.errors.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-destructive">
                    오류 ({pushResult.errors.length}건)
                  </p>
                  <div className="max-h-40 overflow-y-auto rounded-md border p-2 text-xs space-y-1">
                    {pushResult.errors.map((err, i) => (
                      <p key={i} className="text-destructive">
                        {err.orderId}: {err.message}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button onClick={() => setPushDialogOpen(false)}>닫기</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
