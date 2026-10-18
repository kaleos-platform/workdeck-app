import { hasRole, type Role } from '@/lib/auth/roles'

const LABEL: Record<Role, string> = {
  OWNER: 'Space 소유자(OWNER)',
  ADMIN: 'ADMIN 이상',
  MEMBER: '구성원',
}

/** 설정 페이지 역할 게이트 — 권한이 없으면 403 오류 화면 대신 안내를 보여 준다(서버가 계속 판정한다). */
export function RoleRequired({
  role,
  min,
  children,
}: {
  role: Role
  min: Role
  children: React.ReactNode
}) {
  if (hasRole(role, min)) return <>{children}</>
  return (
    <p className="rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      이 설정은 {LABEL[min]}만 볼 수 있습니다. 필요하면 Space 소유자에게 요청하세요.
    </p>
  )
}
