import { SettingsTabs } from '@/components/hiring-posts/settings-tabs'

// 모집 관리 설정 — 제목 + 매장/직무 탭. 접근 검사는 상위 recruiting 레이아웃과 각 페이지가 수행한다.
export default function RecruitingSettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">설정</h1>
      <SettingsTabs />
      {children}
    </div>
  )
}
