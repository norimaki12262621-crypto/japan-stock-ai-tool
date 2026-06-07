'use client'

import { useState } from 'react'
import { diagnose } from '@/lib/stockScoring'
import type { DiagnosisResult } from '@/lib/stockTypes'
import type { StockData } from '@/lib/stockTypes'

const JUDGMENT_STYLE = {
  買い候補: { bg: 'bg-emerald-50', border: 'border-emerald-400', text: 'text-emerald-700', badge: 'bg-emerald-500', icon: '📈' },
  様子見: { bg: 'bg-amber-50', border: 'border-amber-400', text: 'text-amber-700', badge: 'bg-amber-500', icon: '👀' },
  危険: { bg: 'bg-red-50', border: 'border-red-400', text: 'text-red-700', badge: 'bg-red-500', icon: '⚠️' },
}

const SOURCE_LABEL: Record<string, string> = {
  real: '実データ',
  calculated: '計算値',
  unavailable: '取得不可',
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

export default function Home() {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<DiagnosisResult | null>(null)

  const handleAnalyze = async () => {
    const trimmed = code.trim()
    if (!/^\d{4}$/.test(trimmed)) {
      setError('4桁の銘柄コードを入力してください（例: 7203）')
      return
    }
    setError('')
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch(`/api/stock?code=${trimmed}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'エラーが発生しました')
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
          銘柄コードを入れるだけで<br />
          <span className="text-emerald-400">AI が株を100点採点</span>
        </h1>
        <p className="mt-3 text-slate-300 text-sm">PER・PBR・ROE・配当など5指標を総合分析して「買い候補/様子見/危険」を判定</p>
      </section>

      <div className="max-w-2xl mx-auto px-4 space-y-4">

        {/* 入力エリア */}
        <div className="bg-white rounded-3xl shadow-xl p-6">
          <label className="block text-sm font-bold text-gray-600 mb-2">銘柄コード（4桁）</label>
          <div className="flex gap-3">
            <input
              type="text"
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/[^0-9]/g, '')); setError('') }}
              onKeyDown={(e) => e.key === 'Enter' && !loading && handleAnalyze()}
              placeholder="例：7203"
              maxLength={4}
              className="flex-1 h-12 border-2 border-gray-200 rounded-2xl px-4 text-lg font-mono font-bold text-center focus:border-blue-500 focus:outline-none transition-colors"
            />
            <button
              onClick={handleAnalyze}
              disabled={loading}
              className="h-12 px-6 bg-slate-900 text-white font-black rounded-2xl hover:bg-slate-700 active:scale-95 transition-all disabled:opacity-50 whitespace-nowrap"
            >
              {loading ? '分析中...' : '診断する'}
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-500">⚠️ {error}</p>}
          <p className="mt-2 text-xs text-gray-400">例: 7203（トヨタ）/ 9984（ソフトバンクG）/ 6758（ソニー）</p>
        </div>

        {/* ローディング */}
        {loading && (
          <div className="bg-white rounded-3xl p-8 flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
            <p className="text-gray-500 text-sm font-medium">Yahoo Finance からデータ取得中...</p>
          </div>
        )}

        {/* 結果 */}
        {result && jStyle && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">

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
                {[
                  { label: '株価', value: fmt(result.stock.price, '円'), src: '実データ' },
                  { label: 'PER', value: fmt(result.stock.per, '倍'), src: '実データ' },
                  { label: 'PBR', value: fmt(result.stock.pbr, '倍'), src: '実データ' },
                  { label: 'ROE', value: result.stock.roe !== null ? `${(result.stock.roe * 100).toFixed(1)}%` : '—', src: '実データ' },
                  { label: '配当利回り', value: result.stock.dividendYield !== null ? `${(result.stock.dividendYield * 100).toFixed(2)}%` : '—', src: '実データ' },
                  { label: '時価総額', value: fmt(result.stock.marketCap, '億円'), src: '実データ' },
                  { label: '売上高', value: fmt(result.stock.revenue, '億円'), src: '実データ' },
                  { label: '営業利益(EBITDA)', value: fmt(result.stock.operatingProfit, '億円'), src: '実データ' },
                  { label: '自己資本比率', value: result.stock.equityRatio !== null ? `${result.stock.equityRatio.toFixed(1)}%` : '—', src: '計算値' },
                ].map(({ label, value, src }) => (
                  <div key={label} className="flex justify-between items-center py-1.5 border-b border-gray-50">
                    <span className="text-gray-500 font-medium">{label}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900">{value}</span>
                      <span className="text-[10px] text-gray-400">{src}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-gray-400">
                データ取得: {new Date(result.stock.fetchedAt).toLocaleString('ja-JP')} ／ Yahoo Finance（非公式API）
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
