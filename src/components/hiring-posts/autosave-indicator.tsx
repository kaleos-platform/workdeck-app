type Status = 'idle' | 'saving' | 'saved'

export function AutoSaveIndicator({ status }: { status: Status }) {
  if (status === 'saving') {
    return <span className="text-xs text-muted-foreground">저장 중…</span>
  }
  if (status === 'saved') {
    return <span className="text-xs text-muted-foreground">자동 저장됨</span>
  }
  return null
}
