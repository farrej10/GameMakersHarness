import { PNG } from 'pngjs';
import type { ArtOutput } from '../contracts/index';
import { validateArtArtifact } from './validate';

export type AssetId = ArtOutput['sprites'][number]['id'];
export type SpriteGrid = { id: AssetId; rows: string[] };
export type PngInspection = {
  width: number;
  height: number;
  visiblePixels: number;
};

const GRID_SIZE = 16;
const PIXEL_SCALE = 4;
const OUTPUT_SIZE = GRID_SIZE * PIXEL_SCALE;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/u;

function parseColor(hex: string): readonly [number, number, number] {
  if (!HEX_COLOR.test(hex)) {
    throw new Error(`Invalid palette color: ${hex}`);
  }
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function assertPalette(palette: readonly string[]): void {
  if (
    palette.length !== 4 ||
    new Set(palette.map((entry) => entry.toLowerCase())).size !== 4 ||
    palette.some((entry) => !HEX_COLOR.test(entry))
  ) {
    throw new Error('Palette must contain exactly four distinct hex colors.');
  }
}

export function renderSpriteToPng(
  sprite: SpriteGrid,
  palette: readonly string[],
): Buffer {
  assertPalette(palette);
  if (
    sprite.rows.length !== GRID_SIZE ||
    sprite.rows.some((row) => !/^[.123]{16}$/u.test(row))
  ) {
    throw new Error(`Sprite ${sprite.id} must be a valid 16 by 16 pixel grid.`);
  }

  const colors = palette.map(parseColor);
  const png = new PNG({
    width: OUTPUT_SIZE,
    height: OUTPUT_SIZE,
    colorType: 6,
    inputColorType: 6,
    bitDepth: 8,
  });

  for (let gridY = 0; gridY < GRID_SIZE; gridY += 1) {
    const row = sprite.rows[gridY]!;
    for (let gridX = 0; gridX < GRID_SIZE; gridX += 1) {
      const symbol = row[gridX]!;
      const selected = symbol === '.' ? null : colors[Number(symbol)]!;
      for (let offsetY = 0; offsetY < PIXEL_SCALE; offsetY += 1) {
        for (let offsetX = 0; offsetX < PIXEL_SCALE; offsetX += 1) {
          const outputX = gridX * PIXEL_SCALE + offsetX;
          const outputY = gridY * PIXEL_SCALE + offsetY;
          const byteIndex = (outputY * OUTPUT_SIZE + outputX) * 4;
          png.data[byteIndex] = selected?.[0] ?? 0;
          png.data[byteIndex + 1] = selected?.[1] ?? 0;
          png.data[byteIndex + 2] = selected?.[2] ?? 0;
          png.data[byteIndex + 3] = selected ? 255 : 0;
        }
      }
    }
  }

  return PNG.sync.write(png, {
    colorType: 6,
    inputColorType: 6,
    bitDepth: 8,
    deflateLevel: 9,
    deflateStrategy: 3,
  });
}

export function inspectPng(buffer: Buffer): PngInspection {
  const png = PNG.sync.read(buffer);
  let visiblePixels = 0;
  for (let index = 3; index < png.data.length; index += 4) {
    if (png.data[index]! > 0) visiblePixels += 1;
  }
  return { width: png.width, height: png.height, visiblePixels };
}

export function renderArtOutput(
  art: ArtOutput,
  palette: readonly string[],
): Map<AssetId, Buffer> {
  const issues = validateArtArtifact(art);
  if (issues.length > 0) {
    throw new Error(
      `Cannot render invalid art: ${issues.map(({ code }) => code).join(', ')}`,
    );
  }
  assertPalette(palette);

  const rendered = new Map<AssetId, Buffer>();
  for (const sprite of art.sprites) {
    const buffer = 'pngBase64' in sprite
      ? Buffer.from(sprite.pngBase64, 'base64')
      : renderSpriteToPng(sprite, palette);
    const inspection = inspectPng(buffer);
    if (
      inspection.width !== OUTPUT_SIZE ||
      inspection.height !== OUTPUT_SIZE ||
      inspection.visiblePixels === 0
    ) {
      throw new Error(`Rendered sprite ${sprite.id} failed PNG inspection.`);
    }
    rendered.set(sprite.id, buffer);
  }
  return rendered;
}

export function normalizeImageTo64(input: Buffer): Buffer {
  const source = PNG.sync.read(input);
  if (source.width < 32 || source.height < 32) {
    throw new Error('Generated image must be at least 32 by 32 pixels.');
  }
  const output = new PNG({ width: 64, height: 64, colorType: 6, inputColorType: 6, bitDepth: 8 });
  const side = Math.min(source.width, source.height);
  const sourceX = Math.floor((source.width - side) / 2);
  const sourceY = Math.floor((source.height - side) / 2);
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const sx = sourceX + Math.min(side - 1, Math.floor(x * side / 64));
      const sy = sourceY + Math.min(side - 1, Math.floor(y * side / 64));
      const from = (sy * source.width + sx) * 4;
      const to = (y * 64 + x) * 4;
      output.data[to] = source.data[from]!;
      output.data[to + 1] = source.data[from + 1]!;
      output.data[to + 2] = source.data[from + 2]!;
      output.data[to + 3] = source.data[from + 3]!;
    }
  }
  let transparent = 0;
  for (let index = 3; index < output.data.length; index += 4) {
    if (output.data[index]! < 16) transparent += 1;
  }
  if (transparent < 64) {
    const corners = [0, 63 * 4, 63 * 64 * 4, (64 * 64 - 1) * 4];
    const background = [0, 1, 2].map((channel) =>
      Math.round(corners.reduce((sum, index) => sum + output.data[index + channel]!, 0) / corners.length),
    );
    const seen = new Uint8Array(64 * 64);
    const queue: number[] = [];
    for (let coordinate = 0; coordinate < 64; coordinate += 1) {
      queue.push(coordinate, 63 * 64 + coordinate, coordinate * 64, coordinate * 64 + 63);
    }
    while (queue.length) {
      const pixel = queue.pop()!;
      if (seen[pixel]) continue;
      seen[pixel] = 1;
      const index = pixel * 4;
      const distance = Math.hypot(
        output.data[index]! - background[0]!,
        output.data[index + 1]! - background[1]!,
        output.data[index + 2]! - background[2]!,
      );
      if (distance > 70) continue;
      output.data[index + 3] = 0;
      const x = pixel % 64;
      const y = Math.floor(pixel / 64);
      if (x > 0) queue.push(pixel - 1);
      if (x < 63) queue.push(pixel + 1);
      if (y > 0) queue.push(pixel - 64);
      if (y < 63) queue.push(pixel + 64);
    }
  }
  return PNG.sync.write(output, { colorType: 6, inputColorType: 6, bitDepth: 8, deflateLevel: 9 });
}

function makeGrid(
  pixel: (x: number, y: number) => '.' | '1' | '2' | '3',
): string[] {
  return Array.from({ length: GRID_SIZE }, (_, y) =>
    Array.from({ length: GRID_SIZE }, (_, x) => pixel(x, y)).join(''),
  );
}

export function createFallbackArtOutput(): ArtOutput {
  return {
    schemaVersion: 1,
    sprites: [
      {
        id: 'player',
        rows: makeGrid((x, y) => {
          if ((x === 6 || x === 9) && (y === 2 || y >= 12)) return '1';
          if (x >= 4 && x <= 11 && y >= 3 && y <= 11) {
            if (y === 6 && (x === 6 || x === 9)) return '3';
            return y >= 9 ? '2' : '1';
          }
          return '.';
        }),
      },
      {
        id: 'collectible',
        rows: makeGrid((x, y) => {
          const distance = Math.abs(x - 7.5) + Math.abs(y - 7.5);
          if (distance <= 4) return distance <= 2 ? '3' : '2';
          return '.';
        }),
      },
      {
        id: 'enemy',
        rows: makeGrid((x, y) => {
          const body = x >= 3 && x <= 12 && y >= 4 && y <= 11;
          const spikes =
            (y === 2 && (x === 3 || x === 12)) ||
            (y === 13 && (x === 4 || x === 11));
          if (spikes) return '3';
          if (body && y === 7 && (x === 5 || x === 10)) return '1';
          return body ? '3' : '.';
        }),
      },
      {
        id: 'exit',
        rows: makeGrid((x, y) => {
          const outer = x >= 2 && x <= 13 && y >= 2 && y <= 13;
          const inner = x >= 5 && x <= 10 && y >= 5 && y <= 10;
          if (inner) return '2';
          return outer ? '1' : '.';
        }),
      },
    ],
  };
}
