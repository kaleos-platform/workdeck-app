'use client'

import { useCallback, useEffect, useState } from 'react'
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
import { redirectIfMfaRequired } from '@/lib/auth/mfa-client'

type Member = { id: string; role: string; user: { email: string; name: string | null } }
type InviteState = 'pending' | 'accepted' | 'expired' | 'revoked'
type Invitation = {
  id: string
  email: string
  role: string
  state: InviteState
  expiresAt: string
  lastSentAt: string | null
  lastSendFailed: boolean
  acceptedAt: string | null
  revokedAt: string | null
}
type Created = { link: string; emailSent: boolean; resent?: boolean; expiresAt?: string }

const STATE_BADGE: Record<InviteState, { label: string; className: string }> = {
  pending: {
    label: '대기',
    className:
      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400',
  },
  accepted: {
    label: '수락',
    className:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400',
  },
  expired: { label: '만료', className: 'border-border bg-muted text-muted-foreground' },
  revoked: { label: '취소', className: 'border-border bg-muted text-muted-foreground' },
}

const fmtDate = (v: string) => new Date(v).toLocaleDateString('ko-KR')
const fmtDateTime = (v: string) =>
  new Date(v).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })

function inviteMeta(i: Invitation): string {
  if (i.state === 'accepted' && i.acceptedAt) return `${fmtDateTime(i.acceptedAt)} 수락`
  if (i.state === 'revoked' && i.revokedAt) return `${fmtDateTime(i.revokedAt)} 취소`
  if (i.state === 'expired') return `${fmtDate(i.expiresAt)} 만료`
  return [`${fmtDate(i.expiresAt)} 만료`, i.lastSentAt && `${fmtDateTime(i.lastSentAt)} 발송`]
    .filter(Boolean)
    .join(' · ')
}
const NET_ERR = '네트워크 오류로 요청하지 못했습니다.'

export function MembersCard() {
  const [spaceId, setSpaceId] = useState<string | null>(null)
  // 쓰기 대상(spaceId)과 같은 응답에서 받은 이름 — 다른 탭에서 전환해도 표시와 대상이 어긋나지 않는다.
  const [spaceName, setSpaceName] = useState<string | null>(null)
  const [myRole, setMyRole] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invitation[]>([])
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
      const res = await fetch('/api/spaces/members')
      const body = await res.json().catch(() => null)
      if (res.status === 403)
        return setError(body?.message ?? '구성원 목록은 관리자 이상만 볼 수 있습니다.')
      if (!res.ok) return setError(body?.message ?? '구성원을 불러오지 못했습니다')
      setSpaceId(body.spaceId)
      setSpaceName(body.spaceName ?? null)
      setMyRole(body.myRole)
      setMembers(body.members)
      setLimit(body.approvalLimitKrw ?? null)
      setLimitInput(body.approvalLimitKrw == null ? '' : String(body.approvalLimitKrw))
      if (body.myRole === 'OWNER') {
        const inv = await fetch(`/api/spaces/${body.spaceId}/invitations`)
        const ib = await inv.json().catch(() => null)
        if (inv.ok) setInvites(ib.invitations)
        else setError(ib?.message ?? '초대 목록을 불러오지 못했습니다')
      }
    } catch {
      setError(NET_ERR)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // target 이 있으면 목록의 「다시 초대」 — 폼 입력은 건드리지 않는다.
  async function invite(target?: { email: string; role: 'ADMIN' | 'MEMBER' }) {
    if (!spaceId) return
    setPending(true)
    setError(null)
    setCopied(false)
    try {
      const res = await fetch(`/api/spaces/${spaceId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(target ?? { email: email.trim(), role }),
      })
      if (await redirectIfMfaRequired(res)) return
      const body = await res.json().catch(() => null)
      if (!res.ok) return setError(body?.message ?? '초대하지 못했습니다')
      setCreated({
        expiresAt: body.expiresAt,
        link: body.link,
        emailSent: body.emailSent,
        resent: body.resent,
      })
      if (!target) setEmail('')
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

  // 다시 보내기 — OWNER 만(AAL2 면제). 새 링크가 나오고 이전 링크는 무효.
  async function resend(id: string) {
    if (!spaceId) return
    setPending(true)
    setError(null)
    setCopied(false)
    try {
      const res = await fetch(`/api/spaces/${spaceId}/invitations/${id}/resend`, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        await load()
        return setError(body?.message ?? '다시 보내지 못했습니다')
      }
      setCreated({ link: body.link, emailSent: body.emailSent, expiresAt: body.expiresAt })
      await load()
    } catch {
      setError(NET_ERR)
    } finally {
      setPending(false)
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
    if (
      !confirm(
        spaceName
          ? `「${spaceName}」에서 ${m.user.email} 님을 내보낼까요?`
          : `${m.user.email} 님을 이 작업 공간에서 내보낼까요?`
      )
    )
      return
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

  const notice = !created
    ? null
    : !created.emailSent
      ? '메일을 보내지 못했습니다. 잠시 뒤 다시 보내거나 아래 링크를 복사해 전달하세요.'
      : created.resent
        ? '이미 대기 중인 초대가 있어 다시 보냈습니다.'
        : '초대 메일을 보냈습니다. 메일이 오지 않으면 아래 링크를 전달하세요.'

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
              <Button onClick={() => invite()} disabled={pending || !email.trim()}>
                {spaceName ? `「${spaceName}」에 초대` : '초대 보내기'}
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
                  메일이 안 오면 이 링크를 전달하세요. 지금만 표시됩니다.
                  {created.expiresAt &&
                    ` ${new Date(created.expiresAt).toLocaleDateString('ko-KR')}에 만료됩니다.`}
                </p>
              </div>
            )}
            {invites.length > 0 && (
              <ul className="divide-y text-sm">
                {invites.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span>
                        {i.email} · {i.role}
                      </span>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-xs ${STATE_BADGE[i.state].className}`}
                      >
                        {STATE_BADGE[i.state].label}
                      </span>
                      {i.state === 'pending' && i.lastSendFailed && (
                        <span className="text-xs text-destructive">메일 실패</span>
                      )}
                      <span className="text-xs text-muted-foreground">{inviteMeta(i)}</span>
                    </span>
                    {i.state === 'pending' && (
                      <span className="flex gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => resend(i.id)}
                          disabled={pending}
                        >
                          다시 보내기
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => revoke(i.id)}>
                          취소
                        </Button>
                      </span>
                    )}
                    {(i.state === 'expired' || i.state === 'revoked') && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          invite({ email: i.email, role: i.role as 'ADMIN' | 'MEMBER' })
                        }
                        disabled={pending}
                      >
                        다시 초대
                      </Button>
                    )}
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
