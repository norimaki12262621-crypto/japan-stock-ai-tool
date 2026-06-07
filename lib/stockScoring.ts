import type { StockData, ScoreDetail, DiagnosisResult } from './stockTypes'

function scorePER(per: number | null): ScoreDetail {
  const max = 25
  if (per === null) {
    return { label: 'PER', value: 'データなし', score: 0, maxScore: max, comment: '取得できませんでした', dataSource: 'unavailable' }
  }
  let score: number
  let comment: string
  if (per < 10) { score = 25; comment = '割安圏。市場平均を大きく下回っています' }
  else if (per < 15) { score = 20; comment = '割安〜適正。日本平均を下回っています' }
  else if (per < 20) { score = 15; comment = '適正水準。市場平均付近です' }
  else if (per < 30) { score = 8; comment = 'やや割高。成長期待が織り込まれています' }
  else if (per < 50) { score = 3; comment = '割高水準。成長の裏付けが必要です' }
  else { score = 0; comment = '非常に割高。リスクが高い水準です' }
  return { label: 'PER', value: `${per.toFixed(1)}倍`, score, maxScore: max, comment, dataSource: 'real' }
}

function scorePBR(pbr: number | null): ScoreDetail {
  const max = 15
  if (pbr === null) {
    return { label: 'PBR', value: 'データなし', score: 0, maxScore: max, comment: '取得できませんでした', dataSource: 'unavailable' }
  }
  let score: number
  let comment: string
  if (pbr < 0.8) { score = 15; comment = '純資産割れ。資産面での割安感があります' }
  else if (pbr < 1.5) { score = 12; comment = '割安〜適正。1倍近辺で安定しています' }
  else if (pbr < 2.5) { score = 8; comment = '適正〜やや割高' }
  else if (pbr < 4.0) { score = 4; comment = '割高。成長株として評価されています' }
  else { score = 0; comment = '非常に割高水準です' }
  return { label: 'PBR', value: `${pbr.toFixed(2)}倍`, score, maxScore: max, comment, dataSource: 'real' }
}

function scoreROE(roe: number | null): ScoreDetail {
  const max = 25
  if (roe === null) {
    return { label: 'ROE', value: 'データなし', score: 0, maxScore: max, comment: '取得できませんでした', dataSource: 'unavailable' }
  }
  const roePct = roe * 100
  let score: number
  let comment: string
  if (roePct >= 20) { score = 25; comment = '優秀。高い資本効率を維持しています' }
  else if (roePct >= 15) { score = 20; comment = '良好。ROE15%超は収益力の高さを示します' }
  else if (roePct >= 10) { score = 14; comment = '標準的。改善余地あり' }
  else if (roePct >= 5) { score = 7; comment = '低水準。資本効率に課題あり' }
  else if (roePct >= 0) { score = 2; comment = '非常に低い。収益性に問題があります' }
  else { score = 0; comment = '赤字。自己資本を毀損しています' }
  return { label: 'ROE', value: `${roePct.toFixed(1)}%`, score, maxScore: max, comment, dataSource: 'real' }
}

function scoreDividend(dividendYield: number | null): ScoreDetail {
  const max = 20
  if (dividendYield === null) {
    return { label: '配当利回り', value: 'データなし', score: 5, maxScore: max, comment: '無配または取得不可', dataSource: 'unavailable' }
  }
  const yieldPct = dividendYield * 100
  let score: number
  let comment: string
  if (yieldPct >= 4.0) { score = 20; comment = '高配当。インカム面で魅力的です' }
  else if (yieldPct >= 3.0) { score = 16; comment = '良好な配当水準です' }
  else if (yieldPct >= 2.0) { score = 12; comment = '標準的な配当水準です' }
  else if (yieldPct >= 1.0) { score = 7; comment = 'やや低め。成長株型の傾向' }
  else if (yieldPct > 0) { score = 3; comment = '配当は少額です' }
  else { score = 0; comment = '無配当です' }
  return { label: '配当利回り', value: `${yieldPct.toFixed(2)}%`, score, maxScore: max, comment, dataSource: 'real' }
}

function scoreEquityRatio(equityRatio: number | null): ScoreDetail {
  const max = 15
  if (equityRatio === null) {
    return { label: '自己資本比率', value: 'データなし', score: 0, maxScore: max, comment: '取得できませんでした', dataSource: 'unavailable' }
  }
  let score: number
  let comment: string
  if (equityRatio >= 60) { score = 15; comment = '財務基盤が非常に安定しています' }
  else if (equityRatio >= 50) { score = 12; comment = '財務健全性が高い水準です' }
  else if (equityRatio >= 40) { score = 9; comment = '標準的な財務水準です' }
  else if (equityRatio >= 25) { score = 5; comment = 'やや負債依存。業種特性を確認してください' }
  else { score = 0; comment = '財務リスクが高い水準です' }
  return { label: '自己資本比率', value: `${equityRatio.toFixed(1)}%`, score, maxScore: max, comment, dataSource: 'calculated' }
}

function buildSummary(score: number, judgment: string, stock: StockData): string {
  const lines: string[] = []
  if (judgment === '買い候補') {
    lines.push(`${stock.name}（${stock.code}）はスコア${score}点で「買い候補」と判定されました。`)
    if (stock.per && stock.per < 15) lines.push('PERが市場平均を下回り、割安感があります。')
    if (stock.roe && stock.roe * 100 >= 15) lines.push('ROEが高く、高い資本効率を維持しています。')
    if (stock.dividendYield && stock.dividendYield * 100 >= 3) lines.push('配当利回りも良好で、長期保有に適しています。')
  } else if (judgment === '様子見') {
    lines.push(`${stock.name}（${stock.code}）はスコア${score}点で「様子見」と判定されました。`)
    lines.push('一部指標に課題があるため、決算発表や業績動向を確認しながら判断を行うことをお勧めします。')
  } else {
    lines.push(`${stock.name}（${stock.code}）はスコア${score}点で「危険」と判定されました。`)
    lines.push('複数の指標でリスクが確認されています。現時点での投資には慎重な判断が必要です。')
  }
  return lines.join(' ')
}

export function diagnose(stock: StockData): DiagnosisResult {
  const details: ScoreDetail[] = [
    scorePER(stock.per),
    scorePBR(stock.pbr),
    scoreROE(stock.roe),
    scoreDividend(stock.dividendYield),
    scoreEquityRatio(stock.equityRatio),
  ]

  const totalScore = Math.min(100, details.reduce((sum, d) => sum + d.score, 0))

  let judgment: '買い候補' | '様子見' | '危険'
  let judgmentColor: 'green' | 'yellow' | 'red'
  if (totalScore >= 65) { judgment = '買い候補'; judgmentColor = 'green' }
  else if (totalScore >= 45) { judgment = '様子見'; judgmentColor = 'yellow' }
  else { judgment = '危険'; judgmentColor = 'red' }

  return {
    stock,
    totalScore,
    judgment,
    judgmentColor,
    details,
    summary: buildSummary(totalScore, judgment, stock),
  }
}
