const MAX_SIDE = 1600

/** 최장변 1600px 로 줄여 webp(0.8)로 인코딩. 미지원 브라우저는 jpeg(0.8). GIF 는 첫 프레임 정지 이미지가 된다. */
export async function compressImage(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bmp.width * scale))
  canvas.height = Math.max(1, Math.round(bmp.height * scale))
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  const toBlob = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.8))
  const webp = await toBlob('image/webp')
  if (webp?.type === 'image/webp') return webp
  const jpeg = await toBlob('image/jpeg')
  if (!jpeg) throw new Error('이미지를 변환하지 못했어요')
  return jpeg
}
