'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Sidebar, type SidebarProps } from './sidebar'

type Props = Omit<SidebarProps, 'mobile'>

export function MobileNavigation(props: Props) {
  const pathname = usePathname()
  return <NavigationPanel key={pathname} {...props} />
}

function NavigationPanel(props: Props) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(min-width: 768px)')
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false)
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return (
    <div className="pl-3 md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label="메뉴 열기">
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="w-72 max-w-[85vw] gap-0 border-0 bg-slate-900 p-0 [&>button:last-child]:text-white"
          onClickCapture={(event) => {
            if ((event.target as HTMLElement).closest('a[href]')) setOpen(false)
          }}
        >
          <SheetTitle className="sr-only">메뉴</SheetTitle>
          <SheetDescription className="sr-only">다른 화면으로 이동합니다.</SheetDescription>
          <Sidebar {...props} mobile />
        </SheetContent>
      </Sheet>
    </div>
  )
}
