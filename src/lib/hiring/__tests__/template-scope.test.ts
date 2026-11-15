/** @jest-environment node */
import { templateAccessScope, templateContentScope, templateListScope } from '../template-scope'

// 임시 차단: opening 이관 샘플(sourceRef opening:detail_template:*)은 브랜드 정리 전까지 고객 경로에서 제외.
const notPending = {
  OR: [{ sourceRef: null }, { NOT: { sourceRef: { startsWith: 'opening:detail_template:' } } }],
}

it('상세·적용·복사 범위에서 정리 대기 샘플을 제외하고 소유 템플릿은 그대로 둔다', () => {
  expect(templateAccessScope('s1')).toEqual({
    OR: [{ spaceId: 's1' }, { spaceId: null, isSample: true, ...notPending }],
  })
})

it('공용 블록 범위도 정리 대기 샘플 소속 블록을 제외한다', () => {
  expect(templateContentScope('s1')).toEqual({
    sourceType: 'DETAIL_TEMPLATE',
    OR: [
      { spaceId: 's1', template: { spaceId: 's1' } },
      { spaceId: null, template: { spaceId: null, isSample: true, ...notPending } },
    ],
  })
})

it('목록 범위도 정리 대기 샘플을 제외한다', () => {
  const scope = templateListScope('s1') as { OR: Record<string, unknown>[] }
  expect(scope.OR[0]).toEqual({ spaceId: 's1' })
  expect(scope.OR[1]).toMatchObject({ spaceId: null, isSample: true, ...notPending })
})
