'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Copy, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export type VariantTab = { id: string; name: string }

type TabActions = {
  onSelect: (id: string) => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
  onDuplicate: (id: string) => void
}

/**
 * 가격 시뮬 옵션 조합(탭) 바 — 전환/추가/이름편집/복제/삭제/드래그 순서 변경.
 * 복제·삭제는 이름 옆 아이콘이 오클릭을 유발해 활성 탭의 ⋯ 메뉴로 묶었다.
 */
export function PricingVariantTabs({
  tabs,
  activeId,
  onAdd,
  onReorder,
  extra,
  ...actions
}: TabActions & {
  tabs: VariantTab[]
  activeId: string
  onAdd: () => void
  /** 드래그로 active 탭을 over 탭 자리로 이동 */
  onReorder: (activeId: string, overId: string) => void
  /** 탭 바 우측 추가 버튼 영역 */
  extra?: React.ReactNode
}) {
  // 탭 전체가 드래그 대상 — 5px 이동 후 활성이라 클릭(전환)과 충돌하지 않는다
  // SSR·클라 aria-describedby id 불일치(hydration 경고) 방지 — DndContext 기본 id는 전역 카운터
  const dndId = useId()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) onReorder(String(active.id), String(over.id))
  }

  return (
    <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
      {/* 표준 TabsList 룩 (bg-muted 트랙 + active는 bg-background/shadow-sm) — 인라인 편집·메뉴·드래그 때문에 커스텀 유지 */}
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
          <div className="inline-flex h-10 w-fit shrink-0 items-center gap-1 rounded-lg bg-muted p-1">
            {tabs.map((tab) => (
              <SortableVariantTab
                key={tab.id}
                tab={tab}
                active={tab.id === activeId}
                canRemove={tabs.length > 1}
                {...actions}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onAdd}
        className="h-8 shrink-0 gap-1 text-muted-foreground"
      >
        <Plus className="h-3.5 w-3.5" /> 새 조합
      </Button>
      {extra}
    </div>
  )
}

function SortableVariantTab({
  tab,
  active,
  canRemove,
  onSelect,
  onRename,
  onRemove,
  onDuplicate,
}: TabActions & { tab: VariantTab; active: boolean; canRemove: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // 편집 중엔 드래그 비활성 — 입력 중 Space/Enter가 KeyboardSensor 드래그를 시작하지 않도록
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({
    id: tab.id,
    disabled: editing,
  })

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const startEdit = () => {
    setDraft(tab.name)
    setEditing(true)
  }
  const commit = () => {
    onRename(tab.id, draft)
    setEditing(false)
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={cn(
        'relative flex h-full shrink-0 cursor-grab items-center gap-1.5 rounded-md border border-transparent pr-1.5 pl-3 text-sm font-medium active:cursor-grabbing',
        !active && 'pr-3',
        active
          ? 'bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30'
          : 'text-foreground/60 hover:text-foreground',
        isDragging && 'z-10 opacity-80 shadow-md'
      )}
    >
      {editing ? (
        <Input
          ref={inputRef}
          value={draft}
          maxLength={50}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
            }
          }}
          className="h-7 w-32 px-1.5 text-sm"
        />
      ) : (
        <button
          type="button"
          onClick={() => onSelect(tab.id)}
          onDoubleClick={startEdit}
          className="max-w-[160px] cursor-[inherit] truncate"
          title={`${tab.name} (더블클릭: 이름 변경 · 드래그: 순서 변경)`}
        >
          {tab.name}
        </button>
      )}
      {active && !editing && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${tab.name} 메뉴`}
              className="ml-1 flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          {/* 닫힐 때 트리거로 포커스 복귀를 막아야 이름 편집 Input이 즉시 blur(=commit)되지 않는다 */}
          <DropdownMenuContent align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
            <DropdownMenuItem onSelect={startEdit}>
              <Pencil /> 이름 변경
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDuplicate(tab.id)}>
              <Copy /> 복제
            </DropdownMenuItem>
            {canRemove && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => onRemove(tab.id)}>
                  <Trash2 /> 삭제
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
