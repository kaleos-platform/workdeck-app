import type { DeckLandingContent } from '../types'

export const financeLanding: DeckLandingContent = {
  slug: 'finance',
  seo: {
    title: '재무 관리 — 거래내역 자동분류·현금흐름 손익 대시보드',
    description:
      '거래내역을 업로드하면 자동으로 분류되고, 현금흐름 손익 관점 대시보드로 한눈에 재무 상태를 확인합니다. Workdeck 재무 관리 Deck으로 수기 정리하던 회계 업무를 줄이세요.',
    keywords: [
      '재무 관리',
      '거래내역 자동분류',
      '현금흐름 관리',
      '손익 관리',
      '계좌 관리',
      '부채 관리',
      '소상공인 회계',
      '자금흐름 대시보드',
    ],
  },
  hero: {
    headline: '거래내역은 자동분류,',
    highlight: '현금흐름은 한눈에',
    subcopy:
      '은행·카드 거래내역을 업로드하면 학습된 규칙으로 자동 분류되고, 현금흐름 손익 관점 대시보드에서 자금 흐름을 바로 확인할 수 있습니다.',
    primaryCta: { label: '무료로 시작하기', href: '/signup' },
    secondaryCta: { label: '로그인', href: '/d/finance/login' },
  },
  painPoints: [
    {
      title: '거래내역을 매번 수기로 분류',
      description:
        '엑셀로 받은 거래내역을 계정과목별로 매번 손으로 분류하는 데 시간이 오래 걸립니다.',
    },
    {
      title: '현금흐름을 파악하기 어려움',
      description: '통장 잔액만 보고 실제 수입·지출 구조와 손익 흐름을 파악하기 힘듭니다.',
    },
    {
      title: '부채·계좌 현황이 흩어져 있음',
      description:
        '여러 계좌와 대출을 따로 관리하다 보니 전체 자산·부채 현황을 한번에 보기 어렵습니다.',
    },
  ],
  features: [
    {
      icon: 'upload',
      title: '거래내역 업로드·자동분류',
      description:
        '은행·카드 거래내역 파일을 업로드하면 학습된 규칙으로 계정과목이 자동 분류됩니다.',
    },
    {
      icon: 'git-branch',
      title: '현금흐름 손익 대시보드',
      description: '현금주의 기준 손익 관점으로 자금흐름을 시각화해 재무 상태를 바로 파악합니다.',
    },
    {
      icon: 'landmark',
      title: '계좌·부채 관리',
      description: '자산·부채 계좌를 통합 관리하고, 대출 상환을 계좌와 연결해 자동으로 추적합니다.',
    },
    {
      icon: 'tag',
      title: '학습형 분류 규칙',
      description:
        '한 번 분류한 거래는 규칙으로 학습되어 다음부터 자동으로 같은 계정과목에 분류됩니다.',
    },
    {
      icon: 'file-text',
      title: '업로드 파일 관리',
      description:
        '업로드 일자와 파일 단위로 등록 이력을 관리하고, 필요 시 파일 단위로 삭제할 수 있습니다.',
    },
  ],
  workflow: [
    {
      step: 1,
      title: '거래내역 업로드',
      description: '은행·카드사에서 받은 거래내역 파일을 업로드합니다.',
    },
    {
      step: 2,
      title: '자동 분류·검토',
      description: '학습된 규칙으로 자동 분류된 내역을 검토하고 필요한 부분만 수정합니다.',
    },
    {
      step: 3,
      title: '현금흐름·손익 확인',
      description: '현금흐름 대시보드에서 기간별 손익과 자금 흐름을 한눈에 확인합니다.',
    },
  ],
  faq: [
    {
      question: '어떤 형식의 거래내역을 업로드할 수 있나요?',
      answer:
        '은행·카드사에서 제공하는 거래내역 파일을 업로드할 수 있으며, 파일 형식을 자동으로 식별해 처리합니다.',
    },
    {
      question: '분류 규칙은 어떻게 학습되나요?',
      answer:
        '거래내역을 한 번 분류하면 동일한 조건의 거래를 자동으로 같은 계정과목에 분류하는 규칙으로 저장됩니다.',
    },
    {
      question: '대출 상환도 자동으로 반영되나요?',
      answer: '연결된 계좌에서 상환 거래가 감지되면 부채 잔액에 원클릭으로 반영할 수 있습니다.',
    },
    {
      question: '무료로 사용할 수 있나요?',
      answer: '현재 베타 기간 동안 모든 기능을 무료로 이용할 수 있습니다.',
    },
  ],
  finalCta: {
    headline: '재무 정리, 이제 자동분류로 끝내세요',
    subcopy: '가입 후 거래내역을 업로드하고 첫 현금흐름 대시보드를 확인해 보세요.',
  },
  relatedDecks: ['seller-hub'],
}
