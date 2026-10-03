import { render, screen } from '@testing-library/react'
import { ApplicationHistory } from '../application-history'
import type { ApplicationHistoryView } from '@/lib/hiring/migration/application-history'
const at = '2026-10-03T00:00:00.000Z'
it('원문 HTML을 실행하지 않고 타입과 미확정 의미를 표시한다', () => {
  const history: ApplicationHistoryView = {
    sourceSnapshotAt: at,
    sourceStatus: 1,
    sourceStage: 1,
    sourceHiringStage: 2,
    createdAt: at,
    updatedAt: at,
    requiredPrivacyAgreedAt: null,
    optionalPrivacyAgreedAt: null,
    canceledAt: null,
    deletedAt: null,
    entries: [
      {
        index: 0,
        label: '<script>label</script>',
        sourceType: 'select',
        otherMarker: 'true',
        kind: 'value',
        value: { kind: 'scalar', value: '<img src=x onerror=alert(1)>' },
        interpretation: 'unresolved',
      },
    ],
  }
  const { container } = render(
    <ApplicationHistory applicationId="a" result={{ status: 'available', history }} />
  )
  expect(container.querySelector('script,img')).toBeNull()
  expect(screen.getByText('<script>label</script>')).toBeInTheDocument()
  expect(screen.getByText('선택 라벨·기타 응답 해석 미확정')).toBeInTheDocument()
  expect(screen.getByText(/문자열: <img/)).toBeInTheDocument()
  expect(screen.getByText(/서류 통과/)).toBeInTheDocument()
})
it('미지원 snapshot은 원문 없이 고정 안내만 표시한다', () => {
  render(<ApplicationHistory applicationId="a" result={{ status: 'unavailable' }} />)
  expect(screen.getByText('이전 원문을 확인할 수 없습니다.')).toBeInTheDocument()
})
