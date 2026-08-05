import { ImageResponse } from 'next/og'

export const alt = 'Workdeck — 여러 비즈니스 업무를 하나의 워크스페이스에서'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        background: 'linear-gradient(135deg, #2563eb 0%, #06b6d4 100%)',
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 120,
          height: 120,
          borderRadius: 28,
          background: 'rgba(255,255,255,0.18)',
          marginBottom: 40,
        }}
      >
        <div
          style={{
            display: 'flex',
            width: 60,
            height: 60,
            borderRadius: 14,
            background: '#ffffff',
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          fontSize: 88,
          fontWeight: 700,
          color: '#ffffff',
          letterSpacing: -2,
        }}
      >
        Workdeck
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: 24,
          fontSize: 34,
          color: 'rgba(255,255,255,0.92)',
        }}
      >
        여러 비즈니스 업무를 하나의 워크스페이스에서
      </div>
    </div>,
    { ...size }
  )
}
