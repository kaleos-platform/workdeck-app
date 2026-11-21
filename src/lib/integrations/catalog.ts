// 외부 서비스 연결 화면의 정적 목록 — 서버(상태 조회)와 클라이언트(그리드)가 같이 쓴다.
import { Bot, KeyRound, LockKeyhole, Plug, ShoppingBag, type LucideIcon } from 'lucide-react'
import { COUPANG_ADS_SETTINGS_PATH, SELLER_HUB_SETTINGS_PATH } from '@/lib/deck-routes'

export type IntegrationGroup = '판매 채널' | '광고·마케팅' | '협업 도구' | 'AI·에이전트' | '기타'

export const INTEGRATION_GROUPS: IntegrationGroup[] = [
  '판매 채널',
  '광고·마케팅',
  '협업 도구',
  'AI·에이전트',
  '기타',
]

export type IntegrationId =
  | 'coupang-api'
  | 'coupang-login'
  | 'naver-nbaesong'
  | 'cafe24'
  | 'meta-ads'
  | 'google-marketing'
  | 'naver-searchad'
  | 'slack'
  | 'notion'
  | 'google-drive'
  | 'workdeck-agent'
  | 'my-ai-app'
  | 'agent-tokens'
  | 'secrets'

/** dialog=팝업에서 설정, deck-link=업무 설정 화면으로 이동 */
export type IntegrationKind = 'dialog' | 'deck-link'

export type IntegrationService = {
  id: IntegrationId
  group: IntegrationGroup
  name: string
  description: string
  logo: { src: string } | { icon: LucideIcon }
  kind: IntegrationKind
  /** 이 업무(deck id)가 켜져 있을 때만 타일을 보인다. */
  requiredDeck?: string
  /** deck-link 타일의 이동 경로 */
  href?: string
  /** 상태·본문 모두 ADMIN 이상 전용(MEMBER에게는 서버가 조회하지 않는다). */
  adminOnly?: boolean
  /** MEMBER 화면에서 타일 자체를 숨긴다. */
  hiddenForMember?: boolean
  /** 키 발급 방법 — 공식 링크는 새 탭으로 연다. */
  keyGuide?: { steps: string[]; linkLabel: string; linkHref: string }
}

export const INTEGRATIONS: IntegrationService[] = [
  {
    id: 'coupang-api',
    group: '판매 채널',
    name: '쿠팡 Open API',
    description: '쿠팡 판매 데이터를 공식 API로 읽어 옵니다.',
    logo: { src: '/brand/coupang.svg' },
    kind: 'dialog',
    adminOnly: true,
    keyGuide: {
      steps: ['Wing에 로그인', '판매자정보 → 추가판매정보', 'OPEN API 키 발급'],
      linkLabel: '쿠팡 Wing 열기',
      linkHref: 'https://wing.coupang.com',
    },
  },
  {
    id: 'coupang-login',
    group: '판매 채널',
    name: '쿠팡 로그인',
    description: '광고·재고 수집에 쓰는 쿠팡 로그인 계정입니다.',
    logo: { src: '/brand/coupang.svg' },
    kind: 'deck-link',
    requiredDeck: 'coupang-ads',
    href: COUPANG_ADS_SETTINGS_PATH,
    adminOnly: true,
  },
  {
    id: 'naver-nbaesong',
    group: '판매 채널',
    name: '네이버 N배송',
    description: '네이버 N배송(위킵) 판매를 수집합니다.',
    logo: { src: '/brand/naver.svg' },
    kind: 'deck-link',
    requiredDeck: 'seller-hub',
    href: SELLER_HUB_SETTINGS_PATH,
  },
  {
    id: 'cafe24',
    group: '판매 채널',
    name: '카페24',
    description: '카페24 쇼핑몰의 주문을 읽고 배송 처리합니다.',
    logo: { icon: ShoppingBag },
    kind: 'dialog',
    requiredDeck: 'seller-hub',
    adminOnly: true,
  },
  {
    id: 'meta-ads',
    group: '광고·마케팅',
    name: 'Meta 광고',
    description: '페이스북·인스타그램 광고 성과를 에이전트가 읽습니다.',
    logo: { src: '/brand/meta.svg' },
    kind: 'dialog',
    adminOnly: true,
    keyGuide: {
      steps: [
        '비즈니스 설정 → 시스템 사용자 → 토큰 생성(ads_read·ads_management 권한)',
        '앱 대시보드 → 설정 → 앱 시크릿 확인',
        '광고 관리자에서 광고 계정 ID 확인',
      ],
      linkLabel: 'Meta 비즈니스 설정 열기',
      linkHref: 'https://business.facebook.com/settings/system-users',
    },
  },
  {
    id: 'google-marketing',
    group: '광고·마케팅',
    name: 'Google 마케팅',
    description: 'GA4·태그 관리자 데이터를 에이전트가 읽습니다.',
    logo: { src: '/brand/google.svg' },
    kind: 'dialog',
    adminOnly: true,
    keyGuide: {
      steps: [
        'Google Cloud 콘솔 → OAuth 클라이언트 ID 만들기(웹 애플리케이션, 리디렉션 URI 등록)',
        '클라이언트 ID·시크릿과 브랜드를 저장한 뒤 「Google로 연결」로 승인',
        '개발 담당자 도움이 필요할 수 있습니다',
      ],
      linkLabel: 'Google Cloud 콘솔 열기',
      linkHref: 'https://console.cloud.google.com/apis/credentials',
    },
  },
  {
    id: 'naver-searchad',
    group: '광고·마케팅',
    name: '네이버 검색광고',
    description: '검색광고 캠페인 성과를 에이전트가 읽습니다.',
    logo: { src: '/brand/naver.svg' },
    kind: 'dialog',
    adminOnly: true,
    keyGuide: {
      steps: [
        '검색광고 관리 → 도구 → API 사용 관리',
        '액세스 라이선스·비밀 키 발급',
        '관리 고객 ID와 광고주 고객 ID 확인',
      ],
      linkLabel: '네이버 검색광고 열기',
      linkHref: 'https://manage.searchad.naver.com',
    },
  },
  {
    id: 'slack',
    group: '협업 도구',
    name: 'Slack',
    description: '알림과 에이전트 대화를 Slack으로 받습니다.',
    logo: { src: '/brand/slack.svg' },
    kind: 'dialog',
    adminOnly: true,
  },
  {
    id: 'notion',
    group: '협업 도구',
    name: '노션',
    description: '노션 데이터베이스의 소재와 발행 요청을 가져옵니다.',
    logo: { src: '/brand/notion.svg' },
    kind: 'dialog',
    requiredDeck: 'sales-content',
    adminOnly: true,
  },
  {
    id: 'google-drive',
    group: '협업 도구',
    name: '구글 드라이브',
    description: '드라이브 폴더의 파일을 소재로 가져옵니다.',
    logo: { src: '/brand/google-drive.svg' },
    kind: 'dialog',
    requiredDeck: 'sales-content',
    adminOnly: true,
  },
  {
    id: 'workdeck-agent',
    group: 'AI·에이전트',
    name: '워크덱 에이전트',
    description: '워크덱 안에서 일하는 에이전트를 켜고 끕니다.',
    logo: { icon: Bot },
    kind: 'dialog',
    adminOnly: true,
  },
  {
    id: 'my-ai-app',
    group: 'AI·에이전트',
    name: '내 AI 앱 연결',
    description: 'Claude·Codex 같은 내 AI 앱을 워크덱에 연결합니다.',
    logo: { icon: Plug },
    kind: 'dialog',
  },
  {
    id: 'agent-tokens',
    group: 'AI·에이전트',
    name: '에이전트 접속 토큰',
    description: '외부 에이전트가 워크덱에 접속할 토큰을 발급합니다.',
    logo: { icon: KeyRound },
    kind: 'dialog',
    adminOnly: true,
    hiddenForMember: true,
  },
  {
    id: 'secrets',
    group: '기타',
    name: '직접 등록한 API·로그인',
    description: '에이전트가 쓸 API 키와 로그인 정보를 보관합니다.',
    logo: { icon: LockKeyhole },
    kind: 'dialog',
    adminOnly: true,
    hiddenForMember: true,
  },
]

export const OPENABLE_IDS = new Set<string>(
  INTEGRATIONS.filter((s) => s.kind === 'dialog').map((s) => s.id)
)

export type IntegrationState = 'connected' | 'not_connected' | 'attention' | 'unknown'
export type IntegrationStatus = { state: IntegrationState; summary?: string }
