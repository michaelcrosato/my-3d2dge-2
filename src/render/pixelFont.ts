/**
 * A 3x5 bitmap font drawn with fillRect, so text in the overlay is made of exact art pixels (no
 * antialiasing blur at any scale). Uppercase only; lowercase maps to uppercase.
 */
const G: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101111011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', ' ': '000000000000000', '.': '000000000000010', ',': '000000000010100', '!': '010010010000010',
  '?': '111001011000010', '-': '000000111000000', '+': '000010111010000', ':': '000010000010000', '/': '001001010100100',
  '%': '101001010100101', "'": '010010000000000', '(': '010100100100010', ')': '010001001001010', '[': '110100100100110',
  ']': '011001001001011', '#': '101111101111101', '*': '000101010101000', '=': '000111000111000', '<': '001010100010001',
  '>': '100010001010100', '&': '010101010101011',
};

export const GLYPH_W = 3;
export const GLYPH_H = 5;

/** The 3x5 bitmap of a character, row-major '1'/'0' (unknown characters draw as '?'). */
export function glyphBits(ch: string): string {
  return G[ch.toUpperCase()] ?? G['?'];
}

/** Width in pixels of `text` at `scale` (1 px gap between glyphs). */
export function textWidth(text: string, scale = 1): number {
  return text.length ? (text.length * (GLYPH_W + 1) - 1) * scale : 0;
}

export function drawText(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, scale = 1, outline: string | null = '#0b0a10') {
  x = Math.round(x);
  y = Math.round(y);
  const up = text.toUpperCase();
  if (outline) {
    g.fillStyle = outline;
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) paint(g, up, x + ox, y + oy, scale);
  }
  g.fillStyle = color;
  paint(g, up, x, y, scale);
}

function paint(g: CanvasRenderingContext2D, text: string, x: number, y: number, s: number) {
  let cx = x;
  for (const ch of text) {
    const bits = G[ch] ?? G['?'];
    for (let r = 0; r < GLYPH_H; r++)
      for (let c = 0; c < GLYPH_W; c++) if (bits[r * GLYPH_W + c] === '1') g.fillRect(cx + c * s, y + r * s, s, s);
    cx += (GLYPH_W + 1) * s;
  }
}
