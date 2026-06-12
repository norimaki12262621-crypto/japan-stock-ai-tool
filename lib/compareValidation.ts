export type CompareCell = "◎" | "○" | "△" | "×";

export interface CompareSlots {
  title: string;
  compareTargets: { A: string; B: string };
  axes: [string, string, string, string, string];
  table: [
    { axis: string; A: CompareCell; B: CompareCell },
    { axis: string; A: CompareCell; B: CompareCell },
    { axis: string; A: CompareCell; B: CompareCell },
    { axis: string; A: CompareCell; B: CompareCell },
    { axis: string; A: CompareCell; B: CompareCell },
  ];
  forA: string;
  forB: string;
  cta: string;
}

export interface ValidationResult {
  pass: boolean;
  score: number;
  fails: string[];
  deductions: string[];
  bonuses: string[];
}

const VALID_CELLS = ["◎", "○", "△", "×"] as const;

const BENEFIT_WORDS = [
  "迷わない", "後悔しない", "失敗しない", "損しない",
  "わかる", "選べる", "決まる", "差がつく", "得する",
];

const BANNED_TITLE_PATTERNS = [/とは/, /完全解説/, /初心者向け解説/];

const SENTENCE_PATTERN = /。|、|です|ます|から|ので/;

export function validateCompare(slots: CompareSlots): ValidationResult {
  const fails: string[] = [];
  const deductions: string[] = [];
  const bonuses: string[] = [];

  // --- FAIL条件 ---

  if (!slots.axes || slots.axes.length !== 5) {
    fails.push("比較軸が5個ではない");
  }

  (slots.axes ?? []).forEach((axis, i) => {
    if (axis.length > 10) fails.push(`軸${i + 1}「${axis}」が10文字超`);
    if (SENTENCE_PATTERN.test(axis)) fails.push(`軸${i + 1}に説明文混入`);
  });

  if (!slots.table || slots.table.length !== 5) {
    fails.push("比較表が5行ではない");
  }

  (slots.table ?? []).forEach((row, i) => {
    if (!VALID_CELLS.includes(row.A as CompareCell)) fails.push(`行${i + 1} Aセル「${row.A}」が記号以外`);
    if (!VALID_CELLS.includes(row.B as CompareCell)) fails.push(`行${i + 1} Bセル「${row.B}」が記号以外`);
  });

  if (!/[0-9０-９一二三四五六七八九十]/.test(slots.title)) {
    fails.push("タイトルに数字なし");
  }

  if (!BENEFIT_WORDS.some((w) => slots.title.includes(w))) {
    fails.push("タイトルに利益ワードなし");
  }

  BANNED_TITLE_PATTERNS.forEach((p) => {
    if (p.test(slots.title)) fails.push(`タイトルに禁止表現(${p.source})`);
  });

  if (slots.forA.length > 20) fails.push("forAが20文字超");
  if (slots.forB.length > 20) fails.push("forBが20文字超");
  if (slots.cta.length > 15) fails.push("CTAが15文字超");

  // --- 1. bonus 集計 ---
  let bonus = 0;

  const avgAxisLen = (slots.axes ?? []).reduce((s, a) => s + a.length, 0) / 5;
  if (avgAxisLen <= 4) {
    bonus += 5;
    bonuses.push("軸名平均4文字以下(+5)");
  }

  if (slots.forA.length <= 10 && slots.forB.length <= 10) {
    bonus += 5;
    bonuses.push("forA/forB両方10文字以内(+5)");
  }

  // --- 2. penalty 集計 ---
  let penalty = 0;

  if (avgAxisLen > 7) {
    penalty += 5;
    deductions.push("軸名が長め(-5)");
  }

  if (SENTENCE_PATTERN.test(slots.forA)) {
    penalty += 10;
    deductions.push("forAに文章形式(-10)");
  }

  if (SENTENCE_PATTERN.test(slots.forB)) {
    penalty += 10;
    deductions.push("forBに文章形式(-10)");
  }

  const allText = [slots.forA, slots.forB, slots.cta, ...(slots.axes ?? [])].join("");
  if (allText.length > 120) {
    penalty += 10;
    deductions.push("総文字数過多(-10)");
  }

  // --- 3-5. スコア計算 ---
  let score = fails.length > 0
    ? 0
    : Math.max(0, Math.min(100, 100 + bonus) - penalty);

  return { pass: fails.length === 0, score, fails, deductions, bonuses };
}
