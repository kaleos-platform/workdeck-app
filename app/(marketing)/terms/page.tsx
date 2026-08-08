import type { Metadata } from 'next'
import { COMPANY, CONTACT_EMAIL } from '@/lib/marketing/company'
import { buildMarketingMetadata } from '@/lib/marketing/seo'

// 실값 확정 후 교체 필요: COMPANY(상호·대표자·사업자등록번호·주소) — src/lib/marketing/company.ts

export function generateMetadata(): Metadata {
  return buildMarketingMetadata({
    title: '이용약관 — Workdeck',
    description: 'Workdeck 서비스 이용약관입니다.',
    path: '/terms',
  })
}

const sections = [
  {
    title: '제1조 (목적)',
    body: `이 약관은 ${COMPANY.name}(이하 "회사")가 제공하는 Workdeck 서비스(이하 "서비스")의 이용과 관련하여 회사와 이용자의 권리, 의무 및 책임사항, 기타 필요한 사항을 규정함을 목적으로 합니다.`,
  },
  {
    title: '제2조 (정의)',
    body: `① "서비스"란 회사가 제공하는 광고 분석, 재고·배송 운영, 재무 관리, 채용, 세일즈 콘텐츠, 블로그 운영 등 업무별 모듈(이하 "업무 모듈")과 이를 이용하기 위한 워크스페이스 일체를 의미합니다.
② "이용자"란 이 약관에 따라 회사와 이용계약을 체결하고 서비스를 이용하는 개인 또는 법인을 의미합니다.
③ "워크스페이스"란 이용자가 소속되어 하나 이상의 업무 모듈을 이용하는 단위 공간을 의미합니다.`,
  },
  {
    title: '제3조 (약관의 게시와 개정)',
    body: `① 회사는 이 약관의 내용을 이용자가 쉽게 알 수 있도록 서비스 초기 화면 또는 연결화면에 게시합니다.
② 회사는 관련 법령을 위배하지 않는 범위에서 이 약관을 개정할 수 있으며, 개정 시 적용일자 및 개정사유를 명시하여 최소 7일 전(이용자에게 불리한 변경의 경우 30일 전)부터 서비스 내 공지 또는 이메일로 안내합니다.`,
  },
  {
    title: '제4조 (서비스의 제공 및 변경)',
    body: `① 회사는 이용자가 필요한 업무 모듈을 선택하여 이용할 수 있도록 서비스를 제공합니다.
② 현재 모든 업무 모듈은 베타 기간 동안 무료로 제공되며, 정식 유료 전환 시점과 조건은 사전에 공지합니다.
③ 회사는 운영상, 기술상의 필요에 따라 제공하는 서비스의 전부 또는 일부를 변경할 수 있으며, 이 경우 변경 사유와 내용을 사전에 공지합니다.`,
  },
  {
    title: '제5조 (이용자 데이터의 소유 및 처리)',
    body: `① 이용자가 서비스에 업로드하는 광고 데이터, 재무 데이터, 재고 데이터 등 일체의 데이터에 대한 소유권은 이용자에게 있습니다.
② 회사는 서비스 제공 목적 범위 내에서만 이용자 데이터를 처리하며, 이용자의 동의 없이 이를 제3자에게 제공하지 않습니다. 자세한 사항은 개인정보처리방침을 따릅니다.
③ 이용계약 종료 시 이용자 데이터의 보관·파기 정책은 개인정보처리방침에 따릅니다.`,
  },
  {
    title: '제6조 (유료 서비스 및 결제)',
    body: `① 회사는 정식 유료 전환 이후 업무 모듈별 구독료를 부과할 수 있으며, 요금 및 결제 방식은 서비스 내 요금제 페이지에서 안내합니다.
② 결제는 토스페이먼츠 등 회사가 지정하는 전자결제 서비스를 통해 이루어집니다.
③ 이용자는 구독 중인 업무 모듈을 언제든지 해지할 수 있으며, 해지 시점과 환불 정책은 관련 법령 및 회사가 정한 기준에 따릅니다.`,
  },
  {
    title: '제7조 (이용자의 의무)',
    body: `이용자는 다음 각 호에 해당하는 행위를 하여서는 안 됩니다.
1. 타인의 계정을 도용하거나 부정하게 사용하는 행위
2. 서비스를 이용하여 법령 또는 이 약관이 금지하는 행위를 하는 행위
3. 서비스의 안정적 운영을 방해할 수 있는 방법으로 서비스를 이용하는 행위`,
  },
  {
    title: '제8조 (책임 제한)',
    body: `회사는 천재지변, 이용자의 귀책사유 등 회사가 통제할 수 없는 사유로 인한 서비스 중단에 대해서는 책임을 지지 않습니다. 회사는 이용자가 업로드한 데이터의 정확성, 이를 기반으로 한 분석 결과의 활용에 대해 보증하지 않습니다.`,
  },
  {
    title: '제9조 (계약 해지)',
    body: `이용자는 언제든지 서비스 내 설정을 통해 이용계약 해지(회원탈퇴)를 신청할 수 있으며, 회사는 관련 법령에 따라 이를 즉시 처리합니다.`,
  },
  {
    title: '제10조 (분쟁 해결)',
    body: `이 약관과 관련하여 회사와 이용자 간 분쟁이 발생한 경우 상호 협의하여 해결하는 것을 원칙으로 하며, 협의가 이루어지지 않을 경우 관련 법령이 정한 절차에 따릅니다.`,
  },
  {
    title: '부칙',
    body: `이 약관은 게시일로부터 시행됩니다. 약관에 관한 문의는 ${CONTACT_EMAIL}로 연락해 주시기 바랍니다.`,
  },
]

export default function TermsPage() {
  return (
    <div className="w-full px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-10">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold tracking-tight break-keep sm:text-4xl">이용약관</h1>
          <p className="text-sm break-keep text-muted-foreground">시행일: 2026년 8월 5일</p>
        </div>

        <div className="space-y-8">
          {sections.map((section) => (
            <div key={section.title} className="space-y-2">
              <h2 className="text-lg font-semibold break-keep">{section.title}</h2>
              <p className="leading-relaxed break-keep whitespace-pre-line text-muted-foreground">
                {section.body}
              </p>
            </div>
          ))}
        </div>

        <div className="space-y-1 rounded-lg border bg-muted/30 p-6 text-sm break-keep text-muted-foreground">
          <p className="font-semibold text-foreground">{COMPANY.name}</p>
          <p>대표자: {COMPANY.ceo}</p>
          <p>사업자등록번호: {COMPANY.registrationNumber}</p>
          <p>주소: {COMPANY.address}</p>
        </div>
      </div>
    </div>
  )
}
