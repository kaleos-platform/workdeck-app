import { AiSettingsForm } from '@/components/settings/ai-settings-form'

export default function AiSettingsPage() {
  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">AI 설정</h1>
        <p className="text-sm text-muted-foreground">
          아이데이션·콘텐츠 생성·온보딩 초안 등 AI 기능이 어떤 모델을 쓸지 정합니다. 워크스페이스
          전체에 적용됩니다.
        </p>
      </header>
      <AiSettingsForm />
    </div>
  )
}
