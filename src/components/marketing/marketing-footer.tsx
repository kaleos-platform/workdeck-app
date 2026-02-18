import Link from 'next/link'
import { Github, Twitter, Linkedin, Mail } from 'lucide-react'
import { Separator } from '@/components/ui/separator'

const footerLinks = [
  {
    title: '제품',
    links: [
      { label: '기능', href: '/#features' },
      { label: '요금제', href: '/pricing' },
      { label: '보안', href: '#' },
      { label: '로드맵', href: '#' },
    ],
  },
  {
    title: '회사',
    links: [
      { label: '블로그', href: '#' },
      { label: '문서', href: '#' },
      { label: '문의', href: '/contact' },
      { label: 'PR', href: '#' },
    ],
  },
  {
    title: '법률',
    links: [
      { label: '개인정보 보호정책', href: '#' },
      { label: '이용약관', href: '#' },
      { label: '쿠키 정책', href: '#' },
    ],
  },
]

const socialLinks = [
  { icon: Twitter, href: '#', label: 'Twitter' },
  { icon: Github, href: '#', label: 'GitHub' },
  { icon: Linkedin, href: '#', label: 'LinkedIn' },
  { icon: Mail, href: 'mailto:hello@example.com', label: 'Email' },
]

export function MarketingFooter() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="bg-gray-50 dark:bg-gray-900/50 border-t">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* 푸터 컨텐츠 */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-8 mb-8">
          {/* 브랜드 */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="h-8 w-8 rounded-md bg-gradient-to-br from-blue-600 to-purple-600" />
              <span className="font-bold">SaaS Starter</span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              비즈니스 의사결정을 돕는 SaaS 플랫폼
            </p>
          </div>

          {/* 푸터 링크 */}
          {footerLinks.map((section) => (
            <div key={section.title}>
              <h3 className="font-semibold mb-4">{section.title}</h3>
              <ul className="space-y-3">
                {section.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-50 transition"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* 구분선 */}
        <Separator className="my-8" />

        {/* 하단 정보 */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          {/* 저작권 */}
          <p className="text-sm text-gray-600 dark:text-gray-400">
            &copy; {currentYear} SaaS Starter Kit. All rights reserved.
          </p>

          {/* 소셜 링크 */}
          <div className="flex gap-4">
            {socialLinks.map((social) => {
              const Icon = social.icon
              return (
                <Link
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-50 transition"
                  aria-label={social.label}
                >
                  <Icon className="h-5 w-5" />
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </footer>
  )
}
