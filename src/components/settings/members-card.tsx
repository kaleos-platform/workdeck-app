'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SpaceRequiredPicker, type SpaceChoice } from '@/components/common/space-required-picker'
import { redirectIfMfaRequired } from '@/lib/auth/mfa-client'

type Member = { id: string; role: string; user: { email: string; name: string | null } }
type Invitation = { id: string; email: string; role: string; expiresAt: string }
type Created = { link: string; emailSent: boolean; emailSkipReason?: string; expiresAt?: string }
const NET_ERR = '네트워크 오류로 요청하지 못했습니다.'

export function MembersCard() {
  const spaceParam = useSearchParams().get('spaceId')
  const q = spaceParam ? `?spaceId=${encodeURIComponent(spaceParam)}` : ''
  const [spaceId, setSpaceId] = useState<string | null>(null)
  const [myRole, setMyRole] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invitation[]>([])
  const [choices, setChoices] = useState<SpaceChoice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'ADMIN' | 'MEMBER'>('ADMIN')
  const [created, setCreated] = useState<Created | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState(false)
  const [limit, setLimit] = useState<number | null>(null)
  const [limitInput, setLimitInput] = useState('')
  const [limitSaved, setLimitSaved] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/spaces/members${q}`)
      const body = await res.json().catch(() => null)
      if (res.status === 400 && body?.code === 'SPACE_REQUIRED')
        return setChoices(body.spaces ?? [])
      if (res.status === 403)
        return setError(body?.message ?? '구성원 목록은 관리자 이상만 볼 수 있습니다.')
      if (!res.ok) return setError(body?.message ?? '구성원을 불러오지 못했습니다')
      setSpaceId(body.spaceId)
      setMyRole(body.myRole)
      setMembers(body.members)
      setLimit(body.approvalLimitKrw ?? null)
      setLimitInput(body.approvalLimitKrw == null ? '' : String(body.approvalLimitKrw))
      if (body.myRole === 'OWNER') {
        const inv = await fetch(`/api/spaces/${body.spaceId}/invitations`)
        // MFA(aal2)가 아니면 403 — 보기만 하는 화면이라 이동시키지 않고 메시지만(변경 동작에서 단계 인증으로 보낸다).
        const ib = await inv.json().catch(() => null)
        if (inv.ok) setInvites(ib.invitations)
        else setError(ib?.message ?? '초대 목록을 불러오지 못했습니다')
      }
    } catch {
      setError(NET_ERR)
    }
  }, [q])

  useEffect(() => {
    void load()
  }, [load])

  async function invite() {
    if (!spaceId) return
    setPending(true)
    setError(null)
    setCopied(false)
    try {
      const res = await fetch(`/api/spaces/${spaceId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role }),
      })
      if (await redirectIfMfaRequired(res)) return
      const body = await res.json().catch(() => null)
      if (!res.ok) return setError(body?.message ?? '초대하지 못했습니다')
      setCreated({
        expiresAt: body.expiresAt,
        link: body.link,
        emailSent: body.emailSent,
        emailSkipReason: body.emailSkipReason,
      })
      setEmail('')
      await load()
    } catch {
      setError(NET_ERR)
    } finally {
      setPending(false)
    }
  }

  async function revoke(id: string) {
    if (!spaceId || !confirm('이 초대를 취소할까요?')) return
    setError(null)
    try {
      const res = await fetch(`/api/spaces/${spaceId}/invitations/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        await load()
        return setError(body?.message ?? '초대를 취소하지 못했습니다')
      }
      await load()
    } catch {
      setError(NET_ERR)
    }
  }

  // OWNER 전용 변경 요청 공통 — MFA 필요하면 단계 인증으로, 실패하면 메시지, 끝나면 목록을 다시 읽는다.
  async function mutate(url: string, init: RequestInit, failMessage: string): Promise<boolean> {
    setError(null)
    setPending(true)
    try {
      const res = await fetch(url, init)
      if (await redirectIfMfaRequired(res)) return false
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.message ?? failMessage)
        return false
      }
      await load()
      return true
    } catch {
      setError(NET_ERR)
      return false
    } finally {
      setPending(false)
    }
  }

  function changeRole(m: Member, next: string) {
    if (next === m.role) return
    void mutate(
      `/api/spaces/members/${m.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: next }),
      },
      '역할을 바꾸지 못했습니다'
    )
  }

  function removeMember(m: Member) {
    if (!confirm(`${m.user.email} 님을 이 Space에서 내보낼까요?`)) return
    void mutate(`/api/spaces/members/${m.id}`, { method: 'DELETE' }, '구성원을 내보내지 못했습니다')
  }

  async function saveLimit(noLimit: boolean) {
    if (!spaceId) return
    const value = noLimit ? null : Number(limitInput)
    if (value !== null && (!Number.isInteger(value) || value < 0))
      return setError('승인 한도는 0 이상의 정수(원)로 입력하세요')
    setLimitSaved(false)
    const ok = await mutate(
      `/api/spaces/${spaceId}/approval-limit`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalLimitKrw: value }),
      },
      '승인 한도를 저장하지 못했습니다'
    )
    setLimitSaved(ok)
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      // 클립보드를 못 쓰면 아래 읽기 전용 입력에서 직접 복사한다.
    }
  }

  if (choices) return <SpaceRequiredPicker spaces={choices} />

  const notice = !created
    ? null
    : created.emailSent
      ? '초대 메일을 보냈습니다. 아래 링크로도 전달할 수 있습니다.'
      : created.emailSkipReason === 'already_registered'
        ? '이미 가입된 이메일이라 메일을 보내지 않았습니다. 아래 링크를 복사해 전달하세요.'
        : created.emailSkipReason === 'stale_resend'
          ? '이전 초대 메일을 다시 보낼 수 없어 메일을 보내지 않았습니다. 아래 링크를 복사해 전달하세요.'
          : '초대 메일을 보내지 못했습니다. 아래 링크를 복사해 전달하세요.'

  return (
    <Card>
      <CardHeader>
        <CardTitle>구성원</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && <p className="text-sm text-destructive">{error}</p>}
        <ul className="divide-y text-sm">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 py-2">
              <span>
                {m.user.name ? `${m.user.name} · ` : ''}
                {m.user.email}
              </span>
              {myRole === 'OWNER' && m.role !== 'OWNER' ? (
                <span className="flex items-center gap-1">
                  <Select value={m.role} onValueChange={(v) => changeRole(m, v)} disabled={pending}>
                    <SelectTrigger className="w-28" aria-label={`${m.user.email} 역할`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ADMIN">ADMIN</SelectItem>
                      <SelectItem value="MEMBER">MEMBER</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeMember(m)}
                    disabled={pending}
                  >
                    내보내기
                  </Button>
                </span>
              ) : (
                <span className="text-muted-foreground">{m.role}</span>
              )}
            </li>
          ))}
        </ul>

        <div className="space-y-2 text-sm">
          <p className="font-medium">지출 승인 한도</p>
          <p className="text-muted-foreground">
            이 금액 이하의 지출 제안은 ADMIN도 Slack·승인 화면에서 승인할 수 있습니다. 넘으면
            OWNER만 승인합니다.
          </p>
          {myRole === 'OWNER' ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="w-40"
                inputMode="numeric"
                placeholder="한도 없음"
                aria-label="ADMIN 승인 한도(원)"
                value={limitInput}
                onChange={(e) => {
                  setLimitInput(e.target.value.replace(/[^0-9]/g, ''))
                  setLimitSaved(false)
                }}
              />
              <span>원</span>
              <Button size="sm" onClick={() => saveLimit(false)} disabled={!limitInput}>
                저장
              </Button>
              <Button size="sm" variant="outline" onClick={() => saveLimit(true)}>
                한도 없음
              </Button>
              {limitSaved && <span className="text-muted-foreground">저장했습니다</span>}
            </div>
          ) : (
            <p>
              {limit == null
                ? '한도 없음 — 모든 지출 제안은 OWNER만 승인합니다'
                : `${limit.toLocaleString('ko-KR')}원`}
            </p>
          )}
        </div>

        {myRole === 'OWNER' && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Input
                className="w-72"
                type="email"
                placeholder="초대할 이메일"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Select value={role} onValueChange={(v) => setRole(v as 'ADMIN' | 'MEMBER')}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">ADMIN</SelectItem>
                  <SelectItem value="MEMBER">MEMBER</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={invite} disabled={pending || !email.trim()}>
                초대 보내기
              </Button>
            </div>
            {created && (
              <div className="space-y-1 text-sm">
                <p>{notice}</p>
                <div className="flex gap-2">
                  <Input readOnly value={created.link} onFocus={(e) => e.currentTarget.select()} />
                  <Button variant="outline" onClick={() => copy(created.link)}>
                    {copied ? '복사됨' : '링크 복사'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  이 링크는 지금만 표시됩니다.
                  {created.expiresAt &&
                    ` ${new Date(created.expiresAt).toLocaleDateString('ko-KR')}에 만료됩니다.`}
                </p>
              </div>
            )}
            {invites.length > 0 && (
              <ul className="divide-y text-sm">
                {invites.map((i) => (
                  <li key={i.id} className="flex items-center justify-between py-2">
                    <span>
                      {i.email} · {i.role} · {new Date(i.expiresAt).toLocaleDateString('ko-KR')}{' '}
                      만료
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => revoke(i.id)}>
                      취소
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
