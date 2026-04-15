'use client'

import { useState } from 'react'
import { MovementForm } from '@/components/inv/movement-form'
import { MovementHistory } from '@/components/inv/movement-history'
import { ImportDialog } from '@/components/inv/import-dialog'

export default function MovementsPage() {
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">입출고 관리</h1>
        <div className="flex items-center gap-2">
          <ImportDialog onImported={() => setRefreshKey((k) => k + 1)} />
          <MovementForm onCreated={() => setRefreshKey((k) => k + 1)} />
        </div>
      </div>
      <MovementHistory key={refreshKey} />
    </div>
  )
}
