import type { StockData, ScoreDetail, DiagnosisResult } from './stockTypes'

function scorePER(per: number | null): ScoreDetail {
  const max = 25
  if (per === null) return { label: 'PER', value: 'データなし', score: 0, maxScore: max, comment: '未取得（Ver2対応予定）', dataSource: 'unavailable' }
  let score: number
  let comment: string
  if (per < 10)       { score = 25; comment = '割安圏。市場平均を大きく下回っています' }
  else if (per < 15)  { score = 20; comment = '割安〜適正。日本平均を下回っています' }
  else if (per < 20)  { score = 15; comment = '適正水準。市場平均付近です' }
  else if (per < 30)  { score = 8;  comment = 'やや割高。成長期待が織り込まれています' }
  else if (per < 50)  { score = 3;  comment = '割高水準。成長の裏付けが必要です' }
  else                { score = 0;  comment = '非常に割高。リスクが高い水準です' }
  return { label: 'PER', value: `${per.toFixed(1)}倍`, score, maxScore: max, comment, dataSource: 'real' }
}

function scorePBR(pbr: number | null): ScoreDetail {
  const max = 15
  if (pbr === null) return { label: 'PBR', value: 'データなし', score: 0, maxScore: max, comment: '未取得（Ver2対応予定）', dataSource: 'unavailable' }
  let score: number
  let comment: string
  if (pbr < 0.8)      { score = 15; comment = '純資産割れ。資産面での割安感があります' }
  else if (pbr < 1.5) { score = 12; comment = '割安〜適正。1倍近辺で安定しています' }
  else if (pbr < 2.5) { score = 8;  comment = '適正〜やや割高' }
  else if (pbr < 4.0) { score = 4;  comment = '割高。成長株として評価されています' }
  else                { score = 0;  comment = '非常に割高水準です' }
  return { label: 'PBR', value: `${pbr.toFixed(2)}倍`, score, maxScore: max, comment, dataSource: 'real' }
}

function scoreROE(roe: number | null): ScoreDetail {
  const max = 25
  if (roe === null) return { label: 'ROE', value: 'データなし', score: 0, maxScore: max, comment: '未取得（Ver2対応予定）', dataSource: 'unavailable' }
  const pct = roe
  let score: number
  let comment: string
  if (pct >= 20)      { score = 25; comment = '優秀。高い資本効率を維持しています' }
  else if (pct >= 15) { score = 20; comment = '良好。ROE15%超は収益力の高さを示します' }
  else if (pct >= 10) { score = 14; comment = '標準的。改善余地あり' }
  else if (pct >= 5)  { score = 7;  comment = '低水準。資本効率に課題あり' }
  else if (pct >= 0)  { score = 2;  comment = '非常に低い。収益性に問題があります' }
  else                { score = 0;  comment = '赤字。自己資本を毀損しています' }
  return { label: 'ROE', value: `${pct.toFixed(1)}%`, score, maxScore: max, comment, dataSource: 'real' }
}

function scoreDividend(dividendYield: number | null): ScoreDetail {
  const max = 20
  if (dividendYield === null) return { label: '配当利回り', value: 'データなし', score: 0, maxScore: max, comment: '未取得（Ver2対応予定）', dataSource: 'unavailable' }
  const pct = dividendYield
  let score: number
  let comment: string
  if (pct >= 4.0)     { score = 20; comment = '高配当。インカム面で魅力的です' }
  else if (pct >= 3.0){ score = 16; comment = '良好な配当水準です' }
  else if (pct >= 2.0){ score = 12; comment = '標準的な配当水準です' }
  else if (pct >= 1.0){ score = 7;  comment = 'やや低め。成長株型の傾向' }
  else if (pct > 0)   { score = 3;  comment = '配当は少額です' }
  else                { score = 0;  comment = '無配当です' }
  return { label: '配当利回り', value: `${pct.toFixed(2)}%`, score, maxScore: max, comment, dataSource: 'real' }
}

function scoreEquityRatio(equityRatio: number | null): ScoreDetail {
  const max = 15
  if (equityRatio === null) return { label: '自己資本比率', value: 'データなし', score: 0, maxScore: max, comment: '未取得（Ver2対応予定）', dataSource: 'unavailable' }
  let score: number
  let comment: string
  if (equityRatio >= 60)      { score = 15; comment = '財務基盤が非常に安定しています' }
  else if (equityRatio >= 50) { score = 12; comment = '財務健全性が高い水準です' }
  else if (equityRatio >= 40) { score = 9;  comment = '標準的な財務水準です' }
  else if (equityRatio >= 25) { score = 5;  comment = 'やや負債依存。業種特性を確認してください' }
  else                        { score = 0;  comment = '財務リスクが高い水準です' }
  return { label: '自己資本比率', value: `${equityRatio.toFixed(1)}%`, score, maxScore: max, comment, dataSource: 'calculated' }
}

export function diagnose(stock: StockData): DiagnosisResult {
  const details: ScoreDetail[] = [
    scorePER(stock.per),
    scorePBR(stock.pbr),
    scoreROE(stock.roe),
    scoreDividend(stock.dividendYield),
    scoreEquityRatio(stock.equityRatio),
  ]

  const available = details.filter((d) => d.dataSource !== 'unavailable')
  const availableMax = available.reduce((s, d) => s + d.maxScore, 0)
  const availableScore = available.reduce((s, d) => s + d.score, 0)

  // 取得できた指標だけで100点に正規化する
  const totalScore = availableMax > 0
    ? Math.min(100, Math.round((availableScore / availableMax) * 100))
    : 0

  const hasEnoughData = available.length >= 3

  let judgment: '買い候補' | '様子見' | '危険'
  let judgmentColor: 'green' | 'yellow' | 'red'

  if (!hasEnoughData) {
    judgment = '様子見'
    judgmentColor = 'yellow'
  } else if (totalScore >= 65) {
    judgment = '買い候補'
    judgmentColor = 'green'
  } else if (totalScore >= 45) {
    judgment = '様子見'
    judgmentColor = 'yellow'
  } else {
    judgment = '危険'
    judgmentColor = 'red'
  }

  const summary = buildSummary(totalScore, judgment, stock, available.length)

  return { stock, totalScore, judgment, judgmentColor, details, summary }
}

function buildSummary(score: number, judgment: string, stock: StockData, availableCount: number): string {
  if (availableCount === 0) {
    return `${stock.name}（${stock.code}）の株価を取得しました。財務指標のデータ取得はVer2で対応予定です。`
  }
  if (judgment === '買い候補') {
    return `${stock.name}（${stock.code}）は取得済み${availableCount}指標でスコア${score}点、「買い候補」と判定されました。`
  }
  if (judgment === '危険') {
    return `${stock.name}（${stock.code}）は取得済み${availableCount}指標でスコア${score}点、「危険」と判定されました。複数の指標にリスクが確認されています。`
  }
  return `${stock.name}（${stock.code}）は取得済み${availableCount}指標でスコア${score}点、「様子見」と判定されました。`
}
