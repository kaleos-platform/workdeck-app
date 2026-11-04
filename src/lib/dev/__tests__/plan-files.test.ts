import { isDevPlanEnabled, isExcalidrawScene, isPlanName } from '../plan-files'

describe('plan-files', () => {
  it('경로 탈출이 가능한 이름을 거부한다', () => {
    expect(isPlanName('inventory-revamp')).toBe(true)
    for (const name of ['..', '../env', 'a/b', '.hidden', 'A', '', 'a'.repeat(65)]) {
      expect(isPlanName(name)).toBe(false)
    }
  })

  it('개발 서버에서만 켜진다', () => {
    expect(isDevPlanEnabled()).toBe(false)
  })

  it('excalidraw scene 형식만 허용한다', () => {
    expect(isExcalidrawScene({ type: 'excalidraw', elements: [] })).toBe(true)
    expect(isExcalidrawScene({ type: 'other', elements: [] })).toBe(false)
    expect(isExcalidrawScene({ type: 'excalidraw' })).toBe(false)
    expect(isExcalidrawScene(null)).toBe(false)
  })
})
