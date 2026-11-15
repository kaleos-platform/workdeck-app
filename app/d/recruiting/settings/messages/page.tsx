import { TemplatesManager } from '@/components/hiring-applicants/templates-manager'

// 자주 쓰는 메시지 관리 — 인증은 deck 레이아웃에서 강제.
export default function MessagesSettingsPage() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        지원자에게 문자·상태 알림으로 보낼 안내 문구를 저장합니다.
      </p>
      <TemplatesManager />
    </div>
  )
}
