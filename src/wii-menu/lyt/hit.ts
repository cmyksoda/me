import type { PaneNode } from './layout';

/** PaneComponent::contain: the point, carried into the pane's own space, lies inside its rectangle. */
export function contains(pane: PaneNode, x: number, y: number): boolean {
  for (let p: PaneNode | null = pane; p; p = p.parent) if (!p.visible) return false;
  const m = pane.world;
  const det = m[0] * m[5] - m[1] * m[4];
  if (Math.abs(det) < 1e-9) return false;
  const dx = x - m[3];
  const dy = y - m[7];
  const localX = (m[5] * dx - m[1] * dy) / det;
  const localY = (m[0] * dy - m[4] * dx) / det;
  const [width, height] = pane.size;
  const left = -((pane.source.origin % 3) / 2) * width;
  const top = (Math.floor(pane.source.origin / 3) / 2) * height;
  return localX >= left && localX <= left + width && localY <= top && localY >= top - height;
}

export function center(pane: PaneNode): [number, number] {
  return [pane.world[3], pane.world[7]];
}
