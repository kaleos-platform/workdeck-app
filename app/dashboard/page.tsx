'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { BarChart3, DollarSign, Users, TrendingUp } from 'lucide-react'

const stats = [
  {
    title: '총 매출',
    value: '₩1,234,567',
    description: '+12.5% 전월 대비',
    icon: DollarSign,
    color: 'text-green-600',
  },
  {
    title: '활성 사용자',
    value: '2,543',
    description: '+8.2% 전월 대비',
    icon: Users,
    color: 'text-blue-600',
  },
  {
    title: '전환율',
    value: '3.42%',
    description: '+0.5% 전월 대비',
    icon: TrendingUp,
    color: 'text-purple-600',
  },
  {
    title: '월간 매출',
    value: '₩5,678,900',
    description: '+23.1% 전월 대비',
    icon: BarChart3,
    color: 'text-orange-600',
  },
]

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      {/* 환영 메시지 */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">대시보드에 오신 것을 환영합니다! 👋</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          비즈니스의 성과를 한눈에 파악할 수 있습니다.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
                <Icon className={`h-4 w-4 ${stat.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  {stat.description}
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* 메인 컨텐츠 영역 */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* 차트 영역 (추후 Recharts로 업데이트 예정) */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>매출 추이</CardTitle>
            <CardDescription>최근 30일 일일 매출</CardDescription>
          </CardHeader>
          <CardContent className="h-72 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>차트 데이터 준비 중...</p>
            </div>
          </CardContent>
        </Card>

        {/* 최근 활동 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">최근 활동</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { user: '김철수', action: '가입', time: '2시간 전' },
                { user: '이영희', action: '업그레이드', time: '4시간 전' },
                { user: '박민준', action: '구독 취소', time: '1일 전' },
              ].map((item, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium">{item.user}</p>
                    <p className="text-gray-500 text-xs">{item.action}</p>
                  </div>
                  <p className="text-gray-500 text-xs">{item.time}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 빠른 작업 */}
      <Card>
        <CardHeader>
          <CardTitle>빠른 작업</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline">새로운 회원 초대</Button>
            <Button variant="outline">리포트 생성</Button>
            <Button variant="outline">설정</Button>
            <Button variant="outline">도움말</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
