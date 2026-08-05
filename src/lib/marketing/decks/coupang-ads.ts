import type { DeckLandingContent } from '../types'

export const coupangAdsLanding: DeckLandingContent = {
  slug: 'coupang-ads',
  seo: {
    title: '쿠팡 광고 관리자 — Excel 리포트 업로드로 ROAS·키워드 분석',
    description:
      '쿠팡 광고 리포트 Excel을 업로드하면 캠페인별 ROAS·광고비 추이와 비효율 키워드를 자동으로 분석합니다. 매일 수기 정리하던 광고 리포트를 Workdeck 쿠팡 광고 관리자로 자동화하세요.',
    keywords: [
      '쿠팡 광고 분석',
      '쿠팡 광고 리포트',
      'ROAS 분석',
      '쿠팡 키워드 분석',
      '쿠팡 광고비 관리',
      '쿠팡 광고 자동 수집',
      '광고 성과 대시보드',
    ],
  },
  hero: {
    headline: '쿠팡 광고 리포트, 엑셀 대신',
    highlight: 'ROAS 대시보드로',
    subcopy:
      '쿠팡 광고 관리자에서 다운로드한 Excel 리포트를 그대로 업로드하면 캠페인별 ROAS·광고비·클릭 시계열이 자동으로 정리됩니다. 비효율 키워드를 바로 찾아 운영 액션으로 옮기세요.',
    primaryCta: { label: '무료로 시작하기', href: '/signup' },
    secondaryCta: { label: '로그인', href: '/d/coupang-ads/login' },
  },
  painPoints: [
    {
      title: '매번 엑셀 리포트를 손으로 취합',
      description:
        '캠페인마다 따로 다운로드한 리포트를 매일 엑셀로 합치고 피벗을 다시 만드는 데 시간이 소모됩니다.',
    },
    {
      title: '비효율 키워드를 늦게 발견',
      description:
        '광고비만 나가고 전환이 없는 키워드를 뒤늦게 발견해 예산이 새는 경우가 반복됩니다.',
    },
    {
      title: '캠페인별 추이를 한눈에 보기 어려움',
      description: '일자별 스냅샷만 쌓여 있어 캠페인 성과가 좋아지는지 나빠지는지 파악이 늦습니다.',
    },
  ],
  features: [
    {
      icon: 'upload',
      title: 'Excel 리포트 업로드 자동 파싱',
      description: '쿠팡 광고 관리자 표준 리포트를 업로드하면 형식을 자동 인식해 즉시 반영합니다.',
    },
    {
      icon: 'chart',
      title: 'ROAS·광고비 시계열 분석',
      description: '캠페인 단위로 ROAS, 광고비, 클릭, 전환 추이를 기간별로 비교할 수 있습니다.',
    },
    {
      icon: 'search',
      title: '키워드별 성과 분석',
      description:
        '전환 없이 광고비만 소진하는 비효율 키워드를 즉시 골라내 운영 우선순위를 정합니다.',
    },
    {
      icon: 'refresh',
      title: '자동 수집',
      description:
        '연동 계정 기준으로 광고 데이터를 주기적으로 자동 수집해 수동 업로드 부담을 줄입니다.',
    },
    {
      icon: 'grid',
      title: '캠페인 상세 대시보드',
      description: '캠페인별 대시보드·광고 데이터·키워드 분석 탭으로 상세 성과를 바로 확인합니다.',
    },
  ],
  workflow: [
    {
      step: 1,
      title: 'Excel 리포트 업로드',
      description: '쿠팡 광고 관리자에서 받은 리포트를 그대로 끌어다 놓으면 자동으로 파싱됩니다.',
    },
    {
      step: 2,
      title: 'ROAS·키워드 자동 분석',
      description: '캠페인별 ROAS 추이와 키워드별 성과가 대시보드에 자동으로 정리됩니다.',
    },
    {
      step: 3,
      title: '비효율 구간 바로 조치',
      description: '광고비만 소진하는 키워드·캠페인을 찾아 운영 의사결정을 바로 실행합니다.',
    },
  ],
  faq: [
    {
      question: '쿠팡 광고 관리자 리포트를 그대로 업로드할 수 있나요?',
      answer:
        '네. 쿠팡 광고 관리자에서 다운로드하는 표준 Excel 리포트 형식을 그대로 업로드하면 자동으로 파싱됩니다.',
    },
    {
      question: '자동 수집은 어떻게 동작하나요?',
      answer:
        '연동 계정을 등록하면 광고 데이터를 주기적으로 자동 수집해 매번 수동으로 리포트를 다운로드할 필요가 없습니다.',
    },
    {
      question: '여러 캠페인을 한 화면에서 비교할 수 있나요?',
      answer:
        '캠페인별 상세 페이지에서 대시보드·광고 데이터·키워드 분석 탭을 통해 성과를 비교하고 추이를 확인할 수 있습니다.',
    },
    {
      question: '무료로 사용할 수 있나요?',
      answer: '현재 베타 기간 동안 모든 기능을 무료로 이용할 수 있습니다.',
    },
  ],
  finalCta: {
    headline: '쿠팡 광고 데이터, 이제 자동으로 분석하세요',
    subcopy: '가입 후 바로 리포트를 업로드하고 첫 ROAS 대시보드를 확인해 보세요.',
  },
  relatedDecks: ['seller-hub'],
}
