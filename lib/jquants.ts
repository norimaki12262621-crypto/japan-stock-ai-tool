const BASE = 'https://api.jquants.com/v1'

type AuthUserResponse = { refreshToken?: string; message?: string }
type AuthRefreshResponse = { idToken?: string; message?: string }

type RawStatement = {
  DisclosedDate?: string
  DisclosedTime?: string
  LocalCode?: string
  DisclosureNumber?: string
  TypeOfDocument?: string
  TypeOfCurrentPeriod?: string
  NetSales?: string
  OperatingProfit?: string
  Profit?: string
  EarningsPerShare?: string
  ForecastEarningsPerShare?: string
  TotalAssets?: string
  Equity?: string
  EquityToAssetRatio?: string
  BookValuePerShare?: string
  ResultDividendPerShareFiscalYearEnd?: string
  ResultDividendPerShareAnnual?: string
  ForecastDividendPerShareFiscalYearEnd?: string
  ForecastDividendPerShareAnnual?: string
  NumberOfIssuedAndOutstandingSharesAtTheEndOfFiscalYearIncludingTreasuryStock?: string
}

type StatementsResponse = {
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

let _idTokenCache: { token: string; expiresAt: number } | null = null

async function fetchRefreshToken(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/token/auth_user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mailaddress: email, password }),
    cache: 'no-store',
  })
  const json = await res.json() as AuthUserResponse
  if (!res.ok || !json.refreshToken) {
    throw new Error(`auth_user failed (${res.status}): ${json.message ?? 'unknown'}`)
  }
  return json.refreshToken
}

async function fetchIdToken(refreshToken: string): Promise<string> {
  const res = await fetch(
    `${BASE}/token/auth_refresh?refreshtoken=${encodeURIComponent(refreshToken)}`,
    { method: 'POST', cache: 'no-store' },
  )
  const json = await res.json() as AuthRefreshResponse
  if (!res.ok || !json.idToken) {
    throw new Error(`auth_refresh failed (${res.status}): ${json.message ?? 'unknown'}`)
  }
  return json.idToken
}

async function getIdToken(): Promise<string> {
  const now = Date.now()
  if (_idTokenCache && _idTokenCache.expiresAt > now) return _idTokenCache.token

  const email = process.env.JQUANTS_EMAIL
  const password = process.env.JQUANTS_PASSWORD
  if (!email || !password) throw new Error('JQUANTS_EMAIL / JQUANTS_PASSWORD is not set')

  const refreshToken = await fetchRefreshToken(email, password)
  const idToken = await fetchIdToken(refreshToken)
  _idTokenCache = { token: idToken, expiresAt: now + 23 * 60 * 60 * 1000 }
  return idToken
}

function statementsUrl(code: string): string {
  return `${BASE}/fins/statements?code=${encodeURIComponent(code)}`
}

async function fetchStatementsResponse(idToken: string, code: string): Promise<{
  url: string
  status: number
  json: StatementsResponse
}> {
  const url = statementsUrl(code)
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` },
    next: { revalidate: 3600 },
  })
  const json = await res.json() as StatementsResponse
  return { url, status: res.status, json }
}

async function fetchStatements(idToken: string, code: string): Promise<RawStatement[]> {
  const { status, json } = await fetchStatementsResponse(idToken, code)
  if (status < 200 || status >= 300) {
    throw new Error(`fins/statements failed (${status}): ${json.message ?? 'unknown'}`)
  }
  return json.statements ?? []
}

function parseNum(value: string | undefined): number | null {
  if (!value || value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function yenToOku(value: string | undefined): number | null {
  const n = parseNum(value)
  return n !== null ? Math.round(n / 100_000_000) : null
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

  try {
    const idToken = await getIdToken()
    const { status, json } = await fetchStatementsResponse(idToken, code)
    const statements = json.statements ?? []
    const first = statements[0] ?? null
    const selected = selectStatement(statements)

    return {
      requestedCode: code,
      normalizedFiveDigitCode,
      endpoint,
      status,
      error: status >= 200 && status < 300 ? null : json.message ?? 'request failed',
      topLevelKeys: Object.keys(json),
      statementsCount: statements.length,
      firstStatementKeys: first ? Object.keys(first) : [],
      latestStatementKeys: statements.at(-1) ? Object.keys(statements.at(-1) as RawStatement) : [],
      selectedStatementKeys: selected ? Object.keys(selected) : [],
      firstStatementPreview: previewStatement(first),
      selectedStatementPreview: previewStatement(selected),
    }
  } catch (e) {
    return {
      requestedCode: code,
      normalizedFiveDigitCode,
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

  let idToken: string
  try {
    idToken = await getIdToken()
  } catch (e) {
    return { ...empty, fetchError: e instanceof Error ? e.message : 'auth error' }
  }

  let statements: RawStatement[]
  try {
    statements = await fetchStatements(idToken, code)
  } catch (e) {
    return { ...empty, fetchError: e instanceof Error ? e.message : 'fetch error' }
  }

  const latest = selectStatement(statements)
  if (!latest) {
    return { ...empty, fetchError: `${code} statements not found` }
  }

  const revenue = yenToOku(latest.NetSales)
  const operatingProfit = yenToOku(latest.OperatingProfit)
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
      ? dividendPerShare / currentPrice
      : null

  let marketCap: number | null = null
  const issuedShares = parseNum(latest.NumberOfIssuedAndOutstandingSharesAtTheEndOfFiscalYearIncludingTreasuryStock)
  if (issuedShares !== null && currentPrice !== null) {
    marketCap = Math.round((issuedShares * currentPrice) / 100_000_000)
  } else if (equity !== null && bps !== null && bps > 0 && currentPrice !== null) {
    const sharesOutstanding = equity / bps
    marketCap = Math.round((sharesOutstanding * currentPrice) / 100_000_000)
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
