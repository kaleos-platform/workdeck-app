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

/**
 * attrState 기반 cartesian — 활성 속성은 선택값만, 미활성은 전체 값.
 * SimpleModeSettings의 effectiveCombos / buildSimpleCompositionGroups의 combos 생성 로직을 단일화.
 */
export function cartesianFromAttrState(
  attrs: BuilderAttributeDef[],
  attrState: Record<string, BuilderAttrState>
): Array<Record<string, string>> {
  if (attrs.length === 0) return []
  let combos: Array<Record<string, string>> = [{}]
  for (const attr of attrs) {
    const state = attrState[attr.name]
    const selected = state?.enabled ? Object.keys(state.valueQuantities) : []
    const vals = selected.length > 0 ? selected : attributeValuesOf(attr)
    const next: Array<Record<string, string>> = []
    for (const prev of combos) {
      for (const v of vals) next.push({ ...prev, [attr.name]: v })
    }
    combos = next
  }
  return combos
}

/** 옵션 행들이 실제로 보유한 (속성명, 값) 집합 — `${attr} ${value}` 키. 인라인 배지용. */
export function buildBackedValueSet(options: BuilderOptionRow[]): Set<string> {
  const set = new Set<string>()
  for (const opt of options) {
    for (const [k, v] of Object.entries(opt.attributeValues ?? {})) {
      const value = String(v ?? '').trim()
      if (value) set.add(`${k.trim()} ${value}`)
    }
  }
  return set
}

export type CompositionCase =
  | 'OK'
  | 'NO_OPTIONS'
  | 'EMPTY_VALUES'
  | 'KEY_MISMATCH'
  | 'VALUE_MISMATCH'
  | 'PARTIAL'

export type CompositionDiagnosis = {
  caseType: CompositionCase
  backedCombos: Array<Record<string, string>>
  missingCombos: Array<Record<string, string>>
  missingLabels: string[]
  message: string
}

function comboLabel(combo: Record<string, string>): string {
  return Object.values(combo)
    .map((v) => String(v).trim())
    .filter(Boolean)
    .join(' / ')
}

function sampleLabels(labels: string[], n = 3): string {
  if (labels.length <= n) return labels.join(', ')
  return `${labels.slice(0, n).join(', ')} 외 ${labels.length - n}개`
}

/**
 * 정의(optionAttributes)에서 펼친 combos와 실제 옵션 행(attributeValues)의 불일치를 진단한다.
 * findMatchingOption은 키 불일치/공백을 일반 miss로 뭉개므로, 케이스 분류는 별도로 trim 기반 비교를 한다.
 */
export function diagnoseComposition(
  product: BuilderProductDetail,
  combos: Array<Record<string, string>>
): CompositionDiagnosis {
  const options = product.options
  const attrs = product.optionAttributes ?? []

  // (a) 옵션 자체가 없음
  if (options.length === 0) {
    return {
      caseType: 'NO_OPTIONS',
      backedCombos: [],
      missingCombos: combos,
      missingLabels: combos.map(comboLabel).filter(Boolean),
      message: '이 상품에는 옵션이 없습니다. 먼저 "옵션 속성 수정"에서 옵션을 만들어 주세요.',
    }
  }

  // 옵션 행이 실제로 보유한 속성 키/값 (trim)
  const optionKeys = new Set<string>()
  let anyValue = false
  for (const opt of options) {
    for (const [k, v] of Object.entries(opt.attributeValues ?? {})) {
      const key = k.trim()
      if (!key) continue
      optionKeys.add(key)
      if (String(v ?? '').trim()) anyValue = true
    }
  }

  // (b) 옵션은 있으나 속성값이 전부 비어 있음 (속성이 정의된 상품에 한함 —
  //     속성 없는 상품의 기본 옵션은 attributeValues가 {}인 것이 정상)
  if (attrs.length > 0 && !anyValue) {
    return {
      caseType: 'EMPTY_VALUES',
      backedCombos: [],
      missingCombos: combos,
      missingLabels: combos.map(comboLabel).filter(Boolean),
      message:
        '옵션은 있지만 속성값이 비어 있습니다. "옵션 속성 수정"에서 각 옵션의 속성값(예: 사이즈·색상)을 지정해 주세요.',
    }
  }

  // (d) 정의 축 이름과 옵션 키가 trim 후에도 교집합 0 → 키 불일치
  const defKeys = attrs.map((a) => a.name.trim()).filter(Boolean)
  if (defKeys.length > 0 && optionKeys.size > 0) {
    const overlap = defKeys.some((k) => optionKeys.has(k))
    if (!overlap) {
      return {
        caseType: 'KEY_MISMATCH',
        backedCombos: [],
        missingCombos: combos,
        missingLabels: combos.map(comboLabel).filter(Boolean),
        message: `속성 정의(${defKeys.join(', ')})와 옵션에 저장된 속성(${Array.from(
          optionKeys
        ).join(', ')})이 일치하지 않습니다. "옵션 속성 수정"에서 옵션을 다시 적용해 주세요.`,
      }
    }
  }

  // 평가할 조합 자체가 없음 — 정의 속성값이 비어 cartesian이 []인 경우.
  // (backedCombos.length === combos.length가 0 === 0으로 OK 오분류되는 것을 방지)
  if (combos.length === 0) {
    return {
      caseType: 'EMPTY_VALUES',
      backedCombos: [],
      missingCombos: [],
      missingLabels: [],
      message:
        '속성 정의에 값이 없습니다. "옵션 속성 수정"에서 각 속성의 값(예: 사이즈·색상)을 지정해 주세요.',
    }
  }

  // backed/missing 분류 (실제 생성에 쓰이는 findMatchingOption과 동일 기준)
  const backedCombos: Array<Record<string, string>> = []
  const missingCombos: Array<Record<string, string>> = []
  for (const combo of combos) {
    if (findMatchingOption(options, combo)) backedCombos.push(combo)
    else missingCombos.push(combo)
  }

  if (backedCombos.length === combos.length) {
    return {
      caseType: 'OK',
      backedCombos,
      missingCombos: [],
      missingLabels: [],
      message: '',
    }
  }

  const missingLabels = missingCombos.map(comboLabel).filter(Boolean)

  // (c) backed 0개 — 키는 맞으나 값이 전부 다름
  if (backedCombos.length === 0) {
    // 옵션이 실제 보유한 값 일부를 안내에 노출
    const optionValues = new Set<string>()
    for (const opt of options) {
      for (const v of Object.values(opt.attributeValues ?? {})) {
        const val = String(v ?? '').trim()
        if (val) optionValues.add(val)
      }
    }
    const defValues = attrs.flatMap((a) => attributeValuesOf(a))
    return {
      caseType: 'VALUE_MISMATCH',
      backedCombos: [],
      missingCombos,
      missingLabels,
      message: `선택한 속성값(${sampleLabels(defValues)})을 가진 옵션이 없습니다. 옵션에는 ${sampleLabels(
        Array.from(optionValues)
      )}이(가) 저장돼 있습니다. "옵션 속성 수정"에서 값을 맞춰 주세요.`,
    }
  }

  // (e) 일부만 backed
  return {
    caseType: 'PARTIAL',
    backedCombos,
    missingCombos,
    missingLabels,
    message: `${combos.length}개 조합 중 ${missingCombos.length}개는 뒷받침 옵션이 없어 제외됩니다: ${sampleLabels(
      missingLabels
    )}. "옵션 속성 수정"에서 해당 옵션을 추가하세요.`,
  }
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
