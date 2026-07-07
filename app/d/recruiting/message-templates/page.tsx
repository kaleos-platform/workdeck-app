// 알림 메시지 템플릿 관리(server wrapper) — 인증은 deck 레이아웃에서 강제.
import { TemplatesManager } from '@/components/hiring-applicants/templates-manager'

export default function MessageTemplatesPage() {
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">메시지 템플릿</h1>
        <p className="text-sm text-muted-foreground">
          자주 쓰는 안내 문구를 저장해 상태 알림 발송 시 빠르게 채워 넣습니다.
        </p>
      </div>
      <TemplatesManager />
    </div>
  )
}
