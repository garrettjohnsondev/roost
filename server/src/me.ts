import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './config.js';

/** You, in the thread.
 *
 *  The crew had faces and names from the start and you had neither -- your turns
 *  rendered as an unattributed bubble, which is a strange way to build something
 *  that is supposed to feel like a group chat you are IN. This is the other half
 *  of that: one name, one face, one colour, stored beside the crew overrides
 *  because it is the same kind of thing.
 *
 *  Deliberately global rather than per-session: you are the same person in every
 *  project, and nobody wants to set their own name twice. */
export interface Me {
  name: string;
  /** Pool path ('/avatars/owl.png') or a bare custom filename, exactly as a
   *  crew avatar -- so the same picker and the same upload endpoint serve both. */
  avatar?: string;
  color: string;
}

export const ME_DEFAULT: Me = { name: 'You', color: '#4b5563' };

const meFile = () => join(dataDir(), 'me.json');

export function loadMe(): Me {
  try {
    if (!existsSync(meFile())) return ME_DEFAULT;
    const raw = JSON.parse(readFileSync(meFile(), 'utf8'));
    return normalizeMe(raw);
  } catch {
    // A corrupt file must never cost you the thread; you just go back to default.
    return ME_DEFAULT;
  }
}

export function saveMe(me: Me): Me {
  const clean = normalizeMe(me);
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(meFile(), JSON.stringify(clean, null, 2) + '\n');
  return clean;
}

/** Same validation the crew endpoint applies, for the same reason: this string
 *  is rendered and this colour goes into a style attribute. */
export function normalizeMe(raw: any): Me {
  const name = typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : ME_DEFAULT.name;
  const color = /^#[0-9a-fA-F]{6}$/.test(String(raw?.color ?? '')) ? String(raw.color) : ME_DEFAULT.color;
  const avatar = typeof raw?.avatar === 'string' && raw.avatar.trim() ? raw.avatar.trim().slice(0, 200) : undefined;
  return avatar ? { name, color, avatar } : { name, color };
}
