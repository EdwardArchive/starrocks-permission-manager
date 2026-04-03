import Dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";

// Must match CustomNode FIXED_W
const CHILD_W = 148;
const CHILD_H = 34;

export function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB"
): { nodes: Node[]; edges: Edge[] } {
  const count = nodes.length;

  const nodesep = count <= 10 ? 30 : count <= 30 ? 24 : count <= 80 ? 18 : 14;
  const ranksep = count <= 10 ? 60 : count <= 30 ? 50 : count <= 80 ? 40 : 30;
  const nodeW = 160;
  const nodeH = 40;

  // Grid inside group containers
  // cellW/cellH must be >= rendered node size (CHILD_W=148 + border 4 + gap)
  const cellW = CHILD_W + 16;
  const cellH = CHILD_H + 16;
  const maxCols = 4;
  const headerH = 32;
  const padX = 14;
  const padBottom = 20;

  // ── Identify groups & children ──
  const groupIds = new Set(
    nodes.filter((n) => (n.data as { nodeRole?: string }).nodeRole === "group").map((n) => n.id)
  );
  const childrenOf: Record<string, string[]> = {};
  const allChildIds = new Set<string>();
  edges.forEach((e) => {
    if (groupIds.has(e.source)) {
      (childrenOf[e.source] ??= []).push(e.target);
      allChildIds.add(e.target);
    }
  });

  // ── Compute container sizes ──
  const groupSizes: Record<string, { w: number; h: number }> = {};
  for (const [gid, children] of Object.entries(childrenOf)) {
    const cc = children.length;
    const cols = Math.min(cc, maxCols);
    const rows = Math.ceil(cc / maxCols);
    const w = cols * cellW + padX * 2 + 10;
    const h = headerH + rows * cellH + padBottom + 14;
    groupSizes[gid] = { w: Math.max(nodeW, w), h: Math.max(nodeH, h) };
  }

  // ── Detect if this is a role/user DAG (Role Map) ──
  const nodeTypes = new Set(nodes.map((n) => (n.data as { nodeType?: string }).nodeType));
  const isRoleMap = nodeTypes.has("role") && !nodeTypes.has("table") && !nodeTypes.has("database");

  interface PlacedNode { id: string; x: number; y: number; w: number; h: number; isGroup: boolean }
  const placed: PlacedNode[] = [];

  // ── Collect non-child nodes & edges ──
  const layoutNodes = nodes.filter((n) => !allChildIds.has(n.id));
  const layoutEdges = edges.filter((e) => {
    if (allChildIds.has(e.target) && groupIds.has(e.source)) return false;
    if (allChildIds.has(e.source)) return false;
    return true;
  });

  const userNodeIds = isRoleMap
    ? new Set(nodes.filter((n) => (n.data as { nodeType?: string }).nodeType === "user").map((n) => n.id))
    : null;

  // ── Role Map: split into connected components, layout each separately ──
  if (isRoleMap) {
    // Find connected components (undirected)
    const adj = new Map<string, Set<string>>();
    for (const n of layoutNodes) {
      adj.set(n.id, new Set());
    }
    for (const e of layoutEdges) {
      adj.get(e.source)?.add(e.target);
      adj.get(e.target)?.add(e.source);
    }
    const visited = new Set<string>();
    const components: Set<string>[] = [];
    for (const n of layoutNodes) {
      if (visited.has(n.id)) continue;
      const comp = new Set<string>();
      const q = [n.id];
      while (q.length) {
        const cur = q.pop()!;
        if (visited.has(cur)) continue;
        visited.add(cur);
        comp.add(cur);
        for (const nb of adj.get(cur) || []) {
          if (!visited.has(nb)) q.push(nb);
        }
      }
      components.push(comp);
    }

    // Sort: largest component first
    components.sort((a, b) => b.size - a.size);

    // Layout each component with its own dagre graph
    const componentGAP = 80;
    let offsetX = 0;

    for (const comp of components) {
      const cg = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
      cg.setGraph({ rankdir: direction, nodesep: 40, ranksep: 100, edgesep: 20 });

      for (const n of layoutNodes) {
        if (!comp.has(n.id)) continue;
        const sz = groupSizes[n.id];
        cg.setNode(n.id, { width: sz ? sz.w : nodeW, height: sz ? sz.h : nodeH });
      }
      for (const e of layoutEdges) {
        if (!comp.has(e.source) || !comp.has(e.target)) continue;
        const toUser = userNodeIds?.has(e.target);
        cg.setEdge(e.source, e.target, {
          weight: toUser ? 1 : 5,
          minlen: toUser ? 2 : 1,
        });
      }

      Dagre.layout(cg);

      // Post-layout: force builtin roles to Y=0, shift everything else down
      const BUILTIN_ROLES = new Set(["root", "db_admin", "cluster_admin", "user_admin", "security_admin", "public"]);
      const builtinInComp: string[] = [];
      let minBuiltinY = Infinity;
      for (const nid of comp) {
        const nd = layoutNodes.find((n) => n.id === nid);
        if (!nd) continue;
        const d = nd.data as { label?: string; nodeType?: string };
        if (d.nodeType === "role" && BUILTIN_ROLES.has(d.label || "")) {
          builtinInComp.push(nid);
          const pos = cg.node(nid);
          if (pos) minBuiltinY = Math.min(minBuiltinY, pos.y);
        }
      }
      if (builtinInComp.length > 0 && minBuiltinY !== Infinity) {
        // Find the topmost non-builtin Y
        let minOtherY = Infinity;
        for (const nid of comp) {
          if (builtinInComp.includes(nid)) continue;
          const pos = cg.node(nid);
          if (pos) minOtherY = Math.min(minOtherY, pos.y);
        }
        // Set all builtins to a fixed Y above the rest
        const builtinTargetY = Math.min(minBuiltinY, (minOtherY !== Infinity ? minOtherY : minBuiltinY) - 100);
        for (const bid of builtinInComp) {
          const pos = cg.node(bid);
          if (pos) pos.y = builtinTargetY;
        }
      }

      // Get bounding box of this component
      let minX = Infinity, maxX = -Infinity, minY = Infinity;
      for (const nid of comp) {
        const pos = cg.node(nid);
        if (!pos) continue;
        const sz = groupSizes[nid];
        const w = sz ? sz.w : nodeW;
        const h = sz ? sz.h : nodeH;
        minX = Math.min(minX, pos.x - w / 2);
        maxX = Math.max(maxX, pos.x + w / 2);
        minY = Math.min(minY, pos.y - h / 2);
      }

      // Shift component: X after previous, Y top-aligned to 0
      const shiftX = offsetX - minX;
      const shiftY = -minY;
      for (const nid of comp) {
        const pos = cg.node(nid);
        if (!pos) continue;
        const isGroup = groupIds.has(nid);
        const sz = groupSizes[nid];
        const w = sz ? sz.w : nodeW;
        const h = sz ? sz.h : nodeH;
        placed.push({ id: nid, x: pos.x + shiftX - w / 2, y: pos.y + shiftY - h / 2, w, h, isGroup });
      }

      offsetX += (maxX - minX) + componentGAP;
    }

    // All components placed — align all user nodes to same Y (max user Y across all components)
    const userPlaced = placed.filter((p) => userNodeIds?.has(p.id));
    if (userPlaced.length > 0) {
      const maxUserY = Math.max(...userPlaced.map((p) => p.y));
      for (const p of userPlaced) {
        p.y = maxUserY;
      }
    }
  } else {
    // ── Non-Role-Map: single dagre layout ──
    const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: direction, nodesep: nodesep + 20, ranksep, edgesep: 10 });

    for (const n of layoutNodes) {
      const sz = groupSizes[n.id];
      g.setNode(n.id, { width: sz ? sz.w : nodeW, height: sz ? sz.h : nodeH });
    }
    for (const e of layoutEdges) {
      g.setEdge(e.source, e.target);
    }

    Dagre.layout(g);

    for (const n of layoutNodes) {
      const pos = g.node(n.id);
      const isGroup = groupIds.has(n.id);
      const sz = groupSizes[n.id];
      const w = sz ? sz.w : nodeW;
      const h = sz ? sz.h : nodeH;
      placed.push({ id: n.id, x: pos.x - w / 2, y: pos.y - h / 2, w, h, isGroup });
    }
  }

  // ── Build result ──
  const GAP = 20; // minimum gap between nodes
  const laid: Node[] = [];

  // placed was populated in the layout section above

  // ── Build parent→groups map ──
  const groupParentMap = new Map<string, string>();
  edges.forEach((e) => {
    if (groupIds.has(e.target) && !groupIds.has(e.source)) {
      groupParentMap.set(e.target, e.source);
    }
  });

  const siblingsByParent = new Map<string, PlacedNode[]>();
  for (const p of placed) {
    if (!p.isGroup) continue;
    const parentId = groupParentMap.get(p.id);
    if (!parentId) continue;
    const siblings = siblingsByParent.get(parentId) ?? [];
    siblings.push(p);
    siblingsByParent.set(parentId, siblings);
  }

  // ── Step 1: Position groups inside each cluster (below parent, no internal overlap) ──
  for (const [parentId, siblings] of siblingsByParent) {
    const parent = placed.find((p) => p.id === parentId);
    if (!parent) continue;
    // Use actual rendered width (CHILD_W=148) for centering, not dagre's nodeW=160
    const parentCenterX = parent.x + CHILD_W / 2;
    const parentBottom = parent.y + parent.h;

    // All groups at same Y, below parent
    const groupY = parentBottom + GAP;
    for (const g of siblings) {
      g.y = groupY;
    }

    // Lay out siblings left-to-right with GAP, no overlap
    siblings.sort((a, b) => a.x - b.x);
    // Calculate total width
    let totalW = 0;
    for (const g of siblings) totalW += g.w;
    totalW += (siblings.length - 1) * GAP;

    // Center the row under parent
    let curX = parentCenterX - totalW / 2;
    for (const g of siblings) {
      g.x = curX;
      curX += g.w + GAP;
    }
  }

  // ── Step 2: Build cluster bounding boxes (parent + its groups) for global overlap correction ──
  interface ClusterBox { parentId: string; members: PlacedNode[]; x: number; y: number; w: number; h: number }
  const clusters: ClusterBox[] = [];
  const inCluster = new Set<string>(); // node IDs that belong to a cluster

  for (const [parentId, siblings] of siblingsByParent) {
    const parent = placed.find((p) => p.id === parentId);
    if (!parent) continue;

    const members = [parent, ...siblings];
    const minX = Math.min(...members.map((m) => m.x));
    const maxX = Math.max(...members.map((m) => m.x + m.w));
    const minY = Math.min(...members.map((m) => m.y));
    const maxY = Math.max(...members.map((m) => m.y + m.h));

    clusters.push({ parentId, members, x: minX, y: minY, w: maxX - minX, h: maxY - minY });
    for (const m of members) inCluster.add(m.id);
  }

  // Standalone nodes (not part of any cluster)
  const standalone = placed.filter((p) => !inCluster.has(p.id));

  // ── Step 3: Overlap correction between clusters and standalone nodes ──
  // Treat each cluster as a single box, push apart horizontally, then shift all members
  type Box = { x: number; y: number; w: number; h: number; shift: (dx: number) => void };
  const boxes: Box[] = [];

  for (const c of clusters) {
    boxes.push({
      get x() { return c.x; }, get y() { return c.y; }, get w() { return c.w; }, get h() { return c.h; },
      shift(dx: number) {
        c.x += dx;
        for (const m of c.members) m.x += dx;
      },
    });
  }
  for (const s of standalone) {
    boxes.push({
      get x() { return s.x; }, get y() { return s.y; }, get w() { return s.w; }, get h() { return s.h; },
      shift(dx: number) { s.x += dx; },
    });
  }

  let changed = true;
  let iterations = 0;
  while (changed && iterations < 50) {
    changed = false;
    iterations++;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlapX = (a.x + a.w + GAP) - b.x;
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (overlapX > 0 && overlapY > 0) {
          const push = overlapX / 2 + GAP / 2;
          a.shift(-push);
          b.shift(push);
          changed = true;
        }
      }
    }
  }

  // Build final nodes
  for (const p of placed) {
    const n = nodes.find((nd) => nd.id === p.id)!;
    laid.push({
      ...n,
      type: p.isGroup ? "group" : "custom",
      position: { x: p.x, y: p.y },
      data: {
        ...n.data,
        ...(p.isGroup ? { containerW: p.w, containerH: p.h } : {}),
      },
      style: p.isGroup
        ? { width: p.w, height: p.h, background: "transparent", border: "none", padding: 0 }
        : undefined,
    });
  }

  // 2. Children inside group containers (relative coords)
  for (const [groupId, childIds] of Object.entries(childrenOf)) {
    const sz = groupSizes[groupId];
    if (!sz) continue;

    const cc = childIds.length;
    const cols = Math.min(cc, maxCols);
    const rows = Math.ceil(cc / maxCols);
    const gridW = cols * cellW;
    const gridH = rows * cellH;
    // Center grid within container (horizontally + vertically below header)
    const availH = sz.h - headerH;
    const offsetX = (sz.w - gridW) / 2;
    const offsetY = headerH + (availH - gridH) / 2;
    // Center each child node within its cell
    const cellPadX = (cellW - CHILD_W) / 2;
    const cellPadY = (cellH - CHILD_H) / 2;

    childIds.forEach((cid, i) => {
      const orig = nodes.find((nd) => nd.id === cid);
      if (!orig) return;

      laid.push({
        ...orig,
        type: "custom",
        parentId: groupId,
        extent: "parent" as const,
        position: {
          x: offsetX + (i % maxCols) * cellW + cellPadX,
          y: offsetY + Math.floor(i / maxCols) * cellH + cellPadY,
        },
      });
    });
  }

  return { nodes: laid, edges };
}
