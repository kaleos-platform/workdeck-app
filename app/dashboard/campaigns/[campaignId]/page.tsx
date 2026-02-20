'use client'

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { BarChart3, TrendingUp, DollarSign, MousePointerClick, Eye, Copy, CheckSquare } from 'lucide-react'
import { toast } from 'sonner'

type PageProps = {
  params: Promise<{ campaignId: string }>
}

// TODO: 실제 데이터 fetching으로 교체
const kpiCards = [
  { title: '총 광고비', value: '-', icon: DollarSign, color: 'text-orange-500' },
  { title: '평균 ROAS (14일)', value: '-', icon: TrendingUp, color: 'text-green-600' },
  { title: '총 클릭수', value: '-', icon: MousePointerClick, color: 'text-blue-600' },
  { title: '총 노출수', value: '-', icon: Eye, color: 'text-purple-600' },
]

export default function CampaignDetailPage({ params }: PageProps) {
  // 공통 필터 상태
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [adType, setAdType] = useState('all')

  // 키워드 분석 탭 상태
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([])

  // 비효율 키워드 복사
  function copySelectedKeywords() {
    if (selectedKeywords.length === 0) {
      toast.error('복사할 키워드를 선택해주세요')
      return
    }
    const text = selectedKeywords.join(', ')
    navigator.clipboard.writeText(text)
    toast.success(`${selectedKeywords.length}개 키워드가 클립보드에 복사되었습니다`)
  }

  return (
    <div className="space-y-6">
      {/* 페이지 헤더 */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">캠페인 상세</h1>
        {/* TODO: 실제 캠페인명으로 교체 */}
        <p className="text-gray-600 dark:text-gray-400 mt-1 text-sm">캠페인 데이터를 분석합니다</p>
      </div>

      {/* 공통 필터 영역 */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">기간</span>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-36"
              />
              <span className="text-gray-400">~</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-36"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">광고유형</span>
              <Select value={adType} onValueChange={setAdType}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  {/* TODO: 실제 광고유형 목록으로 교체 */}
                  <SelectItem value="keyword">키워드 광고</SelectItem>
                  <SelectItem value="display">상품 광고</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 탭 영역 */}
      <Tabs defaultValue="dashboard">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="dashboard">대시보드</TabsTrigger>
          <TabsTrigger value="addata">광고 데이터</TabsTrigger>
          <TabsTrigger value="keywords">키워드 분석</TabsTrigger>
        </TabsList>

        {/* 대시보드 탭 */}
        <TabsContent value="dashboard" className="space-y-6">
          {/* KPI 카드 */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {kpiCards.map((card) => {
              const Icon = card.icon
              return (
                <Card key={card.title}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
                    <Icon className={`h-4 w-4 ${card.color}`} />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{card.value}</div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* 차트 영역 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">성과 추이</CardTitle>
            </CardHeader>
            <CardContent className="h-72 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                {/* TODO: Recharts 시계열 차트로 교체 (F002) */}
                <p className="text-sm">데이터를 업로드하면 차트가 표시됩니다</p>
              </div>
            </CardContent>
          </Card>

          {/* 일자별 메모 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">일자별 메모</CardTitle>
            </CardHeader>
            <CardContent>
              {/* TODO: 일자별 메모 CRUD 구현 (F005) */}
              <p className="text-sm text-gray-500 text-center py-8">
                날짜를 선택하여 광고 작업 내용을 메모하세요
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 광고 데이터 탭 */}
        <TabsContent value="addata" className="space-y-4">
          <div className="flex justify-end">
            <Select defaultValue="25">
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10행</SelectItem>
                <SelectItem value="25">25행</SelectItem>
                <SelectItem value="50">50행</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>날짜</TableHead>
                    <TableHead>광고유형</TableHead>
                    <TableHead>키워드</TableHead>
                    <TableHead className="text-right">광고비</TableHead>
                    <TableHead className="text-right">클릭수</TableHead>
                    <TableHead className="text-right">노출수</TableHead>
                    <TableHead className="text-right">ROAS (14일)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* TODO: 실제 광고 데이터로 교체 (F004) */}
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-gray-500 text-sm">
                      데이터를 업로드하면 광고 데이터가 표시됩니다
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 키워드 분석 탭 */}
        <TabsContent value="keywords" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <CheckSquare className="h-4 w-4" />
              <span>광고비 지출 & 주문수 0인 비효율 키워드</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={copySelectedKeywords}
              disabled={selectedKeywords.length === 0}
            >
              <Copy className="h-4 w-4" />
              선택 키워드 복사 ({selectedKeywords.length})
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <input type="checkbox" className="rounded" />
                    </TableHead>
                    <TableHead>키워드</TableHead>
                    <TableHead className="text-right">광고비</TableHead>
                    <TableHead className="text-right">노출수</TableHead>
                    <TableHead className="text-right">클릭수</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* TODO: 비효율 키워드 데이터로 교체 (F003) */}
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-12 text-gray-500 text-sm">
                      데이터를 업로드하면 비효율 키워드가 표시됩니다
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
