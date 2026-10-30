'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

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

type Lead = {
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
}

const STATUS_LABELS: Record<Status, string> = {
  NEW: '신규',
  CONTACTED: '연락함',
  CONVERTED: '전환',
  DROPPED: '종료',
}

const ALL = 'ALL'

function LeadRow({ lead }: { lead: Lead }) {
  const router = useRouter()
  const [status, setStatus] = useState<Status>(lead.status)
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
      <td className="p-2 text-xs whitespace-nowrap text-muted-foreground">
        {new Date(lead.createdAt).toLocaleString('ko-KR')}
      </td>
      <td className="p-2 text-sm">
        <div className="font-medium">{lead.companyName}</div>
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
        <div className="text-xs">{lead.email}</div>
      </td>
      <td className="p-2">
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as Status)
            void save({ status: v as Status })
          }}
        >
          <SelectTrigger className="w-28" disabled={saving}>
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
          className="min-w-56"
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
        <SelectTrigger className="w-36">
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
        <table className="w-full text-left">
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="p-2">접수</th>
              <th className="p-2">회사</th>
              <th className="p-2">담당자</th>
              <th className="p-2">상태</th>
              <th className="p-2">메모</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <LeadRow key={l.id} lead={l} />
            ))}
            {leads.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">
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
