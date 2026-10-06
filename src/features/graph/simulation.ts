/**
 * Force-directed layout for the note graph, modelled on d3-force: springs along edges,
 * many-body repulsion (Barnes–Hut approximation over a quadtree, O(n log n) per tick) and a
 * weak pull towards the origin. The "temperature" `alpha` decays every tick, so the layout
 * settles and the caller can stop animating; dragging a node warms it up again.
 */

export interface SimNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Pinned position (while dragged); null when free. */
  fx: number | null;
  fy: number | null;
}

export interface SimOptions {
  linkDistance: number;
  /** Negative: repulsion. */
  charge: number;
  /** Pull towards (0, 0). */
  gravity: number;
  /** Barnes–Hut accuracy: larger is faster and coarser. */
  theta: number;
}

const DEFAULTS: SimOptions = { linkDistance: 60, charge: -140, gravity: 0.06, theta: 0.9 };

const ALPHA_MIN = 0.002;
const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / 300);
const VELOCITY_DECAY = 0.6;
/** Squared distance below which repulsion stops growing (avoids explosions). */
const MIN_DIST2 = 1;
/** Squared distance beyond which repulsion is ignored. */
const MAX_DIST2 = 1000 * 1000;
/** Below this the quadtree stops splitting and keeps coincident points together. */
const MAX_DEPTH = 24;

interface Quad {
  x0: number;
  y0: number;
  size: number;
  /** Weighted centre and total weight (number of nodes). */
  cx: number;
  cy: number;
  weight: number;
  children: (Quad | null)[] | null;
  /** Node indexes of a leaf. */
  points: number[] | null;
}

export class Simulation {
  readonly nodes: SimNode[];
  private readonly links: [number, number][];
  private readonly options: SimOptions;
  private readonly bias: number[];
  private readonly strength: number[];
  alpha = 1;
  alphaTarget = 0;

  constructor(nodeCount: number, links: [number, number][], options: Partial<SimOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.links = links;
    // Phyllotaxis start, like d3: deterministic and evenly spread.
    this.nodes = Array.from({ length: nodeCount }, (_, i) => {
      const radius = 10 * Math.sqrt(0.5 + i);
      const angle = i * Math.PI * (3 - Math.sqrt(5));
      return {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
      };
    });
    const count = new Array<number>(nodeCount).fill(0);
    for (const [a, b] of links) {
      count[a] = (count[a] ?? 0) + 1;
      count[b] = (count[b] ?? 0) + 1;
    }
    this.bias = links.map(([a, b]) => {
      const ca = count[a] ?? 1;
      return ca / (ca + (count[b] ?? 1));
    });
    this.strength = links.map(([a, b]) => 1 / Math.min(count[a] ?? 1, count[b] ?? 1));
  }

  get running(): boolean {
    return this.alpha >= ALPHA_MIN || this.alphaTarget > 0;
  }

  /** Warms the layout up (e.g. while dragging). */
  reheat(alpha = 0.3) {
    this.alpha = Math.max(this.alpha, alpha);
  }

  tick() {
    this.alpha += (this.alphaTarget - this.alpha) * ALPHA_DECAY;
    const alpha = this.alpha;
    this.applyLinks(alpha);
    this.applyCharge(alpha);
    const g = this.options.gravity * alpha;
    for (const n of this.nodes) {
      n.vx -= n.x * g;
      n.vy -= n.y * g;
      if (n.fx !== null && n.fy !== null) {
        n.x = n.fx;
        n.y = n.fy;
        n.vx = 0;
        n.vy = 0;
      } else {
        n.vx *= VELOCITY_DECAY;
        n.vy *= VELOCITY_DECAY;
        n.x += n.vx;
        n.y += n.vy;
      }
    }
  }

  private applyLinks(alpha: number) {
    const distance = this.options.linkDistance;
    this.links.forEach(([a, b], i) => {
      const s = this.nodes[a];
      const t = this.nodes[b];
      if (!s || !t) return;
      let dx = t.x + t.vx - s.x - s.vx || jiggle();
      let dy = t.y + t.vy - s.y - s.vy || jiggle();
      let l = Math.sqrt(dx * dx + dy * dy);
      l = ((l - distance) / l) * alpha * (this.strength[i] ?? 1);
      dx *= l;
      dy *= l;
      const bias = this.bias[i] ?? 0.5;
      t.vx -= dx * bias;
      t.vy -= dy * bias;
      s.vx += dx * (1 - bias);
      s.vy += dy * (1 - bias);
    });
  }

  private applyCharge(alpha: number) {
    const root = this.buildTree();
    if (!root) return;
    const strength = this.options.charge * alpha;
    const theta2 = this.options.theta * this.options.theta;
    this.nodes.forEach((node, index) => {
      const stack: Quad[] = [root];
      while (stack.length > 0) {
        const quad = stack.pop();
        if (!quad || quad.weight === 0) continue;
        let dx = quad.cx - node.x;
        let dy = quad.cy - node.y;
        let d2 = dx * dx + dy * dy;
        if (quad.children) {
          // Far enough: treat the whole quad as one body.
          if ((quad.size * quad.size) / theta2 < d2) {
            if (d2 < MAX_DIST2) {
              if (d2 < MIN_DIST2) d2 = Math.sqrt(MIN_DIST2 * d2);
              node.vx += (dx * strength * quad.weight) / d2;
              node.vy += (dy * strength * quad.weight) / d2;
            }
          } else {
            for (const child of quad.children) if (child) stack.push(child);
          }
          continue;
        }
        for (const other of quad.points ?? []) {
          if (other === index) continue;
          const o = this.nodes[other];
          if (!o) continue;
          dx = o.x - node.x || jiggle();
          dy = o.y - node.y || jiggle();
          d2 = dx * dx + dy * dy;
          if (d2 >= MAX_DIST2) continue;
          if (d2 < MIN_DIST2) d2 = Math.sqrt(MIN_DIST2 * d2);
          node.vx += (dx * strength) / d2;
          node.vy += (dy * strength) / d2;
        }
      }
    });
  }

  private buildTree(): Quad | null {
    const nodes = this.nodes;
    if (nodes.length === 0) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const n of nodes) {
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x);
      y1 = Math.max(y1, n.y);
    }
    const root = newQuad(x0, y0, Math.max(x1 - x0, y1 - y0, 1));
    nodes.forEach((_, i) => {
      insert(root, i, nodes, 0);
    });
    weigh(root, nodes);
    return root;
  }
}

function newQuad(x0: number, y0: number, size: number): Quad {
  return { x0, y0, size, cx: 0, cy: 0, weight: 0, children: null, points: null };
}

function insert(q: Quad, index: number, nodes: readonly SimNode[], depth: number) {
  if (!q.children) {
    if (!q.points) {
      q.points = [index];
      return;
    }
    if (depth >= MAX_DEPTH) {
      q.points.push(index);
      return;
    }
    // Split the leaf and push its points one level down.
    const existing = q.points;
    q.points = null;
    q.children = [null, null, null, null];
    for (const p of existing) insertChild(q, p, nodes, depth);
  }
  insertChild(q, index, nodes, depth);
}

function insertChild(q: Quad, index: number, nodes: readonly SimNode[], depth: number) {
  const n = nodes[index];
  const children = q.children;
  if (!n || !children) return;
  const half = q.size / 2;
  const right = n.x >= q.x0 + half ? 1 : 0;
  const bottom = n.y >= q.y0 + half ? 1 : 0;
  const slot = bottom * 2 + right;
  let child = children[slot] ?? null;
  if (!child) {
    child = newQuad(q.x0 + right * half, q.y0 + bottom * half, half);
    children[slot] = child;
  }
  insert(child, index, nodes, depth + 1);
}

/** Computes weights and centres of mass bottom-up. */
function weigh(q: Quad, nodes: readonly SimNode[]) {
  let weight = 0;
  let cx = 0;
  let cy = 0;
  if (q.children) {
    for (const child of q.children) {
      if (!child) continue;
      weigh(child, nodes);
      weight += child.weight;
      cx += child.cx * child.weight;
      cy += child.cy * child.weight;
    }
  } else {
    for (const p of q.points ?? []) {
      const n = nodes[p];
      if (!n) continue;
      weight += 1;
      cx += n.x;
      cy += n.y;
    }
  }
  q.weight = weight;
  q.cx = weight ? cx / weight : 0;
  q.cy = weight ? cy / weight : 0;
}

/** A tiny random offset that separates coincident points. */
function jiggle(): number {
  return (Math.random() - 0.5) * 1e-6;
}
