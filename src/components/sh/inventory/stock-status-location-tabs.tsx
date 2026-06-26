'use client'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { StockLocation } from './stock-status.types'

type Props = {
  locations: StockLocation[]
  selectedLocationId: string | null
  onLocationChange: (locationId: string | null) => void
}

const ALL_LOCATIONS = '__all__'

export function StockStatusLocationTabs({
  locations,
  selectedLocationId,
  onLocationChange,
}: Props) {
  return (
    <Tabs
      value={selectedLocationId ?? ALL_LOCATIONS}
      onValueChange={(value) => onLocationChange(value === ALL_LOCATIONS ? null : value)}
      className="w-full"
    >
      <TabsList className="h-auto max-w-full flex-wrap justify-start rounded-lg bg-muted/60 p-1">
        <TabsTrigger value={ALL_LOCATIONS} className="h-8 px-3 text-xs">
          전체 위치
        </TabsTrigger>
        {locations.map((location) => (
          <TabsTrigger key={location.id} value={location.id} className="h-8 px-3 text-xs">
            {location.name}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
