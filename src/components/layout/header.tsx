'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Moon, Sun, LogOut } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useAuth } from '@/hooks/use-auth'
import type { DeckVariant } from '@/lib/deck-meta'

type HeaderProps = {
  variant?: DeckVariant
}

export function Header({ variant = 'workdeck' }: HeaderProps) {
  const { theme, setTheme } = useTheme()
  const { user, signOut } = useAuth()

  if (!user) return null

  const initials = user.email?.charAt(0).toUpperCase() || '?'
  const isSalesContentDeck = variant === 'sales-content'
  // 로고는 사이드바로 이동했으므로 헤더는 우측 액션만 노출.
  // 자기 deck(workdeck)이 아닌 경우에만 My Deck로 돌아가는 버튼을 보인다.
  const isDeckVariant = variant !== 'workdeck'

  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div
        className={`flex items-center justify-end gap-2 px-4 ${isSalesContentDeck ? 'h-12' : 'h-14'}`}
      >
        {isDeckVariant && (
          <Button asChild variant="outline" size="sm" className="h-8">
            <Link href="/my-deck">My Deck</Link>
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label="테마 전환"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 rounded-full p-0">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-gradient-to-br from-blue-600 to-cyan-500 text-white">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="flex flex-col space-y-1 p-2">
              <p className="text-sm leading-none font-medium">
                {user.user_metadata?.name || '사용자'}
              </p>
              <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem>프로필</DropdownMenuItem>
            <DropdownMenuItem>설정</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut} className="cursor-pointer">
              <LogOut className="mr-2 h-4 w-4" />
              로그아웃
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
