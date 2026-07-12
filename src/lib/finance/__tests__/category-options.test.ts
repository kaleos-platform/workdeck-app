/**
 * @jest-environment node
 */
import {
  buildClassifyOptions,
  buildParentOptions,
  comboOptionLabel,
  type CategoryTreeNode,
} from '../category-options'

// 분류 타깃(리프) 빌더 — 대분류/리프 구분이 자식 유무가 아니라 루트 타입으로 결정되는지 검증.
// 회귀 핵심: 자식 없는 빈 대분류(신규 추가 직후)가 분류 타깃으로 새지 않아야 한다.
describe('buildClassifyOptions — 루트 타입 기준 리프 판별', () => {
  const node = (
    id: string,
    name: string,
    type: string,
    children: CategoryTreeNode[] = []
  ): CategoryTreeNode => ({ id, name, type, children })

  test('빈 INCOME 대분류 → 분류 타깃 0개 (그룹은 타깃 아님)', () => {
    const tree = [node('inc', '수입', 'INCOME', [node('g1', 'B2B 수익', 'INCOME')])]
    expect(buildClassifyOptions(tree)).toEqual([])
  })

  test('자식 있는 대분류 → 하위 리프만 타깃, 대분류명은 breadcrumb hint', () => {
    const tree = [
      node('inc', '수입', 'INCOME', [
        node('g1', 'B2C 수익', 'INCOME', [
          node('l1', '온라인 판매정산', 'INCOME'),
          node('l2', '도매·B2B 매출', 'INCOME'),
        ]),
      ]),
    ]
    const opts = buildClassifyOptions(tree)
    expect(opts.map((o) => o.id)).toEqual(['l1', 'l2'])
    expect(opts[0]).toMatchObject({ label: '온라인 판매정산', hint: 'B2C 수익', indent: true })
  })

  test('TRANSFER lvl1 → 그 자체가 분류 타깃(이체 항목은 lvl1=리프)', () => {
    const tree = [node('tr', '이체', 'TRANSFER', [node('t1', '보증금 대체', 'TRANSFER')])]
    const opts = buildClassifyOptions(tree)
    expect(opts.map((o) => o.id)).toEqual(['t1'])
    expect(opts[0]).toMatchObject({ label: '보증금 대체', hint: null, indent: false })
  })

  test('빈 대분류와 채워진 대분류 혼재 → 채워진 쪽 리프만', () => {
    const tree = [
      node('inc', '수입', 'INCOME', [
        node('g1', '기타수입', 'INCOME', [node('l1', '정부지원금', 'INCOME')]),
        node('g2', '테스트', 'INCOME'), // 빈 대분류 — 제외돼야 함
      ]),
    ]
    expect(buildClassifyOptions(tree).map((o) => o.id)).toEqual(['l1'])
  })

  test('types 제한(INCOME/EXPENSE) → TRANSFER 제외', () => {
    const tree = [
      node('inc', '수입', 'INCOME', [
        node('g1', 'B2C 수익', 'INCOME', [node('l1', '온라인 판매정산', 'INCOME')]),
      ]),
      node('tr', '이체', 'TRANSFER', [node('t1', '보증금 대체', 'TRANSFER')]),
    ]
    expect(buildClassifyOptions(tree, ['INCOME', 'EXPENSE']).map((o) => o.id)).toEqual(['l1'])
  })
})

// 비활성 항목은 옵션에 포함하되 isActive=false로 표시(콤보박스가 새 선택지에선 숨김).
// 빌더는 제외하지 않는다 — 이미 분류된 거래의 라벨 보존을 위해.
describe('buildClassifyOptions — isActive 플래그/전파', () => {
  const node = (
    id: string,
    name: string,
    type: string,
    isActive: boolean | undefined,
    children: CategoryTreeNode[] = []
  ): CategoryTreeNode => ({ id, name, type, isActive, children })

  test('비활성 리프 → 옵션에 포함되되 isActive=false', () => {
    const tree = [
      node('inc', '수입', 'INCOME', true, [
        node('g1', '매출', 'INCOME', true, [
          node('l1', '활성잎', 'INCOME', true),
          node('l2', '비활성잎', 'INCOME', false),
        ]),
      ]),
    ]
    const opts = buildClassifyOptions(tree)
    expect(opts.map((o) => o.id)).toEqual(['l1', 'l2'])
    expect(opts.find((o) => o.id === 'l1')?.isActive).toBe(true)
    expect(opts.find((o) => o.id === 'l2')?.isActive).toBe(false)
  })

  test('비활성 대분류 → 하위 리프 전체 isActive=false 전파(리프 자체는 활성이어도)', () => {
    const tree = [
      node('inc', '수입', 'INCOME', true, [
        node('g1', '비활성그룹', 'INCOME', false, [node('l1', '활성잎', 'INCOME', true)]),
      ]),
    ]
    const opts = buildClassifyOptions(tree)
    expect(opts.map((o) => o.id)).toEqual(['l1'])
    expect(opts[0].isActive).toBe(false)
  })

  test('비활성 이체 항목 → 옵션 포함, isActive=false', () => {
    const tree = [
      node('tr', '이체', 'TRANSFER', true, [node('t1', '비활성이체', 'TRANSFER', false)]),
    ]
    const opts = buildClassifyOptions(tree)
    expect(opts.map((o) => o.id)).toEqual(['t1'])
    expect(opts[0].isActive).toBe(false)
  })

  test('isActive 미지정 → 활성 취급(false 아님)', () => {
    const tree = [
      node('inc', '수입', 'INCOME', undefined, [
        node('g1', '매출', 'INCOME', undefined, [node('l1', '잎', 'INCOME', undefined)]),
      ]),
    ]
    expect(buildClassifyOptions(tree)[0].isActive).not.toBe(false)
  })

  // 회귀 방지: 이미 비활성 항목에 분류된 거래의 콤보 라벨이 보존되는가.
  // 콤보박스는 비활성을 목록에서 숨기지만 comboOptionLabel은 전체 옵션에서 해석하므로
  // 비활성 항목이 현재 선택값이어도 라벨이 빈칸이 되지 않아야 한다.
  test('comboOptionLabel — 비활성 항목 id도 라벨 해석(선택값 표시 보존)', () => {
    const tree = [
      node('inc', '수입', 'INCOME', true, [
        node('g1', '매출', 'INCOME', true, [node('l2', '비활성잎', 'INCOME', false)]),
      ]),
    ]
    const opts = buildClassifyOptions(tree)
    expect(comboOptionLabel(opts, 'l2')).toBe('매출 › 비활성잎')
  })
})

// 회귀 방지: 상위 계정과목 옵션에 type이 빠지면 콤보박스 blockType 필터에서
// `undefined !== undefined = false`로 전 옵션이 탈락해 "계정과목 추가" 팝업의
// 상위 선택이 항상 빈 목록이 된다(거래내역 실버그).
describe('buildParentOptions — 옵션 type 필수', () => {
  const node = (
    id: string,
    name: string,
    type: string,
    children: CategoryTreeNode[] = []
  ): CategoryTreeNode => ({ id, name, type, children })

  test('root·lvl1 전 옵션에 루트 타입이 설정된다', () => {
    const tree = [
      node('inc', '수입', 'INCOME', [node('g1', 'B2C 수익', 'INCOME')]),
      node('exp', '지출', 'EXPENSE', [node('g2', '판관비', 'EXPENSE')]),
      node('trf', '이체', 'TRANSFER', [node('g3', '내계좌이체', 'TRANSFER')]),
    ]
    const opts = buildParentOptions(tree)
    expect(opts).toHaveLength(6)
    for (const o of opts) expect(o.type).toBeDefined()
    expect(opts.find((o) => o.id === 'g1')?.type).toBe('INCOME')
    expect(opts.find((o) => o.id === 'g2')?.type).toBe('EXPENSE')
    expect(opts.find((o) => o.id === 'trf')?.type).toBe('TRANSFER')
  })
})
