import type { DeckLandingContent } from '../types'

export const recruitingLanding: DeckLandingContent = {
  slug: 'recruiting',
  seo: {
    title: '모집 관리 — 채용 공고 꾸미기부터 지원자 관리까지',
    description:
      '디자인 블록으로 채용 공고를 꾸미고, 지원자 접수·관리·블랙리스트까지 한 곳에서 처리합니다. Workdeck 모집 관리로 매장·매니저 채용 프로세스를 체계화하세요.',
    keywords: [
      '채용 관리',
      '채용 공고 제작',
      '지원자 관리',
      '모집 관리',
      '알바 채용',
      '매장 채용 관리',
      '채용 공고 템플릿',
    ],
  },
  hero: {
    headline: '채용 공고 제작부터 지원자 관리까지,',
    highlight: '한 흐름으로',
    subcopy:
      '디자인 블록으로 채용 공고를 직접 꾸미고, 접수된 지원자를 관리하고, 블랙리스트까지 함께 관리할 수 있습니다.',
    primaryCta: { label: '무료로 시작하기', href: '/signup' },
    secondaryCta: { label: '로그인', href: '/d/recruiting/login' },
  },
  painPoints: [
    {
      title: '채용 공고를 매번 새로 디자인',
      description:
        '매장·직무마다 공고 디자인을 새로 만들다 보면 시간이 오래 걸리고 톤이 제각각입니다.',
    },
    {
      title: '지원자 관리가 메신저·엑셀에 흩어짐',
      description: '지원자 연락과 진행 상태를 메신저와 엑셀로 따로 관리하다 누락이 생깁니다.',
    },
    {
      title: '문제 지원자 재확인이 어려움',
      description:
        '과거에 문제가 있었던 지원자를 다시 걸러내기 위한 기록이 체계적으로 남지 않습니다.',
    },
  ],
  features: [
    {
      icon: 'palette',
      title: '디자인 블록 공고 꾸미기',
      description:
        '디자인 블록을 조합해 채용 공고를 직접 꾸미고, 상세 템플릿으로 빠르게 시작할 수 있습니다.',
    },
    {
      icon: 'inbox',
      title: '지원자 접수·관리',
      description: '공고별 지원자를 접수하고 진행 상태를 단계별로 관리합니다.',
    },
    {
      icon: 'message-square',
      title: '메시지 템플릿',
      description:
        '지원자에게 보내는 안내·합격·불합격 메시지를 템플릿으로 관리해 반복 작업을 줄입니다.',
    },
    {
      icon: 'shield-alert',
      title: '블랙리스트 관리',
      description: '문제가 있었던 지원자 정보를 기록해 재지원 시 빠르게 확인할 수 있습니다.',
    },
    {
      icon: 'store',
      title: '매장·직무 설정',
      description: '매장과 직무 정보를 미리 등록해 공고 제작 시 반복 입력을 줄입니다.',
    },
  ],
  screenshots: [
    {
      src: '/marketing/recruiting/dashboard.png',
      alt: '모집 관리 공고 목록 화면',
      caption: '채용 공고 상태와 지원자 현황을 한눈에',
    },
  ],
  workflow: [
    {
      step: 1,
      title: '매장·직무 등록',
      description: '채용 공고에 반복 사용할 매장과 직무 정보를 등록합니다.',
    },
    {
      step: 2,
      title: '공고 제작·게시',
      description: '디자인 블록이나 상세 템플릿으로 공고를 꾸며 게시합니다.',
    },
    {
      step: 3,
      title: '지원자 관리·소통',
      description: '접수된 지원자를 단계별로 관리하고 메시지 템플릿으로 소통합니다.',
    },
  ],
  faq: [
    {
      question: '채용 공고를 디자인 지식 없이도 만들 수 있나요?',
      answer:
        '네. 디자인 블록과 상세 템플릿을 활용하면 별도 디자인 도구 없이도 공고를 꾸밀 수 있습니다.',
    },
    {
      question: '지원자에게 보내는 메시지도 관리할 수 있나요?',
      answer:
        '메시지 템플릿 기능으로 안내·합격·불합격 메시지를 미리 만들어 반복 사용할 수 있습니다.',
    },
    {
      question: '블랙리스트는 어떻게 활용되나요?',
      answer: '문제가 있었던 지원자 정보를 기록해 두면 재지원 시 빠르게 확인할 수 있습니다.',
    },
    {
      question: '무료로 사용할 수 있나요?',
      answer: '현재 베타 기간 동안 모든 기능을 무료로 이용할 수 있습니다.',
    },
  ],
  finalCta: {
    headline: '채용 공고부터 지원자 관리까지, 이제 한 곳에서',
    subcopy: '가입 후 매장 정보를 등록하고 첫 채용 공고를 만들어 보세요.',
  },
  relatedDecks: ['sales-content'],
}
