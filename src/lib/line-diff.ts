/**
 * Line diff (Myers' O(ND) algorithm) for the in-editor change markers.
 *
 * Works on arrays of lines and returns only the changed regions. Common leading and trailing
 * lines are stripped first, so typing in a long note costs time proportional to the edit,
 * not to the note.
 */

/** A changed region: old lines `[oldFrom, oldTo)` became new lines `[newFrom, newTo)` (0-based). */
export interface LineHunk {
  oldFrom: number;
  oldTo: number;
  newFrom: number;
  newTo: number;
}

/** Above this many edits the diff gives up and reports one hunk covering the rest. */
const MAX_EDITS = 2000;

export function diffLines(oldLines: readonly string[], newLines: readonly string[]): LineHunk[] {
  let start = 0;
  const minLength = Math.min(oldLines.length, newLines.length);
  while (start < minLength && oldLines[start] === newLines[start]) start++;
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  if (start === oldEnd && start === newEnd) return [];
  if (start === oldEnd || start === newEnd) {
    return [{ oldFrom: start, oldTo: oldEnd, newFrom: start, newTo: newEnd }];
  }
  const a = oldLines.slice(start, oldEnd);
  const b = newLines.slice(start, newEnd);
  const pairs = myers(a, b);
  if (!pairs) return [{ oldFrom: start, oldTo: oldEnd, newFrom: start, newTo: newEnd }];
  return hunksFromMatches(pairs, a.length, b.length).map((h) => ({
    oldFrom: h.oldFrom + start,
    oldTo: h.oldTo + start,
    newFrom: h.newFrom + start,
    newTo: h.newTo + start,
  }));
}

/** Splits text into lines the way CodeMirror does (any line break, trailing one kept as ""). */
export function toLines(text: string): string[] {
  return text.split(/\r\n?|\n/);
}

/** Matched line pairs `[oldIndex, newIndex]` in order, or null when the edit budget ran out. */
function myers(a: readonly string[], b: readonly string[]): [number, number][] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_EDITS);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const left = get(v, offset + k - 1);
      const right = get(v, offset + k + 1);
      let x = k === -d || (k !== d && left < right) ? right : left + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, offset, n, m);
    }
  }
  return null;
}

function backtrack(trace: Int32Array[], offset: number, n: number, m: number): [number, number][] {
  const pairs: [number, number][] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d] ?? new Int32Array(0);
    const k = x - y;
    const prevK =
      k === -d || (k !== d && get(v, offset + k - 1) < get(v, offset + k + 1)) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : get(v, offset + prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      pairs.push([x, y]);
    }
    if (d === 0) break;
    x = prevX;
    y = prevY;
  }
  return pairs.reverse();
}

function get(v: Int32Array, index: number): number {
  return v[index] ?? 0;
}

function hunksFromMatches(pairs: [number, number][], n: number, m: number): LineHunk[] {
  const hunks: LineHunk[] = [];
  let oldPos = 0;
  let newPos = 0;
  for (const [x, y] of [...pairs, [n, m] as [number, number]]) {
    if (x > oldPos || y > newPos) {
      hunks.push({ oldFrom: oldPos, oldTo: x, newFrom: newPos, newTo: y });
    }
    oldPos = x + 1;
    newPos = y + 1;
  }
  return hunks;
}
