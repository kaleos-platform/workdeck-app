'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { signupSourceLabel, type SignupSource } from '@/lib/marketing/signup-source'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { ROLE_LABEL } from '@/components/layout/space-switcher'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
  signupSource: SignupSource | null
  isOperator: boolean
  mfaRequired: boolean
  totpEnrolled: boolean | null
  spaceMemberships: { spaceId: string; spaceName: string; role: keyof typeof ROLE_LABEL }[]
}

type SortKey = 'createdAt' | 'email' | 'name' | 'spaces'
type SortDir = 'asc' | 'desc'
const ALL = 'all'

function SortHead({
  label,
  k,
  sort,
  dir,
  onSort,
}: {
  label: string
  k: SortKey
  sort: SortKey
  dir: SortDir
  onSort: (k: SortKey) => void
}) {
  const active = sort === k
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <TableHead aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        <Icon className={active ? 'size-3.5' : 'size-3.5 opacity-40'} />
      </button>
    </TableHead>
  )
}

// 서버가 대표 순서로 정렬해 준다 — [0] 이 대표. 2개 이상이면 툴팁에 전체 목록
function SpaceCell({ memberships }: { memberships: AdminUserListItem['spaceMemberships'] }) {
  if (memberships.length === 0) return <span className="text-muted-foreground">-</span>
  const [rep, ...rest] = memberships
  const label = (
    <span className="inline-flex items-center gap-1">
      <span className="max-w-48 truncate" title={rep.spaceName}>
        {rep.spaceName}
      </span>
      {rest.length > 0 && <span className="text-muted-foreground">외 {rest.length}</span>}
    </span>
  )
  if (rest.length === 0) return label
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="cursor-default">
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <ul className="flex flex-col gap-0.5">
          {memberships.map((m) => (
            <li key={m.spaceId}>
              {m.spaceName} · {ROLE_LABEL[m.role] ?? m.role}
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  )
}

export function UsersTable() {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [source, setSource] = useState('')
  const [debouncedSource, setDebouncedSource] = useState('')
  const [role, setRole] = useState(ALL)
  const [spaces, setSpaces] = useState(ALL)
  const [mfa, setMfa] = useState(ALL)
  const [sort, setSort] = useState<SortKey>('createdAt')
  const [dir, setDir] = useState<SortDir>('desc')
  const [users, setUsers] = useState<AdminUserListItem[]>([])
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  // 검색·정렬·필터가 바뀌면 증가 — 늦게 도착한 "더 보기" 응답이 새 목록에 섞이지 않게 한다
  const listVersion = useRef(0)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q.trim())
      setDebouncedSource(source.trim())
    }, 300)
    return () => clearTimeout(t)
  }, [q, source])

  function buildParams() {
    const params = new URLSearchParams({ sort, dir })
    if (debouncedQ) params.set('q', debouncedQ)
    if (debouncedSource) params.set('source', debouncedSource)
    if (role !== ALL) params.set('role', role)
    if (spaces !== ALL) params.set('spaces', spaces)
    if (mfa !== ALL) params.set('mfa', mfa)
    return params
  }

  function onSort(k: SortKey) {
    if (k === sort) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSort(k)
      // 가입일·Space 수는 큰 값부터, 이메일·이름은 가나다순부터
      setDir(k === 'createdAt' || k === 'spaces' ? 'desc' : 'asc')
    }
  }

  useEffect(() => {
    let cancelled = false
    listVersion.current += 1
    setLoading(true)
    const params = buildParams()
    fetch(`/api/admin/users?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        setUsers(data.users ?? [])
        setNextOffset(data.nextOffset ?? null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildParams 는 아래 값들로만 결정된다
  }, [debouncedQ, debouncedSource, role, spaces, mfa, sort, dir])

  async function loadMore() {
    if (nextOffset === null) return
    const version = listVersion.current
    setLoadingMore(true)
    const params = buildParams()
    params.set('offset', String(nextOffset))
    try {
      const res = await fetch(`/api/admin/users?${params.toString()}`)
      const data = await res.json()
      if (version !== listVersion.current) return
      setUsers((prev) => [...prev, ...(data.users ?? [])])
      setNextOffset(data.nextOffset ?? null)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="이메일 또는 이름으로 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-sm"
        />
        <Input
          placeholder="가입 경로 (utm_source, 예: opening)"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="max-w-xs"
        />
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>전체 권한</SelectItem>
            <SelectItem value="operator">운영자</SelectItem>
            <SelectItem value="owner">소유자</SelectItem>
            <SelectItem value="admin">관리자</SelectItem>
            <SelectItem value="member">멤버</SelectItem>
          </SelectContent>
        </Select>
        <Select value={spaces} onValueChange={setSpaces}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Space 전체</SelectItem>
            <SelectItem value="some">Space 소속 있음</SelectItem>
            <SelectItem value="none">Space 소속 없음</SelectItem>
          </SelectContent>
        </Select>
        <Select value={mfa} onValueChange={setMfa}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>2단계 인증: 전체</SelectItem>
            <SelectItem value="required">2단계 인증: 필수</SelectItem>
            <SelectItem value="off">2단계 인증: 꺼짐</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead label="이메일" k="email" sort={sort} dir={dir} onSort={onSort} />
              <SortHead label="이름" k="name" sort={sort} dir={dir} onSort={onSort} />
              <SortHead label="소속" k="spaces" sort={sort} dir={dir} onSort={onSort} />
              <TableHead>권한</TableHead>
              <TableHead>가입 경로</TableHead>
              <SortHead label="가입일" k="createdAt" sort={sort} dir={dir} onSort={onSort} />
              <TableHead>2단계 인증</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
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
                <TableCell>
                  <SpaceCell memberships={u.spaceMemberships} />
                </TableCell>
                <TableCell>
                  {u.isOperator || u.spaceMemberships.length > 0 ? (
                    <span>
                      {u.isOperator && <span className="font-medium">운영자</span>}
                      {u.isOperator && u.spaceMemberships.length > 0 && ' · '}
                      {u.spaceMemberships.length > 0 &&
                        (ROLE_LABEL[u.spaceMemberships[0].role] ?? u.spaceMemberships[0].role)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <span title={u.signupSource ? JSON.stringify(u.signupSource) : undefined}>
                    {signupSourceLabel(u.signupSource)}
                  </span>
                </TableCell>
                <TableCell>{new Date(u.createdAt).toLocaleDateString('ko-KR')}</TableCell>
                <TableCell>
                  {u.isOperator || u.mfaRequired ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Badge variant="secondary">필수</Badge>
                      <span className="text-xs text-muted-foreground">
                        {u.totpEnrolled === null ? '—' : u.totpEnrolled ? '인증 앱 등록' : '미등록'}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">꺼짐</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {nextOffset !== null && (
        <Button variant="outline" onClick={loadMore} disabled={loadingMore} className="self-center">
          {loadingMore ? '불러오는 중...' : '더 보기'}
        </Button>
      )}
    </div>
  )
}
