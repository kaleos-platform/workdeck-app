import type { Metadata } from 'next'
import { COMPANY, CONTACT_EMAIL } from '@/lib/marketing/company'
import { buildMarketingMetadata } from '@/lib/marketing/seo'

export function generateMetadata(): Metadata {
  return buildMarketingMetadata({
    title: '취소·환불 규정 — Workdeck',
    description:
      'Workdeck 업무 모듈 구독의 청약철회, 중도 해지, 환불 기준과 신청 방법을 안내합니다.',
    path: '/refund',
    keywords: ['Workdeck 환불', 'Workdeck 청약철회', 'Workdeck 해지'],
  })
}

/**
 * 규정 내용은 실제 구현 동작과 일치해야 한다.
 * - 중도 해지: SubscriptionItem이 CANCEL_AT_PERIOD_END로 전환되어 기간 말까지 이용, 잔여기간 일할 환불 없음
 * - 업무 모듈 추가: 남은 기간 일할 계산 즉시 결제 (src/lib/billing/pricing.ts prorate)
 */
const sections = [
  {
    title: '1. 적용 범위',
    body: `이 규정은 ${COMPANY.name}(이하 "회사")가 제공하는 Workdeck 서비스의 업무 모듈 구독 상품에 적용됩니다. Workdeck은 온라인으로 제공되는 소프트웨어 이용권으로, 별도의 재화 배송이 발생하지 않습니다.`,
  },
  {
    title: '2. 청약철회 (결제 후 7일 이내)',
    body: `① 이용자는 결제일로부터 7일 이내에 청약철회를 신청할 수 있습니다.
② 다만 「전자상거래 등에서의 소비자보호에 관한 법률」 제17조 제2항에 따라, 이용자가 해당 업무 모듈을 실질적으로 이용한 경우(데이터 업로드·분석 실행·콘텐츠 생성 등 서비스의 핵심 기능을 사용한 경우) 청약철회가 제한될 수 있습니다.
③ 회사는 청약철회 제한 사유가 있는 경우, 결제 전 상품 페이지에 그 사실을 명시합니다.`,
  },
  {
    title: '3. 구독 해지 및 잔여 기간',
    body: `① 이용자는 워크스페이스 [설정 > 결제] 화면에서 언제든지 업무 모듈 구독을 해지할 수 있습니다.
② 해지를 신청하면 이미 결제한 이용 기간의 마지막 날까지 서비스를 정상적으로 이용할 수 있으며, 그 다음 결제 주기부터 요금이 청구되지 않습니다.
③ 이용 기간 도중 해지하는 경우 잔여 기간에 대한 일할 환불은 제공되지 않습니다. 대신 결제한 기간 전체를 이용할 수 있습니다.
④ 해지 이후에도 이용자가 업로드한 데이터는 개인정보처리방침에서 정한 보관 기준에 따라 처리됩니다.`,
  },
  {
    title: '4. 이용 기간 중 업무 모듈 추가',
    body: `이용 기간 중 새로운 업무 모듈을 추가하는 경우, 남은 이용 일수에 대해 일할 계산된 금액이 즉시 결제되며 다음 결제일부터는 전체 구독 금액이 청구됩니다.`,
  },
  {
    title: '5. 회사 귀책 사유에 따른 환불',
    body: `회사의 귀책 사유(서비스 장애, 회사의 일방적 서비스 종료 등)로 이용자가 서비스를 정상적으로 이용하지 못한 경우, 회사는 이용하지 못한 기간에 해당하는 금액을 환불하거나 그 기간만큼 이용 기간을 연장합니다.`,
  },
  {
    title: '6. 환불 방법 및 처리 기간',
    body: `① 환불은 원칙적으로 결제에 사용한 수단을 통해 이루어집니다(카드 결제 취소).
② 회사는 환불 사유를 확인한 날로부터 영업일 기준 3일 이내에 환불 절차를 진행하며, 카드사 사정에 따라 실제 반영까지 추가로 3~5영업일이 소요될 수 있습니다.
③ 결제 취소가 불가능한 경우 이용자가 지정한 계좌로 환불합니다.`,
  },
  {
    title: '7. 환불 신청 방법',
    body: `환불·해지 관련 문의는 아래로 연락해 주시기 바랍니다.
- 이메일: ${CONTACT_EMAIL}
- 전화: ${COMPANY.phone}
접수 시 워크스페이스 정보와 결제 내역을 함께 알려주시면 처리가 빠릅니다.`,
  },
  {
    title: '8. 재화의 배송',
    body: `Workdeck은 온라인으로 제공되는 서비스로, 물리적 재화의 배송이 없습니다. 결제가 완료되면 즉시 워크스페이스에서 해당 업무 모듈을 이용할 수 있습니다.`,
  },
  {
    title: '부칙',
    body: `이 규정은 게시일로부터 시행되며, 이 규정에 정하지 않은 사항은 이용약관 및 관련 법령(전자상거래법, 콘텐츠산업진흥법, 소비자분쟁해결기준 등)을 따릅니다.`,
  },
]

export default function RefundPage() {
  return (
    <div className="w-full px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-10">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold tracking-tight break-keep sm:text-4xl">
            취소·환불 규정
          </h1>
          <p className="text-sm break-keep text-muted-foreground">시행일: 2026년 9월 6일</p>
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
          <p>통신판매업신고번호: {COMPANY.mailOrderNumber}</p>
          <p>주소: {COMPANY.address}</p>
          <p>고객센터: {COMPANY.phone}</p>
        </div>
      </div>
    </div>
  )
}
