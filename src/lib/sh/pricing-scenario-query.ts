import { parseSnapshot } from '@/lib/sh/pricing-scenario-snapshot'

export type PricingScenarioTarget = {
  productIds: string[]
  channelId: string
}

export type PricingScenarioMatchInput = {
  scenarioProductIds: string[]
  channelId?: string | null
  inputSnapshot: unknown
  target: PricingScenarioTarget
}

export type PricingScenarioChannelSource = {
  channelId?: string | null
  inputSnapshot: unknown
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((v) => v?.trim()).filter((v): v is string => Boolean(v)))]
}

export function getPricingScenarioChannelIds(input: PricingScenarioChannelSource): string[] {
  const snapshot = parseSnapshot(input.inputSnapshot)
  return uniqueNonEmpty([input.channelId, ...(snapshot?.selectedChannelIds ?? [])])
}

export function collectPricingScenarioChannelIds(rows: PricingScenarioChannelSource[]): string[] {
  return uniqueNonEmpty(rows.flatMap((row) => getPricingScenarioChannelIds(row)))
}

export function matchPricingScenarioToListingGroup(input: PricingScenarioMatchInput): boolean {
  const targetProductIds = uniqueNonEmpty(input.target.productIds)
  if (targetProductIds.length === 0) return false

  const scenarioProductIds = new Set(uniqueNonEmpty(input.scenarioProductIds))
  const hasTargetProduct = targetProductIds.some((productId) => scenarioProductIds.has(productId))
  if (!hasTargetProduct) return false

  const scenarioChannelIds = new Set(getPricingScenarioChannelIds(input))
  return scenarioChannelIds.has(input.target.channelId)
}
