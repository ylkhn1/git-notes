import { describe, expect, it } from "vitest";

import type { NoteLinks, WikiLink } from "@/lib/bindings";

import { buildGraph } from "./graph-data";
import { Simulation } from "./simulation";

const link = (target: string): WikiLink => ({
  target,
  heading: null,
  alias: null,
  lineNo: 1,
  line: "",
});
const note = (path: string, targets: string[], tags: string[] = []): NoteLinks => ({
  path,
  links: targets.map(link),
  tags,
});

const notes = ["a.md", "b.md", "dir/c.md", "lonely.md"];
const index = [
  note("a.md", ["b", "c", "Missing", "b"], ["work"]),
  note("dir/c.md", ["a", ""], ["Work"]),
];
const ids = (data: ReturnType<typeof buildGraph>) => data.nodes.map((n) => n.id);

describe("buildGraph", () => {
  it("resolves links, dedupes edges and marks missing targets", () => {
    const data = buildGraph(notes, index, { tags: false, orphans: true, focus: null, depth: 1 });
    expect(ids(data)).toEqual(["a.md", "b.md", "dir/c.md", "lonely.md", "missing:missing"]);
    expect(data.edges).toHaveLength(3);
    expect(data.nodes.find((n) => n.id === "a.md")?.degree).toBe(3);
    expect(data.nodes.find((n) => n.id === "missing:missing")?.kind).toBe("missing");
  });

  it("can hide orphans and add tag nodes", () => {
    const data = buildGraph(notes, index, { tags: true, orphans: false, focus: null, depth: 1 });
    expect(ids(data)).not.toContain("lonely.md");
    const tag = data.nodes.find((n) => n.kind === "tag");
    expect(tag).toMatchObject({ id: "tag:work", label: "#work", degree: 2 });
  });

  it("limits a local graph to the focus neighbourhood", () => {
    const one = buildGraph(notes, index, { tags: false, orphans: true, focus: "b.md", depth: 1 });
    expect(ids(one).sort()).toEqual(["a.md", "b.md"]);
    const two = buildGraph(notes, index, { tags: false, orphans: true, focus: "b.md", depth: 2 });
    expect(ids(two).sort()).toEqual(["a.md", "b.md", "dir/c.md", "missing:missing"]);
    const alone = buildGraph(notes, index, {
      tags: false,
      orphans: false,
      focus: "lonely.md",
      depth: 2,
    });
    expect(ids(alone)).toEqual(["lonely.md"]);
  });
});

describe("Simulation", () => {
  it("settles with edges near the link distance and no overlaps", () => {
    // Two triangles joined by one edge.
    const links: [number, number][] = [
      [0, 1],
      [1, 2],
      [2, 0],
      [3, 4],
      [4, 5],
      [5, 3],
      [2, 3],
    ];
    const sim = new Simulation(6, links);
    let ticks = 0;
    while (sim.running && ticks < 1000) {
      sim.tick();
      ticks++;
    }
    expect(sim.running).toBe(false);
    for (const n of sim.nodes) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
    }
    const dist = (a: number, b: number) => {
      const p = sim.nodes[a];
      const q = sim.nodes[b];
      return p && q ? Math.hypot(p.x - q.x, p.y - q.y) : NaN;
    };
    // Edges end up around the link distance (60) and no two nodes overlap.
    for (const [a, b] of links) {
      expect(dist(a, b)).toBeGreaterThan(20);
      expect(dist(a, b)).toBeLessThan(120);
    }
    for (let a = 0; a < 6; a++) {
      for (let b = a + 1; b < 6; b++) expect(dist(a, b)).toBeGreaterThan(15);
    }
  });

  it("keeps pinned nodes in place and survives coincident points", () => {
    const sim = new Simulation(50, []);
    for (const n of sim.nodes) {
      n.x = 0;
      n.y = 0;
    }
    const pinned = sim.nodes[0];
    if (!pinned) throw new Error("no node");
    pinned.fx = 100;
    pinned.fy = -50;
    for (let i = 0; i < 50; i++) sim.tick();
    expect(pinned.x).toBe(100);
    expect(pinned.y).toBe(-50);
    for (const n of sim.nodes) expect(Number.isFinite(n.x)).toBe(true);
  });
});
