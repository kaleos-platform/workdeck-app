'use client'

import { useEffect, useState } from 'react'
import { GripVertical, Plus } from 'lucide-react'
import { toast } from 'sonner'
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
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ChannelEditDialog } from '@/components/sh/channels/channel-edit-dialog'

type ChannelTypeDef = {
  id: string
  name: string
  isSalesChannel: boolean
  isSystem: boolean
  sortOrder: number
  channelCount: number
}

type ChannelWithCount = {
  id: string
  name: string
  externalSource: string | null
  listingCount: number
}

type Props = {
  selectedChannelId: string | null
  onSelectChannel: (id: string) => void
  onChannelsLoaded?: (channels: ChannelWithCount[]) => void
  refreshKey?: number
}

export function ChannelRail({
  selectedChannelId,
  onSelectChannel,
  onChannelsLoaded,
  refreshKey = 0,
}: Props) {
  const [channels, setChannels] = useState<ChannelWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [channelTypes, setChannelTypes] = useState<ChannelTypeDef[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [localRefresh, setLocalRefresh] = useState(0)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const [chRes, typeRes] = await Promise.all([
          fetch('/api/channels?isActive=true&isSalesChannel=true'),
          fetch('/api/channel-types'),
        ])
        if (!chRes.ok) throw new Error('채널 조회 실패')
        const data: {
          channels: Array<{ id: string; name: string; externalSource: string | null }>
        } = await chRes.json()
        if (typeRes.ok) {
          const td: { types: ChannelTypeDef[] } = await typeRes.json()
          if (!cancelled) setChannelTypes(td.types ?? [])
        }
        const channelsList = data.channels ?? []
        const counts = await Promise.all(
          channelsList.map(async (c) => {
            try {
              const r = await fetch(`/api/sh/products/listings?channelId=${c.id}&pageSize=1`)
              if (!r.ok) return 0
              const d: { total?: number } = await r.json()
              return d.total ?? 0
            } catch {
              return 0
            }
          })
        )
        const merged: ChannelWithCount[] = channelsList.map((c, idx) => ({
          ...c,
          listingCount: counts[idx] ?? 0,
        }))
        if (cancelled) return
        setChannels(merged)
        onChannelsLoaded?.(merged)
        if (!selectedChannelId && merged.length > 0) {
          onSelectChannel(merged[0].id)
        }
      } catch {
        if (!cancelled) setChannels([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, localRefresh])

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIdx = channels.findIndex((c) => c.id === active.id)
    const newIdx = channels.findIndex((c) => c.id === over.id)
    if (oldIdx < 0 || newIdx < 0) return

    const next = arrayMove(channels, oldIdx, newIdx)
    const previous = channels
    setChannels(next)

    try {
      const res = await fetch('/api/channels/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: next.map((c) => c.id) }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.message ?? '정렬 저장 실패')
      }
    } catch (err) {
      setChannels(previous)
      toast.error(err instanceof Error ? err.message : '정렬 저장 실패')
    }
  }

  const mobileSelect = (
    <div className="md:hidden">
      <Select value={selectedChannelId ?? ''} onValueChange={(v) => onSelectChannel(v)}>
        <SelectTrigger>
          <SelectValue placeholder="채널을 선택하세요" />
        </SelectTrigger>
        <SelectContent>
          {channels.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name} ({c.listingCount})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  return (
    <div>
      {mobileSelect}
      <div className="hidden md:block">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">채널</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />새 채널
          </Button>
        </div>
        {loading ? (
          <p className="px-2 text-sm text-muted-foreground">불러오는 중...</p>
        ) : channels.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">활성 채널이 없습니다</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={channels.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-1">
                {channels.map((c) => (
                  <SortableChannelItem
                    key={c.id}
                    channel={c}
                    isSelected={c.id === selectedChannelId}
                    onSelect={() => onSelectChannel(c.id)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>
      <ChannelEditDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        channel={null}
        channels={[]}
        channelTypes={channelTypes}
        onSaved={() => {
          setCreateOpen(false)
          setLocalRefresh((n) => n + 1)
        }}
        onTypesChanged={() => setLocalRefresh((n) => n + 1)}
      />
    </div>
  )
}

function SortableChannelItem({
  channel,
  isSelected,
  onSelect,
}: {
  channel: ChannelWithCount
  isSelected: boolean
  onSelect: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: channel.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <li ref={setNodeRef} style={style}>
      <div
        className={`flex items-center gap-1 rounded-md transition ${
          isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60'
        }`}
      >
        <button
          type="button"
          aria-label="순서 이동"
          className="cursor-grab px-1.5 py-2 text-muted-foreground hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onSelect}
          aria-current={isSelected ? 'true' : undefined}
          className={`flex flex-1 items-center justify-between py-2 pr-3 text-sm ${
            isSelected ? 'font-medium' : ''
          }`}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{channel.name}</span>
            {channel.externalSource != null && (
              <Badge variant="outline" className="shrink-0 text-[10px]">
                연동
              </Badge>
            )}
          </span>
          <Badge variant={isSelected ? 'default' : 'secondary'} className="ml-2 shrink-0">
            {channel.listingCount}
          </Badge>
        </button>
      </div>
    </li>
  )
}
