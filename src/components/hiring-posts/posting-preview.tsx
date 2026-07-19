'use client'

import { Card, CardContent } from '@/components/ui/card'
import { renderTiptapHtml } from '@/lib/hiring/render-tiptap'
import { HIRING_PROSE_CLASS } from '@/lib/hiring/prose'
import { buttonBlockStyle } from '@/lib/hiring/button-color'
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
        </div>

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
                  const btn = c.data as {
                    title?: string
                    linkType?: string
                    url?: string
                    color?: string
                  } | null
                  if (!btn?.title) return null
                  return (
                    <a
                      key={c.id}
                      href={btn.linkType === 'url' && btn.url ? btn.url : '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={buttonBlockStyle(btn.color)}
                      className="inline-flex w-full items-center justify-center rounded-md px-4 py-2.5 text-sm font-medium shadow transition-opacity hover:opacity-90"
                    >
                      {btn.title}
                    </a>
                  )
                })()
              ) : c.contentType === 'positions' ? (
                <div key={c.id} className="space-y-2">
                  <div className="text-sm font-medium">모집 직무</div>
                  {positions.length > 0 ? (
                    positions.map((p) => (
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
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
                      등록된 직무가 없습니다
                    </div>
                  )}
                </div>
              ) : c.contentType === 'text' && c.data ? (
                // 공개 페이지(app/p/[uuid])와 동일한 렌더 — 에디터 박스 없이 본문만 표시
                <div
                  key={c.id}
                  className={`${HIRING_PROSE_CLASS} [&_img]:h-auto [&_img]:max-w-full`}
                  dangerouslySetInnerHTML={{ __html: renderTiptapHtml(c.data) }}
                />
              ) : null
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
