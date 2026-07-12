'use client'

/**
 * 새 계좌/카드 등록 다이얼로그 — 업로드 파일 정보를 prefill.
 * upload-panel(단일)에서 추출 — 동작 무변경.
 */
import { useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import type { Account, FinKind } from './types'

type AccountRegisterDialogProps = {
  /** 업로드 파일 정보에서 추출한 초기값 */
  prefill: {
    name: string
    holder: string
    kind: FinKind
    institution: string
    accountNumber: string
  }
  onCancel: () => void
  /** 등록 성공 시 생성된 계좌를 부모로 전달(후보 목록 추가 + 자동 선택) */
  onCreated: (account: Account) => void
}

export function AccountRegisterDialog({
  prefill,
  onCancel,
  onCreated,
}: AccountRegisterDialogProps) {
  const [name, setName] = useState(prefill.name)
  const [holder, setHolder] = useState(prefill.holder)
  const [accKind, setAccKind] = useState<FinKind>(prefill.kind)
  const [institution, setInstitution] = useState(prefill.institution)
  const [accountNumber, setAccountNumber] = useState(prefill.accountNumber)
  const [accountType, setAccountType] = useState('')
  const [openingBalance, setOpeningBalance] = useState('')
  const [saving, setSaving] = useState(false)

  const isCard = accKind === 'CARD'

  async function handleSave() {
    if (!name.trim()) {
      toast.error(isCard ? '카드 이름을 입력해 주세요' : '계좌 이름을 입력해 주세요')
      return
    }
    if (!institution.trim()) {
      toast.error(isCard ? '카드사명을 입력해 주세요' : '금융기관명을 입력해 주세요')
      return
    }

    const payload = {
      name: name.trim(),
      holder: holder.trim() || undefined,
      kind: accKind,
      institution: institution.trim(),
      accountNumber: accountNumber.trim() || undefined,
      accountType: accountType.trim() || undefined,
      ...(openingBalance.trim() !== '' && { openingBalance: Number(openingBalance) }),
    }

    setSaving(true)
    try {
      const res = await fetch('/api/finance/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json().catch(() => ({}))) as {
        message?: string
        account?: {
          id: string
          name: string
          kind: string
          institution: string | null
          holder: string | null
          accountNumber: string | null
        }
      }
      if (!res.ok || !data.account)
        throw new Error(data?.message ?? (isCard ? '카드 등록 실패' : '계좌 등록 실패'))
      toast.success(
        isCard
          ? '카드가 등록되어 연결 카드로 선택되었습니다'
          : '계좌가 등록되어 적재 계좌로 선택되었습니다'
      )
      onCreated({
        id: data.account.id,
        name: data.account.name,
        kind: data.account.kind,
        institution: data.account.institution,
        holder: data.account.holder,
        accountNumber: data.account.accountNumber,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : isCard ? '카드 등록 실패' : '계좌 등록 실패')
    } finally {
      setSaving(false)
    }
  }

  function handleEnter(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleSave()
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onCancel()
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isCard ? '새 카드 등록' : '새 계좌 등록'}</DialogTitle>
          <DialogDescription>
            {isCard
              ? '파일 정보를 확인한 뒤 연결 카드로 등록하세요.'
              : '파일 정보를 확인한 뒤 적재 계좌로 등록하세요.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          {/* 이름 */}
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">{isCard ? '카드 이름' : '계좌 이름'} *</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleEnter}
              placeholder={isCard ? '예: 하나카드 법인' : '예: 기업은행 사업용'}
              className="h-8 text-sm"
            />
          </div>

          {/* 예금주/명의자 */}
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">{isCard ? '명의자' : '예금주'}</Label>
            <Input
              value={holder}
              onChange={(e) => setHolder(e.target.value)}
              onKeyDown={handleEnter}
              placeholder="예: 주식회사 워크덱"
              className="h-8 text-sm"
            />
          </div>

          {/* 종류 — 카드 등록은 업로드 종류(카드) 고정이라 숨김 */}
          {!isCard && (
            <div className="space-y-1">
              <Label className="text-xs">종류 *</Label>
              <Select value={accKind} onValueChange={(v) => setAccKind(v as FinKind)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BANK">은행</SelectItem>
                  <SelectItem value="CARD">카드</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* 금융기관/카드사 */}
          <div className="space-y-1">
            <Label className="text-xs">{isCard ? '카드사' : '금융기관'} *</Label>
            <Input
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              onKeyDown={handleEnter}
              placeholder={isCard ? '예: 하나카드' : '예: 기업은행'}
              className="h-8 text-sm"
            />
          </div>

          {/* 계좌/카드번호 */}
          <div className="space-y-1">
            <Label className="text-xs">{isCard ? '카드번호' : '계좌번호'}</Label>
            <Input
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              onKeyDown={handleEnter}
              placeholder="선택 입력"
              className="h-8 font-mono text-sm"
            />
          </div>

          {/* 계좌 유형·기초 잔액 — 카드에는 불필요 */}
          {!isCard && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">계좌 유형</Label>
                <Input
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value)}
                  onKeyDown={handleEnter}
                  placeholder="예: 보통예금"
                  className="h-8 text-sm"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">기초 잔액 (원)</Label>
                <Input
                  type="number"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(e.target.value)}
                  onKeyDown={handleEnter}
                  placeholder="선택 입력"
                  className="h-8 text-sm"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '등록 중...' : isCard ? '카드 등록' : '계좌 등록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
