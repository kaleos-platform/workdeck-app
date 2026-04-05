'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'
import type { SafetyLimits } from '@/types/execution'

export function SafetyLimitsForm() {
  const [limits, setLimits] = useState<SafetyLimits>({
    id: '',
    maxBidChangePct: 30,
    maxKeywordsPerBatch: 50,
    maxBudgetChangePct: 20,
    requireApproval: true,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/execution/limits')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SafetyLimits | null) => {
        if (data) setLimits(data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await fetch('/api/execution/limits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(limits),
      })
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>안전 제한 설정</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="maxBidChangePct">최대 입찰가 변경% ({limits.maxBidChangePct}%)</Label>
          </div>
          <Input
            id="maxBidChangePct"
            type="range"
            min={0}
            max={100}
            value={limits.maxBidChangePct}
            onChange={(e) =>
              setLimits((prev) => ({
                ...prev,
                maxBidChangePct: Number(e.target.value),
              }))
            }
            className="h-2 cursor-pointer"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0%</span>
            <span>100%</span>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="maxKeywordsPerBatch">배치당 최대 키워드 수</Label>
          <Input
            id="maxKeywordsPerBatch"
            type="number"
            min={1}
            value={limits.maxKeywordsPerBatch}
            onChange={(e) =>
              setLimits((prev) => ({
                ...prev,
                maxKeywordsPerBatch: Number(e.target.value),
              }))
            }
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="maxBudgetChangePct">최대 예산 변경% ({limits.maxBudgetChangePct}%)</Label>
          </div>
          <Input
            id="maxBudgetChangePct"
            type="range"
            min={0}
            max={100}
            value={limits.maxBudgetChangePct}
            onChange={(e) =>
              setLimits((prev) => ({
                ...prev,
                maxBudgetChangePct: Number(e.target.value),
              }))
            }
            className="h-2 cursor-pointer"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0%</span>
            <span>100%</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="requireApproval">승인 필수 여부</Label>
            <p className="text-xs text-muted-foreground">
              활성화하면 모든 실행 작업에 수동 승인이 필요합니다.
            </p>
          </div>
          <Switch
            id="requireApproval"
            checked={limits.requireApproval}
            onCheckedChange={(checked) =>
              setLimits((prev) => ({
                ...prev,
                requireApproval: checked as boolean,
              }))
            }
          />
        </div>

        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          저장
        </Button>
      </CardContent>
    </Card>
  )
}
