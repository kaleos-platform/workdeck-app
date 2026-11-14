'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Eye, Loader2, Monitor, Smartphone } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { WizardContentData } from './build-types'
import { ContentBlockPreview } from './posting-preview'

export type TemplateRow = {
  id: string
  name: string
  blockCount: number
  updatedAt: string
  isSample: boolean
}

// ─── 블록 조회 저장소: 갤러리 인스턴스 단위 캐시 + 동시 요청 4개 제한 ───────────────
const MAX_IN_FLIGHT = 4

export type TemplateBlockStore = { load: (id: string) => Promise<WizardContentData[]> }

export function createTemplateBlockStore(): TemplateBlockStore {
  const cache = new Map<string, Promise<WizardContentData[]>>()
  const waiting: Array<() => void> = []
  let inFlight = 0

  function pump() {
    while (inFlight < MAX_IN_FLIGHT && waiting.length > 0) waiting.shift()!()
  }

  function fetchBlocks(id: string) {
    return new Promise<WizardContentData[]>((resolve, reject) => {
      waiting.push(() => {
        inFlight++
        fetch(`/api/hiring-posts/templates/${id}`)
          .then(async (res) => {
            if (!res.ok) throw new Error('미리보기를 불러오지 못했습니다')
            const { contents } = await res.json()
            return contents as WizardContentData[]
          })
          .then(resolve, reject)
          .finally(() => {
            inFlight--
            pump()
          })
      })
      pump()
    })
  }

  return {
    load(id) {
      const hit = cache.get(id)
      if (hit) return hit
      const request = fetchBlocks(id)
      cache.set(id, request)
      // 실패는 캐시하지 않아 재시도할 수 있게 한다.
      request.catch(() => cache.delete(id))
      return request
    },
  }
}

export function useTemplateBlockStore() {
  return useState(createTemplateBlockStore)[0]
}

type BlocksState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; blocks: WizardContentData[] }

// enabled=false 면 요청하지 않는다(화면 밖 썸네일).
function useTemplateBlocks(store: TemplateBlockStore, id: string, enabled: boolean): BlocksState {
  const [result, setResult] = useState<{ id: string; state: BlocksState } | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    store.load(id).then(
      (blocks) => live && setResult({ id, state: { status: 'ready', blocks } }),
      () => live && setResult({ id, state: { status: 'error' } })
    )
    return () => {
      live = false
    }
  }, [store, id, enabled])
  return result?.id === id ? result.state : { status: 'loading' }
}

// ─── 큰 미리보기 (PC/모바일 전환) ───────────────────────────────────────────────
export function TemplatePreviewPane({
  store,
  template,
  className,
}: {
  store: TemplateBlockStore
  template: TemplateRow
  className?: string
}) {
  const [device, setDevice] = useState<'pc' | 'mobile'>('pc')
  const state = useTemplateBlocks(store, template.id, true)
  return (
    <div
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-md border bg-muted/20',
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b bg-background px-3 py-2">
        <div className="min-w-0 truncate text-sm font-medium">{template.name}</div>
        <div className="flex shrink-0 gap-1" role="group" aria-label="미리보기 화면 크기">
          <Button
            type="button"
            size="sm"
            variant={device === 'pc' ? 'secondary' : 'ghost'}
            aria-pressed={device === 'pc'}
            onClick={() => setDevice('pc')}
          >
            <Monitor /> PC
          </Button>
          <Button
            type="button"
            size="sm"
            variant={device === 'mobile' ? 'secondary' : 'ghost'}
            aria-pressed={device === 'mobile'}
            onClick={() => setDevice('mobile')}
          >
            <Smartphone /> 모바일
          </Button>
        </div>
      </div>
      {state.status === 'loading' ? (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" /> 미리보기 불러오는 중…
        </div>
      ) : state.status === 'error' ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-destructive">
          미리보기를 불러오지 못했습니다
        </div>
      ) : state.blocks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          이 템플릿에는 표시할 블록이 없습니다
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div
            className={cn(
              'mx-auto space-y-4 rounded-md bg-background p-4',
              device === 'mobile' ? 'max-w-[375px]' : 'max-w-2xl'
            )}
          >
            {state.blocks.map((c) => (
              <ContentBlockPreview key={c.id} content={c} positions={[]} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 썸네일: 첫 블록 3개를 고정 폭(THUMB_BASE)으로 그려 박스 폭에 맞춰 축소 ───────────
const THUMB_BASE = 420
const THUMB_BLOCKS = 3

function TemplateThumbnail({
  store,
  template,
}: {
  store: TemplateBlockStore
  template: TemplateRow
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [scale, setScale] = useState(0.5)
  // IntersectionObserver 없는 환경은 즉시 불러온다.
  const noObserver = typeof IntersectionObserver === 'undefined'
  const state = useTemplateBlocks(store, template.id, visible || noObserver)

  // 화면에 들어올 때만 불러온다.
  useEffect(() => {
    const el = boxRef.current
    if (!el || visible || noObserver) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '200px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible, noObserver])

  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setScale(entry.contentRect.width / THUMB_BASE)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const blocks = state.status === 'ready' ? state.blocks.slice(0, THUMB_BLOCKS) : []
  return (
    <div
      ref={boxRef}
      className="relative aspect-[4/5] w-full overflow-hidden bg-muted/40"
      aria-hidden="true"
    >
      {state.status === 'ready' && blocks.length > 0 ? (
        <div
          className="pointer-events-none absolute top-0 left-0 origin-top-left space-y-3 bg-background p-4"
          style={{ width: THUMB_BASE, transform: `scale(${scale})` }}
        >
          {blocks.map((c) => (
            <ContentBlockPreview key={c.id} content={c} positions={[]} />
          ))}
        </div>
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          {state.status === 'error' ? (
            '미리보기 없음'
          ) : state.status === 'ready' ? (
            '빈 템플릿'
          ) : (
            <div className="size-full animate-pulse bg-muted" data-testid="thumb-skeleton" />
          )}
        </div>
      )}
    </div>
  )
}

function formatDate(at: string) {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ko-KR', { dateStyle: 'medium', timeZone: 'Asia/Seoul' })
}

type GalleryProps = {
  templates: TemplateRow[]
  store: TemplateBlockStore
  selectedId?: string | null
  onSelect: (template: TemplateRow) => void
  // 카드 하단 액션(미리보기·이름 변경·삭제 등). 카드 선택 버튼과 별개 영역.
  renderActions?: (template: TemplateRow) => ReactNode
  // 이름 영역 교체(인라인 이름 변경용)
  renderTitle?: (template: TemplateRow) => ReactNode | undefined
  gridClassName?: string
}

export function TemplateGallery({
  templates,
  store,
  selectedId,
  onSelect,
  renderActions,
  renderTitle,
  gridClassName = 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4',
}: GalleryProps) {
  const mine = templates.filter((t) => !t.isSample)
  const provided = templates.filter((t) => t.isSample)
  const [tab, setTab] = useState<'mine' | 'provided'>(() =>
    mine.length > 0 || provided.length === 0 ? 'mine' : 'provided'
  )

  function renderGrid(list: TemplateRow[]) {
    return (
      <ul className={cn('grid gap-3', gridClassName)}>
        {list.map((t) => {
          const selected = selectedId === t.id
          return (
            <li
              key={t.id}
              className={cn(
                'group overflow-hidden rounded-lg border bg-card transition-shadow hover:shadow-md',
                selected && 'border-primary ring-2 ring-primary'
              )}
            >
              <button
                type="button"
                aria-pressed={selectedId === undefined ? undefined : selected}
                aria-label={t.name}
                onClick={() => onSelect(t)}
                className="relative block w-full text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <TemplateThumbnail store={store} template={t} />
                {t.isSample && (
                  <Badge variant="secondary" className="absolute top-2 left-2 font-normal">
                    워크덱 제공
                  </Badge>
                )}
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-foreground/0 opacity-0 transition group-hover:bg-foreground/10 group-hover:opacity-100">
                  <span className="rounded-full bg-background p-2 shadow">
                    <Eye className="size-4" />
                  </span>
                </span>
              </button>
              <div className="space-y-1 border-t px-3 py-2">
                <div className="min-w-0 truncate text-sm font-medium">
                  {renderTitle?.(t) ?? t.name}
                </div>
                <div className="text-xs text-muted-foreground">
                  블록 {t.blockCount}개 · {formatDate(t.updatedAt)}
                </div>
                {renderActions && (
                  <div className="flex flex-wrap items-center gap-1 pt-1">{renderActions(t)}</div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as 'mine' | 'provided')}>
      <TabsList>
        <TabsTrigger value="mine">내 템플릿 {mine.length}</TabsTrigger>
        <TabsTrigger value="provided">워크덱 제공 {provided.length}</TabsTrigger>
      </TabsList>
      <TabsContent value="mine">
        {mine.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              아직 저장한 템플릿이 없습니다. 공고 꾸미기에서 ‘템플릿으로 저장’하면 여기에 모입니다.
            </p>
            {provided.length > 0 && (
              <Button type="button" size="sm" variant="outline" onClick={() => setTab('provided')}>
                워크덱 제공 템플릿 보기
              </Button>
            )}
          </div>
        ) : (
          renderGrid(mine)
        )}
      </TabsContent>
      <TabsContent value="provided">
        {provided.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
            제공되는 템플릿이 없습니다.
          </p>
        ) : (
          renderGrid(provided)
        )}
      </TabsContent>
    </Tabs>
  )
}
