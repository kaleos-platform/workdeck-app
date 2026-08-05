import type { DeckLandingContent } from '../types'

export const salesContentLanding: DeckLandingContent = {
  slug: 'sales-content',
  seo: {
    title: '세일즈 콘텐츠 — 브랜드 맞춤 콘텐츠 기획부터 배포까지',
    description:
      '상품·타겟 페르소나·브랜드 프로필을 등록하면 콘텐츠 기획부터 제작, 채널 배포, 성과 분석까지 이어집니다. Workdeck 세일즈 콘텐츠 Deck으로 마케팅 콘텐츠 운영을 체계화하세요.',
    keywords: [
      '세일즈 콘텐츠',
      '콘텐츠 마케팅',
      '콘텐츠 기획',
      '브랜드 콘텐츠 제작',
      '콘텐츠 배포 관리',
      '마케팅 콘텐츠 성과 분석',
      '콘텐츠 템플릿',
    ],
  },
  hero: {
    headline: '콘텐츠 기획부터 배포·성과까지,',
    highlight: '하나의 흐름으로',
    subcopy:
      '상품과 타겟 페르소나를 등록하면 콘텐츠 아이디어 기획, 제작, 채널 배포, 성과 분석이 하나의 흐름으로 이어집니다.',
    primaryCta: { label: '무료로 시작하기', href: '/signup' },
    secondaryCta: { label: '로그인', href: '/d/sales-content/login' },
  },
  painPoints: [
    {
      title: '콘텐츠 기획이 매번 처음부터',
      description:
        '상품별·타겟별 맥락이 정리되어 있지 않아 콘텐츠를 기획할 때마다 처음부터 다시 고민합니다.',
    },
    {
      title: '배포 채널이 흩어져 관리 어려움',
      description: '채널마다 배포 상태와 일정을 따로 관리하다 보니 누락이나 중복이 생깁니다.',
    },
    {
      title: '콘텐츠 성과를 추적하기 힘듦',
      description: '배포한 콘텐츠가 실제로 어떤 성과를 냈는지 채널별로 모아보기 어렵습니다.',
    },
  ],
  features: [
    {
      icon: 'users',
      title: '상품·페르소나·브랜드 프로필 설정',
      description: '상품 정보와 타겟 페르소나, 브랜드 톤을 등록해 콘텐츠 기획의 기준을 만듭니다.',
    },
    {
      icon: 'lightbulb',
      title: '콘텐츠 아이디어 기획',
      description: '등록된 상품·페르소나 맥락을 기반으로 콘텐츠 아이디어를 기획하고 관리합니다.',
    },
    {
      icon: 'layout-template',
      title: '콘텐츠 제작·템플릿',
      description: '템플릿을 활용해 콘텐츠를 제작하고 채널별 규칙에 맞춰 정리합니다.',
    },
    {
      icon: 'send',
      title: '채널 배포 관리',
      description: '여러 배포 채널의 일정과 상태를 통합 관리해 배포 누락을 방지합니다.',
    },
    {
      icon: 'bar-chart',
      title: '배포 성과 분석',
      description: '배포한 콘텐츠의 채널별 성과를 모아 분석하고 다음 콘텐츠 기획에 반영합니다.',
    },
  ],
  workflow: [
    {
      step: 1,
      title: '상품·페르소나 등록',
      description: '콘텐츠 기획의 기준이 되는 상품 정보와 타겟 페르소나를 등록합니다.',
    },
    {
      step: 2,
      title: '콘텐츠 기획·제작',
      description: '아이디어를 기획하고 템플릿을 활용해 콘텐츠를 제작합니다.',
    },
    {
      step: 3,
      title: '배포·성과 확인',
      description: '채널에 배포하고 성과 분석 화면에서 결과를 확인합니다.',
    },
  ],
  faq: [
    {
      question: '어떤 채널에 콘텐츠를 배포할 수 있나요?',
      answer: '여러 배포 채널을 등록해 채널별 일정과 배포 상태를 통합 관리할 수 있습니다.',
    },
    {
      question: '콘텐츠 템플릿을 직접 만들 수 있나요?',
      answer: '네. 템플릿을 등록해 반복되는 콘텐츠 제작 작업에 활용할 수 있습니다.',
    },
    {
      question: '배포 성과는 어떻게 확인하나요?',
      answer: '배포별 성과 분석 화면에서 채널별 결과를 모아 확인할 수 있습니다.',
    },
    {
      question: '무료로 사용할 수 있나요?',
      answer: '현재 베타 기간 동안 모든 기능을 무료로 이용할 수 있습니다.',
    },
  ],
  finalCta: {
    headline: '콘텐츠 기획부터 성과 분석까지, 한 곳에서',
    subcopy: '가입 후 상품과 페르소나를 등록하고 첫 콘텐츠를 기획해 보세요.',
  },
  relatedDecks: ['blog-ops'],
}
