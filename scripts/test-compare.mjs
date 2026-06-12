// lib/compareValidation.ts の実装をそのまま移植(ESM)
const VALID_CELLS = ["◎", "○", "△", "×"];
const BENEFIT_WORDS = ["迷わない","後悔しない","失敗しない","損しない","わかる","選べる","決まる","差がつく","得する"];
const BANNED_TITLE_PATTERNS = [/とは/, /完全解説/, /初心者向け解説/];
const SENTENCE_PATTERN = /。|、|です|ます|から|ので/;

function validateCompare(slots) {
  const fails = [], deductions = [], bonuses = [];

  if (!slots.axes || slots.axes.length !== 5) fails.push("比較軸が5個ではない");

  (slots.axes ?? []).forEach((axis, i) => {
    if (axis.length > 10) fails.push(`軸${i + 1}「${axis}」が10文字超`);
    if (SENTENCE_PATTERN.test(axis)) fails.push(`軸${i + 1}に説明文混入`);
  });

  if (!slots.table || slots.table.length !== 5) fails.push("比較表が5行ではない");

  (slots.table ?? []).forEach((row, i) => {
    if (!VALID_CELLS.includes(row.A)) fails.push(`行${i + 1} Aセル「${row.A}」が記号以外`);
    if (!VALID_CELLS.includes(row.B)) fails.push(`行${i + 1} Bセル「${row.B}」が記号以外`);
  });

  if (!/[0-9０-９一二三四五六七八九十]/.test(slots.title)) fails.push("タイトルに数字なし");
  if (!BENEFIT_WORDS.some((w) => slots.title.includes(w))) fails.push("タイトルに利益ワードなし");
  BANNED_TITLE_PATTERNS.forEach((p) => { if (p.test(slots.title)) fails.push(`タイトルに禁止表現(${p.source})`); });
  if (slots.forA.length > 20) fails.push("forAが20文字超");
  if (slots.forB.length > 20) fails.push("forBが20文字超");
  if (slots.cta.length > 15) fails.push("CTAが15文字超");

  // 1. bonus
  let bonus = 0;
  const avgAxisLen = (slots.axes ?? []).reduce((s, a) => s + a.length, 0) / 5;
  if (avgAxisLen <= 4) { bonus += 5; bonuses.push("軸名平均4文字以下(+5)"); }
  if (slots.forA.length <= 10 && slots.forB.length <= 10) { bonus += 5; bonuses.push("forA/forB両方10文字以内(+5)"); }

  // 2. penalty
  let penalty = 0;
  if (avgAxisLen > 7) { penalty += 5; deductions.push("軸名が長め(-5)"); }
  if (SENTENCE_PATTERN.test(slots.forA)) { penalty += 10; deductions.push("forAに文章形式(-10)"); }
  if (SENTENCE_PATTERN.test(slots.forB)) { penalty += 10; deductions.push("forBに文章形式(-10)"); }
  const allText = [slots.forA, slots.forB, slots.cta, ...(slots.axes ?? [])].join("");
  if (allText.length > 120) { penalty += 10; deductions.push("総文字数過多(-10)"); }

  // 3-5. score
  const score = fails.length > 0
    ? 0
    : Math.max(0, Math.min(100, 100 + bonus) - penalty);

  return { pass: fails.length === 0, score, fails, deductions, bonuses };
}

// ============================================
// テストケース 4種
// ============================================

const testCases = [
  {
    label: "✅ 合格ケース(理想的)",
    expect: 100,
    slots: {
      title: "迷わない5軸で選ぶ日本株vs海外株",
      compareTargets: { A: "日本株", B: "海外株" },
      axes: ["成長性", "配当", "値動き", "分散", "手軽さ"],
      table: [
        { axis: "成長性", A: "△", B: "◎" },
        { axis: "配当",   A: "◎", B: "○" },
        { axis: "値動き", A: "○", B: "△" },
        { axis: "分散",   A: "△", B: "◎" },
        { axis: "手軽さ", A: "◎", B: "○" },
      ],
      forA: "安定配当重視の人",
      forB: "成長重視の人",
      cta: "保存して見返す",
    },
  },
  {
    label: "❌ FAILケース① タイトル不備",
    expect: 0,
    slots: {
      title: "日本株と海外株の違い",
      compareTargets: { A: "日本株", B: "海外株" },
      axes: ["成長性", "配当", "値動き", "分散", "手軽さ"],
      table: [
        { axis: "成長性", A: "△", B: "◎" },
        { axis: "配当",   A: "◎", B: "○" },
        { axis: "値動き", A: "○", B: "△" },
        { axis: "分散",   A: "△", B: "◎" },
        { axis: "手軽さ", A: "◎", B: "○" },
      ],
      forA: "安定重視の人",
      forB: "成長重視の人",
      cta: "保存して見返す",
    },
  },
  {
    label: "❌ FAILケース② 禁止表現・軸不足・セル不正",
    expect: 0,
    slots: {
      title: "日本株とは？完全解説5選",
      compareTargets: { A: "日本株", B: "海外株" },
      axes: ["成長性", "配当", "値動き", "分散"],
      table: [
        { axis: "成長性", A: "低め",   B: "高い" },
        { axis: "配当",   A: "◎",     B: "○" },
        { axis: "値動き", A: "安定",   B: "不安定" },
        { axis: "分散",   A: "△",     B: "◎" },
        { axis: "手軽さ", A: "◎",     B: "○" },
      ],
      forA: "安定した配当収入を求めている人",
      forB: "成長重視の人",
      cta: "今すぐ保存して後で比較しよう",
    },
  },
  {
    label: "⚠️  減点ケース(軸名が長い) → 期待: 95点",
    expect: 95,
    slots: {
      title: "後悔しない5つの選択基準",
      compareTargets: { A: "日本株", B: "海外株" },
      axes: ["成長ポテンシャル", "配当利回り傾向", "為替リスク影響度", "情報アクセス容易性", "税制優遇措置"],
      table: [
        { axis: "成長ポテンシャル",   A: "△", B: "◎" },
        { axis: "配当利回り傾向",     A: "◎", B: "○" },
        { axis: "為替リスク影響度",   A: "◎", B: "△" },
        { axis: "情報アクセス容易性", A: "◎", B: "○" },
        { axis: "税制優遇措置",       A: "○", B: "△" },
      ],
      forA: "国内市場に慣れた投資家",
      forB: "グローバル分散志向の人",
      cta: "保存して見返す",
    },
  },
];

// ============================================
// 実行
// ============================================

let allPassed = true;

for (const tc of testCases) {
  const result = validateCompare(tc.slots);
  const expectOk = result.score === tc.expect;
  if (!expectOk) allPassed = false;

  console.log("━".repeat(58));
  console.log(`【${tc.label}】`);
  console.log(`  タイトル  : ${tc.slots.title}`);
  console.log(`  PASS      : ${result.pass}`);
  console.log(`  SCORE     : ${result.score} / 100  (期待: ${tc.expect}) ${expectOk ? "✅" : "❌ 不一致"}`);
  if (result.bonuses.length > 0) {
    console.log(`  加点:`);
    result.bonuses.forEach((b) => console.log(`    + ${b}`));
  }
  if (result.deductions.length > 0) {
    console.log(`  減点:`);
    result.deductions.forEach((d) => console.log(`    − ${d}`));
  }
  if (result.fails.length > 0) {
    console.log(`  FAIL (${result.fails.length}件):`);
    result.fails.forEach((f) => console.log(`    ✗ ${f}`));
  }
  if (result.fails.length === 0 && result.bonuses.length === 0 && result.deductions.length === 0) {
    console.log("  加減点なし");
  }
}

console.log("━".repeat(58));
console.log(`\n総合: ${allPassed ? "✅ 全ケース期待値一致" : "❌ 不一致あり"}\n`);
