import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Star } from 'lucide-react'

interface TestimonialCardProps {
  name: string
  title: string
  company: string
  text: string
  image?: string
  rating?: number
}

export function TestimonialCard({
  name,
  title,
  company,
  text,
  image,
  rating = 5,
}: TestimonialCardProps) {
  return (
    <div className="rounded-lg border bg-white dark:bg-slate-950 p-6">
      {/* 별점 */}
      <div className="flex gap-1 mb-4">
        {Array.from({ length: rating }).map((_, i) => (
          <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
        ))}
      </div>

      {/* 후기 텍스트 */}
      <p className="text-gray-700 dark:text-gray-300 mb-6 italic">"{text}"</p>

      {/* 사용자 정보 */}
      <div className="flex items-center gap-3">
        <Avatar>
          <AvatarImage src={image} />
          <AvatarFallback>{name.slice(0, 2)}</AvatarFallback>
        </Avatar>
        <div>
          <p className="font-semibold">{name}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {title} at {company}
          </p>
        </div>
      </div>
    </div>
  )
}
