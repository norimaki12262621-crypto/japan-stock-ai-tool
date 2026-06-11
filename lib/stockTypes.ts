export type TechnicalAnalysis = {
  ma25: number | null
  ma75: number | null
  rsi14: number | null
  avgVolume20: number | null
  currentVolume: number | null
  week52High: number | null
  week52Low: number | null
  diffFrom52WeekHighPercent: number | null
  diffFrom52WeekLowPercent: number | null
  technicalScore: number | null
  technicalRating: '強い上昇シグナル ◎' | '良好シグナル ○' | '中立 △' | '様子見 △' | '弱いシグナル ×' | null
  buyTiming: string | null
  comments: string[]
}

export type ChartHistoryPoint = {
  date: string
  close: number
  ma25: number | null
  ma75: number | null
}

export type StockData = {
  /** 銘柄コード (例: 7203) */
  code: string
  /** 銘柄名 */
  name: string
  /** 株価 (円) — 実データ */
  price: number | null
  /** 前日比 (%) — 実データ */
  changePercent: number | null
  /** PER (倍) — 実データ */
  per: number | null
  /** PBR (倍) — 実データ */
  pbr: number | null
  /** ROE (%) — 実データ */
  roe: number | null
  /** 配当利回り (%) — 実データ */
  dividendYield: number | null
  /** 時価総額 (億円) — 実データ */
  marketCap: number | null
  /** 売上高 (億円) — 実データ */
  revenue: number | null
  /** 営業利益 (億円) — 実データ（EBITDA近似） */
  operatingProfit: number | null
  /** 自己資本比率 (%) — 計算値（総資産・自己資本から算出） */
  equityRatio: number | null
  technicalAnalysis: TechnicalAnalysis
  chartHistory: ChartHistoryPoint[]
  marketSession: {
    status: 'open' | 'break' | 'closed'
    label: string
    nextSession: string
    isHoliday: boolean
  }
  /** データ取得日時 */
  fetchedAt: string
  /** データソース識別子 */
  dataSource?: 'stooq' | 'yahoo' | 'jquants'
}

export type ScoreDetail = {
  label: string
  value: string
  score: number
  maxScore: number
  comment: string
  dataSource: 'real' | 'calculated' | 'unavailable'
}

export type DiagnosisResult = {
  stock: StockData
  totalScore: number
  judgment: '買い候補' | '様子見' | '危険'
  judgmentColor: 'green' | 'yellow' | 'red'
  details: ScoreDetail[]
  summary: string
}

export type ApiError = {
  error: string
}
