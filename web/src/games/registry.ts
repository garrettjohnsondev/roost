import type { GameModule } from './types';

/** Every game is a folder with an index.tsx exporting `meta` and `Game`; the
 *  arcade finds them itself, so adding a game never touches a shared list. */
const found = import.meta.glob<GameModule>('./*/index.tsx', { eager: true });

const PACK_ORDER = ['classic', 'quick', 'sports', 'stretch'] as const;
export const GAMES: GameModule[] = Object.values(found)
  .filter((m) => m?.meta && m.Game)
  .sort((a, b) => PACK_ORDER.indexOf(a.meta.pack ?? 'quick') - PACK_ORDER.indexOf(b.meta.pack ?? 'quick') || a.meta.name.localeCompare(b.meta.name));

export const PACK_TITLE: Record<string, string> = {
  classic: 'Classics',
  quick: 'Quick ones',
  sports: 'Sports pack',
  stretch: 'Big one',
};
