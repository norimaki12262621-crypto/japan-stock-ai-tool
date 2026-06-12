import { readFileSync } from 'fs'
import { join } from 'path'
import type { StockSearchCandidate } from './stockTypes'

let cache: StockSearchCandidate[] | null = null

function loadStocks(): StockSearchCandidate[] {
  if (cache) return cache
  try {
    const raw = readFileSync(join(process.cwd(), 'public', 'stocks.json'), 'utf-8')
    cache = JSON.parse(raw) as StockSearchCandidate[]
    return cache
  } catch {
    return []
  }
}

/** 検索正規化: NFKC + 小文字 + 空白除去 + 株式会社除去 + カタカナ→ひらがな */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　・]/g, '')
    .replace(/株式会社|（株）|\(株\)|㈱|合同会社|有限会社/g, '')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
}

type Ranked = StockSearchCandidate & { rank: number }

/**
 * 社名・コードで部分一致検索。最大 limit 件返す。
 * rank: 0=完全一致, 1=前方一致, 2=部分一致
 */
export function searchStocks(
  query: string,
  limit = 10,
): StockSearchCandidate[] {
  const stocks = loadStocks()
  const q = normalizeForSearch(query)
  if (!q) return []

  const results: Ranked[] = []

  for (const s of stocks) {
    // コード完全一致 (最優先)
    if (s.code === query.trim()) {
      results.push({ ...s, rank: -1 })
      continue
    }
    const n = normalizeForSearch(s.name)
    if (n === q) results.push({ ...s, rank: 0 })
    else if (n.startsWith(q)) results.push({ ...s, rank: 1 })
    else if (n.includes(q)) results.push({ ...s, rank: 2 })
  }

  return results
    .sort((a, b) => a.rank - b.rank || a.name.length - b.name.length || a.code.localeCompare(b.code))
    .slice(0, limit)
    .map(({ code, name }) => ({ code, name }))
}

/** コードで1件検索 */
export function findStockByCode(code: string): StockSearchCandidate | null {
  return loadStocks().find((s) => s.code === code) ?? null
}
