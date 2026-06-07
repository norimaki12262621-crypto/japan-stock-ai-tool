import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '日本株AI診断ツール',
  description: '銘柄コードを入力するだけで、PER・PBR・ROE・配当利回りなどを分析し100点満点でスコアリング。買い候補・様子見・危険を自動判定します。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  )
}
