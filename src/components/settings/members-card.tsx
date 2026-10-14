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
      if (body.myRole === 'OWNER') {
        const inv = await fetch(`/api/spaces/${body.spaceId}/invitations`)
        const ib = await inv.json().catch(() => null)
        // MFA(aal2)가 아니면 403 — API 메시지를 그대로 보여준다.
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
            <li key={m.id} className="flex justify-between py-2">
              <span>
                {m.user.name ? `${m.user.name} · ` : ''}
                {m.user.email}
              </span>
              <span className="text-muted-foreground">{m.role}</span>
            </li>
          ))}
        </ul>

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
