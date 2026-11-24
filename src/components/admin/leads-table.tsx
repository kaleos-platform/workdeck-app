'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { signupSourceLabel, type SignupSource } from '@/lib/marketing/signup-source'
import { renderLeadInviteEmail } from '@/lib/marketing/lead-invite-content'
import { leadInviteSchema } from '@/lib/validations/lead-invite'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DECK_META } from '@/lib/deck-meta'
import { employeeCountLabel } from '@/lib/validations/marketing-lead'

type Status = 'NEW' | 'CONTACTED' | 'CONVERTED' | 'DROPPED'

export type Lead = {
  id: string
  deck: string
  name: string
  phone: string
  email: string
  companyName: string
  position: string
  employeeCount: string
  status: Status
  memo: string
  createdAt: string
  source: SignupSource
  applicationCount: number
  joinedAt: string | null
  invitedAt: string | null
  signupUrl: string | null
}

const STATUS_LABELS: Record<Status, string> = {
  NEW: '신규',
  CONTACTED: '연락함',
  CONVERTED: '전환',
  DROPPED: '종료',
}

const ALL = 'ALL'

function LeadInviteDialog({ lead }: { lead: Lead }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const form = useForm<
    z.input<typeof leadInviteSchema>,
    unknown,
    z.output<typeof leadInviteSchema>
  >({
    resolver: zodResolver(leadInviteSchema),
    defaultValues: { message: '' },
  })
  const message = form.watch('message') ?? ''
  async function send(data: z.output<typeof leadInviteSchema>) {
    setSendError(null)
    try {
      const res = await fetch(`/api/admin/leads/${lead.id}/send-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const result = await res.json().catch(() => null)
      if (!res.ok) throw new Error(result?.message ?? '안내 메일 발송에 실패했습니다')
      toast.success(
        result?.alreadySent ? '오늘 이미 안내 메일을 보냈습니다' : '안내 메일을 보냈습니다'
      )
      setOpen(false)
      form.reset()
      router.refresh()
    } catch (error) {
      setSendError(error instanceof Error ? error.message : '안내 메일 발송에 실패했습니다')
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={lead.status === 'DROPPED' || !lead.signupUrl}>
          안내 메일 보내기
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>안내 메일 보내기</DialogTitle>
          <DialogDescription className="break-all">
            {lead.email} · 같은 이메일에는 하루 한 번 발송합니다.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(send)} className="space-y-4">
            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>운영자 메시지 (선택)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value ?? ''}
                      maxLength={300}
                      rows={3}
                      placeholder="이용 안내를 덧붙여 주세요"
                      disabled={form.formState.isSubmitting}
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    {message.length}/300 · 일반 텍스트로 표시되며 링크로 변환하지 않습니다.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="space-y-2">
              <p className="text-sm font-medium">메일 미리보기</p>
              <iframe
                title="안내 메일 미리보기"
                sandbox=""
                srcDoc={renderLeadInviteEmail(message.trim(), lead.signupUrl ?? '')}
                className="h-96 w-full rounded-md border"
              />
            </div>
            {sendError ? (
              <p role="alert" className="text-sm text-destructive">
                {sendError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={form.formState.isSubmitting}
                onClick={() => setOpen(false)}
              >
                취소
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? '발송 중...' : '안내 메일 보내기'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function LeadRow({ lead }: { lead: Lead }) {
  const router = useRouter()
  const [memo, setMemo] = useState(lead.memo)
  const [saving, setSaving] = useState(false)

  async function save(patch: { status?: Status; memo?: string }) {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error()
      toast.success('저장했습니다')
      router.refresh()
    } catch {
      toast.error('저장에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr className="border-b align-top">
      <td className="p-2 text-xs text-muted-foreground">
        {new Date(lead.createdAt).toLocaleString('ko-KR')}
      </td>
      <td className="sticky left-0 z-10 bg-background p-2 text-sm">
        <div className="truncate font-medium" title={lead.companyName}>
          {lead.companyName}
        </div>
        <div className="text-xs text-muted-foreground">
          {DECK_META[lead.deck as keyof typeof DECK_META]?.name ?? lead.deck} ·{' '}
          {employeeCountLabel(lead.employeeCount)}
        </div>
      </td>
      <td className="p-2 text-sm">
        <div>
          {lead.name} <span className="text-xs text-muted-foreground">{lead.position}</span>
        </div>
        <div className="text-xs">{lead.phone}</div>
        <div className="truncate text-xs" title={lead.email}>
          {lead.email}
        </div>
        {lead.applicationCount >= 2 ? (
          <div className="mt-1 text-xs text-muted-foreground">
            같은 이메일 신청 {lead.applicationCount}회
          </div>
        ) : null}
      </td>
      <td className="p-2 text-xs">
        <p className="truncate" title={JSON.stringify(lead.source)}>
          {signupSourceLabel(lead.source)}
        </p>
      </td>
      <td className="p-2 text-xs">
        {lead.joinedAt ? (
          <>
            <p className="text-emerald-700 dark:text-emerald-400">가입함</p>
            <p className="mt-1 text-muted-foreground">
              {new Date(lead.joinedAt).toLocaleDateString('ko-KR')}
            </p>
          </>
        ) : (
          <span className="text-muted-foreground">미가입</span>
        )}
      </td>
      <td className="p-2">
        <Select
          value={lead.status}
          onValueChange={(v) => {
            void save({ status: v as Status })
          }}
        >
          <SelectTrigger className="w-28" disabled={saving} aria-label={`${lead.companyName} 상태`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(STATUS_LABELS) as Status[]).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="p-2">
        <Textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={2}
          maxLength={2000}
          aria-label={`${lead.companyName} 메모`}
        />
        <Button
          size="sm"
          variant="outline"
          className="mt-1"
          disabled={saving || memo === lead.memo}
          onClick={() => save({ memo })}
        >
          메모 저장
        </Button>
      </td>
      <td className="p-2">
        <LeadInviteDialog lead={lead} />
        {lead.invitedAt ? (
          <p className="mt-1 text-xs text-muted-foreground">
            마지막 발송
            <br />
            {new Date(lead.invitedAt).toLocaleString('ko-KR')}
          </p>
        ) : null}
      </td>
    </tr>
  )
}

export function LeadsTable({
  leads,
  status,
  statuses,
}: {
  leads: Lead[]
  status: string
  statuses: Status[]
}) {
  const router = useRouter()
  return (
    <div className="flex flex-col gap-4">
      <Select
        value={status || ALL}
        onValueChange={(v) => router.push(v === ALL ? '/admin/leads' : `/admin/leads?status=${v}`)}
      >
        <SelectTrigger className="w-36" aria-label="도입 신청 상태 필터">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>전체 상태</SelectItem>
          {statuses.map((s) => (
            <SelectItem key={s} value={s}>
              {STATUS_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1490px] table-fixed text-left">
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="w-[150px] p-2">접수</th>
              <th className="sticky left-0 z-20 w-[160px] bg-background p-2">회사</th>
              <th className="w-[230px] p-2">담당자</th>
              <th className="w-[160px] p-2">유입 경로</th>
              <th className="w-[100px] p-2">가입</th>
              <th className="w-[130px] p-2">상태</th>
              <th className="w-[280px] p-2">메모</th>
              <th className="w-[180px] p-2">안내 메일</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <LeadRow key={l.id} lead={l} />
            ))}
            {leads.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-6 text-center text-sm text-muted-foreground">
                  접수된 신청이 없습니다
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
