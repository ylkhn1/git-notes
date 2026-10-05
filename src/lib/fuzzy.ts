/**
 * Small fuzzy matcher for the command palette and quick switcher: every query character must
 * appear in order; runs, word starts and early matches score higher. Case-insensitive.
 */

export interface FuzzyMatch {
  score: number;
  /** Indices into `text` that matched, for highlighting. */
  positions: number[];
}

const SCORE_SUBSTRING = 1000;
const SCORE_WORD_START = 12;
const SCORE_CONSECUTIVE = 8;
const SCORE_CHAR = 1;
const PENALTY_GAP = 1;
const PENALTY_OFFSET = 0.05;

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  const prev = text[index - 1] ?? "";
  const cur = text[index] ?? "";
  return /[\s\-_/.([]/.test(prev) || (cur !== cur.toLowerCase() && prev === prev.toLowerCase());
}

/** Matches `query` against `text`; null when some query character is missing. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase();
  if (q === "") return { score: 0, positions: [] };
  const t = text.toLowerCase();

  // Whole-query substring wins outright, earlier is better.
  const sub = t.indexOf(q);
  if (sub !== -1) {
    const positions = Array.from({ length: q.length }, (_, i) => sub + i);
    const bonus = isWordStart(text, sub) ? SCORE_WORD_START : 0;
    return { score: SCORE_SUBSTRING + bonus - sub * PENALTY_OFFSET, positions };
  }

  // Greedy subsequence. Preferring word starts gives nicer highlights ("nn" → New note) but
  // can skip past the only viable path, so fall back to plain first-occurrence greed.
  return subsequence(q, text, t, true) ?? subsequence(q, text, t, false);
}

function subsequence(
  q: string,
  text: string,
  lower: string,
  preferWordStarts: boolean,
): FuzzyMatch | null {
  const positions: number[] = [];
  let score = 0;
  let from = 0;
  let prev = -2;
  for (const ch of q) {
    if (/\s/.test(ch)) continue;
    let index = -1;
    for (let i = from; i < lower.length; i += 1) {
      if (lower[i] !== ch) continue;
      if (index === -1) index = i;
      if (!preferWordStarts) break;
      if (isWordStart(text, i)) {
        index = i;
        break;
      }
      if (i - index > 24) break;
    }
    if (index === -1) return null;
    positions.push(index);
    score += SCORE_CHAR;
    if (index === prev + 1) score += SCORE_CONSECUTIVE;
    if (isWordStart(text, index)) score += SCORE_WORD_START;
    score -= (index - from) * PENALTY_GAP * 0.1;
    prev = index;
    from = index + 1;
  }
  score -= (positions[0] ?? 0) * PENALTY_OFFSET;
  return { score, positions };
}

export interface Ranked<T> {
  item: T;
  match: FuzzyMatch;
}

/** Filters and sorts `items` by fuzzy score on `key(item)`; keeps input order for ties. */
export function rankItems<T>(
  items: readonly T[],
  query: string,
  key: (item: T) => string,
  limit = 50,
): Ranked<T>[] {
  const out: Ranked<T>[] = [];
  items.forEach((item) => {
    const match = fuzzyMatch(query, key(item));
    if (match) out.push({ item, match });
  });
  if (query.trim() !== "") out.sort((a, b) => b.match.score - a.match.score);
  return out.slice(0, limit);
}

/** Splits `text` into plain and highlighted runs according to `positions`. */
export function highlightRuns(
  text: string,
  positions: readonly number[],
): { text: string; hit: boolean }[] {
  const set = new Set(positions);
  const runs: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const hit = set.has(i);
    const last = runs[runs.length - 1];
    if (last?.hit === hit) last.text += text[i] ?? "";
    else runs.push({ text: text[i] ?? "", hit });
  }
  return runs;
}
