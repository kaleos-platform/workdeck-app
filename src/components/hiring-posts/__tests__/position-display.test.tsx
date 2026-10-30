import { render, screen } from '@testing-library/react'
import { ContentBlockPreview } from '../posting-preview'
import { StepPositions } from '../step-positions'
import type { WizardPositionData } from '../build-types'

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))

const position: WizardPositionData = {
  id: 'qa',
  positionId: null,
  name: '합성 직무',
  jobType: null,
  payFrequency: null,
  payAmount: 12000,
  workDays: [1, 2],
  workStartAt: '09:00',
  workEndAt: null,
  headcount: 1,
  experience: null,
  education: null,
  jobDescription: null,
  requiredQualifications: null,
  preferredQualifications: null,
}

it.each(['미리보기', '직무 목록'])('%s에 급여 금액과 입력한 근무 시간이 표시된다', (view) => {
  if (view === '미리보기') {
    render(
      <ContentBlockPreview
        content={{
          id: 'content',
          contentType: 'positions',
          title: null,
          data: null,
          imagePath: null,
          sortOrder: 0,
        }}
        positions={[position]}
      />
    )
  } else {
    render(
      <StepPositions
        postingId="qa"
        positions={[position]}
        spacePositions={[]}
        onChange={jest.fn()}
      />
    )
  }
  expect(screen.getByText('12,000원')).toBeInTheDocument()
  expect(screen.getByText('09:00')).toBeInTheDocument()
})
