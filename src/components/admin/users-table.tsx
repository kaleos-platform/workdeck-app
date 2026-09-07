'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type AdminUserListItem = {
  id: string
  email: string
  name: string | null
  createdAt: string
  isOperator: boolean
  spaceMemberships: { spaceId: string; spaceName: string; role: string }[]
}

export function UsersTable() {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [users, setUsers] = useState<AdminUserListItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams()
    if (debouncedQ) params.set('q', debouncedQ)
    fetch(`/api/admin/users?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        setUsers(data.users ?? [])
        setCursor(data.nextCursor ?? null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQ])

  async function loadMore() {
    if (!cursor) return
    setLoadingMore(true)
    const params = new URLSearchParams()
    if (debouncedQ) params.set('q', debouncedQ)
    params.set('cursor', cursor)
    try {
      const res = await fetch(`/api/admin/users?${params.toString()}`)
      const data = await res.json()
      setUsers((prev) => [...prev, ...(data.users ?? [])])
      setCursor(data.nextCursor ?? null)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Input
        placeholder="이메일 또는 이름으로 검색"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="max-w-sm"
      />

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이메일</TableHead>
              <TableHead>이름</TableHead>
              <TableHead>소속 Space</TableHead>
              <TableHead>가입일</TableHead>
              <TableHead>상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  결과가 없습니다
                </TableCell>
              </TableRow>
            )}
            {users.map((u) => (
              <TableRow
                key={u.id}
                className="cursor-pointer"
                onClick={() => router.push(`/admin/users/${u.id}`)}
              >
                <TableCell className="font-medium">{u.email}</TableCell>
                <TableCell>{u.name ?? '-'}</TableCell>
                <TableCell>{u.spaceMemberships.length}개</TableCell>
                <TableCell>{new Date(u.createdAt).toLocaleDateString('ko-KR')}</TableCell>
                <TableCell>
                  {u.isOperator ? <Badge variant="secondary">운영자</Badge> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {cursor && (
        <Button variant="outline" onClick={loadMore} disabled={loadingMore} className="self-center">
          {loadingMore ? '불러오는 중...' : '더 보기'}
        </Button>
      )}
    </div>
  )
}
