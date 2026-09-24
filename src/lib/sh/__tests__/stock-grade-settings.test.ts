import {
  DEFAULT_STOCK_GRADE_SETTINGS,
  readStockGradeSettings,
  validateStockGradeSettings,
} from '../stock-grade-settings'

describe('readStockGradeSettings', () => {
  it('preferences 가 비었으면 기본값', () => {
    expect(readStockGradeSettings(null)).toEqual(DEFAULT_STOCK_GRADE_SETTINGS)
    expect(readStockGradeSettings({})).toEqual(DEFAULT_STOCK_GRADE_SETTINGS)
  })

  it('저장된 값을 읽는다', () => {
    expect(
      readStockGradeSettings({
        gradeRiskMultiplier: 1.5,
        gradeReorderMultiplier: 3,
        defaultLeadTimeDays: 30,
        gradeAvgWindow: 90,
        gradeApplySafetyStock: true,
      })
    ).toEqual({
      riskMultiplier: 1.5,
      reorderMultiplier: 3,
      defaultLeadTimeDays: 30,
      avgWindow: 90,
      applySafetyStock: true,
    })
  })

  it('깨진 값은 항목별로 기본값으로 떨어진다 — 화면이 멈추면 안 된다', () => {
    const result = readStockGradeSettings({
      gradeRiskMultiplier: 'abc',
      gradeReorderMultiplier: -1,
      gradeAvgWindow: 60,
      defaultLeadTimeDays: 14,
    })
    expect(result.riskMultiplier).toBe(1)
    expect(result.reorderMultiplier).toBe(2)
    expect(result.avgWindow).toBe('auto')
    expect(result.defaultLeadTimeDays).toBe(14)
  })
})

describe('validateStockGradeSettings', () => {
  const valid = {
    riskMultiplier: 1,
    reorderMultiplier: 2,
    defaultLeadTimeDays: 7,
    avgWindow: 'auto',
    applySafetyStock: false,
  }

  it('정상 입력은 preferences 패치를 만든다', () => {
    const result = validateStockGradeSettings(valid)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.patch).toEqual({
        gradeRiskMultiplier: 1,
        gradeReorderMultiplier: 2,
        defaultLeadTimeDays: 7,
        gradeAvgWindow: 'auto',
        gradeApplySafetyStock: false,
      })
    }
  })

  it('발주시기 배수가 위험 배수보다 작으면 거부', () => {
    const result = validateStockGradeSettings({ ...valid, riskMultiplier: 3 })
    expect(result).toMatchObject({ ok: false })
  })

  it('숫자가 아니거나 범위를 벗어나면 거부', () => {
    expect(validateStockGradeSettings({ ...valid, riskMultiplier: '1' })).toMatchObject({
      ok: false,
    })
    expect(validateStockGradeSettings({ ...valid, defaultLeadTimeDays: 7.5 })).toMatchObject({
      ok: false,
    })
    expect(validateStockGradeSettings({ ...valid, defaultLeadTimeDays: 400 })).toMatchObject({
      ok: false,
    })
    expect(validateStockGradeSettings({ ...valid, avgWindow: 60 })).toMatchObject({ ok: false })
    expect(validateStockGradeSettings({ ...valid, applySafetyStock: 'yes' })).toMatchObject({
      ok: false,
    })
  })
})
