'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { fetchWithMfa, redirectIfMfaRequired } from '@/lib/auth/mfa-client'

type Invitation = {
  id: string
  email: string
  role: 'ADMIN' | 'MEMBER'
  state: 'pending' | 'expired' | 'revoked' | 'accepted'
  expiresAt: string
  sendCount: number
  lastSendFailed: boolean
}

type Issued = {
  email: string
  link: string
  emailSent: boolean
  emailSkipReason?: string
}

const date = (iso: string) => new Date(iso).toLocaleString('ko-KR')

// CS 대응 — 고객 공간의 대기 초대를 새 링크로 다시 발급해 운영자가 초대받은 본인에게 직접 전달한다.
export function SpaceInvitationsCard({ spaceId }: { spaceId: string }) {
  const [rows, setRows] = useState<Invitation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<Invitation | null>(null)
  const [busy, setBusy] = useState(false)
  const [issued, setIssued] = useState<Issued | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetchWithMfa(`/api/admin/spaces/${spaceId}/invitations`, {
        cache: 'no-store',
      })
      if (await redirectIfMfaRequired(res)) return
      if (!res.ok) throw new Error(`${res.status}`)
      setRows((await res.json()).invitations)
    } catch {
      setError('초대 목록을 불러오지 못했습니다')
    }
  }, [spaceId])
  useEffect(() => {
    void load()
  }, [load])

  async function issue(inv: Invitation) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetchWithMfa(`/api/admin/spaces/${spaceId}/invitations/${inv.id}/resend`, {
        method: 'POST',
      })
      if (await redirectIfMfaRequired(res)) return
      const body = await res.json().catch(() => null)
      setTarget(null)
      if (!res.ok) {
        setError(body?.message ?? '다시 발급하지 못했습니다')
      } else {
        setCopied(false)
        setIssued({
          email: inv.email,
          link: body.link,
          emailSent: body.emailSent,
          emailSkipReason: body.emailSkipReason,
        })
      }
      await load()
    } catch {
      setError('다시 발급하지 못했습니다')
    } finally {
      setBusy(false)
    }
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      setError('복사하지 못했습니다. 링크를 직접 선택해 복사하세요')
    }
  }

  const pending = rows?.filter((r) => r.state === 'pending') ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>초대</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이메일</TableHead>
              <TableHead>역할</TableHead>
              <TableHead>만료</TableHead>
              <TableHead>발송</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pending.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.email}</TableCell>
                <TableCell>{r.role}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{date(r.expiresAt)}</TableCell>
                <TableCell className="text-xs">
                  {r.sendCount}회
                  {r.lastSendFailed && (
                    <Badge variant="destructive" className="ml-1">
                      마지막 발송 실패
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setTarget(r)}>
                    다시 발급
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {rows && pending.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  대기 중인 초대가 없습니다
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={!!target} onOpenChange={(o) => !o && !busy && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>초대 링크 다시 발급</DialogTitle>
            <DialogDescription>
              {target?.email} — 이전 링크는 더 이상 쓸 수 없습니다. 링크는 초대받은 본인 주소로만
              보내세요.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setTarget(null)}>
              취소
            </Button>
            <Button disabled={busy} onClick={() => target && issue(target)}>
              {busy ? '발급 중...' : '다시 발급'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!issued} onOpenChange={(o) => !o && setIssued(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>새 초대 링크</DialogTitle>
            <DialogDescription>
              {issued?.email} 본인에게만 전달하세요.{' '}
              {issued?.emailSent
                ? '초대 메일도 발송했습니다.'
                : `초대 메일은 발송되지 않았습니다${
                    issued?.emailSkipReason ? ` (${issued.emailSkipReason})` : ''
                  }.`}
            </DialogDescription>
          </DialogHeader>
          <Input readOnly value={issued?.link ?? ''} aria-label="초대 링크" />
          <DialogFooter>
            <Button onClick={() => issued && copy(issued.link)}>
              {copied ? '복사됨' : '링크 복사'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
