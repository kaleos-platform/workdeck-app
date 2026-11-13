import type { DeckLandingContent, DeckLandingFeature } from '../types'

// 아래 두 기능은 개발 중이다. 운영 배포 뒤에만 true로 바꾼다(표시=실제).
// false면 데이터에서 빠지므로 화면·JSON-LD·llms.txt·요금 페이지 어디에도 나가지 않는다.
// 공개 PR에서 문구를 배포된 동작(MCP 도구 스키마 포함)과 다시 대조한다.
const RECRUITING_EMAIL_LIVE = false
const RECRUITING_AI_LIVE = false

const OPENING_MIGRATION_NOTICE_URL =
  'https://workdeck-work.notion.site/40982f170039814c9eb1dcc3ad51d800'

const EMAIL_FEATURE: DeckLandingFeature = {
  icon: 'mail',
  title: '이메일 알림',
  headline: '새 지원 소식을 메일로',
  description:
    '지원자가 이메일을 입력하면 제출 직후 접수 완료 메일이 가고, 회신하면 공고 담당자에게 전달됩니다. 담당자는 전날 새 지원자가 있으면 매일 오전 9시에 공고별 새 지원자 수를 요약 메일로 받습니다(지원자 개인정보는 담지 않습니다). 두 메일 모두 공고별로 끌 수 있습니다.',
}

const AI_FEATURE: DeckLandingFeature = {
  icon: 'bot',
  title: 'AI 연동',
  headline: '쓰던 AI에게 채용 현황을 물어보세요',
  description:
    'Claude 같은 AI에서 공고와 지원 현황을 조회하고 공고 초안을 제안받습니다. 초안은 워크덱에서 승인해야 반영되고, 지원자 개인정보는 AI에 보내지 않습니다.',
}

const NEW_APPLICANT_ALERT_ROW = RECRUITING_EMAIL_LIVE
  ? {
      before: '신규 지원자 접수 알림 (카카오톡)',
      after: '이메일 알림 (지원자 접수 완료·담당자 매일 요약)',
      diff: '채널 다름',
      same: false,
    }
  : {
      before: '신규 지원자 접수 알림 (카카오톡)',
      after: '지원서 제출 후 지원 완료 화면',
      diff: '다름',
      same: false,
    }

const NOTIFICATION_FAQ_ANSWER = RECRUITING_EMAIL_LIVE
  ? '지원자가 이메일을 입력하면 접수 완료 메일이 가고, 담당자는 전날 새 지원자가 있을 때 매일 오전 9시에 요약 메일을 받습니다. 공고별로 끌 수 있습니다. 결과 안내는 메시지 템플릿과 결과 확인 링크로 빠르게 전달합니다. 카카오톡 알림은 제공하지 않습니다.'
  : '지원서를 제출하면 지원 완료 화면이 바로 표시됩니다. 결과 안내는 메시지 템플릿과 지원자별 결과 확인 링크를 만들어 문자나 메신저로 빠르게 전달합니다. 카카오톡 알림은 제공하지 않습니다.'

export const recruitingLanding: DeckLandingContent = {
  slug: 'recruiting',
  seo: {
    title: '모집 관리 — 생산직·인력파견 대규모 채용 공고부터 지원자 관리까지',
    description:
      '채용 공고 제작, 간편 지원서, 지원자 통합 관리, 결과 안내까지 하나의 툴로. 생산직·인력파견·물류·매장 대규모 채용을 Workdeck 모집 관리로 체계화하세요. 신규 작업공간 7일 무료 체험.',
    keywords: [
      '채용 관리',
      '채용 공고 제작',
      '지원자 관리',
      '모집 관리',
      '알바 채용',
      '매장 채용 관리',
      '채용 공고 템플릿',
      '생산직 채용',
      '인력파견 채용',
      '대규모 채용 관리',
    ],
  },
  hero: {
    headline: '채용 시간은 줄이고.',
    highlight: '지원자는 더 많이.',
    subcopy:
      '생산직·인력파견처럼 반복되는 대규모 채용을, 공고 제작부터 지원자 관리와 결과 안내까지 한 곳에서 간편하게 관리하세요.',
    primaryCta: { label: '시작하기', href: '/signup' },
    secondaryCta: { label: '로그인', href: '/d/recruiting/login' },
    note: '7일 무료 체험 · 이후 월 22,000원(부가세 포함)',
  },
  migration: {
    utmSource: 'opening',
    headline: '오프닝워크를 쓰고 계셨나요? 서비스 종료 전에 그대로 옮겨 오세요.',
    points: [
      '월 13,500원(부가세 포함)을 계속 보장합니다 — 정가 22,000원',
      '최근 1년의 공고·템플릿·매장·직무·브랜드를 옮겨 드립니다 (지원자·계정은 옮기지 않습니다)',
      '7일 무료 체험으로 먼저 써 보고 결정하세요',
      '이전 신청은 12월 11일까지 받습니다',
    ],
    ctas: [
      // 이전 신청 접수는 공지 안의 경로로 받는다(도입 신청 폼은 utm을 저장하지 않음)
      { label: '이전 안내·신청 방법 보기', href: OPENING_MIGRATION_NOTICE_URL },
      { label: '먼저 무료로 써 보기', href: '#apply' },
    ],
    comparison: {
      headline: '오프닝워크에서 하던 일, 여기서는 이렇게',
      columns: ['오프닝워크', '워크덱 모집 관리', '차이'],
      rows: [
        {
          before: '공고 디자인 에디터·템플릿',
          after: '공고 디자인 에디터·상세 템플릿',
          diff: '그대로',
          same: true,
        },
        {
          before: '공고 HTML 코드·공고 링크',
          after: '공고 HTML 복사·공개 링크',
          diff: '그대로',
          same: true,
        },
        { before: '간편 지원서', after: '공고별 지원서 양식', diff: '그대로', same: true },
        {
          before: '지원자 통합 관리·메모·다운로드',
          after: '지원자 통합 관리·메모·엑셀 다운로드 + 블랙리스트',
          diff: '그대로',
          same: true,
        },
        { before: '팀원 초대', after: '멤버 초대', diff: '그대로', same: true },
        {
          before: '자주 쓰는 메시지 (휴대폰 문자앱으로 바로 열기)',
          after: '메시지 템플릿 + 지원자별 결과 확인 링크 (복사해 문자·메신저로 전달)',
          diff: '방식 다름',
          same: false,
        },
        NEW_APPLICANT_ALERT_ROW,
      ],
    },
  },
  painPoints: [
    {
      title: '공고를 올릴 때마다 새로 디자인',
      description:
        '직무·근무지마다 공고 이미지를 새로 만들다 보면 시간이 오래 걸리고 톤이 제각각입니다.',
    },
    {
      title: '지원자가 여러 플랫폼과 엑셀에 흩어짐',
      description:
        '지원서 양식을 따로 만들고 응답을 내려받아 합치는 사이, 대규모 지원자 확인과 연락에 누락이 생깁니다.',
    },
    {
      title: '결과 안내와 재지원자 확인이 번거로움',
      description:
        '합격·불합격 안내 문구를 매번 다시 쓰고, 과거에 문제가 있었던 지원자를 다시 걸러내기도 어렵습니다.',
    },
  ],
  featureStyle: 'rows',
  features: [
    {
      icon: 'palette',
      title: '공고 디자인 에디터',
      headline: '디자인을 몰라도 공고를 빠르게',
      description:
        '디자인 블록과 상세 템플릿으로 공고를 꾸밉니다. 다른 도구로 만든 공고 이미지도 이미지 블록으로 그대로 넣을 수 있습니다.',
    },
    {
      icon: 'inbox',
      title: '공고 링크 & 간편 지원서',
      headline: '공고마다 링크와 지원서가 바로',
      description:
        '게시한 공고마다 공개 링크와 HTML 코드가 생겨 어느 채용 채널에든 올릴 수 있습니다. 공고별 지원서 양식으로 별도 설문 도구 없이 지원자를 한 곳에 모읍니다.',
    },
    {
      icon: 'store',
      title: '지원자 통합 관리',
      headline: '모든 지원자를 한눈에',
      description:
        '여러 공고의 지원자를 근무지·직무·채용 단계·기간별로 확인하고, 합격·불합격과 단계 변경을 일괄로 처리합니다. 메모와 엑셀 다운로드, 문제가 있었던 지원자를 기록하는 블랙리스트도 함께 씁니다.',
    },
    {
      icon: 'message-square',
      title: '메시지 템플릿 & 결과 안내',
      headline: '안내 문구는 템플릿으로, 결과는 링크로',
      description:
        '면접·합격·불합격 안내 문구를 템플릿으로 만들어 두고, 지원자별 결과 확인 링크를 바로 만들어 문자나 메신저로 빠르게 안내합니다.',
    },
    ...(RECRUITING_EMAIL_LIVE ? [EMAIL_FEATURE] : []),
    ...(RECRUITING_AI_LIVE ? [AI_FEATURE] : []),
  ],
  industries: [
    '인력파견·도급',
    '물류 센터',
    '생산 공장',
    '매장 관리',
    '콜센터',
    'F&B',
    '배달·운송',
    '숙박·리조트',
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
      description: '채용 공고에 반복 사용할 근무지와 직무 정보를 한 번만 등록합니다.',
    },
    {
      step: 2,
      title: '공고 제작·게시',
      description: '디자인 블록이나 상세 템플릿으로 공고를 꾸미고, 지원서 양식을 정해 게시합니다.',
    },
    {
      step: 3,
      title: '지원자 관리·결과 안내',
      description: '접수된 지원자를 단계별로 관리하고 메시지 템플릿으로 결과를 안내합니다.',
    },
  ],
  faq: [
    {
      question: '신청하면 어떻게 이용하나요?',
      answer:
        '도입 신청을 남겨 주시면 담당자가 확인 후 24시간 안에 이메일로 이용 방법을 안내드립니다. 바로 시작하고 싶다면 가입 후 모집 관리를 추가해 곧장 이용할 수도 있습니다.',
    },
    {
      question: '이용 비용은 얼마인가요?',
      answer:
        '모집 관리는 월 22,000원(부가세 포함)의 구독 상품이며, 신규 작업공간은 7일 무료로 체험할 수 있습니다. 언제든 해지할 수 있습니다.',
    },
    {
      question: '다른 툴로 만든 공고 이미지를 사용할 수 있나요?',
      answer:
        '네. 공고 상세에 이미지 블록으로 넣을 수 있고, 지원서 양식과 지원자 관리는 모집 관리에서 그대로 이용합니다.',
    },
    {
      question: '제작한 공고는 어디에 활용할 수 있나요?',
      answer:
        '게시한 공고는 공개 링크로 공유할 수 있고, 공고 HTML 코드를 복사해 다른 채널에 붙여 넣을 수도 있습니다.',
    },
    {
      question: '간편 지원서의 장점은 무엇인가요?',
      answer:
        '공고마다 지원서 양식을 바로 만들고, 접수된 지원서가 지원자 목록에 자동으로 모입니다. 설문 도구로 응답을 내려받아 합치는 과정이 필요 없습니다.',
    },
    {
      question: '지원자에게 알림이 가나요?',
      answer: NOTIFICATION_FAQ_ANSWER,
    },
    {
      question: '블랙리스트는 어떻게 활용되나요?',
      answer: '문제가 있었던 지원자 정보를 기록해 두면 재지원 시 빠르게 확인할 수 있습니다.',
    },
  ],
  finalCta: {
    headline: '채용 공고부터 지원자 관리까지, 이제 한 곳에서',
    subcopy: '도입 신청을 남기면 24시간 안에 이메일로 안내드립니다.',
  },
  leadForm: {
    headline: '무료로 이용해 보세요',
    subcopy: '정보를 남겨 주시면 담당자가 확인 후 24시간 안에 이메일로 이용 방법을 안내드립니다.',
  },
  relatedDecks: ['sales-content'],
}
