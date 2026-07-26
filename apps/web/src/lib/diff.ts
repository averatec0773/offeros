export type LineDiffOp = "eq" | "add" | "del";

export interface LineDiffEntry {
  op: LineDiffOp;
  text: string;
}

export type LineDiff = LineDiffEntry[];

function splitLines(text: string): string[] {
  return text === "" ? [] : text.split("\n");
}

/**
 * A minimal LCS-based line diff. Builds the longest-common-subsequence table
 * over the two line arrays, then backtracks to emit "eq"/"del"/"add" runs —
 * the same shape `git diff` uses, without any external dependency.
 */
export function diffLines(oldStr: string, newStr: string): LineDiff {
  const a = splitLines(oldStr);
  const b = splitLines(newStr);
  const n = a.length;
  const m = b.length;

  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const result: LineDiff = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ op: "eq", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      result.push({ op: "del", text: a[i]! });
      i++;
    } else {
      result.push({ op: "add", text: b[j]! });
      j++;
    }
  }
  while (i < n) {
    result.push({ op: "del", text: a[i]! });
    i++;
  }
  while (j < m) {
    result.push({ op: "add", text: b[j]! });
    j++;
  }
  return result;
}
