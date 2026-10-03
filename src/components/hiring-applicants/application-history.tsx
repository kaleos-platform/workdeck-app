// 원문 값은 서버에서만 렌더링하고 다운로드 client island에는 검증된 파일 정보만 전달한다.
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type {
  ApplicationHistoryResult,
  HistoryEntry,
} from '@/lib/hiring/migration/application-history'
import { FileDownloadList } from './detail-actions'

function scalar(value: string | number | boolean | null): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return value === '' ? '문자열: (빈 문자열)' : `문자열: ${value}`
  return `${typeof value === 'number' ? '숫자' : 'boolean'}: ${String(value)}`
}
function EntryValue({ entry }: { entry: Extract<HistoryEntry, { kind: 'value' }> }) {
  const value = entry.value
  if (value.kind === 'missing') return <>값 누락</>
  if (value.kind === 'unsupported') return <>표시할 수 없는 원본 값 형식</>
  if (value.kind === 'scalar') return <>{scalar(value.value)}</>
  return value.values.length ? (
    <ol className="list-inside list-decimal space-y-1">
      {value.values.map((item, index) => (
        <li key={index}>{scalar(item)}</li>
      ))}
    </ol>
  ) : (
    <>빈 배열</>
  )
}
const label = (code: number, labels: Record<number, string>) =>
  `${code} · ${labels[code] ?? '알 수 없는 원본 코드'}`

export function ApplicationHistory({
  applicationId,
  result,
}: {
  applicationId: string
  result: ApplicationHistoryResult
}) {
  if (result.status === 'absent') return null
  if (result.status === 'unavailable')
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">이전 원문</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          이전 원문을 확인할 수 없습니다.
        </CardContent>
      </Card>
    )
  const history = result.history
  const dates = [
    ['원본 수집', history.sourceSnapshotAt],
    ['원본 지원', history.createdAt],
    ['원본 수정', history.updatedAt],
    ['필수 개인정보 동의', history.requiredPrivacyAgreedAt],
    ['선택 개인정보 동의', history.optionalPrivacyAgreedAt],
    ['지원 취소', history.canceledAt],
    ['삭제', history.deletedAt],
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">이전 원문</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-xs text-muted-foreground">
          이전 당시의 응답입니다. 현재 지원서 양식이나 전형 상태로 다시 해석하지 않았습니다.
        </p>
        <dl className="space-y-3">
          {history.entries.map((entry) => (
            <div key={entry.index} className="min-w-0 space-y-1 border-b pb-3 last:border-0">
              <dt className="font-medium break-words">
                {entry.label ?? `항목 ${entry.index + 1}`}
              </dt>
              <dd className="text-xs text-muted-foreground">
                원본 유형: {entry.sourceType ?? '미상'}
              </dd>
              <dd className="break-words whitespace-pre-wrap">
                {entry.kind === 'files' ? (
                  <>
                    <FileDownloadList applicationId={applicationId} files={entry.files} />
                    {entry.unresolvedCount > 0 && (
                      <p className="text-xs text-muted-foreground">
                        첨부 연결 미확정 {entry.unresolvedCount}개
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <EntryValue entry={entry} />
                    {entry.interpretation === 'unresolved' && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        선택 라벨·기타 응답 해석 미확정
                      </p>
                    )}
                    {entry.verifiedLabels && (
                      <p className="mt-1 text-xs">
                        검증된 선택 라벨: {entry.verifiedLabels.join(', ')}
                      </p>
                    )}
                  </>
                )}
              </dd>
              <dd className="text-xs text-muted-foreground">
                원본 기타 표시:{' '}
                {
                  {
                    missing: '없음',
                    true: '있음 (의미 미확정)',
                    false: 'false',
                    invalid: '잘못된 형식',
                  }[entry.otherMarker]
                }
              </dd>
            </div>
          ))}
        </dl>
        <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
          <p>원본 상태: {label(history.sourceStatus, { 0: '비활성', 1: '활성' })}</p>
          <p>원본 평가: {label(history.sourceStage, { 1: '평가중', 3: '합격자', 4: '불합격' })}</p>
          <p>
            원본 채용 단계:{' '}
            {label(history.sourceHiringStage, { 1: '지원 접수', 2: '서류 통과', 3: '최종 후보' })}
          </p>
          <p>위 코드는 원본 의미이며 현재 Workdeck 단계와 동일하다는 뜻은 아닙니다.</p>
          <dl className="grid gap-1 pt-2 sm:grid-cols-2">
            {dates.map(([name, date]) => (
              <div key={name} className="min-w-0">
                <dt>{name}</dt>
                <dd className="break-words">{date ?? '원본 기록 없음'}</dd>
              </div>
            ))}
          </dl>
        </div>
      </CardContent>
    </Card>
  )
}
