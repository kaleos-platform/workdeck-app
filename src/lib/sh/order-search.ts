export function matchesPaymentAmount(amount: unknown, query: string): boolean {
  const normalizedQuery = query.trim().replace(/[\s,]/g, '').replace(/원$/, '')
  if (amount == null || !/^\d+(?:\.\d+)?$/.test(normalizedQuery)) return false

  return String(amount).replace(/[\s,]/g, '').includes(normalizedQuery)
}
