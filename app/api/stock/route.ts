import { NextResponse } from 'next/server'
import type { StockData, ApiError } from '@/lib/stockTypes'

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary'
const MODULES = 'summaryDetail,defaultKeyStatistics,financialData,balanceSheetHistoryQuarterly,price'

function val(obj: Record<string, unknown> | undefined, key: string): number | null {
  const v = obj?.[key]
  if (v === null || v === undefined) return null
  if (typeof v === 'object' && v !== null && 'raw' in v) {
    const raw = (v as { raw?: number }).raw
    return typeof raw === 'number' ? raw : null
  }
  return typeof v === 'number' ? v : null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type YahooModule = Record<string, any>

export async function GET(request: Request): Promise<NextResponse<StockData | ApiError>> {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')?.replace(/[^0-9A-Za-z]/g, '')

  if (!code || !/^\d{4}$/.test(code)) {
    return NextResponse.json({ error: '4桁の銘柄コードを入力してください（例: 7203）' }, { status: 400 })
  }

  const ticker = `${code}.T`
  const url = `${YAHOO_BASE}/${ticker}?modules=${MODULES}&lang=ja&region=JP`

  let json: YahooModule
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 300 },
    })
    if (!res.ok) throw new Error(`Yahoo Finance returned ${res.status}`)
    json = await res.json()
  } catch (e) {
    return NextResponse.json(
      { error: `データ取得に失敗しました。銘柄コードを確認してください。(${e instanceof Error ? e.message : 'unknown'})` },
      { status: 502 },
    )
  }

  const result = json?.quoteSummary?.result?.[0] as YahooModule | undefined
  if (!result) {
    return NextResponse.json({ error: `銘柄コード ${code} のデータが見つかりませんでした` }, { status: 404 })
  }

  const summary: YahooModule = result.summaryDetail ?? {}
  const stats: YahooModule = result.defaultKeyStatistics ?? {}
  const financial: YahooModule = result.financialData ?? {}
  const price: YahooModule = result.price ?? {}
  const bsHistory: YahooModule = result.balanceSheetHistoryQuarterly ?? {}

  // 自己資本比率を貸借対照表から計算
  let equityRatio: number | null = null
  const statements = bsHistory.balanceSheetStatements as YahooModule[] | undefined
  if (statements && statements.length > 0) {
    const latest = statements[0]
    const equity = val(latest, 'totalStockholderEquity')
    const assets = val(latest, 'totalAssets')
    if (equity !== null && assets !== null && assets > 0) {
      equityRatio = (equity / assets) * 100
    }
  }

  // 売上高・営業利益 (億円換算)
  const revenueRaw = val(financial, 'totalRevenue')
  const ebitdaRaw = val(financial, 'ebitda')
  const revenue = revenueRaw !== null ? Math.round(revenueRaw / 1e8) : null
  const operatingProfit = ebitdaRaw !== null ? Math.round(ebitdaRaw / 1e8) : null

  // 時価総額 (億円換算)
  const marketCapRaw = val(summary, 'marketCap') ?? val(price, 'marketCap')
  const marketCap = marketCapRaw !== null ? Math.round(marketCapRaw / 1e8) : null

  // 株価
  const priceVal =
    val(price, 'regularMarketPrice') ??
    val(summary, 'regularMarketPrice') ??
    val(financial, 'currentPrice')

  const changePercent = val(price, 'regularMarketChangePercent')

  const stock: StockData = {
    code,
    name: (price.longName as string | undefined) ?? (price.shortName as string | undefined) ?? `${code}`,
    price: priceVal,
    changePercent: changePercent !== null ? changePercent * 100 : null,
    per: val(summary, 'trailingPE') ?? val(stats, 'forwardPE'),
    pbr: val(stats, 'priceToBook'),
    roe: val(financial, 'returnOnEquity'),
    dividendYield: val(summary, 'dividendYield'),
    marketCap,
    revenue,
    operatingProfit,
    equityRatio,
    fetchedAt: new Date().toISOString(),
  }

  return NextResponse.json(stock)
}
