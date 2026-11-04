'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

const PlanCanvas = dynamic(() => import('./plan-canvas').then((m) => m.PlanCanvas), { ssr: false })

type Props = { task: string; screens: string[]; notes: string }

export function PlanReview({ task, screens, notes }: Props) {
  const [screen, setScreen] = useState(screens[0])
  return (
    <main className="flex h-dvh flex-col bg-background">
      <header className="flex items-center gap-2 overflow-x-auto border-b px-3 py-2">
        <h1 className="mr-2 shrink-0 text-sm font-semibold">{task}</h1>
        {screens.map((name) => (
          <Button
            key={name}
            size="sm"
            variant={name === screen ? 'default' : 'outline'}
            onClick={() => setScreen(name)}
          >
            {name}
          </Button>
        ))}
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="min-h-0 flex-1">
          <PlanCanvas key={screen} task={task} screen={screen} />
        </div>
        {notes && (
          <aside className="max-h-48 overflow-y-auto border-t p-4 text-sm whitespace-pre-wrap md:max-h-none md:w-80 md:border-t-0 md:border-l">
            {notes}
          </aside>
        )}
      </div>
    </main>
  )
}
