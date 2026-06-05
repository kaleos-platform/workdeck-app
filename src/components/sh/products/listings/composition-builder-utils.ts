export type BuilderAttributeDef = {
  name: string
  values: Array<{ value: string; code?: string } | string>
}

export type BuilderOptionRow = {
  id: string
  name: string
  sku: string | null
  retailPrice: number | null
  attributeValues: Record<string, string>
}

export type BuilderItemEntry = {
  optionId: string
  optionName: string
  sku: string | null
  quantity: number
  retailPrice: number | null
  attributeValues: Record<string, string>
}

export type BuilderBuiltGroup = {
  suffixParts: string[]
  items: BuilderItemEntry[]
}

export type BuilderAttrState = {
  enabled: boolean
  valueQuantities: Record<string, number>
}

export type BuilderProductDetail = {
  optionAttributes: BuilderAttributeDef[] | null
  options: BuilderOptionRow[]
}

function attrValueOf(value: { value: string } | string): string {
  return typeof value === 'string' ? value : value.value
}

export function attributeValuesOf(attr: BuilderAttributeDef): string[] {
  return attr.values.map(attrValueOf).filter((v) => v.trim().length > 0)
}

export function findMatchingOption(
  options: BuilderOptionRow[],
  target: Record<string, string>
): BuilderOptionRow | null {
  const keys = Object.keys(target)
  if (keys.length === 0) return options[0] ?? null

  for (const opt of options) {
    let match = true
    for (const k of keys) {
      if (String(opt.attributeValues[k] ?? '') !== target[k]) {
        match = false
        break
      }
    }
    if (match) return opt
  }

  return null
}

export function buildSimpleCompositionGroups(params: {
  product: BuilderProductDetail
  attrState: Record<string, BuilderAttrState>
  setQuantities: number[]
}): BuilderBuiltGroup[] {
  const { product, attrState } = params
  const attrs = product.optionAttributes ?? []
  const qtys = params.setQuantities.map((q) => Math.max(1, q))
  const includeQtySuffix = qtys.length > 1

  if (attrs.length === 0) {
    const defaultOpt = product.options[0]
    if (!defaultOpt) return []
    return qtys.map((q) => ({
      suffixParts: includeQtySuffix ? [`${q}개`] : [],
      items: [
        {
          optionId: defaultOpt.id,
          optionName: defaultOpt.name,
          sku: defaultOpt.sku,
          quantity: q,
          retailPrice: defaultOpt.retailPrice,
          attributeValues: defaultOpt.attributeValues,
        },
      ],
    }))
  }

  const combos = attrs.reduce<Array<Record<string, string>>>((acc, attr) => {
    const state = attrState[attr.name]
    const selectedVals = state?.enabled ? Object.keys(state.valueQuantities) : []
    const vals = selectedVals.length > 0 ? selectedVals : attributeValuesOf(attr)
    if (acc.length === 0) return vals.map((v) => ({ [attr.name]: v }))
    return acc.flatMap((prev) => vals.map((v) => ({ ...prev, [attr.name]: v })))
  }, [])

  const groups: BuilderBuiltGroup[] = []
  for (const combo of combos) {
    const opt = findMatchingOption(product.options, combo)
    if (!opt) continue
    const baseParts = attrs.map((a) => combo[a.name]).filter(Boolean)
    for (const q of qtys) {
      groups.push({
        suffixParts: includeQtySuffix ? [...baseParts, `${q}개`] : baseParts,
        items: [
          {
            optionId: opt.id,
            optionName: opt.name,
            sku: opt.sku,
            quantity: q,
            retailPrice: opt.retailPrice,
            attributeValues: opt.attributeValues,
          },
        ],
      })
    }
  }

  return groups
}
