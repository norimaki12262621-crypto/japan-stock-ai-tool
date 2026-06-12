/**
 * compare型 実戦E2Eテスト
 * ANTHROPIC_API_KEY=sk-ant-... node scripts/test-compare-e2e.mjs
 */

import Anthropic from "@anthropic-ai/sdk";

// ============================================================
// validateCompare (lib/compareValidation.ts と同一ロジック)
// ============================================================
const VALID_CELLS = ["◎", "○", "△", "×"];
const BENEFIT_WORDS = ["迷わない","後悔しない","失敗しない","損しない","わかる","選べる","決まる","差がつく","得する"];
const BANNED_TITLE_PATTERNS = [/とは/, /完全解説/, /初心者向け解説/];
const SENTENCE_PATTERN = /。|、|です|ます|から|ので/;

function validateCompare(slots) {
  const fails = [], deductions = [], bonuses = [];
  if (!slots.axes || slots.axes.length !== 5) fails.push("比較軸が5個ではない");
  (slots.axes ?? []).forEach((axis, i) => {
    if (axis.length > 10) fails.push(`軸${i+1}「${axis}」が10文字超`);
    if (SENTENCE_PATTERN.test(axis)) fails.push(`軸${i+1}に説明文混入`);
  });
  if (!slots.table || slots.table.length !== 5) fails.push("比較表が5行ではない");
  (slots.table ?? []).forEach((row, i) => {
    if (!VALID_CELLS.includes(row.A)) fails.push(`行${i+1} Aセル「${row.A}」が記号以外`);
    if (!VALID_CELLS.includes(row.B)) fails.push(`行${i+1} Bセル「${row.B}」が記号以外`);
  });
  if (!/[0-9０-９一二三四五六七八九十]/.test(slots.title)) fails.push("タイトルに数字なし");
  if (!BENEFIT_WORDS.some(w => slots.title.includes(w))) fails.push("タイトルに利益ワードなし");
  BANNED_TITLE_PATTERNS.forEach(p => { if (p.test(slots.title)) fails.push(`タイトルに禁止表現(${p.source})`); });
  if (slots.forA.length > 20) fails.push("forAが20文字超");
  if (slots.forB.length > 20) fails.push("forBが20文字超");
  if (slots.cta.length > 15) fails.push("CTAが15文字超");

  let bonus = 0, penalty = 0;
  const avgAxisLen = (slots.axes ?? []).reduce((s,a) => s+a.length, 0) / 5;
  if (avgAxisLen <= 4) { bonus += 5; bonuses.push("軸名平均4文字以下(+5)"); }
  if (slots.forA.length <= 10 && slots.forB.length <= 10) { bonus += 5; bonuses.push("forA/forB両方10文字以内(+5)"); }
  if (avgAxisLen > 7) { penalty += 5; deductions.push("軸名が長め(-5)"); }
  if (SENTENCE_PATTERN.test(slots.forA)) { penalty += 10; deductions.push("forAに文章形式(-10)"); }
  if (SENTENCE_PATTERN.test(slots.forB)) { penalty += 10; deductions.push("forBに文章形式(-10)"); }
  const allText = [slots.forA, slots.forB, slots.cta, ...(slots.axes ?? [])].join("");
  if (allText.length > 120) { penalty += 10; deductions.push("総文字数過多(-10)"); }

  const score = fails.length > 0 ? 0 : Math.max(0, Math.min(100, 100 + bonus) - penalty);
  return { pass: fails.length === 0, score, fails, deductions, bonuses };
}

// ============================================================
// generateComparePrompt
// ============================================================
function generateComparePrompt(input) {
  return `あなたはSNS図解の構成作家です。比較型図解のスロットをJSONのみで出力してください。

【テーマ】${input.topic}
${input.targetA && input.targetB ? `【比較対象】A=${input.targetA} / B=${input.targetB}` : ""}
${input.memo ? `【参考メモ】${input.memo}` : ""}

【出力フォーマット(厳守)】
{
  "title": "",
  "compareTargets": { "A": "", "B": "" },
  "axes": ["", "", "", "", ""],
  "table": [
    { "axis": "", "A": "", "B": "" },
    { "axis": "", "A": "", "B": "" },
    { "axis": "", "A": "", "B": "" },
    { "axis": "", "A": "", "B": "" },
    { "axis": "", "A": "", "B": "" }
  ],
  "forA": "",
  "forB": "",
  "cta": ""
}

【絶対ルール】
- 比較軸(axes)は必ず5個。各10文字以内。例:成長性/配当/値動き/分散/手軽さ
- table の A・B セルは「◎」「○」「△」「×」のみ。説明文・文章・数値は禁止
- title は数字を含み、利益ワード(迷わない/後悔しない/わかる 等)を含む
  良い例:「迷わない比較5軸」「後悔しない5項目比較」「違いがわかる5軸表」
  禁止:「○○とは」「完全解説」「初心者向け解説」
- forA / forB は「向いている人」を20文字以内。例:「安定重視の人」「成長重視の人」
- cta は15文字以内。例:「保存して見返す」「迷ったら保存」
- 長文説明・理由説明・吹き出し会話・段落・文章形式は一切禁止
- 情報量は最小限に。比較表として瞬時に理解できることが最優先

JSONのみ出力。前置き・コードブロック記法は不要。`;
}

// ============================================================
// compareTemplateToImagePrompt
// ============================================================
function compareTemplateToImagePrompt(s, stylePrompt) {
  return `SNS投稿用の比較型図解インフォグラフィックを1枚生成。

【レイアウト固定:3カラム比較表】
1. 最上部:タイトル「${s.title}」を大きく
2. その下:左に「${s.compareTargets.A}」右に「${s.compareTargets.B}」のヘッダーバッジ、中央にVSマーク
3. 中央:比較表(3列×5行)
   左列=比較軸 / 中列=${s.compareTargets.A} / 右列=${s.compareTargets.B}
${s.table.map(r => `   ${r.axis} | ${r.A} | ${r.B}`).join("\n")}
4. 表の下:左ボックス「${s.compareTargets.A}が向いている人:${s.forA}」/ 右ボックス「${s.compareTargets.B}が向いている人:${s.forB}」
5. 最下部:CTA帯「${s.cta}」

【スタイル】
${stylePrompt}

【厳守】
- セルは ◎○△× の記号のみを大きく描画。説明文を追加しない
- 表は罫線で明確に区切る
- 文字はすべて日本語で誤字なく正確に
- 余白を取り、瞬時に比較が理解できるレイアウトに`;
}

// ============================================================
// main
// ============================================================
async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("❌ ANTHROPIC_API_KEY が設定されていません。");
    console.error("   実行例: ANTHROPIC_API_KEY=sk-ant-... node scripts/test-compare-e2e.mjs");
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });
  const topic = "日本株と海外株";
  const targetA = "日本株";
  const targetB = "海外株";
  const stylePrompt = "手書き風・ネイビー×クリーム配色・ナチュラル";

  // ── Step 1: プロンプト生成 ──────────────────────────────
  console.log("━".repeat(60));
  console.log("【Step 1】generateComparePrompt でプロンプト生成");
  const prompt = generateComparePrompt({ topic, targetA, targetB });
  console.log(`テーマ: ${topic}`);
  console.log(`プロンプト文字数: ${prompt.length} 文字`);

  // ── Step 2: AI にスロット JSON 生成させる ─────────────────
  console.log("\n【Step 2】Claude API でスロット JSON を生成中...");
  let rawJson = "";
  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
    rawJson = response.content[0].type === "text" ? response.content[0].text.trim() : "";
    console.log(`使用トークン: input=${response.usage.input_tokens} / output=${response.usage.output_tokens}`);
  } catch (err) {
    console.error("❌ API エラー:", err.message);
    process.exit(1);
  }

  // ── JSON パース ────────────────────────────────────────────
  let slots;
  try {
    // コードブロック記法が混入した場合も除去
    const cleaned = rawJson.replace(/^```[^\n]*\n?/, "").replace(/```$/, "").trim();
    slots = JSON.parse(cleaned);
  } catch {
    console.error("\n❌ JSON パース失敗。AI の生出力:");
    console.error(rawJson);
    console.error("\n【FAIL分析】generateComparePrompt の指示強化案:");
    console.error("  → 「JSONのみ出力。```json など一切不要。」を冒頭に追加");
    console.error("  → 出力例を明示して誤フォーマットを防ぐ");
    process.exit(1);
  }

  // ── Step 3: 生成スロット表示 ──────────────────────────────
  console.log("\n【Step 3】生成されたスロット JSON");
  console.log("━".repeat(60));
  console.log(JSON.stringify(slots, null, 2));

  // ── Step 4: バリデーション ────────────────────────────────
  const result = validateCompare(slots);
  console.log("\n" + "━".repeat(60));
  console.log("【Step 4】validateCompare 結果");
  console.log(`  PASS  : ${result.pass}`);
  console.log(`  SCORE : ${result.score} / 100`);

  if (result.bonuses.length > 0) {
    console.log("  加点:");
    result.bonuses.forEach(b => console.log(`    + ${b}`));
  }
  if (result.deductions.length > 0) {
    console.log("  減点:");
    result.deductions.forEach(d => console.log(`    − ${d}`));
  }
  if (result.fails.length > 0) {
    console.log(`  FAIL (${result.fails.length}件):`);
    result.fails.forEach(f => console.log(`    ✗ ${f}`));
  }

  if (!result.pass) {
    // ── FAIL: 原因分析と改善提案 ─────────────────────────────
    console.log("\n" + "━".repeat(60));
    console.log("【FAIL分析】generateComparePrompt の指示強化案");

    const suggestions = [];

    if (result.fails.some(f => f.includes("数字なし"))) {
      suggestions.push({
        fail: "タイトルに数字なし",
        cause: "AIが「5軸」「5項目」などの数字を省略した",
        fix: '良い例リストに必ず数字入りサンプルを複数追加\n  例: "「日本株vs海外株 選び方5軸」「迷わない5つの違い」"',
      });
    }
    if (result.fails.some(f => f.includes("利益ワードなし"))) {
      suggestions.push({
        fail: "タイトルに利益ワードなし",
        cause: "AIが「比較」「違い」などの中立的ワードを選んだ",
        fix: "指示に「タイトルは必ず『迷わない』『わかる』『得する』等の利益ワードを入れよ」と明記する",
      });
    }
    if (result.fails.some(f => f.includes("記号以外"))) {
      suggestions.push({
        fail: "セルに記号以外の文字",
        cause: "AIがセルに説明文・数値・評価語を入れた",
        fix: '指示に禁止例を追加: "NG例: 「低め」「高い」「安定」→ 必ず ◎○△× のみ"',
      });
    }
    if (result.fails.some(f => f.includes("比較軸が5個ではない"))) {
      suggestions.push({
        fail: "比較軸が5個ではない",
        cause: "AIが4個または6個生成した",
        fix: '"axes は必ず5要素の配列。5個未満・5個超は厳禁"を強調する',
      });
    }
    if (result.fails.some(f => f.includes("禁止表現"))) {
      suggestions.push({
        fail: "タイトルに禁止表現",
        cause: "「とは」「完全解説」などが混入",
        fix: "禁止ワードを太字・感嘆符で明示: 「⚠ 絶対禁止: 〜とは / 完全解説 / 初心者向け解説」",
      });
    }
    if (result.fails.some(f => f.includes("文字超"))) {
      suggestions.push({
        fail: "forA/forB/CTA が文字数超過",
        cause: "AIが文字制限を無視した",
        fix: '"forA / forB は20文字以内（例:「安定重視の人」=8文字 ✓）、CTAは15文字以内"と文字数の目安例を添える',
      });
    }

    if (suggestions.length === 0) {
      console.log("  (上記のFAIL内容に対応する汎用提案: プロンプト末尾に「このルールを守れなかった場合は再生成してください」を追加)");
    } else {
      suggestions.forEach((s, i) => {
        console.log(`\n  [${i+1}] FAIL: ${s.fail}`);
        console.log(`       原因: ${s.cause}`);
        console.log(`       改善: ${s.fix}`);
      });
    }

    console.log("\n" + "━".repeat(60));
    console.log("総合: ❌ FAIL のため画像生成プロンプトは生成しません");
    process.exit(0);
  }

  // ── Step 5 (PASS): 画像生成プロンプト ──────────────────────
  console.log("\n" + "━".repeat(60));
  console.log("【Step 5】compareTemplateToImagePrompt — 画像生成プロンプト");
  const imagePrompt = compareTemplateToImagePrompt(slots, stylePrompt);
  console.log("━".repeat(60));
  console.log(imagePrompt);
  console.log("━".repeat(60));
  console.log("\n総合: ✅ PASS — 画像生成プロンプトを出力しました");
}

main();
