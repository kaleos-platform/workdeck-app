import { notFound, redirect } from 'next/navigation'
import { requireOperator } from '@/lib/admin/auth'
import { mfaStepUpPath } from '@/lib/auth/mfa-policy'
import { prisma } from '@/lib/prisma'
import { Badge } from '@/components/ui/badge'

export const dynamic = 'force-dynamic'

function counts(detail: unknown) {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null
  const data = detail as Record<string, unknown>
  const values = [data.scanned, data.deleted, data.failed, data.remaining]
  if (
    !values.every((value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
  )
    return null
  const numbers = values as number[]
  if (
    numbers[1] + numbers[2] > numbers[0] ||
    typeof data.truncated !== 'boolean' ||
    data.truncated !== numbers[3] > 0
  )
    return null
  return { values: numbers, truncated: data.truncated }
}

export default async function HiringUploadSweepPage() {
  const auth = await requireOperator()
  if (!auth.ok && auth.reason === 'MFA_REQUIRED')
    redirect(mfaStepUpPath('/admin/hiring-upload-sweep'))
  if (!auth.ok) notFound()

  let rows: { startedAt: Date; ok: boolean; error: string | null; detail: unknown }[]
  try {
    rows = await prisma.cronRun.findMany({
      where: { path: '/api/cron/hiring-upload-sweep' },
      orderBy: { startedAt: 'desc' },
      take: 20,
      select: { startedAt: true, ok: true, error: true, detail: true },
    })
  } catch {
    return <p role="alert">실행 이력을 조회하지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">모집 첨부 정리 이력</h1>
        <p className="text-sm text-muted-foreground">
          최근 실행 기록 20건 · 매시 30분 예정 · 시간은 한국 시간 기준
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        이후 실행이 성공하거나 남은 건수가 0이어도 과거 개별 실패의 복구 완료를 보장하지 않습니다.
        남은 건수에는 재시도 대기 중인 항목이 포함되지 않습니다. 실행 기록이 저장되지 않았을 수도
        있습니다.
      </p>
      {rows.length === 0 ? (
        <p>실행 기록이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[730px] table-fixed text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="sticky left-0 z-10 w-[190px] bg-background p-2">실행 시간</th>
                <th className="w-[110px] p-2">상태</th>
                <th className="w-[80px] p-2">확인</th>
                <th className="w-[80px] p-2">삭제</th>
                <th className="w-[80px] p-2">실패</th>
                <th className="w-[80px] p-2">남음</th>
                <th className="w-[110px] p-2">추가 대상</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const summary = counts(row.detail)
                const values = summary?.values
                const status =
                  row.error !== null
                    ? row.ok
                      ? '미확인'
                      : '중단'
                    : !values || (!row.ok && values[2] === 0)
                      ? '미확인'
                      : values[2] > 0
                        ? '부분 실패'
                        : '성공'
                return (
                  <tr key={index} className="border-b">
                    <td className="sticky left-0 z-10 bg-background p-2 tabular-nums">
                      {new Intl.DateTimeFormat('ko-KR', {
                        timeZone: 'Asia/Seoul',
                        dateStyle: 'short',
                        timeStyle: 'medium',
                      }).format(row.startedAt)}
                    </td>
                    <td className="p-2">
                      <Badge
                        variant="outline"
                        className={
                          status === '성공'
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : status === '부분 실패'
                              ? 'border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                              : status === '중단'
                                ? 'border-red-300 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                : ''
                        }
                      >
                        {status}
                      </Badge>
                    </td>
                    {(values ?? [null, null, null, null]).map((value, i) => (
                      <td className="p-2 tabular-nums" key={i}>
                        {value ?? '—'}
                      </td>
                    ))}
                    <td className="p-2">{summary ? (summary.truncated ? '있음' : '없음') : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
