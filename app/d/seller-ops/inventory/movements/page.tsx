'use client'

import { useState } from 'react'
import { MovementForm } from '@/components/sh/inventory/movement-form'
import { MovementHistory } from '@/components/sh/inventory/movement-history'
import { ImportDialog } from '@/components/sh/inventory/import-dialog'

export default function MovementsPage() {
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">입출고 관리</h1>
        <div className="flex items-center gap-2">
          <ImportDialog onImported={() => setRefreshKey((k) => k + 1)} />
          <MovementForm onCreated={() => setRefreshKey((k) => k + 1)} />
        </div>
      </div>
      <MovementHistory key={refreshKey} />
    </div>
  )
}
