import { NextResponse } from 'next/server'
import type { StockData, ApiError } from '@/lib/stockTypes'

// 主要日本株の銘柄名テーブル
const STOCK_NAMES: Record<string, string> = {
  '1301': '極洋', '1332': 'ニッスイ', '1605': 'INPEX',
  '1721': 'コムシスHD', '1801': '大成建設', '1802': '大林組',
  '1803': '清水建設', '1812': '鹿島', '1925': '大和ハウス工業',
  '2502': 'アサヒグループHD', '2503': 'キリンHD',
  '2801': 'キッコーマン', '2802': '味の素', '2914': 'JT',
  '3382': 'セブン&アイHD', '3659': 'ネクソン',
  '4063': '信越化学工業', '4452': '花王',
  '4502': '武田薬品工業', '4503': 'アステラス製薬',
  '4519': '中外製薬', '4523': 'エーザイ', '4568': '第一三共',
  '4661': 'オリエンタルランド', '4689': 'LINEヤフー',
  '5108': 'ブリヂストン', '5401': '日本製鉄',
  '6301': 'コマツ', '6367': 'ダイキン工業',
  '6501': '日立製作所', '6594': 'ニデック',
  '6645': 'オムロン', '6702': '富士通',
  '6723': 'ルネサスエレクトロニクス', '6752': 'パナソニックHD',
  '6758': 'ソニーグループ', '6861': 'キーエンス',
  '6902': 'デンソー', '6920': 'レーザーテック',
  '6954': 'ファナック', '6971': '京セラ', '6981': '村田製作所',
  '7011': '三菱重工業', '7201': '日産自動車',
  '7203': 'トヨタ自動車', '7267': 'ホンダ',
  '7269': 'スズキ', '7270': 'SUBARU',
  '7741': 'HOYA', '7751': 'キヤノン', '7974': '任天堂',
  '8001': '伊藤忠商事', '8002': '丸紅',
  '8031': '三井物産', '8035': '東京エレクトロン',
  '8053': '住友商事', '8058': '三菱商事',
  '8306': '三菱UFJフィナンシャル・グループ',
  '8316': '三井住友フィナンシャルグループ',
  '8411': 'みずほフィナンシャルグループ',
  '8766': '東京海上HD', '8802': '三菱地所',
  '9020': 'JR東日本', '9021': 'JR西日本', '9022': 'JR東海',
  '9064': 'ヤマトHD', '9104': '商船三井', '9107': '川崎汽船',
  '9202': 'ANAHD', '9432': 'NTT', '9433': 'KDDI',
  '9434': 'ソフトバンク', '9735': 'セコム',
  '9983': 'ファーストリテイリング', '9984': 'ソフトバンクグループ',
}

function yyyymmdd(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

function parseStooqCsv(csv: string): Array<Record<string, string>> {
  const lines = csv.trim().split('\n').filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((h) => h.trim())
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim())
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']))
  })
}

export async function GET(request: Request): Promise<NextResponse<StockData | ApiError>> {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')?.replace(/\D/g, '')

  if (!code || !/^\d{4}$/.test(code)) {
    return NextResponse.json(
      { error: '4桁の銘柄コードを入力してください（例: 7203）' },
      { status: 400 },
    )
  }

  // 直近10営業日分を取得して前日比を計算する
  const today = new Date()
  const from = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000)
  const d1 = yyyymmdd(from)
  const d2 = yyyymmdd(today)
  const url = `https://stooq.com/q/d/l/?s=${code}.jp&d1=${d1}&d2=${d2}&i=d`

  let csv: string
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/csv,text/plain,*/*',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
        Referer: 'https://stooq.com/',
      },
      // Vercelのキャッシュ：60秒間は再取得しない
      next: { revalidate: 60 },
    })
    if (!res.ok) throw new Error(`Stooq returned HTTP ${res.status}`)
    csv = await res.text()
  } catch (e) {
    return NextResponse.json(
      { error: `株価データの取得に失敗しました。(${e instanceof Error ? e.message : 'unknown'})` },
      { status: 502 },
    )
  }

  const rows = parseStooqCsv(csv)

  // Stooqは新しい日付が先頭に来る
  const latest = rows[0]
  const prev = rows[1]

  if (!latest || !latest['Close']) {
    return NextResponse.json(
      { error: `銘柄コード ${code} のデータが見つかりませんでした。コードを確認してください。` },
      { status: 404 },
    )
  }

  const price = parseFloat(latest['Close'])
  const prevClose = prev ? parseFloat(prev['Close']) : null

  if (isNaN(price) || price <= 0) {
    return NextResponse.json(
      { error: `銘柄コード ${code} の株価が正常に取得できませんでした。` },
      { status: 404 },
    )
  }

  const changePercent =
    prevClose && !isNaN(prevClose) && prevClose > 0
      ? ((price - prevClose) / prevClose) * 100
      : null

  const stock: StockData = {
    code,
    name: STOCK_NAMES[code] ?? `${code}`,
    price,
    changePercent,
    // ── 以下は現在未取得（Ver2でJ-Quants APIを使用予定） ──
    per: null,
    pbr: null,
    roe: null,
    dividendYield: null,
    marketCap: null,
    revenue: null,
    operatingProfit: null,
    equityRatio: null,
    fetchedAt: new Date().toISOString(),
    dataSource: 'stooq',
  }

  return NextResponse.json(stock)
}
