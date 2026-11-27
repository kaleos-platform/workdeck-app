import { getRecruitingApplicationPath, safeRecruitingReturnPath } from '@/lib/deck-routes'

test('지원자 상세 경로에 돌아갈 목록 주소를 붙인다', () => {
  expect(getRecruitingApplicationPath('a1')).toBe('/d/recruiting/applications/a1')
  expect(getRecruitingApplicationPath('a1', '/d/recruiting/postings/p1?tab=applicants')).toBe(
    '/d/recruiting/applications/a1?from=%2Fd%2Frecruiting%2Fpostings%2Fp1%3Ftab%3Dapplicants'
  )
})

test('돌아갈 주소는 모집 관리 내부 경로만 허용한다', () => {
  expect(safeRecruitingReturnPath('/d/recruiting/postings/p1?tab=applicants')).toBe(
    '/d/recruiting/postings/p1?tab=applicants'
  )
  expect(safeRecruitingReturnPath('/d/recruiting/applications?stage=HIRING&page=2')).toBe(
    '/d/recruiting/applications?stage=HIRING&page=2'
  )
  for (const bad of [
    undefined,
    ['/d/recruiting/x'],
    'https://evil.com',
    '//evil.com',
    '/d/recruiting//evil.com',
    '/d/recruiting/\\evil',
    '/settings',
  ])
    expect(safeRecruitingReturnPath(bad)).toBe('/d/recruiting/applications')
})
