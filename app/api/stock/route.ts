import { NextResponse } from 'next/server'
import type { StockData, ApiError, ChartHistoryPoint, TechnicalAnalysis } from '@/lib/stockTypes'
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
  '5108': 'ブリヂストン', '5401': '日本製鉄', '5803': 'フジクラ',
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

const STOCK_ALIASES: Record<string, string> = {
  トヨタ: '7203',
  ソニー: '6758',
  三菱重工: '7011',
  フジクラ: '5803',
  ソフトバンク: '9984',
  ソフトバンクg: '9984',
}

function normalizeStockName(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('ja-JP').replace(/[\s・]/g, '')
}

function resolveStockCode(input: string): string | null {
  const normalized = normalizeStockName(input)
  if (/^\d{4}$/.test(normalized)) return normalized

  const aliasCode = STOCK_ALIASES[normalized]
  if (aliasCode) return aliasCode

  const matches = Object.entries(STOCK_NAMES)
    .map(([code, name]) => {
      const normalizedName = normalizeStockName(name)
      if (normalizedName === normalized) return { code, score: 1000 }
      if (normalizedName.startsWith(normalized)) return { code, score: 700 - normalizedName.length }
      const index = normalizedName.indexOf(normalized)
      if (index >= 0) return { code, score: 400 - index - normalizedName.length }
      return null
    })
    .filter((match): match is { code: string; score: number } => match !== null)
    .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))

  return matches[0]?.code ?? null
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

type MarketSession = StockData['marketSession']
type TechnicalSignal = Pick<TechnicalAnalysis, 'technicalScore' | 'technicalRating' | 'buyTiming' | 'comments'>
type TechnicalResult = {
  analysis: TechnicalAnalysis
  chartHistory: ChartHistoryPoint[]
}

function stooqUrl(code: string): string {
  const today = new Date()
  const from = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000)
  return `https://stooq.com/q/d/l/?s=${code}.jp&d1=${yyyymmdd(from)}&d2=${yyyymmdd(today)}&i=d`
}

function yahooUrl(code: string, range = '5d'): string {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${code}.T?range=${range}&interval=1d`
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

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function sanitizeRoe(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  if (value < -100 || value > 100) return null
  return round(value, 1)
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function movingAverage(values: number[], days: number): number | null {
  if (values.length < days) return null
  return average(values.slice(-days))
}

function rsi(values: number[], period = 14): number | null {
  if (values.length <= period) return null
  const slice = values.slice(-(period + 1))
  let gains = 0
  let losses = 0

  for (let i = 1; i < slice.length; i += 1) {
    const diff = slice[i] - slice[i - 1]
    if (diff >= 0) gains += diff
    else losses += Math.abs(diff)
  }

  const avgGain = gains / period
  const avgLoss = losses / period
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - (100 / (1 + rs))
}

function scoreTechnical(input: {
  price: number
  ma25: number | null
  ma75: number | null
  rsi14: number | null
  avgVolume20: number | null
  currentVolume: number | null
  diffFrom52WeekHighPercent: number | null
  diffFrom52WeekLowPercent: number | null
}): TechnicalSignal {
  let score = 50
  const comments: string[] = []

  if (input.ma25 !== null) {
    if (input.price >= input.ma25) {
      score += 12
      comments.push('現在株価は25日線を上回っており、短期的には買い優勢です。')
    } else {
      score -= 10
      comments.push('現在株価は25日線を下回っており、短期の勢いは弱めです。')
    }
  }

  if (input.ma25 !== null && input.ma75 !== null) {
    if (input.ma25 >= input.ma75) {
      score += 12
      comments.push('25日線が75日線を上回っており、上昇トレンドが確認できます。')
    } else {
      score -= 10
      comments.push('25日線が75日線を下回っており、中期トレンドには注意が必要です。')
    }
  } else if (input.ma75 !== null) {
    score += input.price >= input.ma75 ? 8 : -8
  }

  if (input.rsi14 !== null) {
    if (input.rsi14 >= 40 && input.rsi14 <= 70) {
      score += 10
      comments.push('RSIは40〜70の範囲で、過熱感の少ない良好な水準です。')
    } else if (input.rsi14 > 70) {
      score -= 8
      comments.push('RSIが70を超えており、短期的には過熱感があります。')
    } else if (input.rsi14 < 30) {
      score -= 6
      comments.push('RSIが30未満で売られすぎの水準です。反発の確認が必要です。')
    } else {
      comments.push('RSIはやや弱めですが、売られすぎには達していません。')
    }
  }

  if (input.diffFrom52WeekHighPercent !== null) {
    if (input.diffFrom52WeekHighPercent >= -10) {
      score += 8
      comments.push('52週高値に近く、上昇トレンドを維持しています。')
    } else if (input.diffFrom52WeekHighPercent < -30) {
      score -= 8
    }
  }

  if (input.diffFrom52WeekLowPercent !== null) {
    if (input.diffFrom52WeekLowPercent < 20) {
      score -= 8
      comments.push('52週安値に近く、下落リスクに注意が必要です。')
    }
  }

  if (input.avgVolume20 !== null && input.currentVolume !== null && input.avgVolume20 > 0) {
    if (input.currentVolume >= input.avgVolume20) {
      score += 8
      comments.push('出来高が20日平均を上回り、値動きの勢いが増しています。')
    } else {
      score -= 3
      comments.push('出来高は20日平均を下回っており、売買の勢いは控えめです。')
    }
  }

  const technicalScore = Math.max(0, Math.min(100, Math.round(score)))
  if (technicalScore >= 80) {
    return { technicalScore, technicalRating: '強い上昇シグナル ◎', buyTiming: '上昇トレンドが強く、短期の買いタイミングは良好です。', comments }
  }
  if (technicalScore >= 65) {
    return { technicalScore, technicalRating: '良好シグナル ○', buyTiming: '短期は良好です。押し目や出来高の増加を確認して検討できます。', comments }
  }
  if (technicalScore >= 50) {
    return { technicalScore, technicalRating: '中立 △', buyTiming: '方向感は中立です。25日線やRSIの改善を待ちたい局面です。', comments }
  }
  if (technicalScore >= 35) {
    return { technicalScore, technicalRating: '様子見 △', buyTiming: '短期の勢いは弱めです。反転を確認するまで様子見が無難です。', comments }
  }
  return { technicalScore, technicalRating: '弱いシグナル ×', buyTiming: '短期の買い材料は乏しく、今は見送りを優先する局面です。', comments }
}

async function fetchTechnicalData(code: string, currentPrice: number | null): Promise<TechnicalResult> {
  const empty: TechnicalAnalysis = {
    ma25: null,
    ma75: null,
    rsi14: null,
    avgVolume20: null,
    currentVolume: null,
    week52High: null,
    week52Low: null,
    diffFrom52WeekHighPercent: null,
    diffFrom52WeekLowPercent: null,
    technicalScore: null,
    technicalRating: null,
    buyTiming: null,
    comments: [],
  }
  const emptyResult: TechnicalResult = { analysis: empty, chartHistory: [] }

  try {
    const res = await fetch(yahooUrl(code, '1y'), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json,*/*',
      },
      next: { revalidate: 60 },
    })
    if (!res.ok) return emptyResult

    const data = await res.json()
    const result = data?.chart?.result?.[0]
    const quote = result?.indicators?.quote?.[0]
    const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : []
    const rawCloses = Array.isArray(quote?.close) ? quote.close : []
    const closes = Array.isArray(quote?.close)
      ? quote.close.filter((value: unknown): value is number => typeof value === 'number' && Number.isFinite(value))
      : []
    const highs = Array.isArray(quote?.high)
      ? quote.high.filter((value: unknown): value is number => typeof value === 'number' && Number.isFinite(value))
      : []
    const lows = Array.isArray(quote?.low)
      ? quote.low.filter((value: unknown): value is number => typeof value === 'number' && Number.isFinite(value))
      : []
    const volumes = Array.isArray(quote?.volume)
      ? quote.volume.filter((value: unknown): value is number => typeof value === 'number' && Number.isFinite(value))
      : []

    const price = currentPrice ?? closes.at(-1) ?? null
    if (price === null) return emptyResult

    const chartHistory: ChartHistoryPoint[] = []
    const rollingCloses: number[] = []
    rawCloses.forEach((value: unknown, index: number) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return
      const timestamp = timestamps[index]
      if (typeof timestamp !== 'number') return

      rollingCloses.push(value)
      const pointMa25 = movingAverage(rollingCloses, 25)
      const pointMa75 = movingAverage(rollingCloses, 75)
      chartHistory.push({
        date: new Date(timestamp * 1000).toISOString().slice(0, 10),
        close: round(value, 1),
        ma25: pointMa25 !== null ? round(pointMa25, 1) : null,
        ma75: pointMa75 !== null ? round(pointMa75, 1) : null,
      })
    })

    const ma25 = movingAverage(closes, 25)
    const ma75 = movingAverage(closes, 75)
    const rsi14 = rsi(closes, 14)
    const avgVolume20 = volumes.length >= 20 ? average(volumes.slice(-20)) : null
    const currentVolume =
      typeof result?.meta?.regularMarketVolume === 'number'
        ? result.meta.regularMarketVolume
        : volumes.at(-1) ?? null
    const week52High = highs.length > 0 ? Math.max(...highs) : null
    const week52Low = lows.length > 0 ? Math.min(...lows) : null
    const diffFrom52WeekHighPercent = week52High && week52High > 0 ? ((price - week52High) / week52High) * 100 : null
    const diffFrom52WeekLowPercent = week52Low && week52Low > 0 ? ((price - week52Low) / week52Low) * 100 : null
    const scored = scoreTechnical({
      price,
      ma25,
      ma75,
      rsi14,
      avgVolume20,
      currentVolume,
      diffFrom52WeekHighPercent,
      diffFrom52WeekLowPercent,
    })

    return {
      analysis: {
        ma25: ma25 !== null ? round(ma25, 1) : null,
        ma75: ma75 !== null ? round(ma75, 1) : null,
        rsi14: rsi14 !== null ? round(rsi14, 1) : null,
        avgVolume20: avgVolume20 !== null ? Math.round(avgVolume20) : null,
        currentVolume,
        week52High: week52High !== null ? round(week52High, 1) : null,
        week52Low: week52Low !== null ? round(week52Low, 1) : null,
        diffFrom52WeekHighPercent: diffFrom52WeekHighPercent !== null ? round(diffFrom52WeekHighPercent, 2) : null,
        diffFrom52WeekLowPercent: diffFrom52WeekLowPercent !== null ? round(diffFrom52WeekLowPercent, 2) : null,
        ...scored,
      },
      chartHistory,
    }
  } catch {
    return emptyResult
  }
}

function isJapaneseMarketHoliday(date: Date): boolean {
  const day = date.getDay()
  if (day === 0 || day === 6) return true

  const month = date.getMonth() + 1
  const dateOfMonth = date.getDate()
  const ymd = `${date.getFullYear()}-${String(month).padStart(2, '0')}-${String(dateOfMonth).padStart(2, '0')}`
  const holidays2026 = new Set([
    '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20',
    '2026-04-29', '2026-05-04', '2026-05-05', '2026-05-06', '2026-07-20',
    '2026-08-11', '2026-09-21', '2026-09-22', '2026-09-23', '2026-10-12',
    '2026-11-03', '2026-11-23',
  ])
  return holidays2026.has(ymd)
}

function getMarketSession(now = new Date()): MarketSession {
  const tokyo = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const minutes = tokyo.getHours() * 60 + tokyo.getMinutes()
  const isHoliday = isJapaneseMarketHoliday(tokyo)

  if (isHoliday) {
    return { status: 'closed', label: '休場（土日祝）', nextSession: '次の営業日 9:00 前場開始', isHoliday: true }
  }
  if (minutes >= 9 * 60 && minutes < 11 * 60 + 30) {
    return { status: 'open', label: '前場 9:00〜11:30', nextSession: '11:30 昼休み', isHoliday: false }
  }
  if (minutes >= 11 * 60 + 30 && minutes < 12 * 60 + 30) {
    return { status: 'break', label: '昼休み 11:30〜12:30', nextSession: '12:30 後場開始', isHoliday: false }
  }
  if (minutes >= 12 * 60 + 30 && minutes < 15 * 60 + 30) {
    return { status: 'open', label: '後場 12:30〜15:30', nextSession: '15:30 大引け', isHoliday: false }
  }
  return { status: 'closed', label: '時間外', nextSession: '次の営業日 9:00 前場開始', isHoliday: false }
}

export async function GET(request: Request): Promise<NextResponse<StockData | ApiError | Record<string, unknown>>> {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('code')?.trim() ?? ''
  const code = resolveStockCode(query)

  if (!code) {
    return NextResponse.json(
      { error: '銘柄コードまたは社名が見つかりませんでした（例: 7203、トヨタ、ソニー）' },
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
      roe: sanitizeRoe(jq.roe),
      dividendYield: jq.dividendYield,
      marketCap: jq.marketCap,
      revenue: jq.revenue,
      operatingProfit: jq.operatingProfit,
      equityRatio: jq.equityRatio,
    }
  }

  const technical = await fetchTechnicalData(code, price)
  const marketSession = getMarketSession()

  const stock: StockData = {
    code,
    name: STOCK_NAMES[code] ?? code,
    price,
    changePercent,
    ...fundamentals,
    technicalAnalysis: technical.analysis,
    chartHistory: technical.chartHistory,
    marketSession,
    fetchedAt: new Date().toISOString(),
    dataSource: hasJQuantsEnv ? 'jquants' : priceSource,
  }

  return NextResponse.json(stock)
}
