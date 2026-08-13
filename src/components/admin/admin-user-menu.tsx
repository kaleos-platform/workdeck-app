'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronDown, LogOut, UserCog } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// 헤더 우측 운영자 메뉴. 계정 설정은 기능 네비(사용자·결제·템플릿)와 성격이 달라
// nav 에 섞지 않고 여기로 모은다. 로그아웃도 어드민엔 진입점이 없었으므로 함께 제공한다.
export function AdminUserMenu({ email }: { email: string }) {
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 px-2" aria-label="계정 메뉴 열기">
          <span className="max-w-[180px] truncate text-xs text-muted-foreground">{email}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="flex flex-col gap-1 p-2">
          <p className="text-xs text-muted-foreground">로그인 계정</p>
          <p className="truncate text-sm font-medium">{email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="cursor-pointer">
          <Link href="/admin/account">
            <UserCog className="mr-2 size-4" aria-hidden="true" />
            계정 설정
          </Link>
        </DropdownMenuItem>
        {/* 로그아웃은 일반 항목과 구분선으로 분리 — 실수로 누르는 것을 줄인다. */}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer">
          <LogOut className="mr-2 size-4" aria-hidden="true" />
          로그아웃
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
