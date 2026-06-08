const BASE = 'https://api.jquants.com/v2'

type RawStatement = {
  DisclosedDate?: string
  DisclosedTime?: string
  LocalCode?: string
  DisclosureNumber?: string
  TypeOfDocument?: string
  TypeOfCurrentPeriod?: string
  DiscDate?: string
  DiscTime?: string
  Code?: string
  DiscNo?: string
  DocType?: string
  CurPerType?: string
  NetSales?: string
  OperatingProfit?: string
  Profit?: string
  EarningsPerShare?: string
  ForecastEarningsPerShare?: string
  Sales?: string
  OP?: string
  NP?: string
  EPS?: string
  FEPS?: string
  TotalAssets?: string
  Equity?: string
  EquityToAssetRatio?: string
  BookValuePerShare?: string
  TA?: string
  Eq?: string
  EqAR?: string
  BPS?: string
  ResultDividendPerShareFiscalYearEnd?: string
  ResultDividendPerShareAnnual?: string
  ForecastDividendPerShareFiscalYearEnd?: string
  ForecastDividendPerShareAnnual?: string
  DivFY?: string
  DivAnn?: string
  FDivFY?: string
  FDivAnn?: string
  NumberOfIssuedAndOutstandingSharesAtTheEndOfFiscalYearIncludingTreasuryStock?: string
  ShOutFY?: string
}

type StatementsResponse = {
  data?: RawStatement[]
  statements?: RawStatement[]
  message?: string
  pagination_key?: string
}

export type JQuantsFundamentals = {
  revenue: number | null
  operatingProfit: number | null
  equityRatio: number | null
  roe: number | null
  per: number | null
  pbr: number | null
  dividendYield: number | null
  marketCap: number | null
  disclosedDate: string | null
  fetchError?: string
}

export type JQuantsStatementsDebug = {
  requestedCode: string
  normalizedFiveDigitCode: string | null
  auth: {
    method: 'x-api-key'
    hasApiKey: boolean
    success: boolean
  }
  endpoint: string
  status: number | null
  error: string | null
  topLevelKeys: string[]
  statementsCount: number
  firstStatementKeys: string[]
  latestStatementKeys: string[]
  selectedStatementKeys: string[]
  firstStatementPreview: Record<string, unknown> | null
  selectedStatementPreview: Record<string, unknown> | null
}

function getApiKey(): string {
  const apiKey = process.env.JQUANTS_API_KEY
  if (!apiKey) throw new Error('JQUANTS_API_KEY is not set')
  return apiKey
}

function statementsUrl(code: string): string {
  return `${BASE}/fins/summary?code=${encodeURIComponent(code)}`
}

async function fetchStatementsResponse(apiKey: string, code: string): Promise<{
  url: string
  status: number
  json: StatementsResponse
}> {
  const url = statementsUrl(code)
  const res = await fetch(url, {
    headers: { 'x-api-key': apiKey },
    next: { revalidate: 3600 },
  })
  const json = await res.json() as StatementsResponse
  return { url, status: res.status, json }
}

async function fetchStatements(apiKey: string, code: string): Promise<RawStatement[]> {
  const { status, json } = await fetchStatementsResponse(apiKey, code)
  if (status < 200 || status >= 300) {
    throw new Error(`fins/summary failed (${status}): ${json.message ?? 'unknown'}`)
  }
  return (json.data ?? json.statements ?? []).map(normalizeStatement)
}

function parseNum(value: string | undefined): number | null {
  if (!value || value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeStatement(statement: RawStatement): RawStatement {
  return {
    ...statement,
    DisclosedDate: statement.DisclosedDate ?? statement.DiscDate,
    DisclosedTime: statement.DisclosedTime ?? statement.DiscTime,
    LocalCode: statement.LocalCode ?? statement.Code,
    DisclosureNumber: statement.DisclosureNumber ?? statement.DiscNo,
    TypeOfDocument: statement.TypeOfDocument ?? statement.DocType,
    TypeOfCurrentPeriod: statement.TypeOfCurrentPeriod ?? statement.CurPerType,
    NetSales: statement.NetSales ?? statement.Sales,
    OperatingProfit: statement.OperatingProfit ?? statement.OP,
    Profit: statement.Profit ?? statement.NP,
    EarningsPerShare: statement.EarningsPerShare ?? statement.EPS,
    ForecastEarningsPerShare: statement.ForecastEarningsPerShare ?? statement.FEPS,
    TotalAssets: statement.TotalAssets ?? statement.TA,
    Equity: statement.Equity ?? statement.Eq,
    EquityToAssetRatio: statement.EquityToAssetRatio ?? statement.EqAR,
    BookValuePerShare: statement.BookValuePerShare ?? statement.BPS,
    ResultDividendPerShareFiscalYearEnd: statement.ResultDividendPerShareFiscalYearEnd ?? statement.DivFY,
    ResultDividendPerShareAnnual: statement.ResultDividendPerShareAnnual ?? statement.DivAnn,
    ForecastDividendPerShareFiscalYearEnd: statement.ForecastDividendPerShareFiscalYearEnd ?? statement.FDivFY,
    ForecastDividendPerShareAnnual: statement.ForecastDividendPerShareAnnual ?? statement.FDivAnn,
    NumberOfIssuedAndOutstandingSharesAtTheEndOfFiscalYearIncludingTreasuryStock:
      statement.NumberOfIssuedAndOutstandingSharesAtTheEndOfFiscalYearIncludingTreasuryStock ?? statement.ShOutFY,
  }
}

function amountToYen(value: string | undefined): number | null {
  const n = parseNum(value)
  if (n === null) return null

  // J-Quants v2 summary values may be yen-scale or million-yen-scale,
  // depending on the source field. Large values are treated as yen.
  return Math.abs(n) >= 1_000_000_000_000 ? n : n * 1_000_000
}

function amountToOku(value: string | undefined): number | null {
  const yen = amountToYen(value)
  return yen !== null ? Math.round(yen / 100_000_000) : null
}

function annualFactor(typeOfPeriod: string | undefined): number {
  const t = typeOfPeriod?.toUpperCase()
  if (t === '1Q' || t === 'Q1') return 4
  if (t === '2Q' || t === 'Q2') return 2
  if (t === '3Q' || t === 'Q3') return 4 / 3
  return 1
}

function hasFinancialValues(statement: RawStatement): boolean {
  return Boolean(
    statement.NetSales ||
    statement.OperatingProfit ||
    statement.Profit ||
    statement.EarningsPerShare ||
    statement.ForecastEarningsPerShare ||
    statement.Equity ||
    statement.BookValuePerShare,
  )
}

function selectStatement(statements: RawStatement[]): RawStatement | null {
  const sorted = [...statements].sort((a, b) => {
    const dateCompare = (b.DisclosedDate ?? '').localeCompare(a.DisclosedDate ?? '')
    if (dateCompare !== 0) return dateCompare
    return (b.DisclosureNumber ?? '').localeCompare(a.DisclosureNumber ?? '')
  })

  const annual = sorted.find((statement) => {
    const period = statement.TypeOfCurrentPeriod?.toUpperCase()
    return hasFinancialValues(statement) && (period === 'FY' || period === '4Q' || period === '5Q')
  })

  return annual ?? sorted.find(hasFinancialValues) ?? sorted[0] ?? null
}

function previewStatement(statement: RawStatement | null): Record<string, unknown> | null {
  if (!statement) return null
  return {
    DisclosedDate: statement.DisclosedDate,
    LocalCode: statement.LocalCode,
    DisclosureNumber: statement.DisclosureNumber,
    TypeOfDocument: statement.TypeOfDocument,
    TypeOfCurrentPeriod: statement.TypeOfCurrentPeriod,
    NetSales: statement.NetSales,
    OperatingProfit: statement.OperatingProfit,
    Profit: statement.Profit,
    EarningsPerShare: statement.EarningsPerShare,
    ForecastEarningsPerShare: statement.ForecastEarningsPerShare,
    Equity: statement.Equity,
    EquityToAssetRatio: statement.EquityToAssetRatio,
    BookValuePerShare: statement.BookValuePerShare,
    ResultDividendPerShareAnnual: statement.ResultDividendPerShareAnnual,
    ForecastDividendPerShareAnnual: statement.ForecastDividendPerShareAnnual,
  }
}

export async function fetchJQuantsStatementsDebug(code: string): Promise<JQuantsStatementsDebug> {
  const normalizedFiveDigitCode = /^\d{4}$/.test(code) ? `${code}0` : null
  const endpoint = statementsUrl(code)
  const hasApiKey = Boolean(process.env.JQUANTS_API_KEY)

  try {
    const apiKey = getApiKey()
    const { status, json } = await fetchStatementsResponse(apiKey, code)
    const rawStatements = json.data ?? json.statements ?? []
    const statements = rawStatements.map(normalizeStatement)
    const first = rawStatements[0] ?? null
    const selected = selectStatement(statements)

    return {
      requestedCode: code,
      normalizedFiveDigitCode,
      auth: {
        method: 'x-api-key',
        hasApiKey,
        success: status >= 200 && status < 300,
      },
      endpoint,
      status,
      error: status >= 200 && status < 300 ? null : json.message ?? 'request failed',
      topLevelKeys: Object.keys(json),
      statementsCount: rawStatements.length,
      firstStatementKeys: first ? Object.keys(first) : [],
      latestStatementKeys: rawStatements.at(-1) ? Object.keys(rawStatements.at(-1) as RawStatement) : [],
      selectedStatementKeys: selected ? Object.keys(selected) : [],
      firstStatementPreview: previewStatement(first),
      selectedStatementPreview: previewStatement(selected),
    }
  } catch (e) {
    return {
      requestedCode: code,
      normalizedFiveDigitCode,
      auth: {
        method: 'x-api-key',
        hasApiKey,
        success: false,
      },
      endpoint,
      status: null,
      error: e instanceof Error ? e.message : 'unknown',
      topLevelKeys: [],
      statementsCount: 0,
      firstStatementKeys: [],
      latestStatementKeys: [],
      selectedStatementKeys: [],
      firstStatementPreview: null,
      selectedStatementPreview: null,
    }
  }
}

export async function fetchJQuantsFundamentals(
  code: string,
  currentPrice: number | null,
): Promise<JQuantsFundamentals> {
  const empty: JQuantsFundamentals = {
    revenue: null,
    operatingProfit: null,
    equityRatio: null,
    roe: null,
    per: null,
    pbr: null,
    dividendYield: null,
    marketCap: null,
    disclosedDate: null,
  }

  let apiKey: string
  try {
    apiKey = getApiKey()
  } catch (e) {
    return { ...empty, fetchError: e instanceof Error ? e.message : 'auth error' }
  }

  let statements: RawStatement[]
  try {
    statements = await fetchStatements(apiKey, code)
  } catch (e) {
    return { ...empty, fetchError: e instanceof Error ? e.message : 'fetch error' }
  }

  const latest = selectStatement(statements)
  if (!latest) {
    return { ...empty, fetchError: `${code} statements not found` }
  }

  const revenue = amountToOku(latest.NetSales)
  const operatingProfit = amountToOku(latest.OperatingProfit)
  const equityRatioRaw = parseNum(latest.EquityToAssetRatio)
  const equityRatio = equityRatioRaw !== null ? equityRatioRaw * 100 : null

  const forecastEps = parseNum(latest.ForecastEarningsPerShare)
  const actualEps = parseNum(latest.EarningsPerShare)
  const eps = forecastEps ?? actualEps
  const bps = parseNum(latest.BookValuePerShare)
  const annualEps =
    forecastEps !== null
      ? forecastEps
      : actualEps !== null
        ? actualEps * annualFactor(latest.TypeOfCurrentPeriod)
        : null

  const equity = parseNum(latest.Equity)
  const profit = parseNum(latest.Profit)
  const roe =
    equity !== null && equity > 0 && profit !== null
      ? (profit / equity) * 100
      : eps !== null && bps !== null && bps > 0
        ? (eps / bps) * 100
        : null

  const per =
    currentPrice !== null && annualEps !== null && annualEps > 0
      ? currentPrice / annualEps
      : null

  const pbr =
    currentPrice !== null && bps !== null && bps > 0
      ? currentPrice / bps
      : null

  const dividendPerShare =
    parseNum(latest.ForecastDividendPerShareAnnual) ??
    parseNum(latest.ResultDividendPerShareAnnual) ??
    parseNum(latest.ForecastDividendPerShareFiscalYearEnd) ??
    parseNum(latest.ResultDividendPerShareFiscalYearEnd)

  const dividendYield =
    currentPrice !== null && dividendPerShare !== null && dividendPerShare > 0 && currentPrice > 0
      ? (dividendPerShare / currentPrice) * 100
      : null

  let marketCap: number | null = null
  const issuedShares = parseNum(latest.NumberOfIssuedAndOutstandingSharesAtTheEndOfFiscalYearIncludingTreasuryStock)
  if (issuedShares !== null && currentPrice !== null) {
    marketCap = Math.round((issuedShares * currentPrice) / 100_000_000)
  } else if (equity !== null && bps !== null && bps > 0 && currentPrice !== null) {
    const equityYen = amountToYen(latest.Equity)
    const sharesOutstanding = equityYen !== null ? equityYen / bps : null
    if (sharesOutstanding !== null) {
      marketCap = Math.round((sharesOutstanding * currentPrice) / 100_000_000)
    }
  }

  return {
    revenue,
    operatingProfit,
    equityRatio,
    roe,
    per: per !== null ? Math.round(per * 10) / 10 : null,
    pbr: pbr !== null ? Math.round(pbr * 100) / 100 : null,
    dividendYield,
    marketCap,
    disclosedDate: latest.DisclosedDate ?? null,
  }
}
