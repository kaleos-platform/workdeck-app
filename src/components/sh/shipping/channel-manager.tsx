'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  groupId: string
  type: 'OUTBOUND' | 'TRANSFER'
  isActive: boolean
  requireOrderNumber: boolean
  requirePayment: boolean
  requireProducts: boolean
  group: { id: string; name: string } | null
}

const NO_GROUP_VALUE = '__none__'

export function DelChannelManager() {
  const [groups, setGroups] = useState<ChannelGroup[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'OUTBOUND' | 'TRANSFER'>('ALL')

  // 그룹 다이얼로그
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<ChannelGroup | null>(null)
  const [groupName, setGroupName] = useState('')
  const [savingGroup, setSavingGroup] = useState(false)

  // 채널 다이얼로그
  const [channelDialogOpen, setChannelDialogOpen] = useState(false)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [channelName, setChannelName] = useState('')
  const [channelGroupId, setChannelGroupId] = useState<string>(NO_GROUP_VALUE)
  const [channelType, setChannelType] = useState<'OUTBOUND' | 'TRANSFER'>('OUTBOUND')
  const [channelIsActive, setChannelIsActive] = useState(true)
  const [requireOrderNumber, setRequireOrderNumber] = useState(true)
  const [requirePayment, setRequirePayment] = useState(true)
  const [requireProducts, setRequireProducts] = useState(true)
  const [savingChannel, setSavingChannel] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [gRes, cRes] = await Promise.all([
        fetch('/api/del/channel-groups'),
        fetch('/api/del/channels'),
      ])
      if (!gRes.ok) throw new Error('그룹 조회 실패')
      if (!cRes.ok) throw new Error('채널 조회 실패')
      const gData = await gRes.json()
      const cData = await cRes.json()
      setGroups(gData.groups ?? [])
      setChannels(cData.channels ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '데이터 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 필터링
  const filteredChannels = channels.filter((c) => {
    const matchesGroup = !selectedGroupId || c.groupId === selectedGroupId
    const matchesType = typeFilter === 'ALL' || c.type === typeFilter
    return matchesGroup && matchesType
  })

  const totalChannelCount = channels.length

  // ─── 그룹 핸들러 ──────────────────────────────────────────────────
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
        ? `/api/del/channel-groups/${editingGroup.id}`
        : '/api/del/channel-groups'
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
    if (groups.length <= 1) {
      toast.error('마지막 그룹은 삭제할 수 없습니다')
      return
    }
    if (!confirm(`"${group.name}" 그룹을 삭제하시겠습니까?`)) return
    try {
      const res = await fetch(`/api/del/channel-groups/${group.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message ?? '삭제 실패')
      }
      toast.success('그룹이 삭제되었습니다')
      if (selectedGroupId === group.id) {
        setSelectedGroupId(null)
      }
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  // ─── 채널 핸들러 ──────────────────────────────────────────────────
  function openNewChannel() {
    setEditingChannel(null)
    setChannelName('')
    setChannelGroupId(NO_GROUP_VALUE)
    setChannelType('OUTBOUND')
    setChannelIsActive(true)
    setRequireOrderNumber(true)
    setRequirePayment(true)
    setRequireProducts(true)
    setChannelDialogOpen(true)
  }

  function openEditChannel(channel: Channel) {
    setEditingChannel(channel)
    setChannelName(channel.name)
    setChannelGroupId(channel.groupId ?? NO_GROUP_VALUE)
    setChannelType(channel.type)
    setChannelIsActive(channel.isActive)
    setRequireOrderNumber(channel.requireOrderNumber)
    setRequirePayment(channel.requirePayment)
    setRequireProducts(channel.requireProducts)
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
      const payload = {
        name: channelName.trim(),
        groupId: groupIdValue,
        type: channelType,
        isActive: channelIsActive,
        requireOrderNumber,
        requirePayment,
        requireProducts,
      }

      const url = editingChannel ? `/api/del/channels/${editingChannel.id}` : '/api/del/channels'
      const method = editingChannel ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? '저장 실패')
      toast.success(editingChannel ? '채널이 수정되었습니다' : '채널이 생성되었습니다')
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
      const res = await fetch(`/api/del/channels/${channel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !channel.isActive }),
      })
      if (!res.ok) throw new Error('상태 변경 실패')
      toast.success(!channel.isActive ? '활성화되었습니다' : '비활성화되었습니다')
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '상태 변경 실패')
    }
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* 왼쪽: 그룹 패널 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>채널 그룹</CardTitle>
            <Button size="sm" onClick={openNewGroup}>
              <Plus className="mr-1 h-4 w-4" />새 그룹
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">불러오는 중...</p>
            ) : (
              <ul className="space-y-1">
                {/* 전체 항목 */}
                <li
                  className={cn(
                    'flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 transition-colors',
                    selectedGroupId === null
                      ? 'border-primary/20 bg-primary/10'
                      : 'hover:bg-muted/50'
                  )}
                  onClick={() => setSelectedGroupId(null)}
                >
                  <div>
                    <p className="font-medium">전체</p>
                    <p className="text-xs text-muted-foreground">채널 {totalChannelCount}개</p>
                  </div>
                </li>

                {/* 그룹 목록 */}
                {groups.map((group) => (
                  <li
                    key={group.id}
                    className={cn(
                      'flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 transition-colors',
                      selectedGroupId === group.id
                        ? 'border-primary/20 bg-primary/10'
                        : 'hover:bg-muted/50'
                    )}
                    onClick={() => setSelectedGroupId(group.id)}
                  >
                    <div>
                      <p className="font-medium">{group.name}</p>
                      <p className="text-xs text-muted-foreground">채널 {group.channelCount}개</p>
                    </div>
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditGroup(group)}
                        aria-label="그룹 수정"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {groups.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteGroup(group)}
                          aria-label="그룹 삭제"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* 오른쪽: 채널 패널 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-3">
              <CardTitle>판매 채널</CardTitle>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant={typeFilter === 'ALL' ? 'default' : 'outline'}
                  onClick={() => setTypeFilter('ALL')}
                >
                  전체
                </Button>
                <Button
                  size="sm"
                  variant={typeFilter === 'OUTBOUND' ? 'default' : 'outline'}
                  onClick={() => setTypeFilter('OUTBOUND')}
                >
                  출고
                </Button>
                <Button
                  size="sm"
                  variant={typeFilter === 'TRANSFER' ? 'default' : 'outline'}
                  onClick={() => setTypeFilter('TRANSFER')}
                >
                  재고이동
                </Button>
              </div>
            </div>
            <Button size="sm" onClick={openNewChannel}>
              <Plus className="mr-1 h-4 w-4" />새 채널
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">불러오는 중...</p>
            ) : filteredChannels.length === 0 ? (
              <p className="text-sm text-muted-foreground">등록된 채널이 없습니다</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>채널명</TableHead>
                    <TableHead>구분</TableHead>
                    <TableHead>필수필드</TableHead>
                    <TableHead>활성</TableHead>
                    <TableHead>수정</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredChannels.map((channel) => (
                    <TableRow key={channel.id}>
                      <TableCell className="font-medium">{channel.name}</TableCell>
                      <TableCell>
                        {channel.type === 'OUTBOUND' ? (
                          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                            출고
                          </Badge>
                        ) : (
                          <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">
                            재고이동
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {channel.requireOrderNumber && (
                            <Badge variant="outline" className="text-xs">
                              주문번호
                            </Badge>
                          )}
                          {channel.requirePayment && (
                            <Badge variant="outline" className="text-xs">
                              결제금액
                            </Badge>
                          )}
                          {channel.requireProducts && (
                            <Badge variant="outline" className="text-xs">
                              배송상품
                            </Badge>
                          )}
                          {!channel.requireOrderNumber &&
                            !channel.requirePayment &&
                            !channel.requireProducts && (
                              <span className="text-xs text-muted-foreground">없음</span>
                            )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={channel.isActive}
                          onCheckedChange={() => toggleChannelActive(channel)}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditChannel(channel)}
                          aria-label="채널 수정"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 그룹 다이얼로그 */}
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingGroup ? '그룹 수정' : '새 그룹 만들기'}</DialogTitle>
            <DialogDescription>채널 그룹 이름을 입력해 주세요</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="del-group-name">그룹명</Label>
            <Input
              id="del-group-name"
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

      {/* 채널 다이얼로그 */}
      <Dialog open={channelDialogOpen} onOpenChange={setChannelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingChannel ? '채널 수정' : '새 채널 만들기'}</DialogTitle>
            <DialogDescription>판매 채널 정보를 입력해 주세요</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="del-channel-name">채널명</Label>
              <Input
                id="del-channel-name"
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                placeholder="예: 쿠팡"
              />
            </div>

            <div className="space-y-2">
              <Label>구분</Label>
              <Select
                value={channelType}
                onValueChange={(v) => setChannelType(v as 'OUTBOUND' | 'TRANSFER')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="구분 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OUTBOUND">출고</SelectItem>
                  <SelectItem value="TRANSFER">재고이동</SelectItem>
                </SelectContent>
              </Select>
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

            {/* 필수 필드 설정 */}
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">배송 등록 시 필수 입력 항목</p>
              <div className="flex items-center justify-between">
                <Label htmlFor="req-order-no">주문번호</Label>
                <Switch
                  id="req-order-no"
                  checked={requireOrderNumber}
                  onCheckedChange={setRequireOrderNumber}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="req-payment">결제금액</Label>
                <Switch
                  id="req-payment"
                  checked={requirePayment}
                  onCheckedChange={setRequirePayment}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="req-products">배송상품</Label>
                <Switch
                  id="req-products"
                  checked={requireProducts}
                  onCheckedChange={setRequireProducts}
                />
              </div>
            </div>

            {editingChannel && (
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <Label htmlFor="del-channel-active">활성 상태</Label>
                  <p className="text-xs text-muted-foreground">
                    비활성 채널은 배송 등록에 사용할 수 없습니다
                  </p>
                </div>
                <Switch
                  id="del-channel-active"
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
    </>
  )
}
