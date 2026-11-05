import { buildMarketingUrl } from '@/lib/domain'
import { COMPANY, CONTACT_EMAIL } from '@/lib/marketing/company'

const legalLinks = [
  { label: '이용약관', href: '/terms' },
  { label: '개인정보처리방침', href: '/privacy' },
  { label: '취소·환불 규정', href: '/refund' },
]

// 결제가 일어나는 앱 화면(내 워크덱·설정)의 전자상거래법 표기. 원문은 마케팅 사이트 페이지.
export function AppLegalFooter() {
  return (
    <footer className="mt-12 space-y-1 border-t pt-6 text-xs break-keep text-muted-foreground">
      <p className="flex flex-wrap gap-x-3 gap-y-1">
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
      </p>
      <p>
        {COMPANY.name} | 대표: {COMPANY.ceo} | 사업자등록번호: {COMPANY.registrationNumber} |
        통신판매업신고번호: {COMPANY.mailOrderNumber}
      </p>
      <p>주소: {COMPANY.address}</p>
      <p>
        고객센터: {COMPANY.phone} | 이메일: {CONTACT_EMAIL}
      </p>
    </footer>
  )
}
