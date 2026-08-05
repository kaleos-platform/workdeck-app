import type { DeckLandingContent } from '../types'

export const sellerHubLanding: DeckLandingContent = {
  slug: 'seller-hub',
  seo: {
    title: '브랜드 운영 — 재고·발주·배송·가격 시뮬레이션 통합 관리',
    description:
      '재고 현황, 발주·입고, 배송 등록, 판매 분석, 가격 시뮬레이션까지 브랜드 운영에 필요한 모든 업무를 한 곳에서. Workdeck 브랜드 운영 Deck으로 여러 채널의 재고와 마진을 한눈에 관리하세요.',
    keywords: [
      '재고 관리',
      '발주 관리',
      '배송 관리',
      '판매 분석',
      '가격 시뮬레이션',
      '이커머스 재고관리',
      '멀티채널 재고',
      '마진율 계산',
    ],
  },
  hero: {
    headline: '재고·발주·배송·가격까지,',
    highlight: '브랜드 운영 전체를 한 곳에서',
    subcopy:
      '여러 판매 채널의 재고와 발주를 따로 관리하다 생기는 누락과 오차를 줄이고, 가격 시뮬레이션으로 채널별 마진까지 미리 계산하세요.',
    primaryCta: { label: '무료로 시작하기', href: '/signup' },
    secondaryCta: { label: '로그인', href: '/d/seller-ops/login' },
  },
  painPoints: [
    {
      title: '채널마다 다른 재고 시트',
      description:
        '채널별로 재고를 따로 관리하다 보면 실재고와 시트가 어긋나 품절·과다발주가 반복됩니다.',
    },
    {
      title: '발주 시점을 감으로 판단',
      description: '출고 추이를 정리할 시간이 없어 발주 시점과 수량을 경험으로만 정합니다.',
    },
    {
      title: '채널별 마진을 사후에나 파악',
      description:
        '수수료·배송비·광고비를 반영한 실제 마진율을 판매 전에 계산하기 어려워 저마진 판매가 뒤늦게 드러납니다.',
    },
  ],
  features: [
    {
      icon: 'box',
      title: '재고 현황·이동 관리',
      description: '위치별 재고 현황, 입출고 이동, 재고 실사 대조까지 한 화면에서 관리합니다.',
    },
    {
      icon: 'truck',
      title: '발주·입고 관리',
      description: '출고 추이 기반으로 발주 시점을 판단하고 입고까지 이력으로 추적합니다.',
    },
    {
      icon: 'package',
      title: '배송 등록·주문 관리',
      description: '배송 방법 설정부터 주문 등록, 배송 현황 관리까지 지원합니다.',
    },
    {
      icon: 'trending-up',
      title: '판매 분석',
      description: '채널별 판매 데이터를 모아 매출·재고 흐름을 함께 파악합니다.',
    },
    {
      icon: 'calculator',
      title: '가격 시뮬레이션',
      description: '채널 수수료·배송비·광고비를 반영해 판매가 조정 시 마진율을 즉시 계산합니다.',
    },
  ],
  workflow: [
    {
      step: 1,
      title: '채널·상품 연동',
      description: '판매 채널과 상품 정보를 등록하면 재고와 판매 데이터가 한 곳에 모입니다.',
    },
    {
      step: 2,
      title: '재고·발주 흐름 관리',
      description: '재고 현황과 출고 추이를 바탕으로 발주 시점과 수량을 판단합니다.',
    },
    {
      step: 3,
      title: '가격·마진 시뮬레이션',
      description: '채널별 수수료와 비용을 반영해 최적 판매가와 마진율을 확인합니다.',
    },
  ],
  faq: [
    {
      question: '여러 판매 채널의 재고를 한 곳에서 관리할 수 있나요?',
      answer: '네. 채널별 재고를 통합 관리하며 위치별 재고 현황과 이동 이력을 추적할 수 있습니다.',
    },
    {
      question: '가격 시뮬레이션은 어떤 비용을 반영하나요?',
      answer:
        '채널 수수료, 배송비, 광고비, VAT 등을 반영해 판매가 조정 시 실제 마진율을 계산합니다.',
    },
    {
      question: '발주 시점을 자동으로 추천해 주나요?',
      answer: '출고 추이와 재고 현황을 기반으로 발주가 필요한 시점과 수량 판단을 지원합니다.',
    },
    {
      question: '무료로 사용할 수 있나요?',
      answer: '현재 베타 기간 동안 모든 기능을 무료로 이용할 수 있습니다.',
    },
  ],
  finalCta: {
    headline: '브랜드 운영, 흩어진 시트 대신 한 곳에서',
    subcopy: '가입 후 상품과 채널을 등록하고 첫 재고 현황을 확인해 보세요.',
  },
  relatedDecks: ['coupang-ads', 'finance'],
}
