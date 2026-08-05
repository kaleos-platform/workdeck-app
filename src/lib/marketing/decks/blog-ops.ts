import type { DeckLandingContent } from '../types'

export const blogOpsLanding: DeckLandingContent = {
  slug: 'blog-ops',
  seo: {
    title: '블로그 운영 — 소재 기획부터 포스팅·채널 배포까지',
    description:
      '상품 정보를 기반으로 블로그 소재를 기획하고, 포스팅을 제작해 여러 채널에 배포합니다. Workdeck 블로그 운영 Deck으로 반복되는 블로그 마케팅 업무를 체계화하세요.',
    keywords: [
      '블로그 운영',
      '블로그 마케팅',
      '블로그 포스팅 관리',
      '콘텐츠 소재 기획',
      '블로그 채널 배포',
      '체험단 블로그',
      '브랜드 블로그 관리',
    ],
  },
  hero: {
    headline: '블로그 소재 기획부터 배포까지,',
    highlight: '반복 작업 없이',
    subcopy:
      '상품 정보를 기반으로 소재를 기획하고 포스팅을 제작해, 여러 채널에 배포까지 한 곳에서 관리합니다.',
    primaryCta: { label: '무료로 시작하기', href: '/signup' },
    secondaryCta: { label: '로그인', href: '/d/blog-ops/login' },
  },
  painPoints: [
    {
      title: '블로그 소재가 매번 바닥',
      description:
        '상품은 계속 바뀌는데 블로그에 쓸 소재를 매번 새로 고민하다 보니 발행 주기가 늘어집니다.',
    },
    {
      title: '포스팅 이력 관리가 안 됨',
      description: '어떤 상품을 언제 어떤 채널에 올렸는지 기록이 흩어져 중복·누락이 생깁니다.',
    },
    {
      title: '여러 채널 배포를 따로 관리',
      description: '채널마다 배포 일정과 상태를 따로 확인하다 보니 관리 부담이 커집니다.',
    },
  ],
  features: [
    {
      icon: 'shopping-bag',
      title: '상품 기반 소재 기획',
      description: '등록한 상품 정보를 바탕으로 블로그에 쓸 소재를 기획하고 관리합니다.',
    },
    {
      icon: 'lightbulb',
      title: '아이디어·소재 관리',
      description: '기획한 아이디어와 소재를 모아 두고 포스팅 제작에 바로 활용합니다.',
    },
    {
      icon: 'file-text',
      title: '포스팅 제작·관리',
      description: '소재를 기반으로 포스팅을 제작하고 발행 이력을 체계적으로 관리합니다.',
    },
    {
      icon: 'send',
      title: '채널 배포 관리',
      description: '여러 블로그 채널의 배포 일정과 상태를 통합 관리합니다.',
    },
  ],
  workflow: [
    {
      step: 1,
      title: '상품·소재 등록',
      description: '블로그에 다룰 상품 정보와 소재를 등록합니다.',
    },
    {
      step: 2,
      title: '포스팅 제작',
      description: '기획된 소재를 기반으로 포스팅을 제작합니다.',
    },
    {
      step: 3,
      title: '채널 배포',
      description: '완성된 포스팅을 채널별로 배포하고 이력을 관리합니다.',
    },
  ],
  faq: [
    {
      question: '어떤 채널에 포스팅을 배포할 수 있나요?',
      answer: '여러 블로그 채널을 등록해 채널별 배포 일정과 상태를 통합 관리할 수 있습니다.',
    },
    {
      question: '소재 기획은 어떻게 진행되나요?',
      answer:
        '등록한 상품 정보를 기반으로 아이디어와 소재를 정리해 포스팅 제작에 바로 활용할 수 있습니다.',
    },
    {
      question: '발행 이력을 확인할 수 있나요?',
      answer: '상품별·채널별 포스팅 이력을 관리해 중복·누락 없이 발행 현황을 확인할 수 있습니다.',
    },
    {
      question: '무료로 사용할 수 있나요?',
      answer: '현재 베타 기간 동안 모든 기능을 무료로 이용할 수 있습니다.',
    },
  ],
  finalCta: {
    headline: '블로그 운영, 소재 걱정 없이 꾸준하게',
    subcopy: '가입 후 상품을 등록하고 첫 블로그 소재를 기획해 보세요.',
  },
  relatedDecks: ['sales-content'],
}
