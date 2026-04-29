'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type Channel = {
  id: string
  name: string
  isActive: boolean
}

export function ChannelManager() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)

  // 채널 다이얼로그 상태
  const [channelDialogOpen, setChannelDialogOpen] = useState(false)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [channelName, setChannelName] = useState('')
  const [channelIsActive, setChannelIsActive] = useState(true)
  const [savingChannel, setSavingChannel] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/inv/channels')
      if (!res.ok) throw new Error('채널 조회 실패')
      const data = await res.json()
      setChannels(data.channels ?? [])
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : '데이터 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ─── 채널 핸들러 ────────────────────────────────────────────────────────────
  function openNewChannel() {
    setEditingChannel(null)
    setChannelName('')
    setChannelIsActive(true)
    setChannelDialogOpen(true)
  }

  function openEditChannel(channel: Channel) {
    setEditingChannel(channel)
    setChannelName(channel.name)
    setChannelIsActive(channel.isActive)
    setChannelDialogOpen(true)
  }

  async function handleSaveChannel() {
    if (!channelName.trim()) {
      toast.error('채널 이름을 입력해 주세요')
      return
    }
    setSavingChannel(true)
    try {
      if (editingChannel) {
        const res = await fetch(`/api/inv/channels/${editingChannel.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: channelName.trim(),
            isActive: channelIsActive,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.message ?? '저장 실패')
        toast.success('채널이 수정되었습니다')
      } else {
        const res = await fetch('/api/inv/channels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: channelName.trim(),
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.message ?? '저장 실패')
        toast.success('채널이 생성되었습니다')
      }
      setChannelDialogOpen(false)
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSavingChannel(false)
    }
  }

  async function toggleChannelActive(channel: Channel) {
    try {
      const res = await fetch(`/api/inv/channels/${channel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !channel.isActive }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '상태 변경 실패')
      toast.success(!channel.isActive ? '활성화되었습니다' : '비활성화되었습니다')
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '상태 변경 실패')
    }
  }

  return (
    <div>
      {/* ─── 채널 패널 ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>판매 채널</CardTitle>
            <CardDescription>출고 이동에 사용할 판매 채널</CardDescription>
          </div>
          <Button size="sm" onClick={openNewChannel}>
            <Plus className="mr-1 h-4 w-4" />새 채널
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">불러오는 중...</p>
          ) : channels.length === 0 ? (
            <p className="text-sm text-muted-foreground">등록된 채널이 없습니다</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>채널명</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead className="text-right">액션</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {channels.map((channel) => (
                  <TableRow key={channel.id}>
                    <TableCell className="font-medium">{channel.name}</TableCell>
                    <TableCell>
                      {channel.isActive ? (
                        <Badge>활성</Badge>
                      ) : (
                        <Badge variant="outline">비활성</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditChannel(channel)}
                          aria-label="채널 수정"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleChannelActive(channel)}
                        >
                          {channel.isActive ? '비활성화' : '활성화'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ─── 채널 다이얼로그 ─────────────────────────────────────────────── */}
      <Dialog open={channelDialogOpen} onOpenChange={setChannelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingChannel ? '채널 수정' : '새 채널 만들기'}</DialogTitle>
            <DialogDescription>판매 채널 정보를 입력해 주세요</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="channel-name">채널명</Label>
              <Input
                id="channel-name"
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                placeholder="예: 쿠팡"
              />
            </div>
            {editingChannel && (
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <Label htmlFor="channel-active">활성 상태</Label>
                  <p className="text-xs text-muted-foreground">
                    비활성 채널은 새 이동에 사용할 수 없습니다
                  </p>
                </div>
                <Switch
                  id="channel-active"
                  checked={channelIsActive}
                  onCheckedChange={setChannelIsActive}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setChannelDialogOpen(false)}
              disabled={savingChannel}
            >
              취소
            </Button>
            <Button onClick={handleSaveChannel} disabled={savingChannel}>
              {savingChannel ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
