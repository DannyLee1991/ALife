// ============================================
// 空间网格 - 用于高效邻居查询
// ============================================

import { Organism } from './Organism';

export class SpatialGrid {
  private cellSize: number;
  private cols: number;
  private rows: number;
  private cells: Map<number, Organism[]>;
  private width: number;
  private height: number;

  constructor(width: number, height: number, cellSize: number = 30) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.cells = new Map();
  }

  /** 清空网格 */
  clear(): void {
    this.cells.clear();
  }

  /** 获取位置对应的 cell key */
  private getKey(x: number, z: number): number {
    const col = Math.floor((x + this.width / 2) / this.cellSize);
    const row = Math.floor((z + this.height / 2) / this.cellSize);
    const clampedCol = Math.max(0, Math.min(this.cols - 1, col));
    const clampedRow = Math.max(0, Math.min(this.rows - 1, row));
    return clampedRow * this.cols + clampedCol;
  }

  /** 插入生命体 */
  insert(organism: Organism): void {
    const key = this.getKey(organism.position.x, organism.position.z);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = [];
      this.cells.set(key, cell);
    }
    cell.push(organism);
  }

  /** 批量重建网格 */
  rebuild(organisms: Organism[]): void {
    this.clear();
    for (let i = 0; i < organisms.length; i++) {
      if (organisms[i].alive) {
        this.insert(organisms[i]);
      }
    }
  }

  /** 查询范围内的生命体 */
  queryRange(x: number, z: number, range: number): Organism[] {
    const results: Organism[] = [];
    const rangeSq = range * range;

    const minCol = Math.max(0, Math.floor((x - range + this.width / 2) / this.cellSize));
    const maxCol = Math.min(this.cols - 1, Math.floor((x + range + this.width / 2) / this.cellSize));
    const minRow = Math.max(0, Math.floor((z - range + this.height / 2) / this.cellSize));
    const maxRow = Math.min(this.rows - 1, Math.floor((z + range + this.height / 2) / this.cellSize));

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const key = row * this.cols + col;
        const cell = this.cells.get(key);
        if (!cell) continue;

        for (let i = 0; i < cell.length; i++) {
          const o = cell[i];
          if (!o.alive) continue;
          const dx = o.position.x - x;
          const dz = o.position.z - z;
          if (dx * dx + dz * dz <= rangeSq) {
            results.push(o);
          }
        }
      }
    }

    return results;
  }

  /** 查询最近的指定类型的生命体 */
  queryNearest(
    x: number,
    z: number,
    range: number,
    filter: (o: Organism) => boolean
  ): Organism | null {
    const candidates = this.queryRange(x, z, range);
    let nearest: Organism | null = null;
    let nearestDistSq = Infinity;

    for (let i = 0; i < candidates.length; i++) {
      const o = candidates[i];
      if (!filter(o)) continue;
      const dx = o.position.x - x;
      const dz = o.position.z - z;
      const distSq = dx * dx + dz * dz;
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearest = o;
      }
    }

    return nearest;
  }
}
