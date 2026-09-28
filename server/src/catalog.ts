/** The Roost Crate catalog (games wave 1, agreed 2026-09-29). Modelled on
 *  Rocket League's original crates: series crates, five rarities at the same
 *  published odds, Painted and Certified variants, and a 5-for-1 trade-up.
 *  No real money anywhere: coins and keys are earned by playing and working. */

export type Rarity = 'rare' | 'very-rare' | 'import' | 'exotic' | 'black-market';
export const RARITIES: Rarity[] = ['rare', 'very-rare', 'import', 'exotic', 'black-market'];
/** Rocket League's disclosed odds (2019): 55 / 28 / 12 / 4 / 1. */
export const ODDS: Record<Rarity, number> = { rare: 55, 'very-rare': 28, import: 12, exotic: 4, 'black-market': 1 };
export const RARITY_NAME: Record<Rarity | 'ghost' | 'work', string> = {
  rare: 'Rare', 'very-rare': 'Very Rare', import: 'Import', exotic: 'Exotic', 'black-market': 'Black Market', ghost: 'Ghost', work: 'Earned',
};

export type Slot = 'hat' | 'prop' | 'aura' | 'frame' | 'title' | 'celebration';
export const SLOTS: Slot[] = ['hat', 'prop', 'aura', 'frame', 'title', 'celebration'];

export interface Item {
  id: string;
  slot: Slot;
  name: string;
  rarity: Rarity | 'ghost';
  /** Which crates it can drop from. */
  series: string[];
  /** Art or style key: hats/props use /items/<slot>s/<art>.webp; the rest are drawn in CSS. */
  art: string;
  /** Titles: the words. */
  text?: string;
}

export interface CrateDef {
  id: string;
  name: string;
  price: number;
  /** Seasonal crates are only sold in their months (1-12). */
  months?: number[];
  free?: boolean;
  blurb: string;
}

export const CRATES: CrateDef[] = [
  { id: 'season1', name: 'Nest Crate', price: 150, blurb: 'Season 1: the classics.' },
  { id: 'season2', name: 'Hatchling Crate', price: 150, blurb: 'Season 2: louder, shinier.' },
  { id: 'spooky', name: 'Haunted Crate', price: 250, months: [10, 11], blurb: 'Only in autumn: pumpkins and shadows.' },
  { id: 'frosty', name: 'Frost Crate', price: 250, months: [12, 1], blurb: 'Only in winter: snow and sparkle.' },
  { id: 'bloom', name: 'Bloom Crate', price: 250, months: [3, 4, 5], blurb: 'Only in spring: petals and vines.' },
  { id: 'free', name: 'Daily Drop', price: 0, free: true, blurb: 'One free every day. Commons and the odd surprise.' },
];

const I = (id: string, slot: Slot, name: string, rarity: Rarity | 'ghost', series: string[], art = id, text?: string): Item => ({ id, slot, name, rarity, series, art, text });
const S1 = ['season1', 'free'];
const S2 = ['season2', 'free'];

export const ITEMS: Item[] = [
  // Hats
  I('hat-beanie', 'hat', 'Beanie', 'rare', S1, 'beanie'),
  I('hat-cap', 'hat', 'Ball Cap', 'rare', S1, 'cap'),
  I('hat-beret', 'hat', 'Beret', 'rare', S2, 'beret'),
  I('hat-party', 'hat', 'Party Hat', 'rare', S2, 'party'),
  I('hat-hardhat', 'hat', 'Hard Hat', 'very-rare', S1, 'hardhat'),
  I('hat-chef', 'hat', 'Chef Hat', 'very-rare', S2, 'chef'),
  I('hat-cowboy', 'hat', 'Cowboy Hat', 'very-rare', S1, 'cowboy'),
  I('hat-headphones', 'hat', 'Headphones', 'import', S2, 'headphones'),
  I('hat-tophat', 'hat', 'Top Hat', 'import', S1, 'tophat'),
  I('hat-propeller', 'hat', 'Propeller Cap', 'import', S2, 'propeller'),
  I('hat-sombrero', 'hat', 'Sombrero', 'import', S1, 'sombrero'),
  I('hat-pirate', 'hat', 'Pirate Hat', 'exotic', S2, 'pirate'),
  I('hat-viking', 'hat', 'Viking Helm', 'exotic', S1, 'viking'),
  I('hat-wizard', 'hat', 'Wizard Hat', 'exotic', S2, 'wizard'),
  I('hat-halo', 'hat', 'Halo', 'black-market', ['season1'], 'halo'),
  I('hat-crown', 'hat', 'Gold Crown', 'black-market', ['season2'], 'crown'),
  I('hat-pumpkin', 'hat', 'Pumpkin Head', 'exotic', ['spooky'], 'pumpkin'),
  I('hat-santa', 'hat', 'Santa Hat', 'import', ['frosty'], 'santa'),
  I('hat-flowerwreath', 'hat', 'Flower Wreath', 'import', ['bloom'], 'flowerwreath'),
  I('hat-bunnyears', 'hat', 'Bunny Ears', 'exotic', ['bloom'], 'bunnyears'),
  // Props
  I('prop-coffee', 'prop', 'Coffee', 'rare', S1, 'coffee'),
  I('prop-pizza', 'prop', 'Pizza Slice', 'rare', S2, 'pizza'),
  I('prop-rubberduck', 'prop', 'Rubber Duck', 'rare', S1, 'rubberduck'),
  I('prop-balloon', 'prop', 'Balloon', 'rare', S2, 'balloon'),
  I('prop-keyboard', 'prop', 'Keyboard', 'very-rare', S1, 'keyboard'),
  I('prop-laptop', 'prop', 'Laptop', 'very-rare', S2, 'laptop'),
  I('prop-umbrella', 'prop', 'Umbrella', 'very-rare', S1, 'umbrella'),
  I('prop-flag', 'prop', 'Flag', 'very-rare', S2, 'flag'),
  I('prop-fishingrod', 'prop', 'Fishing Rod', 'import', S1, 'fishingrod'),
  I('prop-guitar', 'prop', 'Guitar', 'import', S2, 'guitar'),
  I('prop-sword', 'prop', 'Sword', 'exotic', S1, 'sword'),
  I('prop-wand', 'prop', 'Wand', 'exotic', S2, 'wand'),
  I('prop-trophy', 'prop', 'Trophy', 'black-market', ['season1', 'season2'], 'trophy'),
  I('prop-lantern', 'prop', 'Lantern', 'import', ['spooky'], 'lantern'),
  I('prop-snowglobe', 'prop', 'Snow Globe', 'exotic', ['frosty'], 'snowglobe'),
  I('prop-bouquet', 'prop', 'Bouquet', 'very-rare', ['bloom'], 'bouquet'),
  // Auras (CSS)
  I('aura-sparkle', 'aura', 'Sparkle', 'rare', S1, 'sparkle'),
  I('aura-bubbles', 'aura', 'Bubbles', 'rare', S2, 'bubbles'),
  I('aura-leaves', 'aura', 'Falling Leaves', 'very-rare', S1, 'leaves'),
  I('aura-hearts', 'aura', 'Hearts', 'very-rare', S2, 'hearts'),
  I('aura-stars', 'aura', 'Starfield', 'import', S1, 'stars'),
  I('aura-ember', 'aura', 'Embers', 'import', S2, 'ember'),
  I('aura-lightning', 'aura', 'Lightning', 'exotic', S1, 'lightning'),
  I('aura-rainbow', 'aura', 'Rainbow', 'exotic', S2, 'rainbow'),
  I('aura-pixels', 'aura', 'Glitch', 'black-market', ['season1', 'season2'], 'pixels'),
  I('aura-shadow', 'aura', 'Shadow', 'exotic', ['spooky'], 'shadow'),
  I('aura-frost', 'aura', 'Frost', 'import', ['frosty'], 'frost'),
  I('aura-petals', 'aura', 'Petals', 'import', ['bloom'], 'petals'),
  // Frames (CSS, around the face)
  I('frame-wood', 'frame', 'Wood Frame', 'rare', S1, 'wood'),
  I('frame-candy', 'frame', 'Candy Frame', 'rare', S2, 'candy'),
  I('frame-checker', 'frame', 'Checkered', 'very-rare', S1, 'checker'),
  I('frame-circuit', 'frame', 'Circuit', 'very-rare', S2, 'circuit'),
  I('frame-neon', 'frame', 'Neon', 'import', S1, 'neon'),
  I('frame-gold', 'frame', 'Gold', 'exotic', S2, 'gold'),
  I('frame-royal', 'frame', 'Royal', 'black-market', ['season1', 'season2'], 'royal'),
  I('frame-lava', 'frame', 'Lava', 'exotic', ['spooky'], 'lava'),
  I('frame-ice', 'frame', 'Ice', 'very-rare', ['frosty'], 'ice'),
  I('frame-vine', 'frame', 'Vines', 'very-rare', ['bloom'], 'vine'),
  // Titles
  I('title-rookie', 'title', 'Rookie', 'rare', S1, 'plain', 'Rookie'),
  I('title-tinkerer', 'title', 'Tinkerer', 'rare', S2, 'plain', 'Tinkerer'),
  I('title-bugsquasher', 'title', 'Bug Squasher', 'rare', S1, 'plain', 'Bug Squasher'),
  I('title-nightowl', 'title', 'Night Owl', 'very-rare', S2, 'plain', 'Night Owl'),
  I('title-refactorer', 'title', 'The Refactorer', 'very-rare', S1, 'plain', 'The Refactorer'),
  I('title-shipit', 'title', 'Ship It', 'import', S2, 'glow', 'Ship It'),
  I('title-10x', 'title', '10x', 'import', S1, 'glow', '10x'),
  I('title-mergeking', 'title', 'Merge Monarch', 'exotic', S2, 'gold', 'Merge Monarch'),
  I('title-greentests', 'title', 'All Green', 'exotic', S1, 'gold', 'All Green'),
  I('title-legend', 'title', 'Legend of the Roost', 'black-market', ['season1', 'season2'], 'rainbow', 'Legend of the Roost'),
  I('title-haunted', 'title', 'The Haunted', 'import', ['spooky'], 'glow', 'The Haunted'),
  I('title-snowbird', 'title', 'Snowbird', 'import', ['frosty'], 'glow', 'Snowbird'),
  I('title-inbloom', 'title', 'In Bloom', 'import', ['bloom'], 'glow', 'In Bloom'),
  // Celebrations (the job-verified burst)
  I('cele-classic', 'celebration', 'Confetti', 'rare', S1, 'classic'),
  I('cele-feathers', 'celebration', 'Feathers', 'rare', S2, 'feathers'),
  I('cele-hearts', 'celebration', 'Hearts', 'very-rare', S1, 'hearts'),
  I('cele-coins', 'celebration', 'Coin Shower', 'very-rare', S2, 'coins'),
  I('cele-stars', 'celebration', 'Shooting Stars', 'import', S1, 'stars'),
  I('cele-bubbles', 'celebration', 'Bubbles', 'import', S2, 'bubbles'),
  I('cele-fireworks', 'celebration', 'Fireworks', 'exotic', ['season1', 'season2'], 'fireworks'),
  I('cele-pixels', 'celebration', 'Pixel Storm', 'black-market', ['season1', 'season2'], 'pixels'),
  I('cele-bats', 'celebration', 'Bats', 'exotic', ['spooky'], 'bats'),
  I('cele-snow', 'celebration', 'Snowfall', 'exotic', ['frosty'], 'snow'),
  I('cele-petals', 'celebration', 'Petal Burst', 'exotic', ['bloom'], 'petals'),
];

/** Rocket League's paint names and a CSS hue for each. */
export const PAINTS: Array<{ id: string; name: string; hue: number; sat?: number; bright?: number }> = [
  { id: 'crimson', name: 'Crimson', hue: -30 },
  { id: 'orange', name: 'Orange', hue: 20 },
  { id: 'saffron', name: 'Saffron', hue: 45 },
  { id: 'lime', name: 'Lime', hue: 90 },
  { id: 'forest', name: 'Forest Green', hue: 130, bright: 0.8 },
  { id: 'sky', name: 'Sky Blue', hue: 180 },
  { id: 'cobalt', name: 'Cobalt', hue: 220 },
  { id: 'purple', name: 'Purple', hue: 270 },
  { id: 'pink', name: 'Pink', hue: 310 },
  { id: 'sienna', name: 'Burnt Sienna', hue: 10, bright: 0.75 },
  { id: 'grey', name: 'Grey', hue: 0, sat: 0 },
  { id: 'white', name: 'Titanium White', hue: 0, sat: 0, bright: 1.6 },
  { id: 'black', name: 'Black', hue: 0, sat: 0, bright: 0.35 },
];

/** What a Certified item counts, while worn. */
export const CERTS: Array<{ id: string; name: string }> = [
  { id: 'jobs', name: 'Jobs Shipped' },
  { id: 'runs', name: 'Games Played' },
  { id: 'ghosts', name: 'Ghosts Beaten' },
  { id: 'streak', name: 'Day Streak' },
  { id: 'crates', name: 'Crates Opened' },
];

/** A ghost's one-of-a-kind reward: its own aura, in its colour. */
export function ghostItem(crew: string): Item {
  return { id: `ghost-${crew.toLowerCase()}`, slot: 'aura', name: `${crew}'s Ghost`, rarity: 'ghost', series: [], art: `ghost-${crew.toLowerCase()}` };
}

export function itemById(id: string): Item | undefined {
  if (id.startsWith('ghost-')) {
    const n = id.slice(6);
    return ghostItem(n[0].toUpperCase() + n.slice(1));
  }
  return ITEMS.find((i) => i.id === id);
}
