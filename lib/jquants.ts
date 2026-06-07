/**
 * J-Quants API クライアント（Ver2）
 *
 * 認証フロー:
 *   1. POST /v1/token/auth_user (email + password) → refreshToken (有効期限: 1週間)
 *   2. POST /v1/token/auth_refresh (refreshToken)  → idToken    (有効期限: 24時間)
 *   3. 各エンドポイントに Authorization: Bearer {idToken} で叩く
 *
 * 必要な環境変数:
 *   JQUANTS_EMAIL    - 登録メールアドレス
 *   JQUANTS_PASSWORD - パスワード
 *
 * 無料プラン(Light)でも fins/statements は利用可能。
 * PER/PBR は EPS・BPS と現在株価から算出する。
 */

const BASE = 'https://api.jquants.com/v1'

// ── 型定義 ─────────────────────────────────────────────────────────────────

type AuthUserResponse = { refreshToken?: string; message?: string }
type AuthRefreshResponse = { idToken?: string; message?: string }

type RawStatement = {
  DisclosedDate?: string
  TypeOfDocument?: string
  TypeOfCurrentPeriod?: string
  NetSales?: string
  OperatingProfit?: string
  Profit?: string
  EarningsPerShare?: string
  TotalAssets?: string
  Equity?: string
  EquityToAssetRatio?: string
  BookValuePerShare?: string
  ResultDividendPerShareFiscalYear?: string
  ForecastDividendPerShareFiscalYear?: string
}

type StatementsResponse = { statements?: RawStatement[]; message?: string }

export type JQuantsFundamentals = {
  /** 売上高（億円） */
  revenue: number | null
  /** 営業利益（億円） */
  operatingProfit: number | null
  /** 自己資本比率（%） */
  equityRatio: number | null
  /** ROE（%） */
  roe: number | null
  /** PER（倍） — 現在株価 ÷ 年間EPS */
  per: number | null
  /** PBR（倍） — 現在株価 ÷ BPS */
  pbr: number | null
  /** 配当利回り（%） — 年間配当 ÷ 現在株価 */
  dividendYield: number | null
  /** 時価総額（億円） — 発行株式数 × 現在株価 */
  marketCap: number | null
  /** 開示日 */
  disclosedDate: string | null
  /** エラーメッセージ（デバッグ用） */
  fetchError?: string
}

// ── ID トークンのモジュールレベルキャッシュ ─────────────────────────────────
// Next.js の Fluid Compute ではウォームインスタンスでモジュール変数が保持される。
// コールドスタート時は再取得する（24時間有効なので殆どの場合はキャッシュを使用）。
let _idTokenCache: { token: string; expiresAt: number } | null = null

// ── 認証 ─────────────────────────────────────────────────────────────────

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
  if (!email || !password) throw new Error('JQUANTS_EMAIL / JQUANTS_PASSWORD が未設定です')

  const refreshToken = await fetchRefreshToken(email, password)
  const idToken = await fetchIdToken(refreshToken)

  // 23時間でキャッシュ失効（ID トークンは24時間有効）
  _idTokenCache = { token: idToken, expiresAt: now + 23 * 60 * 60 * 1000 }
  return idToken
}

// ── 財務諸表取得 ─────────────────────────────────────────────────────────────

async function fetchStatements(idToken: string, code: string): Promise<RawStatement[]> {
  // J-Quants は 4桁コードで検索可能（内部では "72030" 形式で管理）
  const res = await fetch(`${BASE}/fins/statements?code=${code}`, {
    headers: { Authorization: `Bearer ${idToken}` },
    next: { revalidate: 3600 }, // 1時間キャッシュ
  })
  const json = await res.json() as StatementsResponse
  if (!res.ok) throw new Error(`fins/statements failed (${res.status}): ${json.message ?? 'unknown'}`)
  return json.statements ?? []
}

// ── ユーティリティ ─────────────────────────────────────────────────────────

function parseNum(s: string | undefined): number | null {
  if (!s || s.trim() === '') return null
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

/** 財務諸表の値（単位: 百万円）を億円に変換 */
function mToOku(s: string | undefined): number | null {
  const n = parseNum(s)
  return n !== null ? Math.round(n / 100) : null
}

/**
 * 決算種別を判定して年換算係数を返す。
 * J-Quants の TypeOfCurrentPeriod: "Q1" | "Q2" | "2Q" | "Q3" | "3Q" | "Q4" | "FY" など
 */
function annualFactor(typeOfPeriod: string | undefined): number {
  if (!typeOfPeriod) return 1
  const t = typeOfPeriod.toUpperCase()
  if (t === 'Q1') return 4
  if (t === 'Q2' || t === '2Q') return 2
  if (t === 'Q3' || t === '3Q') return 4 / 3
  return 1 // FY / Q4 / Annual
}

// ── メイン関数 ─────────────────────────────────────────────────────────────

/**
 * J-Quants から財務指標を取得する。
 * @param code - 4桁の銘柄コード（例: "7203"）
 * @param currentPrice - Stooq から取得した現在株価（PER・PBR・配当利回り算出に使用）
 */
export async function fetchJQuantsFundamentals(
  code: string,
  currentPrice: number | null,
): Promise<JQuantsFundamentals> {
  const empty: JQuantsFundamentals = {
    revenue: null, operatingProfit: null, equityRatio: null,
    roe: null, per: null, pbr: null, dividendYield: null,
    marketCap: null, disclosedDate: null,
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

  if (statements.length === 0) {
    return { ...empty, fetchError: `${code} の財務諸表が見つかりませんでした` }
  }

  // ── 最新の決算を選択 ──────────────────────────────────────────────
  // 優先順位: 通期(FY) > 最新四半期
  // J-Quants は開示日降順で返ってくることが多いが、明示的にソートする
  const sorted = [...statements].sort((a, b) => {
    const da = a.DisclosedDate ?? ''
    const db = b.DisclosedDate ?? ''
    return db.localeCompare(da) // 新しい順
  })

  const annual = sorted.find((s) => {
    const t = (s.TypeOfCurrentPeriod ?? '').toUpperCase()
    return t === 'FY' || t === 'Q4' || t === 'ANNUAL'
  })
  const latest = annual ?? sorted[0]

  // ── 基本財務データ ────────────────────────────────────────────────
  const revenue = mToOku(latest.NetSales)
  const operatingProfit = mToOku(latest.OperatingProfit)
  const equityRatioRaw = parseNum(latest.EquityToAssetRatio)
  const equityRatio = equityRatioRaw !== null ? equityRatioRaw * 100 : null

  // ── EPS・BPS (yen/株) ─────────────────────────────────────────────
  const eps = parseNum(latest.EarningsPerShare)
  const bps = parseNum(latest.BookValuePerShare)
  const periodType = latest.TypeOfCurrentPeriod
  const factor = annualFactor(periodType)

  // 年換算 EPS（四半期報告の場合は係数をかける）
  const annualEps = eps !== null ? eps * factor : null

  // ── ROE (純利益 ÷ 純資産) ─────────────────────────────────────────
  // 通期の場合は EPS/BPS で近似、四半期は単純化のため省略
  const equity = parseNum(latest.Equity) // 百万円
  const profit = parseNum(latest.Profit) // 百万円
  const roe =
    equity !== null && equity > 0 && profit !== null
      ? (profit / equity) * 100
      : eps !== null && bps !== null && bps > 0
        ? (eps / bps) * 100
        : null

  // ── 現在株価ベースの指標 ─────────────────────────────────────────
  const per =
    currentPrice !== null && annualEps !== null && annualEps > 0
      ? currentPrice / annualEps
      : null

  const pbr =
    currentPrice !== null && bps !== null && bps > 0
      ? currentPrice / bps
      : null

  // ── 配当利回り ────────────────────────────────────────────────────
  // 予想配当 > 実績配当 の優先順で使用
  const dividendPerShare =
    parseNum(latest.ForecastDividendPerShareFiscalYear) ??
    parseNum(latest.ResultDividendPerShareFiscalYear)

  const dividendYield =
    currentPrice !== null && dividendPerShare !== null && dividendPerShare > 0 && currentPrice > 0
      ? dividendPerShare / currentPrice
      : null

  // ── 時価総額 ──────────────────────────────────────────────────────
  // 発行株式数 ≈ 純資産(百万円) × 1,000,000 ÷ BPS(円/株)
  // 時価総額(億円) = 発行株式数 × 現在株価 ÷ 1億
  let marketCap: number | null = null
  if (equity !== null && bps !== null && bps > 0 && currentPrice !== null) {
    const sharesOutstanding = (equity * 1_000_000) / bps
    marketCap = Math.round((sharesOutstanding * currentPrice) / 1e8)
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
