import { describe, expect, it, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'roost-modes-'));
process.env.ROOST_CONFIG = join(tmp, 'roost.config.json');
writeFileSync(process.env.ROOST_CONFIG, '{}');
const { loadConfig } = await import('../src/config.js');
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Correction 30: the whole product was opt-in and nothing opted in. */
describe('the defaults are the product', () => {
  it('starts sessions in auto, not chat', () => {
    // 'chat' means no triage: the light tier is never reached and the two
    // engines never confer. That was the default for every session.
    expect(loadConfig().consult.defaultMode).toBe('auto');
  });

  it('escalates a large task to the conference without the user finding a button', () => {
    expect(loadConfig().consult.escalateToConference).toBe(true);
  });

  it('still leaves the human on the Proceed gate', () => {
    expect(loadConfig().consult.autoProceed).toBe(false);
  });
});
