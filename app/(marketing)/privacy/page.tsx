import type { Metadata } from 'next'
import { COMPANY, CONTACT_EMAIL } from '@/lib/marketing/company'
import { buildMarketingMetadata } from '@/lib/marketing/seo'

// 실값 확정 후 교체 필요: COMPANY(상호·대표자·사업자등록번호·주소·개인정보보호책임자) — src/lib/marketing/company.ts

export function generateMetadata(): Metadata {
  return buildMarketingMetadata({
    title: '개인정보처리방침 — Workdeck',
    description: 'Workdeck 개인정보처리방침입니다.',
    path: '/privacy',
  })
}

const sections = [
  {
    title: '1. 수집하는 개인정보 항목',
    body: `회사는 회원가입 및 서비스 제공을 위해 다음과 같은 개인정보를 수집합니다.
- 필수 항목: 이메일 주소, 인증 정보(Supabase Auth를 통한 로그인 정보)
- 이용 과정에서 생성되는 정보: 워크스페이스 내 업로드 데이터(광고 리포트, 재무 데이터, 재고 데이터 등), 서비스 이용 기록
- 결제 시: 결제 처리를 위해 필요한 정보(토스페이먼츠를 통해 처리되며, 카드번호 등 민감한 결제정보는 회사가 직접 저장하지 않습니다)`,
  },
  {
    title: '2. 개인정보의 수집 및 이용 목적',
    body: `- 회원 가입 및 관리, 본인 확인
- 서비스 제공 및 워크스페이스 운영(업로드된 데이터 분석·저장)
- 유료 서비스 이용 시 요금 결제 및 정산
- 서비스 개선 및 신규 기능 안내(선택 동의 시)`,
  },
  {
    title: '3. 개인정보의 보유 및 이용 기간',
    body: `회사는 이용자가 회원 탈퇴를 요청하거나 수집·이용 목적이 달성된 경우 지체 없이 해당 개인정보를 파기합니다. 다만 관계 법령에 따라 보존이 필요한 경우 해당 법령이 정한 기간 동안 보관합니다.`,
  },
  {
    title: '4. 개인정보의 제3자 제공',
    body: `회사는 이용자의 동의 없이 개인정보를 제3자에게 제공하지 않습니다. 다만 법령에 특별한 규정이 있거나 수사 목적으로 법령에 정해진 절차와 방법에 따라 수사기관의 요구가 있는 경우는 예외로 합니다.`,
  },
  {
    title: '5. 개인정보 처리 위탁',
    body: `회사는 서비스 제공을 위해 다음과 같이 개인정보 처리를 위탁하고 있습니다.
- Supabase: 인증 및 데이터베이스 인프라 운영
- 토스페이먼츠: 결제 처리
- Vercel: 서비스 호스팅, 쿠키를 사용하지 않는 방식의 이용 통계 분석(Vercel Analytics)`,
  },
  {
    title: '6. 이용자 업로드 데이터의 처리',
    body: `이용자가 서비스에 업로드하는 광고, 재무, 재고 등 업무 데이터의 소유권은 이용자에게 있습니다. 회사는 해당 데이터를 서비스 제공(분석, 대시보드 표시 등) 목적으로만 처리하며, 이용자의 요청이 있는 경우 지체 없이 삭제합니다.`,
  },
  {
    title: '7. 이용자의 권리와 행사 방법',
    body: `이용자는 언제든지 자신의 개인정보를 조회, 수정, 삭제하거나 처리 정지를 요청할 수 있으며, 서비스 내 설정 또는 아래 문의처를 통해 요청할 수 있습니다.`,
  },
  {
    title: '8. 개인정보의 안전성 확보 조치',
    body: `회사는 개인정보 보호를 위해 접근권한 관리, 데이터 암호화, 접속기록 보관 등 기술적·관리적 조치를 취하고 있습니다.`,
  },
  {
    title: '9. 개인정보보호책임자',
    body: `- 성명: ${COMPANY.privacyOfficer}\n- 이메일: ${COMPANY.privacyOfficerEmail}\n\n개인정보 처리와 관련한 문의, 불만 처리, 피해 구제 등에 관한 사항은 위 개인정보보호책임자에게 문의하실 수 있습니다.`,
  },
  {
    title: '부칙',
    body: `이 개인정보처리방침은 게시일로부터 시행됩니다. 방침에 관한 문의는 ${CONTACT_EMAIL}로 연락해 주시기 바랍니다.`,
  },
]

export default function PrivacyPage() {
  return (
    <div className="w-full px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-10">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold tracking-tight break-keep sm:text-4xl">
            개인정보처리방침
          </h1>
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
