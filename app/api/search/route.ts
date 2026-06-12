import { NextResponse } from 'next/server'
import { searchStocks } from '@/lib/stockSearch'
import type { StockSearchCandidatesResponse } from '@/lib/stockTypes'

export async function GET(
  request: Request,
): Promise<NextResponse<StockSearchCandidatesResponse | { candidates: [] }>> {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')?.trim() ?? ''

  if (query.length < 1) {
    return NextResponse.json({ candidates: [] })
  }

  const candidates = searchStocks(query)
  return NextResponse.json({ query, candidates })
}
