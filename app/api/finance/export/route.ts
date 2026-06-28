/**
 * GET /api/finance/export
 * 확정 거래(FinTransaction)를 공식 회계 기준으로 환원한 CSV로 내보낸다.
 * K-IFRS가 외부로 노출되는 유일한 표면 — 운영 항목 → K-IFRS 코드·계정명·현금흐름 활동 매핑.
 *
 * query: from?(YYYY-MM-DD), to?(YYYY-MM-DD) — 미지정 시 전체 기간.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { toNum } from '@/lib/finance/serialize'
import { cfActivityForCode, kifrsAccountName, CF_ACTIVITY_LABEL } from '@/lib/finance/kifrs-seed'
import { signedAmount } from '@/lib/finance/aggregate'

function parseDate(v: string | null): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(`${v}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** CSV 셀 escape — 쌍따옴표로 감싸고 내부 쌍따옴표는 2개로. */
function cell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v)
  return `"${s.replace(/"/g, '""')}"`
}

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const sp = req.nextUrl.searchParams
  const from = parseDate(sp.get('from'))
  const toRaw = parseDate(sp.get('to'))
  // to는 그 날 포함 — 다음날 00:00 미만으로.
  const toExclusive = toRaw ? new Date(toRaw.getTime() + 24 * 60 * 60 * 1000) : null

  const txns = await prisma.finTransaction.findMany({
    where: {
      spaceId,
      ...(from || toExclusive
        ? {
            txnDate: {
              ...(from ? { gte: from } : {}),
              ...(toExclusive ? { lt: toExclusive } : {}),
            },
          }
        : {}),
    },
    orderBy: { txnDate: 'asc' },
    select: {
      txnDate: true,
      direction: true,
      amount: true,
      description: true,
      counterparty: true,
      isTransfer: true,
      cancelFlag: true,
      account: { select: { name: true } },
      category: {
        select: { name: true, code: true, parent: { select: { name: true } } },
      },
    },
  })

  const headers = [
    '거래일',
    '계좌',
    '적요',
    '거래처',
    '구분',
    '금액',
    '운영계정',
    '대분류',
    'K-IFRS코드',
    'K-IFRS계정',
    '현금흐름분류',
  ]

  const lines: string[] = [headers.map(cell).join(',')]

  for (const t of txns) {
    const code = t.category?.code ?? null
    const division = t.isTransfer ? '이체' : t.direction === 'IN' ? '수입' : '지출'
    const cf = t.isTransfer ? '내부이체(제외)' : CF_ACTIVITY_LABEL[cfActivityForCode(code)]
    // 취소거래(cancelFlag '취소')는 부호 반전으로 상계 — dashboard·cashflow와 동일 회계 처리.
    const amount = signedAmount({ amount: toNum(t.amount), cancelFlag: t.cancelFlag })
    lines.push(
      [
        cell(ymd(t.txnDate)),
        cell(t.account?.name ?? ''),
        cell(t.description ?? ''),
        cell(t.counterparty ?? ''),
        cell(division),
        cell(Math.round(amount)),
        cell(t.category?.name ?? '미분류'),
        cell(t.category?.parent?.name ?? ''),
        cell(code ?? ''),
        cell(kifrsAccountName(code)),
        cell(cf),
      ].join(',')
    )
  }

  // Excel 한글 인식을 위한 UTF-8 BOM.
  const csv = '﻿' + lines.join('\r\n')
  const fname = `finance-export${from ? `_${ymd(from)}` : ''}${toRaw ? `_${ymd(toRaw)}` : ''}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fname}"`,
    },
  })
}
