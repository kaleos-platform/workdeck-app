'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

type FeeRate = {
  id: string
  categoryName: string
  ratePercent: number
  vatIncluded: boolean
}

type ChannelWithFees = {
  id: string
  name: string
  isActive: boolean
  feeRates: FeeRate[]
}

export function ChannelFeesBulk() {
  const [channels, setChannels] = useState<ChannelWithFees[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/channels')
      if (!res.ok) throw new Error('채널 조회 실패')
      const data = await res.json()
      const channelList: ChannelWithFees[] = data.channels ?? []

      // 각 채널의 수수료율 병렬 로드
      const withFees = await Promise.all(
        channelList.map(async (ch) => {
          try {
            const feeRes = await fetch(`/api/channels/${ch.id}/fee-rates`)
            if (feeRes.ok) {
              const feeData = await feeRes.json()
              return { ...ch, feeRates: feeData.feeRates ?? [] }
            }
          } catch {
            // 수수료 조회 실패 시 빈 배열
          }
          return { ...ch, feeRates: [] }
        })
      )
      setChannels(withFees)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // 모든 카테고리명 수집 (중복 제거)
  const allCategories = Array.from(
    new Set(channels.flatMap((ch) => ch.feeRates.map((f) => f.categoryName)))
  ).sort()

  return (
    <Card>
      <CardHeader>
        <CardTitle>전체 채널 수수료 현황</CardTitle>
        <CardDescription>
          모든 채널의 카테고리별 수수료율을 한눈에 확인합니다. 수수료 수정은 각 채널 상세 페이지에서
          진행하세요.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        ) : channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">등록된 채널이 없습니다</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[120px]">채널</TableHead>
                  <TableHead>상태</TableHead>
                  {allCategories.map((cat) => (
                    <TableHead key={cat} className="min-w-[100px] text-right">
                      {cat}
                    </TableHead>
                  ))}
                  {allCategories.length === 0 && <TableHead>수수료율</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {channels.map((ch) => {
                  const feeMap: Record<string, FeeRate> = {}
                  ch.feeRates.forEach((f) => {
                    feeMap[f.categoryName] = f
                  })
                  return (
                    <TableRow key={ch.id}>
                      <TableCell className="font-medium">{ch.name}</TableCell>
                      <TableCell>
                        <Badge variant={ch.isActive ? 'default' : 'outline'}>
                          {ch.isActive ? '활성' : '비활성'}
                        </Badge>
                      </TableCell>
                      {allCategories.map((cat) => {
                        const fee = feeMap[cat]
                        return (
                          <TableCell key={cat} className="text-right tabular-nums">
                            {fee ? (
                              <span>
                                {fee.ratePercent.toFixed(3)}%
                                {fee.vatIncluded && (
                                  <span className="ml-1 text-xs text-muted-foreground">
                                    (VAT포함)
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        )
                      })}
                      {allCategories.length === 0 && (
                        <TableCell className="text-sm text-muted-foreground">
                          수수료율 없음
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
