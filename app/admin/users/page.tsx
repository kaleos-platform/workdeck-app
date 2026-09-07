import { UsersTable } from '@/components/admin/users-table'

export default function AdminUsersPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">사용자</h1>
        <p className="text-sm text-muted-foreground">전체 사용자 검색 및 계정 관리</p>
      </div>
      <UsersTable />
    </div>
  )
}
