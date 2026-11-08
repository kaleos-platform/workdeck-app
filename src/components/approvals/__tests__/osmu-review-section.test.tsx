import { render, screen } from '@testing-library/react'
import { OsmuReviewSection } from '../osmu-review-section'

describe('OsmuReviewSection', () => {
  it('자리별 사진과 사실·근거를 보여준다', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        source: {
          title: '환경교육',
          version: 2,
          facts: [{ text: '30명 참가', evidence: { text: '참가자 30명' } }],
          quotes: [],
        },
        copies: [
          { id: 'c1', url: 'https://s.test/a.jpg', name: 'a.jpg', caption: '키트 만드는 모습' },
        ],
      }),
    }) as never
    render(
      <OsmuReviewSection
        requestId="r1"
        photos={[
          { slot: 2, copyId: 'missing' },
          { slot: 1, copyId: 'c1' },
        ]}
      />
    )
    expect(await screen.findByText('30명 참가')).toBeInTheDocument()
    expect(screen.getByText('근거: “참가자 30명”')).toBeInTheDocument()
    expect(screen.getByAltText('키트 만드는 모습')).toHaveAttribute('src', 'https://s.test/a.jpg')
    expect(screen.getByText('2번 · 사진 없음')).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledWith('/api/sc/osmu/requests/r1')
  })
})
