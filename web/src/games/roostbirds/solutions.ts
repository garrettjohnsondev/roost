/** Winning shots for every level, found by the level solver (solver.ts) and
 *  replayed by the tests. Generated; `score` is the solver's best. */
/** A shot: angle in degrees above flat, pull 0..1, tap time in seconds (0: no tap). */
export interface Shot { a: number; p: number; t: number }
export interface Solution { birds: number; score: number; firstGood: number; shots: Shot[] }
export const SOLUTIONS: Solution[] = [
  { birds: 1, score: 26500, firstGood: 0.327, shots: [{ a: -6, p: 1, t: 0 }] }, // 1-1 Hello, world
  { birds: 1, score: 37500, firstGood: 0.463, shots: [{ a: 18, p: 0.8, t: 0 }] }, // 1-2 Dead code
  { birds: 1, score: 32100, firstGood: 0.39, shots: [{ a: -3, p: 1, t: 0.6 }] }, // 1-3 Carved in stone
  { birds: 1, score: 36500, firstGood: 0.485, shots: [{ a: 12, p: 1, t: 0.35 }] }, // 1-4 Scattered TODOs
  { birds: 1, score: 44800, firstGood: 0.333, shots: [{ a: 6, p: 0.9, t: 0 }] }, // 1-5 Spaghetti
  { birds: 1, score: 41300, firstGood: 0.235, shots: [{ a: 57, p: 0.8, t: 0 }] }, // 1-6 Load-bearing hack
  { birds: 1, score: 44800, firstGood: 0.583, shots: [{ a: 3, p: 0.9, t: 0.6 }] }, // 1-7 The long scroll
  { birds: 1, score: 36600, firstGood: 0.299, shots: [{ a: 3, p: 1, t: 0.85 }] }, // 1-8 Buried in the vault
  { birds: 2, score: 55800, firstGood: 0.651, shots: [{ a: 9, p: 1, t: 0.35 }, { a: 3, p: 1, t: 0.35 }] }, // 1-9 Goto considered harmful
  { birds: 1, score: 39100, firstGood: 0.285, shots: [{ a: 42, p: 0.9, t: 1.1 }] }, // 1-10 Undocumented
  { birds: 2, score: 42300, firstGood: 0.426, shots: [{ a: 12, p: 0.8, t: 1.1 }, { a: 0, p: 1, t: 0.6 }] }, // 1-11 The monolith
  { birds: 2, score: 53900, firstGood: 0.386, shots: [{ a: 45, p: 0.9, t: 0.85 }, { a: 18, p: 0.8, t: 0.6 }] }, // 1-12 Two temples
  { birds: 2, score: 54500, firstGood: 0.289, shots: [{ a: 45, p: 0.7, t: 0.85 }, { a: 21, p: 0.9, t: 0 }] }, // 1-13 The keystone
  { birds: 2, score: 57100, firstGood: 0.432, shots: [{ a: -3, p: 1, t: 0.85 }, { a: 6, p: 1, t: 0.6 }] }, // 1-14 Catacombs
  { birds: 2, score: 62300, firstGood: 0.141, shots: [{ a: 15, p: 1, t: 0 }, { a: 21, p: 1, t: 0.85 }] }, // 1-15 The Ancient Bug
  { birds: 1, score: 31800, firstGood: 0.42, shots: [{ a: -3, p: 1, t: 0 }] }, // 2-1 Pull request
  { birds: 1, score: 37300, firstGood: 0.315, shots: [{ a: 33, p: 0.7, t: 0 }] }, // 2-2 Hot path
  { birds: 1, score: 36700, firstGood: 0.073, shots: [{ a: 24, p: 0.9, t: 0.6 }] }, // 2-3 Revert
  { birds: 1, score: 49500, firstGood: 0.535, shots: [{ a: 6, p: 0.9, t: 1.1 }] }, // 2-4 Ours and theirs
  { birds: 1, score: 49200, firstGood: 0.463, shots: [{ a: -6, p: 1, t: 0 }] }, // 2-5 Chain reaction
  { birds: 1, score: 41200, firstGood: 0.715, shots: [{ a: 33, p: 0.8, t: 0.6 }] }, // 2-6 Cherry-pick
  { birds: 1, score: 49200, firstGood: 0.356, shots: [{ a: -6, p: 1, t: 0.35 }] }, // 2-7 Rebase
  { birds: 2, score: 42600, firstGood: 0.257, shots: [{ a: 21, p: 0.9, t: 0.85 }, { a: 12, p: 1, t: 0.35 }] }, // 2-8 Diff
  { birds: 1, score: 44300, firstGood: 0.049, shots: [{ a: 27, p: 1, t: 1.1 }] }, // 2-9 Git blame
  { birds: 2, score: 45800, firstGood: 0.635, shots: [{ a: 24, p: 1, t: 0.85 }, { a: 66, p: 1, t: 0.85 }] }, // 2-10 Squash commits
  { birds: 2, score: 43900, firstGood: 0.099, shots: [{ a: 21, p: 1, t: 1.1 }, { a: 33, p: 1, t: 0.6 }] }, // 2-11 Detached HEAD
  { birds: 2, score: 49700, firstGood: 0.228, shots: [{ a: 51, p: 0.9, t: 1.1 }, { a: 24, p: 1, t: 0 }] }, // 2-12 Force push
  { birds: 2, score: 51800, firstGood: 0.411, shots: [{ a: 63, p: 0.7, t: 1.1 }, { a: 72, p: 1, t: 0 }] }, // 2-13 Octopus merge
  { birds: 2, score: 50700, firstGood: 0.3, shots: [{ a: 24, p: 1, t: 1.1 }, { a: 63, p: 1, t: 0 }] }, // 2-14 Conflict markers
  { birds: 3, score: 54600, firstGood: 0.168, shots: [{ a: 66, p: 1, t: 0 }, { a: 33, p: 0.8, t: 1.1 }, { a: -6, p: 1, t: 0.35 }] }, // 2-15 The Merge Beast
  { birds: 1, score: 25600, firstGood: 0.093, shots: [{ a: 27, p: 1, t: 0 }] }, // 3-1 First upload
  { birds: 1, score: 40600, firstGood: 0.3, shots: [{ a: 21, p: 0.6, t: 0.6 }] }, // 3-2 Bounce rate
  { birds: 1, score: 38600, firstGood: 0.233, shots: [{ a: 27, p: 1, t: 0.35 }] }, // 3-3 Latency
  { birds: 1, score: 44300, firstGood: 0.257, shots: [{ a: 30, p: 0.5, t: 0.6 }] }, // 3-4 Object storage
  { birds: 2, score: 38000, firstGood: 0.537, shots: [{ a: 48, p: 0.8, t: 0.85 }, { a: 18, p: 1, t: 0 }] }, // 3-5 Autoscaling
  { birds: 1, score: 30100, firstGood: 0.062, shots: [{ a: 30, p: 1, t: 0.6 }] }, // 3-6 Region failover
  { birds: 3, score: 36200, firstGood: 0.051, shots: [{ a: 30, p: 1, t: 1.1 }, { a: 39, p: 0.9, t: 0 }, { a: -6, p: 1, t: 0.6 }] }, // 3-7 Cold start
  { birds: 1, score: 36700, firstGood: 0.238, shots: [{ a: 36, p: 0.9, t: 0.85 }] }, // 3-8 Edge cache
  { birds: 1, score: 43600, firstGood: 0.191, shots: [{ a: 27, p: 1, t: 0.6 }] }, // 3-9 Serverless
  { birds: 2, score: 35100, firstGood: 0.042, shots: [{ a: 27, p: 1, t: 0.6 }, { a: 30, p: 0.8, t: 0.35 }] }, // 3-10 Rate limited
  { birds: 2, score: 34900, firstGood: 0.078, shots: [{ a: 57, p: 0.9, t: 0 }, { a: 30, p: 1, t: 1 }] }, // 3-11 Vendor lock-in
  { birds: 2, score: 47000, firstGood: 0.344, shots: [{ a: 24, p: 0.9, t: 0.6 }, { a: 30, p: 0.9, t: 0.35 }] }, // 3-12 Eventual consistency
  { birds: 2, score: 50000, firstGood: 0.07, shots: [{ a: 24, p: 0.8, t: 0.6 }, { a: 48, p: 1, t: 0 }] }, // 3-13 Split brain
  { birds: 2, score: 48800, firstGood: 0.157, shots: [{ a: 33, p: 1, t: 0.85 }, { a: 51, p: 0.6, t: 1 }] }, // 3-14 Cascade failure
  { birds: 4, score: 61400, firstGood: 0.191, shots: [{ a: 33, p: 0.8, t: 0.6 }, { a: 33, p: 1, t: 1.1 }, { a: 39, p: 1, t: 1.1 }, { a: 3, p: 1, t: 0.35 }] }, // 3-15 The Cloud Leak
];
