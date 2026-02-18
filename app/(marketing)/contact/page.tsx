'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Mail, Phone, MapPin, Clock } from 'lucide-react'
import { toast } from 'sonner'

export default function ContactPage() {
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    type: '',
    message: '',
  })

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSelectChange = (value: string) => {
    setFormData((prev) => ({ ...prev, type: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // 기본 유효성 검사
    if (!formData.name || !formData.email || !formData.type || !formData.message) {
      toast.error('모든 필수 항목을 입력해주세요')
      return
    }

    setLoading(true)

    try {
      // 실제로는 API 호출을 하겠지만, 여기서는 시뮬레이션합니다
      await new Promise((resolve) => setTimeout(resolve, 1000))

      toast.success('문의가 접수되었습니다! 곧 연락드리겠습니다.')
      setFormData({
        name: '',
        email: '',
        company: '',
        type: '',
        message: '',
      })
    } catch (error) {
      toast.error('문의 접수 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const contactInfo = [
    {
      icon: Mail,
      title: '이메일',
      value: 'support@example.com',
      href: 'mailto:support@example.com',
    },
    {
      icon: Phone,
      title: '전화',
      value: '+82-2-1234-5678',
      href: 'tel:+82-2-1234-5678',
    },
    {
      icon: MapPin,
      title: '주소',
      value: '서울시 강남구 테헤란로 123',
    },
    {
      icon: Clock,
      title: '영업시간',
      value: '월-금 09:00-18:00 (한국시간)',
    },
  ]

  return (
    <div className="w-full">
      {/* Hero Section */}
      <section className="px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-4xl mx-auto text-center space-y-4">
          <h1 className="text-5xl sm:text-6xl font-bold">문의하기</h1>
          <p className="text-lg sm:text-xl text-gray-600 dark:text-gray-400">
            질문이 있으시거나 데모를 예약하고 싶으신가요? 저희에게 연락해주세요.
          </p>
        </div>
      </section>

      {/* Contact Form & Info */}
      <section className="px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8">
            {/* 문의 폼 */}
            <div className="md:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>메시지 보내기</CardTitle>
                  <CardDescription>
                    양식을 작성하면 24시간 이내에 연락드리겠습니다.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-6">
                    {/* 이름 */}
                    <div>
                      <label htmlFor="name" className="block text-sm font-medium mb-2">
                        이름 *
                      </label>
                      <Input
                        id="name"
                        name="name"
                        placeholder="홍길동"
                        value={formData.name}
                        onChange={handleInputChange}
                        required
                      />
                    </div>

                    {/* 이메일 */}
                    <div>
                      <label htmlFor="email" className="block text-sm font-medium mb-2">
                        이메일 *
                      </label>
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        placeholder="your@email.com"
                        value={formData.email}
                        onChange={handleInputChange}
                        required
                      />
                    </div>

                    {/* 회사명 */}
                    <div>
                      <label htmlFor="company" className="block text-sm font-medium mb-2">
                        회사명
                      </label>
                      <Input
                        id="company"
                        name="company"
                        placeholder="회사명 (선택)"
                        value={formData.company}
                        onChange={handleInputChange}
                      />
                    </div>

                    {/* 문의 유형 */}
                    <div>
                      <label htmlFor="type" className="block text-sm font-medium mb-2">
                        문의 유형 *
                      </label>
                      <Select value={formData.type} onValueChange={handleSelectChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="문의 유형을 선택해주세요" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="general">일반 문의</SelectItem>
                          <SelectItem value="sales">영업 문의</SelectItem>
                          <SelectItem value="support">기술 지원</SelectItem>
                          <SelectItem value="partnership">파트너십</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* 메시지 */}
                    <div>
                      <label htmlFor="message" className="block text-sm font-medium mb-2">
                        메시지 *
                      </label>
                      <Textarea
                        id="message"
                        name="message"
                        placeholder="자세한 내용을 입력해주세요"
                        rows={6}
                        value={formData.message}
                        onChange={handleInputChange}
                        required
                      />
                    </div>

                    {/* 제출 버튼 */}
                    <Button type="submit" className="w-full" disabled={loading} size="lg">
                      {loading ? '전송 중...' : '메시지 보내기'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>

            {/* 연락처 정보 */}
            <div className="space-y-4">
              {contactInfo.map((info, i) => {
                const Icon = info.icon
                return (
                  <Card key={i}>
                    <CardContent className="pt-6">
                      <div className="flex gap-4">
                        <div className="rounded-lg bg-blue-100 dark:bg-blue-900/30 p-3 h-fit">
                          <Icon className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-sm mb-1">{info.title}</h3>
                          {info.href ? (
                            <a
                              href={info.href}
                              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              {info.value}
                            </a>
                          ) : (
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                              {info.value}
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}

              {/* 소셜 링크 */}
              <Card>
                <CardContent className="pt-6">
                  <h3 className="font-semibold text-sm mb-4">소셜 미디어</h3>
                  <div className="flex gap-2">
                    {['Twitter', 'LinkedIn', 'GitHub', 'Facebook'].map((social) => (
                      <a
                        key={social}
                        href="#"
                        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {social}
                      </a>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Response Time Info */}
      <section className="bg-blue-50 dark:bg-blue-950/30 px-4 sm:px-6 lg:px-8 py-12">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8 text-center">
            <div>
              <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                &lt;24h
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                평균 응답 시간
              </p>
            </div>
            <div>
              <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                24/7
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                고객 지원 가능
              </p>
            </div>
            <div>
              <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                95%
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                고객 만족도
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Quick Links */}
      <section className="px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-4xl mx-auto text-center space-y-12">
          <div>
            <h2 className="text-3xl font-bold mb-4">빠른 답변이 필요하신가요?</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-8">
              자주 묻는 질문에서 답변을 찾아보세요
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button variant="outline" asChild>
                <a href="/#faq">FAQ 보기</a>
              </Button>
              <Button variant="outline" asChild>
                <a href="/pricing">가격 정보</a>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
