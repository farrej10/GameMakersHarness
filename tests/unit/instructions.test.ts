import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyAgentInstruction,
  normalizeAgentInstructions,
  readAgentInstructions,
  writeAgentInstructions,
} from '../../src/toolkit/instructions';

describe('per-agent instructions', () => {
  it('normalizes, persists, and appends guidance without replacing the base prompt', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'agent-instructions-'));
    const saved = writeAgentInstructions(root, {
      logic: '  Return only valid TypeScript.  ',
      art: '',
    });
    expect(saved).toEqual({ logic: 'Return only valid TypeScript.' });
    expect(readAgentInstructions(root)).toEqual(saved);
    expect(applyAgentInstruction('BASE CONTRACT\n', 'logic', saved)).toContain(
      'BASE CONTRACT\n\nUser guidance for this run:\nReturn only valid TypeScript.',
    );
  });

  it('rejects unknown roles and oversized guidance', () => {
    expect(() => normalizeAgentInstructions({ spec: 'replace the contract' })).toThrow(/Unsupported/u);
    expect(() => normalizeAgentInstructions({ logic: 'x'.repeat(2_001) })).toThrow(/2000/u);
  });
});
