'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type SpaceMembership = {
  spaceId: string
  spaceName: string
  spaceType: string
  role: 'OWNER' | 'ADMIN' | 'MEMBER'
  memberCount: number
  joinedAt: string
  activeDeckAppIds: string[]
  subscription: {
    status: string
    exemptFlag: boolean
    currentPeriodEnd: string | null
  } | null
}

type AdminUserDetail = {
  id: string
  email: string
  name: string | null
  avatarUrl: string | null
  createdAt: string
  isOperator: boolean
  spaceMemberships: SpaceMembership[]
}

type AuthInfo = { bannedUntil: string | null; lastSignInAt: string | null } | null

function isCurrentlyBanned(bannedUntil: string | null): boolean {
  if (!bannedUntil) return false
  return new Date(bannedUntil).getTime() > Date.now()
}

export function UserDetail({ userId }: { userId: string }) {
  const router = useRouter()
  const [user, setUser] = useState<AdminUserDetail | null>(null)
  const [authInfo, setAuthInfo] = useState<AuthInfo>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [banPending, setBanPending] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('')
  const [deletePending, setDeletePending] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [blockingSpaces, setBlockingSpaces] = useState<{ id: string; name: string }[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/admin/users/${userId}`)
    if (res.status === 404) {
      setNotFound(true)
      setLoading(false)
      return
    }
    const data = await res.json()
    setUser(data.user)
    setAuthInfo(data.auth)
    setLoading(false)
  }, [userId])

  useEffect(() => {
    load()
  }, [load])

  async function toggleBan(nextBan: boolean) {
    setBanPending(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}/ban`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ban: nextBan }),
      })
      if (res.ok) await load()
    } finally {
      setBanPending(false)
    }
  }

  async function changeRole(spaceId: string, role: string) {
    const res = await fetch(`/api/admin/users/${userId}/memberships/${spaceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    if (res.ok) {
      await load()
    } else {
      const data = await res.json().catch(() => null)
      alert(data?.message ?? '역할 변경에 실패했습니다')
    }
  }

  async function removeMembership(spaceId: string) {
    if (!confirm('이 Space 멤버십을 제거하시겠습니까?')) return
    const res = await fetch(`/api/admin/users/${userId}/memberships/${spaceId}`, {
      method: 'DELETE',
    })
    if (res.ok) {
      await load()
    } else {
      const data = await res.json().catch(() => null)
      alert(data?.message ?? '멤버십 제거에 실패했습니다')
    }
  }

  async function handleDelete() {
    setDeletePending(true)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (res.status === 400 && data?.blockingSpaces) {
        setBlockingSpaces(data.blockingSpaces)
        setDeleteError(data.message)
        return
      }
      if (!res.ok) {
        setDeleteError(data?.message ?? '삭제에 실패했습니다')
        return
      }
      router.push('/admin/users')
    } finally {
      setDeletePending(false)
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">불러오는 중...</p>
  if (notFound || !user) return <p className="text-sm text-muted-foreground">사용자를 찾을 수 없습니다</p>

  const solelyOwnedSoloSpaces = user.spaceMemberships.filter((m) => m.memberCount === 1)
  const banned = isCurrentlyBanned(authInfo?.bannedUntil ?? null)
  const emailMatches = deleteConfirmEmail.trim() === user.email

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/users" className="text-sm text-muted-foreground hover:underline">
            ← 사용자 목록
          </Link>
          <h1 className="text-lg font-semibold">{user.email}</h1>
        </div>
        {user.isOperator && <Badge variant="secondary">운영자</Badge>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>기본 정보</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground">이름</p>
            <p>{user.name ?? '-'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">가입일</p>
            <p>{new Date(user.createdAt).toLocaleString('ko-KR')}</p>
          </div>
          <div>
            <p className="text-muted-foreground">최근 로그인</p>
            <p>{authInfo?.lastSignInAt ? new Date(authInfo.lastSignInAt).toLocaleString('ko-KR') : '-'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">계정 상태</p>
            <p>{banned ? <Badge variant="destructive">정지됨</Badge> : <Badge variant="outline">정상</Badge>}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Space 멤버십</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Space</TableHead>
                <TableHead>유형</TableHead>
                <TableHead>역할</TableHead>
                <TableHead>설치 deck</TableHead>
                <TableHead>구독 상태</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {user.spaceMemberships.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    소속된 Space가 없습니다
                  </TableCell>
                </TableRow>
              )}
              {user.spaceMemberships.map((m) => (
                <TableRow key={m.spaceId}>
                  <TableCell className="font-medium">{m.spaceName}</TableCell>
                  <TableCell>{m.spaceType}</TableCell>
                  <TableCell>
                    <Select value={m.role} onValueChange={(role) => changeRole(m.spaceId, role)}>
                      <SelectTrigger size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="OWNER">OWNER</SelectItem>
                        <SelectItem value="ADMIN">ADMIN</SelectItem>
                        <SelectItem value="MEMBER">MEMBER</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>{m.activeDeckAppIds.join(', ') || '-'}</TableCell>
                  <TableCell>
                    {m.subscription ? (
                      <span className="flex items-center gap-1">
                        {m.subscription.status}
                        {m.subscription.exemptFlag && <Badge variant="outline">면제</Badge>}
                      </span>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeMembership(m.spaceId)}
                    >
                      제거
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">위험 구역</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">계정 정지</p>
              <p className="text-sm text-muted-foreground">
                정지 시 신규 로그인이 차단됩니다. 이미 발급된 세션은 만료 전까지 유효할 수 있습니다.
              </p>
            </div>
            <Switch checked={banned} disabled={banPending} onCheckedChange={toggleBan} />
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <div>
              <p className="text-sm font-medium">계정 삭제</p>
              <p className="text-sm text-muted-foreground">
                되돌릴 수 없습니다. 이 사용자가 유일한 멤버인 Space도 함께 삭제됩니다.
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={() => {
                setDeleteError(null)
                setBlockingSpaces([])
                setDeleteConfirmEmail('')
                setDeleteOpen(true)
              }}
            >
              계정 삭제
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{user.email} 계정을 삭제하시겠습니까?</DialogTitle>
            <DialogDescription>
              이 작업은 되돌릴 수 없습니다. Supabase Auth 계정과 소유한 데이터가 삭제됩니다.
            </DialogDescription>
          </DialogHeader>

          {solelyOwnedSoloSpaces.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="font-medium">함께 삭제되는 Space</p>
              <ul className="mt-1 list-inside list-disc">
                {solelyOwnedSoloSpaces.map((s) => (
                  <li key={s.spaceId}>{s.spaceName}</li>
                ))}
              </ul>
            </div>
          )}

          {deleteError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <p>{deleteError}</p>
              {blockingSpaces.length > 0 && (
                <ul className="mt-1 list-inside list-disc">
                  {blockingSpaces.map((s) => (
                    <li key={s.id}>{s.name}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label className="text-sm text-muted-foreground">
              확인을 위해 이메일 주소({user.email})를 입력하세요
            </label>
            <Input
              value={deleteConfirmEmail}
              onChange={(e) => setDeleteConfirmEmail(e.target.value)}
              placeholder={user.email}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              취소
            </Button>
            <Button
              variant="destructive"
              disabled={!emailMatches || deletePending}
              onClick={handleDelete}
            >
              {deletePending ? '삭제 중...' : '영구 삭제'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
