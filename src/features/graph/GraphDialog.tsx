import { Maximize } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { create } from "zustand";

import { useBackClose } from "@/lib/back-stack";
import { useT } from "@/lib/i18n";
import { isMobile } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { notePaths } from "@/lib/wikilinks";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";

import { selectActiveTab, useEditorStore } from "@/features/editor/store";
import { useLinkIndex } from "@/features/links/use-backlinks";
import { searchFor } from "@/features/search/store";
import { useTreeStore } from "@/features/tree/store";

import { buildGraph, type GraphData, type GraphNode } from "./graph-data";
import { Simulation } from "./simulation";

interface GraphOptionsState {
  local: boolean;
  depth: number;
  tags: boolean;
  orphans: boolean;
  set: (patch: Partial<Omit<GraphOptionsState, "set">>) => void;
}

/** Graph options survive closing the dialog. */
const useGraphOptions = create<GraphOptionsState>((set) => ({
  local: false,
  depth: 2,
  tags: false,
  orphans: true,
  set: (patch) => set(patch),
}));

/** Notes and their links as an interactive force-directed graph. */
export function GraphDialog({
  open,
  onOpenChange,
  notebookId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebookId: string;
}) {
  const t = useT();
  useBackClose(open, () => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex flex-col gap-0 p-0",
          isMobile ? "h-full max-h-full w-full max-w-full rounded-none" : "h-[85vh] sm:max-w-6xl",
        )}
      >
        <DialogHeader className="border-b border-line px-5 py-3">
          <DialogTitle>{t("graph.title")}</DialogTitle>
          <DialogDescription>{t("graph.description")}</DialogDescription>
        </DialogHeader>
        {open && <GraphBody notebookId={notebookId} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function GraphBody({ notebookId, onDone }: { notebookId: string; onDone: () => void }) {
  const t = useT();
  const index = useLinkIndex(notebookId);
  const nodes = useTreeStore((s) => s.nodes);
  const activePath = useEditorStore((s) => selectActiveTab(s)?.path ?? null);
  const { local, depth, tags, orphans, set } = useGraphOptions();
  const focus = local ? activePath : null;

  const data = useMemo(
    () => (index ? buildGraph(notePaths(nodes), index, { tags, orphans, focus, depth }) : null),
    [index, nodes, tags, orphans, focus, depth],
  );
  const noteCount = data ? data.nodes.filter((n) => n.kind === "note").length : 0;

  const openNode = (node: GraphNode) => {
    if (node.kind === "note") {
      void useEditorStore.getState().open(notebookId, node.id);
      onDone();
    } else if (node.kind === "tag") {
      searchFor(`tag:${node.label.slice(1)}`);
      onDone();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2 text-sm">
        <div role="group" className="flex rounded-md bg-surface-2 p-0.5">
          {[false, true].map((value) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={local === value}
              disabled={value && !activePath}
              onClick={() => set({ local: value })}
              className={cn(
                "rounded px-2 py-0.5 text-xs text-muted-text disabled:opacity-50",
                local === value && "bg-bg text-text shadow-sm",
              )}
            >
              {value ? t("graph.scopeLocal") : t("graph.scopeAll")}
            </button>
          ))}
        </div>
        {local && (
          <label className="flex items-center gap-1 text-xs text-muted-text">
            {t("graph.depth")}
            <select
              value={depth}
              onChange={(e) => set({ depth: Number(e.target.value) })}
              className="rounded border border-line bg-bg px-1 py-0.5 text-text"
            >
              {[1, 2, 3].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-1 text-xs text-muted-text">
          <input type="checkbox" checked={tags} onChange={(e) => set({ tags: e.target.checked })} />
          {t("graph.showTags")}
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-text">
          <input
            type="checkbox"
            checked={orphans}
            onChange={(e) => set({ orphans: e.target.checked })}
          />
          {t("graph.showOrphans")}
        </label>
        {data && (
          <span className="ml-auto text-xs text-faint">
            {t("graph.stats", {
              notes: t("graph.notesCount", { count: noteCount }),
              links: t("graph.linksCount", { count: data.edges.length }),
            })}
          </span>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {!data && <p className="p-6 text-center text-sm text-muted-text">{t("graph.loading")}</p>}
        {data?.edges.length === 0 && (
          <p className="pointer-events-none absolute inset-x-0 top-0 p-6 text-center text-sm text-muted-text">
            {t("graph.empty")}
          </p>
        )}
        {data && data.nodes.length > 0 && (
          <GraphCanvas data={data} current={activePath} onOpen={openNode} />
        )}
      </div>
    </div>
  );
}

interface View {
  k: number;
  tx: number;
  ty: number;
}

interface Colors {
  bg: string;
  edge: string;
  note: string;
  current: string;
  tag: string;
  missing: string;
  text: string;
  faint: string;
}

function readColors(): Colors {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim() || "#888";
  return {
    bg: v("--gn-bg"),
    edge: v("--gn-border-strong"),
    note: v("--gn-text-muted"),
    current: v("--gn-accent"),
    tag: v("--gn-success"),
    missing: v("--gn-text-faint"),
    text: v("--gn-text"),
    faint: v("--gn-text-faint"),
  };
}

const radius = (node: GraphNode) => 3.5 + Math.sqrt(node.degree) * 1.6;

/** Canvas renderer and pointer handling for one graph. */
function GraphCanvas({
  data,
  current,
  onOpen,
}: {
  data: GraphData;
  current: string | null;
  onOpen: (node: GraphNode) => void;
}) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const positionsRef = useRef(new Map<string, { x: number; y: number }>());
  const fitRef = useRef<() => void>(() => undefined);
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    // Keep positions of nodes that were already on screen (toggling options must not jump).
    const sim = new Simulation(data.nodes.length, data.edges);
    let reused = 0;
    data.nodes.forEach((node, i) => {
      const old = positionsRef.current.get(node.id);
      const n = sim.nodes[i];
      if (old && n) {
        n.x = old.x;
        n.y = old.y;
        reused++;
      }
    });
    if (reused > data.nodes.length / 2) sim.alpha = 0.3;

    const neighbours: number[][] = data.nodes.map(() => []);
    for (const [a, b] of data.edges) {
      neighbours[a]?.push(b);
      neighbours[b]?.push(a);
    }
    const currentIndex = data.nodes.findIndex((n) => n.id === current);

    let view: View = { k: 1, tx: 0, ty: 0 };
    /** Until the user pans or zooms, the view keeps fitting the layout. */
    let autoFit = true;
    let hover: number | null = null;
    let colors = readColors();
    let width = 0;
    let height = 0;
    let dpr = window.devicePixelRatio || 1;
    let frame = 0;

    const fit = () => {
      if (sim.nodes.length === 0 || width === 0) return;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const n of sim.nodes) {
        x0 = Math.min(x0, n.x);
        y0 = Math.min(y0, n.y);
        x1 = Math.max(x1, n.x);
        y1 = Math.max(y1, n.y);
      }
      const pad = 48;
      const k = Math.min(
        2,
        Math.max(
          0.05,
          Math.min((width - pad * 2) / (x1 - x0 || 1), (height - pad * 2) / (y1 - y0 || 1)),
        ),
      );
      view = { k, tx: width / 2 - ((x0 + x1) / 2) * k, ty: height / 2 - ((y0 + y1) / 2) * k };
    };

    const draw = () => {
      const { k, tx, ty } = view;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty);
      const lit = new Set<number>(hover === null ? [] : [hover, ...(neighbours[hover] ?? [])]);

      ctx.lineWidth = 1 / k;
      for (const [a, b] of data.edges) {
        const p = sim.nodes[a];
        const q = sim.nodes[b];
        if (!p || !q) continue;
        const active = hover !== null && (a === hover || b === hover);
        ctx.strokeStyle = active ? colors.current : colors.edge;
        ctx.globalAlpha = hover === null || active ? 0.7 : 0.15;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }

      data.nodes.forEach((node, i) => {
        const p = sim.nodes[i];
        if (!p) return;
        ctx.globalAlpha = hover === null || lit.has(i) ? 1 : 0.25;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius(node), 0, Math.PI * 2);
        if (node.kind === "missing") {
          ctx.fillStyle = colors.bg;
          ctx.fill();
          ctx.strokeStyle = colors.missing;
          ctx.lineWidth = 1.2 / k;
          ctx.stroke();
        } else {
          ctx.fillStyle =
            i === currentIndex || i === hover
              ? colors.current
              : node.kind === "tag"
                ? colors.tag
                : colors.note;
          ctx.fill();
        }
      });

      // Labels keep a constant screen size; shown when zoomed in or relevant.
      ctx.font = `${String(12 / k)}px "Inter Variable", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      data.nodes.forEach((node, i) => {
        const p = sim.nodes[i];
        if (!p) return;
        const relevant = lit.has(i) || i === currentIndex;
        if (!relevant && k < 1.1 && !(k >= 0.6 && node.degree >= 4)) return;
        ctx.globalAlpha = hover === null || relevant ? 0.95 : 0.3;
        ctx.fillStyle = node.kind === "missing" ? colors.faint : colors.text;
        const label = node.label.length > 40 ? `${node.label.slice(0, 39)}…` : node.label;
        ctx.fillText(label, p.x, p.y + radius(node) + 3 / k);
      });
      ctx.globalAlpha = 1;
    };

    const loop = () => {
      frame = 0;
      if (sim.running) {
        sim.tick();
        if (autoFit) fit();
      }
      draw();
      if (sim.running) frame = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(loop);
    };
    fitRef.current = () => {
      autoFit = true;
      fit();
      kick();
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      if (autoFit) fit();
      kick();
    };
    const sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(canvas);
    resize();
    // Theme switches change the CSS colour variables.
    const themeObserver = new MutationObserver(() => {
      colors = readColors();
      kick();
    });
    themeObserver.observe(document.documentElement, { attributes: true });

    // --- Pointer handling: drag nodes, pan, wheel / pinch zoom, click to open. ---
    const toWorld = (sx: number, sy: number) => ({
      x: (sx - view.tx) / view.k,
      y: (sy - view.ty) / view.k,
    });
    const nodeAt = (sx: number, sy: number): number | null => {
      const { x, y } = toWorld(sx, sy);
      const slop = (isMobile ? 12 : 4) / view.k;
      let best: number | null = null;
      let bestD = Infinity;
      data.nodes.forEach((node, i) => {
        const p = sim.nodes[i];
        if (!p) return;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d <= radius(node) + slop && d < bestD) {
          best = i;
          bestD = d;
        }
      });
      return best;
    };
    const local = (e: PointerEvent | WheelEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
    };
    const zoomAt = (sx: number, sy: number, factor: number) => {
      const k = Math.min(6, Math.max(0.05, view.k * factor));
      const f = k / view.k;
      view = { k, tx: sx - (sx - view.tx) * f, ty: sy - (sy - view.ty) * f };
      autoFit = false;
      kick();
    };

    const pointers = new Map<number, { sx: number; sy: number }>();
    let drag: { index: number; moved: number } | null = null;
    let pan: { moved: number } | null = null;
    let pinch: { dist: number } | null = null;

    const release = () => {
      if (!drag) return;
      const n = sim.nodes[drag.index];
      if (n) n.fx = n.fy = null;
      sim.alphaTarget = 0;
      drag = null;
    };

    const onDown = (e: PointerEvent) => {
      const { sx, sy } = local(e);
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { sx, sy });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        if (a && b) pinch = { dist: Math.hypot(a.sx - b.sx, a.sy - b.sy) };
        release();
        pan = null;
        return;
      }
      const hit = nodeAt(sx, sy);
      if (hit !== null) {
        const n = sim.nodes[hit];
        if (n) {
          n.fx = n.x;
          n.fy = n.y;
        }
        drag = { index: hit, moved: 0 };
        sim.alphaTarget = 0.3;
        sim.reheat();
      } else {
        pan = { moved: 0 };
      }
      kick();
    };

    const onMove = (e: PointerEvent) => {
      const { sx, sy } = local(e);
      const prev = pointers.get(e.pointerId);
      if (prev) pointers.set(e.pointerId, { sx, sy });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        if (!a || !b) return;
        const dist = Math.hypot(a.sx - b.sx, a.sy - b.sy);
        zoomAt((a.sx + b.sx) / 2, (a.sy + b.sy) / 2, dist / (pinch.dist || dist));
        pinch.dist = dist;
        return;
      }
      if (drag && prev) {
        const n = sim.nodes[drag.index];
        const { x, y } = toWorld(sx, sy);
        if (n) {
          n.fx = x;
          n.fy = y;
        }
        drag.moved += Math.hypot(sx - prev.sx, sy - prev.sy);
        kick();
        return;
      }
      if (pan && prev) {
        view = { ...view, tx: view.tx + sx - prev.sx, ty: view.ty + sy - prev.sy };
        pan.moved += Math.hypot(sx - prev.sx, sy - prev.sy);
        autoFit = false;
        kick();
        return;
      }
      const hit = nodeAt(sx, sy);
      if (hit !== hover) {
        hover = hit;
        canvas.style.cursor = hit === null ? "grab" : "pointer";
        kick();
      }
    };

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (drag) {
        const node = data.nodes[drag.index];
        const clicked = drag.moved < 5 && e.type === "pointerup";
        release();
        if (clicked && node) onOpenRef.current(node);
      }
      pan = null;
      kick();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { sx, sy } = local(e);
      zoomAt(sx, sy, Math.exp(-e.deltaY * 0.0015));
    };
    const onLeave = () => {
      if (hover !== null && !drag) {
        hover = null;
        kick();
      }
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(frame);
      sizeObserver.disconnect();
      themeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      const positions = new Map<string, { x: number; y: number }>();
      data.nodes.forEach((node, i) => {
        const n = sim.nodes[i];
        if (n) positions.set(node.id, { x: n.x, y: n.y });
      });
      positionsRef.current = positions;
    };
  }, [data, current]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 size-full cursor-grab touch-none select-none"
        aria-label={t("graph.title")}
      />
      <Button
        variant="outline"
        size="icon-sm"
        className="absolute right-3 bottom-3"
        aria-label={t("graph.resetView")}
        title={t("graph.resetView")}
        onClick={() => fitRef.current()}
      >
        <Maximize />
      </Button>
    </>
  );
}
