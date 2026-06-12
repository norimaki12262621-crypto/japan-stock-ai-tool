'use client'

import { useState, useEffect, useRef } from 'react'
import { diagnose } from '@/lib/stockScoring'
import type {
  ChartHistoryPoint,
  DiagnosisResult,
  StockData,
  StockSearchCandidate,
  StockSearchCandidatesResponse,
} from '@/lib/stockTypes'

const JUDGMENT_STYLE = {
  買い候補: { bg: 'bg-emerald-50', border: 'border-emerald-400', text: 'text-emerald-700', badge: 'bg-emerald-500', icon: '📈' },
  様子見: { bg: 'bg-amber-50', border: 'border-amber-400', text: 'text-amber-700', badge: 'bg-amber-500', icon: '👀' },
  危険: { bg: 'bg-red-50', border: 'border-red-400', text: 'text-red-700', badge: 'bg-red-500', icon: '⚠️' },
}

const SOURCE_LABEL: Record<string, string> = {
  real: '実データ',
  calculated: '計算値',
  unavailable: 'Ver2対応予定',
}
const SOURCE_COLOR: Record<string, string> = {
  real: 'text-emerald-600 bg-emerald-50',
  calculated: 'text-blue-600 bg-blue-50',
  unavailable: 'text-gray-400 bg-gray-100',
}

function fmt(n: number | null, suffix = ''): string {
  if (n === null) return '—'
  return `${n.toLocaleString('ja-JP')}${suffix}`
}

function ScoreBar({ score, max }: { score: number; max: number }) {
  const pct = Math.round((score / max) * 100)
  const color = pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-bold tabular-nums w-14 text-right">
        {score} / {max}
      </span>
    </div>
  )
}

function StockCard({ stock }: { stock: StockData }) {
  const change = stock.changePercent
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
      {[
        { label: '株価', value: fmt(stock.price, '円') },
        { label: '前日比', value: change === null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`, color: change === null ? '' : change >= 0 ? 'text-red-600' : 'text-blue-600' },
        { label: '時価総額', value: fmt(stock.marketCap, '億円') },
        { label: '売上高', value: fmt(stock.revenue, '億円') },
      ].map(({ label, value, color }) => (
        <div key={label} className="bg-white rounded-2xl border border-gray-100 py-3 px-2 shadow-sm">
          <p className="text-[11px] font-semibold text-gray-400 mb-1">{label}</p>
          <p className={`text-base font-black ${color ?? ''}`}>{value}</p>
        </div>
      ))}
    </div>
  )
}

function TechnicalCard({ stock }: { stock: StockData }) {
  const technical = stock.technicalAnalysis
  const techRows = [
    { label: '25日移動平均', value: fmt(technical.ma25, '円') },
    { label: '75日移動平均', value: fmt(technical.ma75, '円') },
    { label: 'RSI(14)', value: technical.rsi14 !== null ? `${technical.rsi14.toFixed(1)}` : '—' },
    { label: '20日平均出来高', value: fmt(technical.avgVolume20) },
    { label: '現在出来高', value: fmt(technical.currentVolume) },
    { label: '52週高値', value: fmt(technical.week52High, '円') },
    { label: '52週安値', value: fmt(technical.week52Low, '円') },
    { label: '52週高値との差', value: technical.diffFrom52WeekHighPercent !== null ? `${technical.diffFrom52WeekHighPercent.toFixed(2)}%` : '—' },
    { label: '52週安値との差', value: technical.diffFrom52WeekLowPercent !== null ? `+${technical.diffFrom52WeekLowPercent.toFixed(2)}%` : '—' },
  ]

  return (
    <div className="bg-white rounded-3xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <p className="text-xs font-black text-gray-400 mb-1">短期評価</p>
          <h3 className="text-lg font-black text-gray-900">テクニカル分析 Ver3</h3>
          <p className="text-xs text-gray-500 mt-1">{technical.buyTiming ?? '短期データを取得できませんでした。'}</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-black text-slate-900">{technical.technicalScore ?? '—'}</p>
          <p className="text-xs font-bold text-emerald-600">{technical.technicalRating ?? '判定なし'}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
        {techRows.map((row) => (
          <div key={row.label} className="flex justify-between items-center py-1.5 border-b border-gray-50">
            <span className="text-gray-600 font-medium">{row.label}</span>
            <span className="font-bold text-gray-900">{row.value}</span>
          </div>
        ))}
      </div>
      {technical.comments.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3 space-y-1.5">
          {technical.comments.map((comment) => (
            <p key={comment} className="text-xs leading-relaxed text-gray-600">・{comment}</p>
          ))}
        </div>
      )}
    </div>
  )
}

function StockChartCard({ stock }: { stock: StockData }) {
  const history = stock.chartHistory ?? []
  if (history.length < 2) {
    return (
      <div className="bg-white rounded-3xl p-5 shadow-sm">
        <h3 className="text-lg font-black text-gray-900">株価チャート</h3>
        <p className="mt-3 text-sm text-gray-500">チャートデータ取得不可</p>
      </div>
    )
  }

  const width = 720
  const height = 300
  const padding = { top: 20, right: 16, bottom: 34, left: 56 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const values = history.flatMap((point) =>
    [point.close, point.ma25, point.ma75].filter((value): value is number => value !== null),
  )
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const pricePadding = Math.max((rawMax - rawMin) * 0.08, rawMax * 0.01)
  const minPrice = rawMin - pricePadding
  const maxPrice = rawMax + pricePadding
  const priceRange = Math.max(maxPrice - minPrice, 1)
  const x = (index: number) => padding.left + (index / (history.length - 1)) * plotWidth
  const y = (value: number) => padding.top + ((maxPrice - value) / priceRange) * plotHeight

  const makePath = (select: (point: ChartHistoryPoint) => number | null) => {
    let drawing = false
    return history.map((point, index) => {
      const value = select(point)
      if (value === null) {
        drawing = false
        return ''
      }
      const command = drawing ? 'L' : 'M'
      drawing = true
      return `${command}${x(index).toFixed(1)},${y(value).toFixed(1)}`
    }).join(' ')
  }

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
  const dateIndexes = [0, Math.floor((history.length - 1) / 2), history.length - 1]
  const formatDate = (date: string) => {
    const [, month, day] = date.split('-')
    return `${Number(month)}/${Number(day)}`
  }

  return (
    <div className="bg-white rounded-3xl p-5 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-black text-gray-400 mb-1">過去1年の日足</p>
          <h3 className="text-lg font-black text-gray-900">株価チャート</h3>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-gray-600">
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-slate-900" />終値</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-emerald-500" />25日線</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-amber-500" />75日線</span>
        </div>
      </div>
      <div className="w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${stock.name}の過去1年の株価チャート`}
          className="block w-full h-auto"
        >
          <rect x={padding.left} y={padding.top} width={plotWidth} height={plotHeight} fill="#f8fafc" />
          {gridLines.map((ratio) => {
            const gridY = padding.top + ratio * plotHeight
            const priceLabel = maxPrice - ratio * priceRange
            return (
              <g key={ratio}>
                <line x1={padding.left} x2={width - padding.right} y1={gridY} y2={gridY} stroke="#e2e8f0" strokeWidth="1" />
                <text x={padding.left - 8} y={gridY + 4} textAnchor="end" fontSize="11" fill="#64748b">
                  {Math.round(priceLabel).toLocaleString('ja-JP')}
                </text>
              </g>
            )
          })}
          <path d={makePath((point) => point.close)} fill="none" stroke="#0f172a" strokeWidth="2.5" strokeLinejoin="round" />
          <path d={makePath((point) => point.ma25)} fill="none" stroke="#10b981" strokeWidth="2" strokeLinejoin="round" />
          <path d={makePath((point) => point.ma75)} fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinejoin="round" />
          {dateIndexes.map((index) => (
            <text
              key={index}
              x={x(index)}
              y={height - 10}
              textAnchor={index === 0 ? 'start' : index === history.length - 1 ? 'end' : 'middle'}
              fontSize="11"
              fill="#64748b"
            >
              {formatDate(history[index].date)}
            </text>
          ))}
        </svg>
      </div>
    </div>
  )
}

function MarketSessionCard({ stock }: { stock: StockData }) {
  const session = stock.marketSession
  const color = session.status === 'open' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : session.status === 'break' ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-gray-700 bg-gray-50 border-gray-200'

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${color}`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
        <span className="font-black">日本株市場時間: {session.label}</span>
        <span className="text-xs font-bold">{session.nextSession}</span>
      </div>
      <p className="mt-1 text-xs opacity-80">前場 9:00〜11:30 / 後場 12:30〜15:30 / 休場 土日祝</p>
    </div>
  )
}

export default function Home() {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<DiagnosisResult | null>(null)
  const [candidates, setCandidates] = useState<StockSearchCandidate[]>([])
  const [selectedIdx, setSelectedIdx] = useState(-1)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 入力中のリアルタイム検索 (200ms デバウンス)
  useEffect(() => {
    const trimmed = code.trim()
    // 4桁コード入力中 or 1文字未満 は検索しない
    if (trimmed.length < 2 || /^\d{4}$/.test(trimmed)) {
      setCandidates([])
      return
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`)
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data.candidates)) {
            setCandidates(data.candidates)
          }
        }
      } catch {
        // ignore
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [code])

  // candidatesが変わったら選択インデックスをリセット
  useEffect(() => { setSelectedIdx(-1) }, [candidates])

  // ドロップダウン外クリックで閉じる
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setCandidates([])
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleAnalyze = async (searchValue = code) => {
    const trimmed = searchValue.trim()
    if (!trimmed) {
      setError('銘柄コードまたは社名を入力してください')
      return
    }
    setError('')
    setLoading(true)
    setResult(null)
    setCandidates([])
    setSelectedIdx(-1)
    try {
      const res = await fetch(`/api/stock?code=${encodeURIComponent(trimmed)}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'エラーが発生しました')
        return
      }
      if (Array.isArray((data as StockSearchCandidatesResponse).candidates)) {
        setCandidates((data as StockSearchCandidatesResponse).candidates)
        return
      }
      setResult(diagnose(data as StockData))
    } catch {
      setError('通信エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  const jStyle = result ? JUDGMENT_STYLE[result.judgment] : null

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 pb-20">

      {/* ナビ */}
      <nav className="border-b border-white/10">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <span className="text-lg font-black text-white">📊 日本株AI診断</span>
          <span className="text-xs text-slate-400 hidden sm:block">Yahoo Finance リアルデータ使用</span>
        </div>
      </nav>

      {/* ヒーロー */}
      <section className="max-w-2xl mx-auto px-4 pt-10 pb-6 text-center">
        <h1 className="text-3xl sm:text-4xl font-black text-white leading-tight">
          銘柄コード・社名を入れるだけで<br />
          <span className="text-emerald-400">AI が株を100点採点</span>
        </h1>
        <p className="mt-3 text-slate-300 text-sm">PER・PBR・ROE・配当など5指標を総合分析して「買い候補/様子見/危険」を判定</p>
      </section>

      <div className="max-w-2xl mx-auto px-4 space-y-4">

        {/* 入力エリア */}
        <div className="bg-white rounded-3xl shadow-xl p-6">
          <label className="block text-sm font-bold text-gray-600 mb-2">銘柄コード・社名</label>
          <div className="relative" ref={dropdownRef}>
            <div className="flex gap-3">
              <input
                type="text"
                value={code}
                onChange={(e) => { setCode(e.target.value); setError('') }}
                onKeyDown={(e) => {
                  if (candidates.length > 0) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setSelectedIdx((i) => Math.min(i + 1, candidates.length - 1))
                      return
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setSelectedIdx((i) => Math.max(i - 1, -1))
                      return
                    }
                    if (e.key === 'Escape') {
                      setCandidates([])
                      setSelectedIdx(-1)
                      return
                    }
                    if (e.key === 'Enter' && selectedIdx >= 0) {
                      e.preventDefault()
                      const sel = candidates[selectedIdx]
                      setCode(sel.code)
                      setCandidates([])
                      handleAnalyze(sel.code)
                      return
                    }
                  }
                  if (e.key === 'Enter' && !loading) handleAnalyze()
                }}
                placeholder="例：7203 / トヨタ / 川崎重工 / かわさきじゅうこう"
                className="flex-1 min-w-0 h-12 border-2 border-gray-200 rounded-2xl px-4 text-base font-bold focus:border-blue-500 focus:outline-none transition-colors"
                autoComplete="off"
              />
              <button
                onClick={() => handleAnalyze()}
                disabled={loading}
                className="h-12 px-6 bg-slate-900 text-white font-black rounded-2xl hover:bg-slate-700 active:scale-95 transition-all disabled:opacity-50 whitespace-nowrap"
              >
                {loading ? '分析中...' : '診断する'}
              </button>
            </div>

            {/* リアルタイムドロップダウン */}
            {candidates.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-2xl shadow-lg overflow-hidden">
                <p className="text-[11px] font-bold text-gray-400 px-3 pt-2 pb-1">
                  {candidates.length} 件の候補（↑↓で選択、Enterで確定）
                </p>
                <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
                  {candidates.map((candidate, idx) => (
                    <button
                      key={candidate.code}
                      type="button"
                      onMouseEnter={() => setSelectedIdx(idx)}
                      onClick={() => {
                        setCode(candidate.code)
                        setCandidates([])
                        setSelectedIdx(-1)
                        handleAnalyze(candidate.code)
                      }}
                      className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors ${
                        idx === selectedIdx ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <span className="text-sm font-bold text-gray-800">{candidate.name}</span>
                      <span className="text-xs font-mono text-gray-400 shrink-0">{candidate.code}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {error && <p className="mt-2 text-sm text-red-500">⚠️ {error}</p>}
          <p className="mt-2 text-xs text-gray-400">例: 7203 / トヨタ / ソニー / 川崎重工 / キーエンス</p>
        </div>

        {/* ローディング */}
        {loading && (
          <div className="bg-white rounded-3xl p-8 flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
            <p className="text-gray-500 text-sm font-medium">株価・財務データを取得中...</p>
          </div>
        )}

        {/* 結果 */}
        {result && jStyle && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">

            {/* データソース状況バナー */}
            {result.stock.dataSource === 'jquants' ? (
              <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
                <span className="font-bold">✅ Ver2 稼働中：</span>
                株価（Stooq）＋財務指標（J-Quants API）のリアルデータで採点しています。
              </div>
            ) : (
              <div className="rounded-2xl bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700">
                <span className="font-bold">📌 Ver1 動作中：</span>
                株価はStooqから取得済み。財務指標はJ-Quants APIの環境変数（JQUANTS_EMAIL・JQUANTS_PASSWORD）を設定すると有効になります。
              </div>
            )}

            {/* 判定カード */}
            <div className={`rounded-3xl border-2 ${jStyle.border} ${jStyle.bg} p-6 text-center shadow-sm`}>
              <p className="text-4xl mb-2">{jStyle.icon}</p>
              <div className={`inline-block text-white text-sm font-black px-4 py-1.5 rounded-full ${jStyle.badge} mb-3`}>
                {result.judgment}
              </div>
              <p className={`text-6xl font-black ${jStyle.text} mb-1`}>{result.totalScore}</p>
              <p className="text-gray-500 text-sm">/ 100点</p>
              <p className="mt-3 text-sm text-gray-700 leading-relaxed max-w-md mx-auto">{result.summary}</p>
            </div>

            {/* 銘柄サマリー */}
            <div className="bg-white rounded-3xl p-5 shadow-sm">
              <div className="flex items-baseline gap-2 mb-4">
                <h2 className="text-lg font-black text-gray-900">{result.stock.name}</h2>
                <span className="text-sm text-gray-400 font-mono">{result.stock.code}</span>
              </div>
              <StockCard stock={result.stock} />
            </div>

            <MarketSessionCard stock={result.stock} />

            <StockChartCard stock={result.stock} />

            <div className="bg-white rounded-3xl p-5 shadow-sm">
              <p className="text-xs font-black text-gray-400 mb-1">長期評価</p>
              <h3 className="text-lg font-black text-gray-900 mb-2">ファンダメンタル分析</h3>
              <p className="text-sm text-gray-600">{result.summary}</p>
            </div>

            <TechnicalCard stock={result.stock} />

            {/* スコア詳細 */}
            <div className="bg-white rounded-3xl p-5 shadow-sm">
              <h3 className="text-sm font-black text-gray-500 mb-4">スコア詳細</h3>
              <div className="space-y-4">
                {result.details.map((d) => (
                  <div key={d.label}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-gray-800">{d.label}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${SOURCE_COLOR[d.dataSource]}`}>
                          {SOURCE_LABEL[d.dataSource]}
                        </span>
                      </div>
                      <span className="text-sm font-black text-gray-700">{d.value}</span>
                    </div>
                    <ScoreBar score={d.score} max={d.maxScore} />
                    <p className="text-xs text-gray-500 mt-1">{d.comment}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* 取得項目一覧 */}
            <div className="bg-white rounded-3xl p-5 shadow-sm">
              <h3 className="text-sm font-black text-gray-500 mb-3">取得データ一覧</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                {((): { label: string; value: string; status: 'ok' | 'pending'; note: string }[] => {
                  const s = result.stock
                  const isJQ = s.dataSource === 'jquants'
                  const pendingNote = isJQ ? 'J-Quants取得不可' : '環境変数未設定'
                  return [
                    { label: '株価',         value: fmt(s.price, '円'),   status: s.price !== null ? 'ok' : 'pending', note: 'Stooq' },
                    { label: '前日比',       value: s.changePercent !== null ? `${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(2)}%` : '—', status: s.changePercent !== null ? 'ok' : 'pending', note: 'Stooq' },
                    { label: 'PER',          value: s.per !== null ? `${s.per.toFixed(1)}倍` : '—', status: s.per !== null ? 'ok' : 'pending', note: isJQ ? 'J-Quants' : pendingNote },
                    { label: 'PBR',          value: s.pbr !== null ? `${s.pbr.toFixed(2)}倍` : '—', status: s.pbr !== null ? 'ok' : 'pending', note: isJQ ? 'J-Quants' : pendingNote },
                    { label: 'ROE',          value: s.roe !== null ? `${s.roe.toFixed(1)}%` : '算出不可',  status: s.roe !== null ? 'ok' : 'pending', note: isJQ ? 'J-Quants' : pendingNote },
                    { label: '配当利回り',   value: s.dividendYield !== null ? `${s.dividendYield.toFixed(2)}%` : '—', status: s.dividendYield !== null ? 'ok' : 'pending', note: isJQ ? 'J-Quants' : pendingNote },
                    { label: '時価総額',     value: fmt(s.marketCap, '億円'), status: s.marketCap !== null ? 'ok' : 'pending', note: isJQ ? 'J-Quants（算出）' : pendingNote },
                    { label: '売上高',       value: fmt(s.revenue, '億円'), status: s.revenue !== null ? 'ok' : 'pending', note: isJQ ? 'J-Quants' : pendingNote },
                    { label: '営業利益',     value: fmt(s.operatingProfit, '億円'), status: s.operatingProfit !== null ? 'ok' : 'pending', note: isJQ ? 'J-Quants' : pendingNote },
                    { label: '自己資本比率', value: s.equityRatio !== null ? `${s.equityRatio.toFixed(1)}%` : '—', status: s.equityRatio !== null ? 'ok' : 'pending', note: isJQ ? 'J-Quants' : pendingNote },
                  ]
                })().map(({ label, value, status, note }) => (
                  <div key={label} className="flex justify-between items-center py-1.5 border-b border-gray-50">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[10px] ${status === 'ok' ? 'text-emerald-500' : 'text-gray-300'}`}>●</span>
                      <span className="text-gray-600 font-medium">{label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`font-bold ${status === 'ok' ? 'text-gray-900' : 'text-gray-300'}`}>{value}</span>
                      <span className="text-[10px] text-gray-400 min-w-[72px] text-right">{note}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-gray-400">
                取得日時: {new Date(result.stock.fetchedAt).toLocaleString('ja-JP')}
                　●＝取得済み　○＝未取得
              </p>
            </div>

            {/* 免責 */}
            <p className="text-center text-xs text-slate-400 px-4">
              ※ 本ツールは情報提供を目的としており、投資を推奨するものではありません。投資判断はご自身の責任で行ってください。
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
