import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { PostingDetail } from '../posting-detail'
import { renderPostingEmbed } from '@/lib/hiring/render-embed-html'

const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))

it('다른 공고 지원서 링크가 있으면 발행 팝업에서 확인을 안내하되 발행은 허용한다', () => {
  const embed = renderPostingEmbed({
    origin: 'https://workdeck.test',
    posting: {
      uuid: 'new',
      positions: [],
      contents: [
        {
          contentType: 'button',
          imagePath: null,
          data: { title: '지원', linkType: 'url', url: 'https://workdeck.test/p/old/apply' },
        },
      ],
    },
  })
  render(
    <PostingDetail
      posting={{ id: 'test', uuid: 'new', title: 'QA', status: 'DRAFT', closingDate: null }}
      origin="https://workdeck.test"
      embedHtml={embed.html}
      embedIssues={embed.issues}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: '공고 발행' }))
  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.getByText(/다른 공고의 지원서 링크/)).toBeInTheDocument()
  expect(dialog.getByRole('link', { name: '공고 수정하기' })).toHaveAttribute(
    'href',
    '/d/recruiting/postings/test/build'
  )
  expect(dialog.getByRole('button', { name: '발행하기' })).toBeEnabled()
})

it('초안에서도 HTML을 우선 복사하고 앱 CSS와 격리된 미리보기를 제공한다', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  const html = '<div><p style="color:red">테스트 공고</p></div>'
  render(
    <PostingDetail
      posting={{
        id: 'test',
        uuid: 'public-test',
        title: '테스트',
        status: 'DRAFT',
        closingDate: null,
      }}
      origin="https://workdeck.test"
      embedHtml={html}
    />
  )
  expect(screen.getAllByRole('heading', { level: 2 })[0]).toHaveTextContent(
    '모집 기간 및 접수 상태'
  )
  fireEvent.click(screen.getByRole('button', { name: 'HTML 복사' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(html))
  // 미리보기는 「공고 내용」 탭에서 제공한다.
  expect(screen.queryByTitle('외부 게시용 공고 미리보기')).not.toBeInTheDocument()
  cleanup()
  render(
    <PostingDetail
      posting={{
        id: 'test',
        uuid: 'public-test',
        title: '테스트',
        status: 'DRAFT',
        closingDate: null,
      }}
      origin="https://workdeck.test"
      embedHtml={html}
      tab="content"
    />
  )
  const frame = screen.getByTitle('외부 게시용 공고 미리보기')
  expect(frame).toHaveAttribute('sandbox', '')
  expect(frame.getAttribute('srcdoc')).toContain(html)
})

it('출력 누락 오류가 있으면 수정할 카드를 안내하고 HTML 복사를 막는다', () => {
  const writeText = jest.fn()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  render(
    <PostingDetail
      posting={{ id: 'test', uuid: 'qa', title: 'QA', status: 'DRAFT', closingDate: null }}
      origin="https://workdeck.test"
      embedHtml="<div></div>"
      embedIssues={[
        { blockNumber: 2, severity: 'error', message: '이미지가 저장되지 않았습니다.' },
      ]}
    />
  )
  expect(screen.getByRole('alert')).toHaveTextContent('카드 2: 이미지가 저장되지 않았습니다.')
  expect(screen.getByRole('button', { name: 'HTML 복사' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'HTML 복사' }))
  expect(writeText).not.toHaveBeenCalled()
  expect(screen.getByRole('link', { name: '공고 수정하기' })).toHaveAttribute(
    'href',
    '/d/recruiting/postings/test/build'
  )
})

it('초안의 지원서 링크와 빈 직무는 안내하되 HTML 복사를 허용한다', () => {
  render(
    <PostingDetail
      posting={{ id: 'test', uuid: 'qa', title: 'QA', status: 'DRAFT', closingDate: null }}
      origin="https://workdeck.test"
      embedHtml="<p>QA</p>"
      usesFormLink
      embedIssues={[{ blockNumber: 2, severity: 'warning', message: '등록된 직무가 없습니다.' }]}
    />
  )
  expect(screen.getByText(/현재 지원 접수가 열려 있지 않습니다/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'HTML 복사' })).toBeEnabled()
})

it('초안 HTML 복사 완료 시 접수 불가 안내와 발행 설정 경로를 제공한다', async () => {
  const { toast } = await import('sonner')
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: jest.fn().mockResolvedValue(undefined) },
  })
  render(
    <PostingDetail
      posting={{ id: 'test', uuid: 'qa', title: 'QA', status: 'DRAFT', closingDate: null }}
      origin="https://workdeck.test"
      embedHtml="<p>QA</p>"
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'HTML 복사' }))
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith('HTML 코드를 복사했습니다', {
      description: '초안 공고는 발행 전까지 지원서 링크로 접수할 수 없습니다.',
      duration: 8000,
    })
  )
  expect(screen.getByRole('button', { name: '공고 발행' })).toBeInTheDocument()
})

it('지난 마감일을 팝업에서 수정해 한 요청으로 발행한다', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ posting: { status: 'ACTIVE', closingDate: '2099-12-31T00:00:00Z' } }),
  })
  render(
    <PostingDetail
      posting={{ id: 'test', uuid: 'qa', title: 'QA', status: 'DRAFT', closingDate: '2023-11-30' }}
      origin="https://workdeck.test"
      embedHtml="<p>QA</p>"
    />
  )
  expect(screen.getByRole('region', { name: '모집 기간 및 접수 상태' })).toHaveTextContent(
    '마감 2023. 11. 30.'
  )
  fireEvent.click(screen.getByRole('button', { name: '공고 발행' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('마감일이 지났습니다')
  expect(screen.getByRole('button', { name: '발행하기' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('지원서 마감일'), { target: { value: '2099-12-31' } })
  fireEvent.click(screen.getByRole('button', { name: '발행하기' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body)).toEqual({
    action: 'publish',
    closingDate: '2099-12-31',
  })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('region', { name: '모집 기간 및 접수 상태' })).toHaveTextContent('2099')
})

it('발행 실패 시 팝업과 입력한 날짜를 유지하고 오류를 안내한다', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ message: '발행 요건 미충족', errors: ['직무를 등록하세요'] }),
  })
  render(
    <PostingDetail
      posting={{ id: 'test', uuid: 'qa', title: 'QA', status: 'DRAFT', closingDate: null }}
      origin="https://workdeck.test"
      embedHtml="<p>QA</p>"
    />
  )
  fireEvent.click(screen.getByRole('button', { name: '공고 발행' }))
  fireEvent.change(screen.getByLabelText('지원서 마감일'), { target: { value: '2099-12-31' } })
  fireEvent.click(screen.getByRole('button', { name: '발행하기' }))
  await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('직무를 등록하세요'))
  expect(screen.getByLabelText('지원서 마감일')).toHaveValue('2099-12-31')
  expect(screen.getByRole('button', { name: '발행하기' })).toBeEnabled()
})

it('보관 공고는 재발행 대신 복사해서 새 모집한다', () => {
  render(
    <PostingDetail
      posting={{ id: 'test', uuid: 'qa', title: 'QA', status: 'ARCHIVED', closingDate: null }}
      origin="https://workdeck.test"
      embedHtml="<p>QA</p>"
    />
  )
  expect(screen.queryByRole('button', { name: '공고 발행' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '복사해서 새 모집' })).toBeInTheDocument()
})

it('발행 상태라도 마감일이 지나면 HTML 지원 링크에 새 모집 안내를 표시한다', () => {
  const { rerender } = render(
    <PostingDetail
      posting={{ id: 'test', uuid: 'qa', title: 'QA', status: 'ACTIVE', closingDate: '2000-01-01' }}
      origin="https://workdeck.test"
      embedHtml="<p>QA</p>"
      usesFormLink
    />
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    '새로운 모집은 공고를 복사해 발행한 뒤 새 지원서 링크를 사용하세요.'
  )
  rerender(
    <PostingDetail
      posting={{ id: 'test', uuid: 'qa', title: 'QA', status: 'ACTIVE', closingDate: '2000-01-01' }}
      origin="https://workdeck.test"
      embedHtml="<p>QA</p>"
      usesFormLink={false}
    />
  )
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

describe('공고 상세 탭', () => {
  const posting = {
    id: 'p1',
    uuid: 'u1',
    title: 'QA',
    status: 'ACTIVE' as const,
    closingDate: null,
  }
  const base = { posting, origin: 'https://workdeck.test', embedHtml: '<div></div>' }

  it('탭 링크는 URL 상태이며 지원자 수와 현재 탭(aria-current)을 표시한다', () => {
    render(<PostingDetail {...base} tab="applicants" applicantCount={1234} />)
    const nav = within(screen.getByRole('navigation', { name: '공고 상세' }))
    expect(nav.getByRole('link', { name: '지원자 모집' })).toHaveAttribute(
      'href',
      '/d/recruiting/postings/p1'
    )
    const applicants = nav.getByRole('link', { name: '지원자 1,234' })
    expect(applicants).toHaveAttribute('href', '/d/recruiting/postings/p1?tab=applicants')
    expect(applicants).toHaveAttribute('aria-current', 'page')
    expect(nav.getByRole('link', { name: '공고 내용' })).toHaveAttribute(
      'href',
      '/d/recruiting/postings/p1?tab=content'
    )
    expect(nav.getByRole('link', { name: '지원자 모집' })).not.toHaveAttribute('aria-current')
  })

  it('지원자 탭에서는 서버가 내려준 목록만 보이고 모집 블록·미리보기는 숨긴다', () => {
    render(
      <PostingDetail {...base} tab="applicants" applicantCount={2}>
        <p>지원자 목록 자리</p>
      </PostingDetail>
    )
    expect(screen.getByText('지원자 목록 자리')).toBeInTheDocument()
    expect(screen.queryByText('모집 기간 및 접수 상태')).not.toBeInTheDocument()
    expect(screen.queryByTitle('외부 게시용 공고 미리보기')).not.toBeInTheDocument()
  })

  it('기본 탭은 지원자 모집이며 children 을 렌더하지 않는다', () => {
    render(
      <PostingDetail {...base}>
        <p>지원자 목록 자리</p>
      </PostingDetail>
    )
    expect(screen.getByText('모집 기간 및 접수 상태')).toBeInTheDocument()
    expect(screen.queryByText('지원자 목록 자리')).not.toBeInTheDocument()
  })
})

describe('마감 확인·마감일 연장', () => {
  const base = { id: 'test', uuid: 'qa', title: 'QA' }
  const html = '<p>QA</p>'

  it('마감 버튼은 확인 팝업을 거쳐야 API를 호출한다', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ posting: { status: 'CLOSED' } }),
    }) as unknown as typeof fetch
    render(
      <PostingDetail
        posting={{ ...base, status: 'ACTIVE', closingDate: '2099-12-31T00:00:00.000Z' }}
        origin="https://workdeck.test"
        embedHtml={html}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '마감' }))
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('공고를 마감할까요?')
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '마감' }))
    fireEvent.click(screen.getByRole('button', { name: '마감하기' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body)).toEqual({ action: 'close' })
  })

  it('마감된 공고를 연장하면 접수 중으로 바뀌고 새로고침한다', async () => {
    refresh.mockClear()
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        posting: { id: 'test', status: 'ACTIVE', closingDate: '2100-01-07T00:00:00.000Z' },
      }),
    }) as unknown as typeof fetch
    render(
      <PostingDetail
        posting={{ ...base, status: 'CLOSED', closingDate: '2099-12-31T00:00:00.000Z' }}
        origin="https://workdeck.test"
        embedHtml={html}
      />
    )
    expect(screen.queryByRole('button', { name: '마감' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '마감일 연장' }))
    expect(screen.getByLabelText('새 마감일')).toHaveValue('2100-01-07')
    expect(screen.getByRole('dialog')).toHaveTextContent('모집 조건과 지원서는 바뀌지 않고')
    fireEvent.click(screen.getByRole('button', { name: '연장하기' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body)).toEqual({
      action: 'extend',
      closingDate: '2100-01-07',
    })
    expect(screen.getByText('마감 2100. 1. 7.')).toBeInTheDocument()
    expect(screen.getByText('지원서 접수 중')).toBeInTheDocument()
  })

  it('연장 실패 시 서버 메시지를 팝업에 표시한다', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ message: '연장할 수 없는 공고입니다' }),
    }) as unknown as typeof fetch
    render(
      <PostingDetail
        posting={{ ...base, status: 'ACTIVE', closingDate: '2099-12-31T00:00:00.000Z' }}
        origin="https://workdeck.test"
        embedHtml={html}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '마감일 연장' }))
    fireEvent.click(screen.getByRole('button', { name: '연장하기' }))
    expect(await screen.findByText('연장할 수 없는 공고입니다')).toBeInTheDocument()
  })

  it('마감일이 없거나 초안이면 연장 버튼이 없다', () => {
    const { rerender } = render(
      <PostingDetail
        posting={{ ...base, status: 'ACTIVE', closingDate: null }}
        origin="https://workdeck.test"
        embedHtml={html}
      />
    )
    expect(screen.queryByRole('button', { name: '마감일 연장' })).not.toBeInTheDocument()
    rerender(
      <PostingDetail
        posting={{ ...base, status: 'DRAFT', closingDate: '2099-12-31' }}
        origin="https://workdeck.test"
        embedHtml={html}
      />
    )
    expect(screen.queryByRole('button', { name: '마감일 연장' })).not.toBeInTheDocument()
  })
})
