import { render, screen } from '@testing-library/react'
import { CompanyProfileForm } from '../company-profile-form'

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))

it('저장 전에는 기업명 기본값이 공간 이름이고 「아직 저장 안 됨」 배지를 보인다', () => {
  render(<CompanyProfileForm initialProfile={null} defaultCompanyName="내 공간" postingUuid="u1" />)
  expect(screen.getByLabelText('기업명')).toHaveValue('내 공간')
  expect(screen.getByText('아직 저장 안 됨')).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '공고에서 보기' })).not.toBeInTheDocument()
})

it('저장된 값이 있으면 「공고에 표시 중」과 공고 보기 링크를 보인다', () => {
  render(
    <CompanyProfileForm
      initialProfile={{
        companyName: '미닝카페',
        intro: null,
        homepageUrl: null,
        blogUrl: null,
        instagramUrl: null,
        youtubeUrl: null,
        showIntro: true,
      }}
      defaultCompanyName="내 공간"
      postingUuid="u1"
    />
  )
  expect(screen.getByLabelText('기업명')).toHaveValue('미닝카페')
  expect(screen.getByText('공고에 표시 중')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '공고에서 보기' })).toHaveAttribute('href', '/p/u1')
})
