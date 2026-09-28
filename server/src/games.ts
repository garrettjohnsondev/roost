import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './config.js';

/** The arcade's memory (roadmap #55): saves, bests and achievements live on
 *  the Mac with the rest of Roost -- Safari may wipe a site's storage after a
 *  week unused, and the Mac follows you to any device (agreed 2026-09-28). */
export interface GameStore {
  saves: Record<string, unknown>;
  best: Record<string, number>;
  plays: Record<string, number>;
  achievements: Record<string, number>;
}

const empty = (): GameStore => ({ saves: {}, best: {}, plays: {}, achievements: {} });
const ID = /^[a-z0-9-]{1,40}$/;
const MAX_SAVE = 200_000;

export function validGameId(id: unknown): id is string {
  return typeof id === 'string' && ID.test(id);
}

export class Games {
  private store: GameStore;
  constructor(private file = join(dataDir(), 'games.json')) {
    this.store = this.load();
  }
  private load(): GameStore {
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8'));
      return { ...empty(), ...s };
    } catch {
      return empty();
    }
  }
  private write(): void {
    mkdirSync(join(this.file, '..'), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.store));
    renameSync(tmp, this.file);
  }
  all(): GameStore {
    return this.store;
  }
  save(id: string, state: unknown): boolean {
    if (!validGameId(id)) return false;
    if (state == null) delete this.store.saves[id];
    else {
      if (JSON.stringify(state).length > MAX_SAVE) return false;
      this.store.saves[id] = state;
    }
    this.write();
    return true;
  }
  /** Records a finished run. Returns whether it beat the best. `lowerIsBetter`
   *  for timed games (Minesweeper, Sudoku). */
  score(id: string, score: number, lowerIsBetter = false): { best: number; isBest: boolean } | null {
    if (!validGameId(id) || !Number.isFinite(score)) return null;
    this.store.plays[id] = (this.store.plays[id] ?? 0) + 1;
    const prev = this.store.best[id];
    const isBest = prev === undefined || (lowerIsBetter ? score < prev : score > prev);
    if (isBest) this.store.best[id] = score;
    this.write();
    return { best: this.store.best[id], isBest };
  }
  achieve(id: string): boolean {
    if (!/^[a-z0-9:-]{1,60}$/.test(id)) return false;
    if (this.store.achievements[id]) return false;
    this.store.achievements[id] = Date.now();
    this.write();
    return true;
  }
}
