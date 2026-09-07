'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Cable,
  Pencil,
  X,
  Trash2,
  Copy,
  Check,
  AlertTriangle,
} from 'lucide-react'

type ApiCredentialResponse = {
  vendorId: string
  accessKeyMasked: string
  isActive: boolean
  lastVerifiedAt: string | null
  lastError: string | null
} | null

type ProbeStatus = 'idle' | 'running' | 'success' | 'ip_blocked' | 'failed'

type ProbeResult = {
  ok: boolean
  ipBlocked?: boolean
  publicIp?: string
  message?: string
} | null

const PROBE_POLL_INTERVAL_MS = 3000
const PROBE_POLL_TIMEOUT_MS = 60000

export function CoupangApiCard() {
  const [data, setData] = useState<ApiCredentialResponse>(null)
  const [loading, setLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const [vendorId, setVendorId] = useState('')
  const [accessKey, setAccessKey] = useState('')
  const [secretKey, setSecretKey] = useState('')

  const [probeStatus, setProbeStatus] = useState<ProbeStatus>('idle')
  const [probeResult, setProbeResult] = useState<ProbeResult>(null)
  const [ipCopied, setIpCopied] = useState(false)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollDeadlineRef = useRef<number>(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/collection/api-credentials')
      const json: ApiCredentialResponse = res.ok ? await res.json() : null
      setData(json)
      if (json) {
        setVendorId(json.vendorId)
      }
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [])

  function stopPolling() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }

  async function handleSave() {
    if (!vendorId.trim() || !accessKey.trim()) {
      toast.error('업체코드와 Access Key를 입력해주세요')
      return
    }
    if (!data && !secretKey.trim()) {
      toast.error('Secret Key를 입력해주세요')
      return
    }
    setIsSaving(true)
    try {
      const res = await fetch('/api/collection/api-credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorId: vendorId.trim(),
          accessKey: accessKey.trim(),
          ...(secretKey.trim() ? { secretKey: secretKey.trim() } : {}),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error((body as { message?: string }).message ?? '저장에 실패했습니다')
        return
      }
      toast.success('API 자격증명이 저장되었습니다')
      setIsEditing(false)
      setSecretKey('')
      setProbeStatus('idle')
      setProbeResult(null)
      await load()
    } catch {
      toast.error('저장 중 오류가 발생했습니다')
    } finally {
      setIsSaving(false)
    }
  }

  function handleCancelEdit() {
    setIsEditing(false)
    setSecretKey('')
    if (data) {
      setVendorId(data.vendorId)
      setAccessKey('')
    }
  }

  async function handleDelete() {
    setIsDeleting(true)
    try {
      const res = await fetch('/api/collection/api-credentials', { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error((body as { message?: string }).message ?? '삭제에 실패했습니다')
        return
      }
      toast.success('API 자격증명이 삭제되었습니다. 관련 소스 설정이 크롤링으로 되돌아갑니다')
      setData(null)
      setVendorId('')
      setAccessKey('')
      setSecretKey('')
      setProbeStatus('idle')
      setProbeResult(null)
      setDeleteOpen(false)
    } catch {
      toast.error('삭제 중 오류가 발생했습니다')
    } finally {
      setIsDeleting(false)
    }
  }

  const pollProbeResult = useCallback((runId: string) => {
    pollDeadlineRef.current = Date.now() + PROBE_POLL_TIMEOUT_MS
    stopPolling()
    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/collection/runs/${runId}`)
        if (res.ok) {
          const run = await res.json()
          if (run?.probeResult) {
            stopPolling()
            const result: NonNullable<ProbeResult> = run.probeResult
            setProbeResult(result)
            setProbeStatus(result.ok ? 'success' : result.ipBlocked ? 'ip_blocked' : 'failed')
            return
          }
          if (run?.status === 'FAILED') {
            stopPolling()
            setProbeStatus('failed')
            setProbeResult({ ok: false, message: run.error ?? '연결 테스트에 실패했습니다' })
            return
          }
        }
      } catch {
        // 폴링 중 일시적 오류 — 다음 tick에서 재시도
      }
      if (Date.now() > pollDeadlineRef.current) {
        stopPolling()
        setProbeStatus('failed')
        setProbeResult({ ok: false, message: '연결 테스트 응답 시간이 초과되었습니다' })
      }
    }, PROBE_POLL_INTERVAL_MS)
  }, [])

  async function handleProbe() {
    setProbeStatus('running')
    setProbeResult(null)
    try {
      const res = await fetch('/api/collection/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ probeApi: true }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error((body as { message?: string }).message ?? '연결 테스트 시작에 실패했습니다')
        setProbeStatus('failed')
        return
      }
      const body = await res.json()
      const runId = body?.runId
      if (!runId) {
        setProbeStatus('failed')
        setProbeResult({ ok: false, message: '작업 ID를 받지 못했습니다' })
        return
      }
      pollProbeResult(runId)
    } catch {
      toast.error('연결 테스트 중 오류가 발생했습니다')
      setProbeStatus('failed')
    }
  }

  async function handleCopyIp() {
    if (!probeResult?.publicIp) return
    try {
      await navigator.clipboard.writeText(probeResult.publicIp)
      setIpCopied(true)
      setTimeout(() => setIpCopied(false), 1500)
    } catch {
      // 클립보드 접근 실패 — 조용히 무시
    }
  }

  const isConnected = Boolean(data?.isActive)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Cable className="h-5 w-5" />
              쿠팡 Open API 연동
            </CardTitle>
            <CardDescription>
              쿠팡 Open API 자격증명을 등록하면 재고·판매·정산·상품 데이터를 크롤링 대신 API로
              수집할 수 있습니다.
            </CardDescription>
          </div>
          {data && (
            <Badge
              className={
                isConnected
                  ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
              }
            >
              {isConnected ? (
                <CheckCircle2 className="mr-1 h-3 w-3" />
              ) : (
                <XCircle className="mr-1 h-3 w-3" />
              )}
              {isConnected ? '등록됨' : '비활성'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>IP 허용목록(allowlist) 등록 필요</AlertTitle>
          <AlertDescription>
            쿠팡 Wing에 워커 서버의 공인 IP를 등록해야 API 호출이 성공합니다. 자격증명 등록 후 [연결
            테스트]를 실행하면 현재 워커의 공인 IP를 확인할 수 있습니다.
          </AlertDescription>
        </Alert>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : data && !isEditing ? (
          <div className="space-y-4">
            <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">업체코드</p>
                <p className="mt-1 text-sm font-medium">{data.vendorId}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Access Key</p>
                <p className="mt-1 text-sm font-medium">{data.accessKeyMasked}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">최근 검증</p>
                <p className="mt-1 text-sm font-medium">
                  {data.lastVerifiedAt
                    ? new Date(data.lastVerifiedAt).toLocaleString('ko-KR')
                    : '검증 이력 없음'}
                </p>
              </div>
            </div>
            {data.lastError && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertTitle>최근 오류</AlertTitle>
                <AlertDescription>{data.lastError}</AlertDescription>
              </Alert>
            )}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleProbe}
                disabled={probeStatus === 'running'}
              >
                {probeStatus === 'running' ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                )}
                연결 테스트
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
                <Pencil className="mr-1 h-3.5 w-3.5" />
                수정
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                삭제
              </Button>
            </div>

            {probeStatus !== 'idle' && (
              <ProbeResultPanel
                status={probeStatus}
                result={probeResult}
                ipCopied={ipCopied}
                onCopyIp={handleCopyIp}
              />
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {data && (
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">자격증명 수정</p>
                <Button type="button" variant="ghost" size="sm" onClick={handleCancelEdit}>
                  <X className="mr-1 h-3.5 w-3.5" />
                  취소
                </Button>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="coupang-vendor-id">업체코드 (vendorId)</Label>
              <Input
                id="coupang-vendor-id"
                placeholder="A00123456"
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="coupang-access-key">Access Key</Label>
              <Input
                id="coupang-access-key"
                placeholder="Access Key"
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="coupang-secret-key">Secret Key</Label>
              <Input
                id="coupang-secret-key"
                type="password"
                placeholder={data ? '변경하지 않으려면 비워두세요' : 'Secret Key'}
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
              />
            </div>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  저장 중...
                </>
              ) : (
                '저장'
              )}
            </Button>
          </div>
        )}
      </CardContent>
      {!data && !loading && !isEditing && (
        <CardFooter>
          <Button size="sm" onClick={() => setIsEditing(true)}>
            API 자격증명 등록
          </Button>
        </CardFooter>
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API 자격증명을 삭제할까요?</DialogTitle>
            <DialogDescription>
              삭제하면 재고·판매·정산·상품 소스 설정 중 &apos;API&apos;로 되어 있던 항목이 모두
              &apos;크롤링&apos;으로 되돌아갑니다. 이 작업은 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={isDeleting}>
              취소
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function ProbeResultPanel({
  status,
  result,
  ipCopied,
  onCopyIp,
}: {
  status: ProbeStatus
  result: ProbeResult
  ipCopied: boolean
  onCopyIp: () => void
}) {
  if (status === 'running') {
    return (
      <Alert>
        <Loader2 className="h-4 w-4 animate-spin" />
        <AlertTitle>연결 테스트 진행 중</AlertTitle>
        <AlertDescription>워커가 작업을 가져가 API 호출을 시도하고 있습니다.</AlertDescription>
      </Alert>
    )
  }

  if (status === 'success') {
    return (
      <Alert>
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        <AlertTitle>연결에 성공했습니다</AlertTitle>
        <AlertDescription>
          {result?.publicIp && (
            <span className="mt-1 flex items-center gap-2 font-mono text-xs">
              워커 공인 IP: {result.publicIp}
              <Button size="icon" variant="ghost" className="h-5 w-5" onClick={onCopyIp}>
                {ipCopied ? (
                  <Check className="h-3 w-3 text-emerald-600" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </span>
          )}
        </AlertDescription>
      </Alert>
    )
  }

  if (status === 'ip_blocked') {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>워커 IP가 쿠팡 Wing에 등록되지 않았습니다</AlertTitle>
        <AlertDescription>
          {result?.publicIp && (
            <span className="mt-1 flex items-center gap-2 font-mono text-xs">
              쿠팡 Wing에 이 IP를 등록해주세요: {result.publicIp}
              <Button size="icon" variant="ghost" className="h-5 w-5" onClick={onCopyIp}>
                {ipCopied ? (
                  <Check className="h-3 w-3 text-emerald-600" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </span>
          )}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert variant="destructive">
      <XCircle className="h-4 w-4" />
      <AlertTitle>연결 테스트에 실패했습니다</AlertTitle>
      <AlertDescription>{result?.message ?? '워커 로그를 확인해주세요'}</AlertDescription>
    </Alert>
  )
}
