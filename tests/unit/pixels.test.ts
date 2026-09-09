import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import type { ArtOutput, GameSpec } from '../../src/contracts/index';
import {
  createFallbackArtOutput,
  inspectPng,
  renderArtOutput,
  renderSpriteToPng,
} from '../../src/toolkit/render-pixels';
import { validateArtArtifact } from '../../src/toolkit/validate';

function readJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/reference/${name}`, import.meta.url), 'utf8'),
  ) as T;
}

const spec = readJson<GameSpec>('game-spec.json');
const art = readJson<ArtOutput>('art.json');

describe('pixel renderer', () => {
  it('renders and decodes every reference sprite as a visible 32 by 32 PNG', () => {
    const rendered = renderArtOutput(art, spec.theme.palette);

    expect([...rendered.keys()]).toEqual([
      'player',
      'collectible',
      'enemy',
      'exit',
    ]);
    for (const png of rendered.values()) {
      expect(inspectPng(png)).toEqual({
        width: 32,
        height: 32,
        visiblePixels: expect.any(Number),
      });
      expect(inspectPng(png).visiblePixels).toBeGreaterThan(0);
    }
  });

  it('expands every source pixel to an exact 2 by 2 RGBA block', () => {
    const sprite = structuredClone(art.sprites[0]!);
    sprite.rows = Array.from({ length: 16 }, (_, y) =>
      y === 3 ? '....1...........' : '................',
    );
    const decoded = PNG.sync.read(renderSpriteToPng(sprite, spec.theme.palette));
    const alphaAt = (x: number, y: number) => decoded.data[(y * 32 + x) * 4 + 3];

    expect(alphaAt(8, 6)).toBe(255);
    expect(alphaAt(9, 6)).toBe(255);
    expect(alphaAt(8, 7)).toBe(255);
    expect(alphaAt(9, 7)).toBe(255);
    expect(alphaAt(7, 6)).toBe(0);
    expect(alphaAt(10, 7)).toBe(0);
  });

  it('produces byte-identical PNGs for identical inputs', () => {
    const first = renderArtOutput(art, spec.theme.palette);
    const second = renderArtOutput(structuredClone(art), [...spec.theme.palette]);

    for (const [id, png] of first) {
      expect(png.equals(second.get(id)!)).toBe(true);
    }
  });

  it('rejects invalid palettes and malformed grids', () => {
    expect(() =>
      renderSpriteToPng(art.sprites[0]!, [
        '#000000',
        '#000000',
        '#222222',
        '#333333',
      ]),
    ).toThrow(/four distinct hex colors/u);

    const invalid = structuredClone(art.sprites[0]!);
    invalid.rows[0] = 'short';
    expect(() => renderSpriteToPng(invalid, spec.theme.palette)).toThrow(
      /valid 16 by 16 pixel grid/u,
    );
  });
});

describe('fallback sprites', () => {
  it('creates four distinct contract-valid and visible sprites', () => {
    const fallback = createFallbackArtOutput();
    expect(validateArtArtifact(fallback)).toEqual([]);

    const rendered = renderArtOutput(fallback, spec.theme.palette);
    const hashes = [...rendered.values()].map((png) =>
      createHash('sha256').update(png).digest('hex'),
    );
    expect(new Set(hashes)).toHaveLength(4);
    for (const png of rendered.values()) {
      expect(inspectPng(png)).toEqual(
        expect.objectContaining({ width: 32, height: 32 }),
      );
      expect(inspectPng(png).visiblePixels).toBeGreaterThan(0);
    }
  });
});
