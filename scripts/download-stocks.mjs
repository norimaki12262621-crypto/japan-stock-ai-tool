/**
 * JPX 東証上場銘柄一覧 (data_j.xls) をダウンロードして
 * public/stocks.json に変換するスクリプト
 *
 * 実行: node scripts/download-stocks.mjs
 */

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUTPUT = join(ROOT, 'public', 'stocks.json')

const JPX_URL =
  'https://www.jpx.co.jp/markets/statistics-equities/misc/tvdivq0000001vg2-att/data_j.xls'

async function main() {
  console.log('Downloading data_j.xls from JPX...')
  const res = await fetch(JPX_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'application/vnd.ms-excel,*/*',
      Referer: 'https://www.jpx.co.jp/',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)

  const buffer = Buffer.from(await res.arrayBuffer())
  console.log(`Downloaded ${(buffer.length / 1024).toFixed(1)} KB`)

  const { read, utils } = await import('xlsx')
  const wb = read(buffer, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = utils.sheet_to_json(ws, { header: 1, defval: '' })

  // ヘッダー行の位置を検出（通常は0行目）
  let dataStart = 1
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const cell = String(rows[i][0])
    if (cell.includes('コード') || cell.toLowerCase().includes('code')) {
      dataStart = i + 1
      console.log(`Header found at row ${i}: ${rows[i].slice(0, 3).join(', ')}`)
      break
    }
  }

  // ヘッダーからコード列・銘柄名列のインデックスを取得
  const header = rows[dataStart - 1].map((h) => String(h))
  let codeCol = header.findIndex((h) => h === 'コード' || h.toLowerCase() === 'code')
  let nameCol = header.findIndex((h) => h === '銘柄名' || h.includes('Name') || h.includes('name'))
  // フォールバック: 見つからなければ旧仕様(col0=code, col1=name)を試みる
  if (codeCol < 0) codeCol = 0
  if (nameCol < 0) nameCol = 1
  console.log(`Columns → code: ${codeCol} (${header[codeCol]}), name: ${nameCol} (${header[nameCol]})`)

  const stocks = []
  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i]
    // Excelの数値セルを4桁文字列に変換
    const rawCode = typeof row[codeCol] === 'number'
      ? String(Math.round(row[codeCol])).padStart(4, '0')
      : String(row[codeCol] ?? '').trim().replace(/\.0+$/, '')
    const code = rawCode.padStart(4, '0')
    const name = String(row[nameCol] ?? '').trim()
    if (/^\d{4}$/.test(code) && name) {
      stocks.push({ code, name })
    }
  }

  // コード順にソート、重複除去
  const unique = [...new Map(stocks.map((s) => [s.code, s])).values()]
  unique.sort((a, b) => a.code.localeCompare(b.code))

  mkdirSync(join(ROOT, 'public'), { recursive: true })
  writeFileSync(OUTPUT, JSON.stringify(unique), 'utf-8')
  console.log(`\n✅ ${unique.length} 銘柄 → public/stocks.json`)

  // 検証
  const checks = [
    { q: '川崎重工', code: '7012' },
    { q: 'キーエンス', code: '6861' },
    { q: '任天堂',   code: '7974' },
    { q: 'レーザーテック', code: '6920' },
    { q: 'トヨタ',   code: '7203' },
  ]
  console.log('\n--- 検証 ---')
  for (const { q, code } of checks) {
    const found = unique.find((s) => s.name.includes(q) || s.code === code)
    console.log(`  ${q} (${code}): ${found ? `✅ ${found.name} / ${found.code}` : '❌ not found'}`)
  }
}

main().catch((e) => {
  console.error('❌', e.message)
  process.exit(1)
})
