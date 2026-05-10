import { Badge } from '@/components/ui/badge'

export type ReconStatus = 'PENDING' | 'PARTIAL' | 'APPLIED' | 'CONFIRMED' | 'CANCELLED'

export function reconStatusBadge(status: ReconStatus) {
  switch (status) {
    case 'PENDING':
      return (
        <Badge variant="outline" className="border-gray-300 text-gray-500">
          대기
        </Badge>
      )
    case 'PARTIAL':
      return <Badge className="border-amber-200 bg-amber-100 text-amber-700">일부 적용</Badge>
    case 'APPLIED':
      return <Badge className="border-green-200 bg-green-100 text-green-700">적용 완료</Badge>
    case 'CONFIRMED':
      return <Badge className="bg-blue-600 text-white">확정</Badge>
    case 'CANCELLED':
      return (
        <Badge variant="outline" className="border-red-300 text-red-500">
          취소
        </Badge>
      )
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}
