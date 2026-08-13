'use client'

import { Copy, Shuffle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { KEYWORD_STATUS_LABELS } from '@/lib/sh/keyword-labels'
import { statusBadgeClass, type KeywordStatus } from './keyword-status'

/** GET /api/sh/keywords/duplicates 응답의 클러스터 한 덩어리. */
export type DuplicateCluster = {
  /** DESPACED = §11 띄어쓰기 변형, SORTED = §12 단어 순열 */
  kind: 'DESPACED' | 'SORTED'
  key: string
  members: Array<{ id: string; keyword: string; status: string; score: number }>
}

const KIND_LABEL: Record<DuplicateCluster['kind'], string> = {
  DESPACED: '띄어쓰기 변형',
  SORTED: '단어 순서 변형',
}

const KIND_DESC: Record<DuplicateCluster['kind'], string> = {
  DESPACED: '공백만 다른 같은 표기입니다. 하나로 통일하세요',
  SORTED: '같은 단어의 순서만 다릅니다. 대표 표기를 정하세요',
}

type Props = {
  clusters: DuplicateCluster[]
  loading: boolean
  /** 클러스터 구성원을 목록에서 한 번에 선택 */
  onSelectCluster: (ids: string[]) => void
}

/**
 * 중복 탐지 패널 — 표기만 다른 같은 키워드를 클러스터로 보여준다.
 * space 전체를 대상으로 하므로 목록 페이지네이션과 무관하다.
 */
export function KeywordDuplicatePanel({ clusters, loading, onSelectCluster }: Props) {
  if (loading) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        중복 표기를 확인하는 중...
      </div>
    )
  }

  if (clusters.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        중복 의심 키워드가 없습니다
      </div>
    )
  }

  return (
    <section aria-labelledby="keyword-duplicates-heading" className="rounded-lg border">
      <header className="flex items-center justify-between border-b bg-amber-50/60 px-4 py-2.5">
        <h2 id="keyword-duplicates-heading" className="text-sm font-semibold text-amber-900">
          중복 의심 {clusters.length}건
        </h2>
        <p className="text-xs text-amber-800">띄어쓰기·단어 순서만 다른 키워드입니다</p>
      </header>
      <ul className="divide-y">
        {clusters.map((cluster) => (
          <li key={`${cluster.kind}-${cluster.key}`} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1 text-[11px]">
                {cluster.kind === 'DESPACED' ? (
                  <Copy className="h-3 w-3" aria-hidden />
                ) : (
                  <Shuffle className="h-3 w-3" aria-hidden />
                )}
                {KIND_LABEL[cluster.kind]}
              </Badge>
              <span className="text-xs text-muted-foreground">{KIND_DESC[cluster.kind]}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto h-7 text-xs"
                onClick={() => onSelectCluster(cluster.members.map((m) => m.id))}
              >
                {cluster.members.length}개 모두 선택
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {cluster.members.map((member) => (
                <span
                  key={member.id}
                  className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs"
                >
                  <span className="font-medium">{member.keyword}</span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${statusBadgeClass(member.status as KeywordStatus)}`}
                  >
                    {KEYWORD_STATUS_LABELS[member.status as KeywordStatus] ?? member.status}
                  </Badge>
                  <span className="text-muted-foreground tabular-nums">{member.score}점</span>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
