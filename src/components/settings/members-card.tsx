'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ROLE_HINT, ROLE_LABEL } from '@/components/layout/space-switcher'
import type { Role } from '@/lib/auth/roles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { fetchWithMfa, redirectIfMfaRequired } from '@/lib/auth/mfa-client'

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
const TABS = ['members', 'invites', 'rules'] as const
type Tab = (typeof TABS)[number]
const roleLabel = (r: string) => ROLE_LABEL[r as Role] ?? r
const NET_ERR = '네트워크 오류로 요청하지 못했습니다.'

export function MembersCard() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const rawTab = searchParams.get('tab')
  const urlTab: Tab = TABS.find((t) => t === rawTab) ?? 'members'
  const [dialogOpen, setDialogOpen] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
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

  // URL 이 탭의 단일 기준 — 다른 query 는 그대로 두고 tab 만 바꾼다.
  function goTab(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', next)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  // target 이 있으면 목록의 「다시 초대」 — 폼 입력은 건드리지 않는다.
  async function invite(target?: { email: string; role: 'ADMIN' | 'MEMBER' }) {
    if (!spaceId) return
    setPending(true)
    setError(null)
    setInviteError(null)
    setCopied(false)
    try {
      const res = await fetchWithMfa(`/api/spaces/${spaceId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(target ?? { email: email.trim(), role }),
      })
      if (await redirectIfMfaRequired(res)) return
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const message = body?.message ?? '초대하지 못했습니다'
        return target ? setError(message) : setInviteError(message)
      }
      setCreated({
        expiresAt: body.expiresAt,
        link: body.link,
        emailSent: body.emailSent,
        resent: body.resent,
      })
      if (!target) {
        setEmail('')
        setDialogOpen(false)
      }
      goTab('invites')
      await load()
    } catch {
      if (target) setError(NET_ERR)
      else setInviteError(NET_ERR)
    } finally {
      setPending(false)
    }
  }

  async function revoke(id: string) {
    if (!spaceId || !confirm('이 초대를 취소할까요?')) return
    setError(null)
    try {
      const res = await fetchWithMfa(`/api/spaces/${spaceId}/invitations/${id}`, {
        method: 'DELETE',
      })
      // 목록은 AAL2 없이 보이지만 취소는 AAL2 — 필요하면 단계 인증으로 보낸다.
      if (await redirectIfMfaRequired(res)) return
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
      goTab('invites')
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
      const res = await fetchWithMfa(url, init)
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

  const isOwner = myRole === 'OWNER'
  const tab: Tab = urlTab === 'invites' && !isOwner ? 'members' : urlTab
  const pendingCount = invites.filter((i) => i.state === 'pending').length

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {myRole === null ? (
        !error && <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : (
        <Tabs value={tab} onValueChange={goTab}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="members">팀원·권한</TabsTrigger>
              {isOwner && (
                <TabsTrigger value="invites">
                  {pendingCount > 0 ? `초대 (${pendingCount})` : '초대'}
                </TabsTrigger>
              )}
              <TabsTrigger value="rules">승인 규칙</TabsTrigger>
            </TabsList>
            {isOwner && (
              <Button
                onClick={() => {
                  setInviteError(null)
                  setDialogOpen(true)
                }}
              >
                팀원 초대
              </Button>
            )}
          </div>

          <TabsContent value="members" className="space-y-6">
            <ul className="divide-y text-sm">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    {m.user.name ? `${m.user.name} · ` : ''}
                    {m.user.email}
                  </span>
                  {isOwner && m.role !== 'OWNER' ? (
                    <span className="flex items-center gap-1">
                      <Select
                        value={m.role}
                        onValueChange={(v) => changeRole(m, v)}
                        disabled={pending}
                      >
                        <SelectTrigger className="w-28" aria-label={`${m.user.email} 역할`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ADMIN">{roleLabel('ADMIN')}</SelectItem>
                          <SelectItem value="MEMBER">{roleLabel('MEMBER')}</SelectItem>
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
                    <span className="text-muted-foreground">{roleLabel(m.role)}</span>
                  )}
                </li>
              ))}
            </ul>
            <dl className="space-y-1 rounded-lg border bg-muted/40 p-4 text-sm">
              {(['OWNER', 'ADMIN', 'MEMBER'] as const).map((r) => (
                <div key={r} className="flex gap-2">
                  <dt className="w-16 shrink-0 font-medium">{ROLE_LABEL[r]}</dt>
                  <dd className="text-muted-foreground">{ROLE_HINT[r]}</dd>
                </div>
              ))}
            </dl>
          </TabsContent>

          {isOwner && (
            <TabsContent value="invites" className="space-y-4">
              {created && (
                <Alert>
                  <AlertDescription className="space-y-2">
                    <p>{notice}</p>
                    <div className="flex gap-2">
                      <Input
                        readOnly
                        aria-label="초대 링크"
                        value={created.link}
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <Button variant="outline" onClick={() => copy(created.link)}>
                        {copied ? '복사됨' : '링크 복사'}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      메일이 안 오면 이 링크를 전달하세요. 지금만 표시됩니다.
                      {created.expiresAt &&
                        ` ${new Date(created.expiresAt).toLocaleDateString('ko-KR')}에 만료됩니다.`}
                    </p>
                  </AlertDescription>
                </Alert>
              )}
              {invites.length === 0 ? (
                <p className="text-sm text-muted-foreground">초대 내역이 없습니다.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {invites.map((i) => (
                    <li
                      key={i.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span>
                          {i.email} · {roleLabel(i.role)}
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
            </TabsContent>
          )}

          <TabsContent value="rules" className="space-y-2 text-sm">
            <p className="font-medium">지출 승인 한도</p>
            <p className="text-muted-foreground">
              이 금액 이하의 지출 제안은 관리자도 Slack이나 AI 요청 승인 화면에서 승인할 수
              있습니다. 넘으면 소유자만 승인합니다.
            </p>
            {isOwner ? (
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
                  ? '한도 없음 — 모든 지출 제안은 소유자만 승인합니다'
                  : `${limit.toLocaleString('ko-KR')}원`}
              </p>
            )}
          </TabsContent>
        </Tabs>
      )}

      {isOwner && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>팀원 초대</DialogTitle>
              <DialogDescription>
                {spaceName
                  ? `「${spaceName}」에 초대할 사람의 이메일과 역할을 정하세요.`
                  : '초대할 사람의 이메일과 역할을 정하세요.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">이메일</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="초대할 이메일"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">역할</legend>
                {(['ADMIN', 'MEMBER'] as const).map((r) => (
                  <label key={r} className="flex items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="invite-role"
                      className="mt-1"
                      checked={role === r}
                      onChange={() => setRole(r)}
                    />
                    <span>
                      <span className="font-medium">{ROLE_LABEL[r]}</span>
                      <span className="block text-muted-foreground">{ROLE_HINT[r]}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}
            </div>
            <DialogFooter>
              <Button onClick={() => invite()} disabled={pending || !email.trim()}>
                초대 보내기
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
