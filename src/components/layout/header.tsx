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
import { Moon, Sun, LogOut, LayoutGrid, BarChart2, ShoppingBag, Sparkles } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useAuth } from '@/hooks/use-auth'
import {
  COUPANG_ADS_BASE_PATH,
  SELLER_HUB_BASE_PATH,
  SALES_CONTENT_BASE_PATH,
} from '@/lib/deck-routes'

type HeaderVariant = 'workdeck' | 'coupang-ads' | 'seller-hub' | 'sales-content'

type HeaderProps = {
  variant?: HeaderVariant
}

export function Header({ variant = 'workdeck' }: HeaderProps) {
  const { theme, setTheme } = useTheme()
  const { user, signOut } = useAuth()

  if (!user) return null

  const initials = user.email?.charAt(0).toUpperCase() || '?'
  const isCoupangDeck = variant === 'coupang-ads'
  const isSellerHubDeck = variant === 'seller-hub'
  const isSalesContentDeck = variant === 'sales-content'
  const isDeckVariant = isCoupangDeck || isSellerHubDeck || isSalesContentDeck
  const brandHref = isCoupangDeck
    ? COUPANG_ADS_BASE_PATH
    : isSellerHubDeck
      ? SELLER_HUB_BASE_PATH
      : isSalesContentDeck
        ? SALES_CONTENT_BASE_PATH
        : '/my-deck'
  const brandName = isCoupangDeck
    ? '쿠팡 광고 관리자'
    : isSellerHubDeck
      ? '브랜드 운영'
      : isSalesContentDeck
        ? '세일즈 콘텐츠'
        : 'Workdeck'
  const BrandIcon = isCoupangDeck
    ? BarChart2
    : isSellerHubDeck
      ? ShoppingBag
      : isSalesContentDeck
        ? Sparkles
        : LayoutGrid

  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center justify-between px-4">
        <Link
          href={brandHref}
          aria-label={`${brandName} 홈으로 이동`}
          className="flex items-center gap-2"
        >
          <div
            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md ${
              isCoupangDeck
                ? 'bg-gradient-to-br from-orange-500 to-red-600'
                : isSellerHubDeck
                  ? 'bg-gradient-to-br from-violet-500 to-purple-700'
                  : isSalesContentDeck
                    ? 'bg-gradient-to-br from-fuchsia-500 to-indigo-600'
                    : 'bg-gradient-to-br from-blue-600 to-cyan-500'
            }`}
          >
            <BrandIcon className="h-5 w-5 text-white" />
          </div>
          <span className="text-sm leading-tight font-bold sm:text-base">{brandName}</span>
        </Link>

        <div className="flex items-center gap-2">
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
      </div>
    </header>
  )
}
