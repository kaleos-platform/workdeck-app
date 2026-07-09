'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Editor } from '@/components/sc/editor/editor'
import { PostingStatusBadge, type PostingStatus } from './status-badge'
import {
  getPostingAssetPublicUrl,
  JOB_TYPE_LABELS,
  PAY_FREQUENCY_LABELS,
  WEEKDAYS,
  type WizardContentData,
  type WizardPositionData,
  type WizardStore,
} from './build-types'

type Props = {
  status: PostingStatus
  title: string
  positions: WizardPositionData[]
  stores: WizardStore[]
  storeIds: string[]
  noStores: boolean
  contents: WizardContentData[]
}

// 문자열 djb2 해시 — 텍스트 블록 data 변경 시 read-only Editor 를 remount 하기 위한 key.
function hashDoc(data: unknown): string {
  const str = JSON.stringify(data ?? null)
  let h = 5381
  for (let i = 0; i < str.length; i++) h = (h * 33) ^ str.charCodeAt(i)
  return (h >>> 0).toString(36)
}

// 공개 공고 페이지 미러 — wizard 로컬 상태에서 즉시 렌더.
export function PostingPreview({
  status,
  title,
  positions,
  stores,
  storeIds,
  noStores,
  contents,
}: Props) {
  const linkedStores = noStores ? [] : stores.filter((s) => storeIds.includes(s.id))
  const ordered = [...contents].sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <Card className="rounded-xl">
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="text-xs font-medium text-muted-foreground">공고 미리보기</div>
            <PostingStatusBadge status={status} />
          </div>
          <h2 className="text-lg font-semibold">{title || '제목 없는 공고'}</h2>
        </div>

        {positions.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">모집 직무</div>
            {positions.map((p) => (
              <div key={p.id} className="space-y-1 rounded-lg border px-4 py-3">
                <div className="text-sm font-medium">{p.name}</div>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {p.jobType && <span>{JOB_TYPE_LABELS[p.jobType]}</span>}
                  {p.payFrequency && (
                    <span>
                      {PAY_FREQUENCY_LABELS[p.payFrequency]}
                      {p.payAmount != null && ` ${p.payAmount.toLocaleString('ko-KR')}원`}
                    </span>
                  )}
                  {p.headcount != null && <span>{p.headcount}명</span>}
                  {p.workDays && p.workDays.length > 0 && (
                    <span>{p.workDays.map((d) => WEEKDAYS[d]).join('·')}</span>
                  )}
                  {p.workStartAt && p.workEndAt && (
                    <span>
                      {p.workStartAt}~{p.workEndAt}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!noStores && linkedStores.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">근무 매장</div>
            <div className="space-y-1">
              {linkedStores.map((s) => (
                <div key={s.id} className="rounded-md border px-4 py-2.5">
                  <div className="text-sm font-medium">{s.name}</div>
                  {s.roadAddress && (
                    <div className="truncate text-xs text-muted-foreground">{s.roadAddress}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {ordered.length > 0 && (
          <div className="space-y-4">
            {ordered.map((c) =>
              c.contentType === 'image' ? (
                c.imagePath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={c.id}
                    src={getPostingAssetPublicUrl(c.imagePath)}
                    alt=""
                    className="w-full rounded-md"
                  />
                ) : null
              ) : c.contentType === 'button' ? (
                (() => {
                  const btn = c.data as { title?: string; linkType?: string; url?: string } | null
                  if (!btn?.title) return null
                  return (
                    <a
                      key={c.id}
                      href={btn.linkType === 'url' && btn.url ? btn.url : '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
                    >
                      {btn.title}
                    </a>
                  )
                })()
              ) : (
                <Editor
                  key={`${c.id}:${hashDoc(c.data)}`}
                  initialDoc={c.data ?? undefined}
                  editable={false}
                />
              )
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
