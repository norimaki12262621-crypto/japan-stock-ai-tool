import { NextResponse } from 'next/server'
import type { StockData, ApiError } from '@/lib/stockTypes'
import { fetchJQuantsFundamentals, fetchJQuantsStatementsDebug } from '@/lib/jquants'

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

type PriceData = {
  price: number | null
  changePercent: number | null
  source: 'yahoo' | 'stooq'
}

type PriceDebug = {
  yahooStatus: number | string | null
  yahooUrl: string
  stooqStatus: number | string | null
  stooqUrl: string
}

type PriceResult = PriceData & {
  debug: PriceDebug
}

function stooqUrl(code: string): string {
  const today = new Date()
  const from = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000)
  return `https://stooq.com/q/d/l/?s=${code}.jp&d1=${yyyymmdd(from)}&d2=${yyyymmdd(today)}&i=d`
}

function yahooUrl(code: string): string {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${code}.T?range=5d&interval=1d`
}

async function fetchStooqPrice(code: string): Promise<{
  price: number | null
  changePercent: number | null
  status: number | string
}> {
  const url = stooqUrl(code)

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'text/csv,text/plain,*/*',
      Referer: 'https://stooq.com/',
    },
    next: { revalidate: 60 },
  })
  if (!res.ok) return { price: null, changePercent: null, status: res.status }

  const csv = await res.text()
  const rows = parseStooqCsv(csv)

  const latest = rows.at(-1)
  const prev = rows.at(-2)
  if (!latest?.['Close']) return { price: null, changePercent: null, status: 'empty-data' }

  const price = parseFloat(latest['Close'])
  const prevClose = prev ? parseFloat(prev['Close']) : null

  if (isNaN(price) || price <= 0) return { price: null, changePercent: null, status: 'invalid-data' }

  const changePercent =
    prevClose && !isNaN(prevClose) && prevClose > 0
      ? ((price - prevClose) / prevClose) * 100
      : null

  return { price, changePercent, status: res.status }
}

async function fetchYahooPrice(code: string): Promise<{
  price: number | null
  changePercent: number | null
  status: number | string
}> {
  const url = yahooUrl(code)

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'application/json,*/*',
    },
    next: { revalidate: 60 },
  })
  if (!res.ok) return { price: null, changePercent: null, status: res.status }

  const data = await res.json()
  const meta = data?.chart?.result?.[0]?.meta
  const price = typeof meta?.regularMarketPrice === 'number' ? meta.regularMarketPrice : null
  const prevClose = typeof meta?.previousClose === 'number' ? meta.previousClose : null

  if (!price || price <= 0) return { price: null, changePercent: null, status: 'invalid-data' }

  const changePercent =
    prevClose && prevClose > 0
      ? ((price - prevClose) / prevClose) * 100
      : null

  return { price, changePercent, status: res.status }
}

async function fetchPriceWithFallback(code: string): Promise<PriceResult> {
  const debug: PriceDebug = {
    yahooStatus: null,
    yahooUrl: yahooUrl(code),
    stooqStatus: null,
    stooqUrl: stooqUrl(code),
  }

  try {
    const yahoo = await fetchYahooPrice(code)
    debug.yahooStatus = yahoo.status
    if (yahoo.price !== null) return { ...yahoo, source: 'yahoo', debug }
  } catch (e) {
    debug.yahooStatus = e instanceof Error ? e.message : 'unknown'
  }

  try {
    const stooq = await fetchStooqPrice(code)
    debug.stooqStatus = stooq.status
    if (stooq.price !== null) return { ...stooq, source: 'stooq', debug }
  } catch (e) {
    debug.stooqStatus = e instanceof Error ? e.message : 'unknown'
  }

  return { price: null, changePercent: null, source: 'yahoo', debug }
}

export async function GET(request: Request): Promise<NextResponse<StockData | ApiError | Record<string, unknown>>> {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')?.replace(/\D/g, '')

  if (!code || !/^\d{4}$/.test(code)) {
    return NextResponse.json(
      { error: '4桁の銘柄コードを入力してください（例: 7203）' },
      { status: 400 },
    )
  }

  if (searchParams.get('debug') === '1') {
    const jquants = await fetchJQuantsStatementsDebug(code)
    return NextResponse.json({ code, jquants })
  }

  // ── Step 1: Yahoo Finance から株価取得（失敗時はStooq） ─────────────
  let price: number | null = null
  let changePercent: number | null = null
  let priceSource: 'yahoo' | 'stooq' = 'yahoo'
  let priceDebug: PriceDebug | null = null
  try {
    const priceData = await fetchPriceWithFallback(code)
    price = priceData.price
    changePercent = priceData.changePercent
    priceSource = priceData.source
    priceDebug = priceData.debug
  } catch (e) {
    return NextResponse.json(
      { error: `株価データの取得に失敗しました。(${e instanceof Error ? e.message : 'unknown'})` },
      { status: 502 },
    )
  }

  if (price === null) {
    return NextResponse.json(
      {
        error: `銘柄コード ${code} のデータが見つかりませんでした。コードを確認してください。`,
        debug: priceDebug,
      },
      { status: 502 },
    )
  }

  // ── Step 2: J-Quants から財務指標取得（env未設定なら全部null） ──────
  const hasJQuantsEnv = !!process.env.JQUANTS_API_KEY

  let fundamentals = {
    per: null as number | null,
    pbr: null as number | null,
    roe: null as number | null,
    dividendYield: null as number | null,
    marketCap: null as number | null,
    revenue: null as number | null,
    operatingProfit: null as number | null,
    equityRatio: null as number | null,
  }

  if (hasJQuantsEnv) {
    const jq = await fetchJQuantsFundamentals(code, price)
    fundamentals = {
      per: jq.per,
      pbr: jq.pbr,
      roe: jq.roe,
      dividendYield: jq.dividendYield,
      marketCap: jq.marketCap,
      revenue: jq.revenue,
      operatingProfit: jq.operatingProfit,
      equityRatio: jq.equityRatio,
    }
  }

  const stock: StockData = {
    code,
    name: STOCK_NAMES[code] ?? code,
    price,
    changePercent,
    ...fundamentals,
    fetchedAt: new Date().toISOString(),
    dataSource: hasJQuantsEnv ? 'jquants' : priceSource,
  }

  return NextResponse.json(stock)
}
