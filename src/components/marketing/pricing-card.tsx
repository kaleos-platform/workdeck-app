import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check } from 'lucide-react'

interface PricingCardProps {
  name: string
  price: number | string
  description: string
  features: string[]
  popular?: boolean
  ctaText: string
  ctaHref: string
}

export function PricingCard({
  name,
  price,
  description,
  features,
  popular = false,
  ctaText,
  ctaHref,
}: PricingCardProps) {
  return (
    <Card
      className={`relative flex flex-col ${
        popular ? 'border-blue-600 border-2 md:scale-105' : ''
      }`}
    >
      {popular && (
        <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
          <Badge className="bg-blue-600">인기</Badge>
        </div>
      )}

      <CardHeader>
        <CardTitle className="text-2xl">{name}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col">
        {/* 가격 */}
        <div className="mb-6">
          {typeof price === 'number' ? (
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold">₩{price.toLocaleString()}</span>
              <span className="text-gray-600 dark:text-gray-400">/월</span>
            </div>
          ) : (
            <div className="text-4xl font-bold">{price}</div>
          )}
        </div>

        {/* 기능 목록 */}
        <ul className="space-y-3 mb-8 flex-1">
          {features.map((feature) => (
            <li key={feature} className="flex gap-3 items-start">
              <Check className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
              <span className="text-gray-700 dark:text-gray-300">{feature}</span>
            </li>
          ))}
        </ul>

        {/* CTA 버튼 */}
        <Link href={ctaHref} className="w-full">
          <Button
            className="w-full"
            variant={popular ? 'default' : 'outline'}
            size="lg"
          >
            {ctaText}
          </Button>
        </Link>
      </CardContent>
    </Card>
  )
}
