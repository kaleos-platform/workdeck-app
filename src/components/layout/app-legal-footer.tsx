import { buildMarketingUrl } from '@/lib/domain'
import { COMPANY, CONTACT_EMAIL } from '@/lib/marketing/company'

const legalLinks = [
  { label: '이용약관', href: '/terms' },
  { label: '개인정보처리방침', href: '/privacy' },
  { label: '취소·환불 규정', href: '/refund' },
]

const SEP = (
  <span aria-hidden className="mx-1.5 text-border">
    |
  </span>
)

// 결제가 일어나는 앱 화면(내 워크덱·설정)의 전자상거래법 표기. 원문은 마케팅 사이트 페이지.
// 넓은 화면: 왼쪽 사업자정보 2줄 · 오른쪽 링크, 좁은 화면: 위아래로 쌓는다.
export function AppLegalFooter() {
  return (
    <footer className="mt-12 flex flex-col gap-3 border-t pt-4 text-xs break-keep text-muted-foreground md:flex-row md:items-start md:justify-between md:gap-8">
      <div className="space-y-0.5 leading-relaxed">
        <p>
          {COMPANY.name}
          {SEP}대표 {COMPANY.ceo}
          {SEP}사업자등록번호 {COMPANY.registrationNumber}
          {SEP}통신판매업신고번호 {COMPANY.mailOrderNumber}
        </p>
        <p>
          {COMPANY.address}
          {SEP}고객센터 {COMPANY.phone}
          {SEP}
          {CONTACT_EMAIL}
        </p>
      </div>
      <nav aria-label="약관 및 정책" className="flex shrink-0 gap-4 md:order-last">
        {legalLinks.map((link) => (
          <a
            key={link.href}
            href={buildMarketingUrl(link.href)}
            className={
              link.href === '/privacy'
                ? 'font-semibold text-foreground hover:underline'
                : 'hover:text-foreground hover:underline'
            }
          >
            {link.label}
          </a>
        ))}
      </nav>
    </footer>
  )
}
