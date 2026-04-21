'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2 } from 'lucide-react'

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type ChannelGroup = {
  id: string
  name: string
  channelCount: number
}

type Channel = {
  id: string
  name: string
  groupId: string | null
  isActive: boolean
  group: { id: string; name: string } | null
}

const NO_GROUP_VALUE = '__none__'

export function ChannelManager() {
  const [groups, setGroups] = useState<ChannelGroup[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)

  // Group dialog state
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<ChannelGroup | null>(null)
  const [groupName, setGroupName] = useState('')
  const [savingGroup, setSavingGroup] = useState(false)

  // Channel dialog state
  const [channelDialogOpen, setChannelDialogOpen] = useState(false)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [channelName, setChannelName] = useState('')
  const [channelGroupId, setChannelGroupId] = useState<string>(NO_GROUP_VALUE)
  const [channelIsActive, setChannelIsActive] = useState(true)
  const [savingChannel, setSavingChannel] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [gRes, cRes] = await Promise.all([
        fetch('/api/inv/channel-groups'),
        fetch('/api/inv/channels'),
      ])
      if (!gRes.ok) throw new Error('그룹 조회 실패')
      if (!cRes.ok) throw new Error('채널 조회 실패')
      const gData = await gRes.json()
      const cData = await cRes.json()
      setGroups(gData.groups ?? [])
      setChannels(cData.channels ?? [])
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

  // ─── Group handlers ──────────────────────────────────────────────────────
  function openNewGroup() {
    setEditingGroup(null)
    setGroupName('')
    setGroupDialogOpen(true)
  }

  function openEditGroup(group: ChannelGroup) {
    setEditingGroup(group)
    setGroupName(group.name)
    setGroupDialogOpen(true)
  }

  async function handleSaveGroup() {
    if (!groupName.trim()) {
      toast.error('그룹 이름을 입력해 주세요')
      return
    }
    setSavingGroup(true)
    try {
      const url = editingGroup
        ? `/api/inv/channel-groups/${editingGroup.id}`
        : '/api/inv/channel-groups'
      const method = editingGroup ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: groupName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '저장 실패')
      toast.success(editingGroup ? '그룹이 수정되었습니다' : '그룹이 생성되었습니다')
      setGroupDialogOpen(false)
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSavingGroup(false)
    }
  }

  async function handleDeleteGroup(group: ChannelGroup) {
    if (!confirm(`"${group.name}" 그룹을 삭제하시겠습니까?`)) return
    try {
      const res = await fetch(`/api/inv/channel-groups/${group.id}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '삭제 실패')
      toast.success('그룹이 삭제되었습니다')
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  // ─── Channel handlers ────────────────────────────────────────────────────
  function openNewChannel() {
    setEditingChannel(null)
    setChannelName('')
    setChannelGroupId(NO_GROUP_VALUE)
    setChannelIsActive(true)
    setChannelDialogOpen(true)
  }

  function openEditChannel(channel: Channel) {
    setEditingChannel(channel)
    setChannelName(channel.name)
    setChannelGroupId(channel.groupId ?? NO_GROUP_VALUE)
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
      const groupIdValue = channelGroupId === NO_GROUP_VALUE ? null : channelGroupId

      if (editingChannel) {
        const res = await fetch(`/api/inv/channels/${editingChannel.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: channelName.trim(),
            groupId: groupIdValue,
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
            groupId: groupIdValue ?? undefined,
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
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      {/* ─── 그룹 패널 ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>채널 그룹</CardTitle>
            <CardDescription>채널을 묶어 분류합니다</CardDescription>
          </div>
          <Button size="sm" onClick={openNewGroup}>
            <Plus className="mr-1 h-4 w-4" />새 그룹
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">불러오는 중...</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">등록된 그룹이 없습니다</p>
          ) : (
            <ul className="space-y-2">
              {groups.map((group) => (
                <li
                  key={group.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div>
                    <p className="font-medium">{group.name}</p>
                    <p className="text-xs text-muted-foreground">채널 {group.channelCount}개</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditGroup(group)}
                      aria-label="그룹 수정"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteGroup(group)}
                      aria-label="그룹 삭제"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

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
                  <TableHead>그룹</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead className="text-right">액션</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {channels.map((channel) => (
                  <TableRow key={channel.id}>
                    <TableCell className="font-medium">{channel.name}</TableCell>
                    <TableCell>
                      {channel.group ? (
                        <Badge variant="secondary">{channel.group.name}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
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

      {/* ─── 그룹 다이얼로그 ─────────────────────────────────────────────── */}
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingGroup ? '그룹 수정' : '새 그룹 만들기'}</DialogTitle>
            <DialogDescription>채널 그룹 이름을 입력해 주세요</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="group-name">그룹명</Label>
            <Input
              id="group-name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="예: 온라인몰"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setGroupDialogOpen(false)}
              disabled={savingGroup}
            >
              취소
            </Button>
            <Button onClick={handleSaveGroup} disabled={savingGroup}>
              {savingGroup ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <div className="space-y-2">
              <Label>그룹 (선택)</Label>
              <Select value={channelGroupId} onValueChange={setChannelGroupId}>
                <SelectTrigger>
                  <SelectValue placeholder="그룹 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_GROUP_VALUE}>그룹 없음</SelectItem>
                  {groups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
