/**
 * Audio tools: agents cannot listen, so sounds are rendered offline and shown as a waveform and a
 * log-frequency spectrogram, with loudness and brightness numbers to compare against.
 */
import { renderSound } from '../../audio/engine';
import { SOUNDS, THEME_AMBIENCE } from '../../content/sounds';
import { newImg, rgba, setPx, text, line, type RGBA } from '../raster';
import { defineTool } from '../registry';

defineTool({
  name: 'audio.list', group: 'audio',
  desc: 'Every synthesized sound (layers, voice limits) and theme ambience, from content/sounds.ts.',
  params: { filter: { type: 'string', desc: 'Substring filter on the sound id.' } },
  run({ filter }) {
    const ids = Object.keys(SOUNDS).filter((id) => !filter || id.includes(filter as string));
    return {
      sounds: ids.map((id) => {
        const d = SOUNDS[id];
        return { id, layers: d.layers.length, waves: [...new Set(d.layers.map((l) => l.wave))], seconds: Math.round(Math.max(...d.layers.map((l) => (l.delay ?? 0) + l.dur)) * 100) / 100, max: d.max ?? 4, gap: d.gap ?? 0, vary: d.vary ?? 0 };
      }),
      ambience: Object.keys(THEME_AMBIENCE),
    };
  },
});

/** Goertzel magnitude of one frequency over a window. */
function goertzel(x: Float32Array, start: number, n: number, f: number, rate: number): number {
  const w = (2 * Math.PI * f) / rate, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    const s0 = (x[start + i] ?? 0) * hann + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / n;
}

function heat(v: number): RGBA {
  const t = Math.max(0, Math.min(1, v));
  return [Math.round(255 * Math.min(1, t * 1.8)), Math.round(255 * Math.max(0, Math.min(1, t * 1.6 - 0.35))), Math.round(255 * Math.max(0, t * 2 - 1.4) + 60 * (1 - t)), 255];
}

defineTool({
  name: 'audio.inspect', group: 'audio', needs: 'game',
  desc: 'Renders a sound offline and returns a waveform + log-frequency spectrogram image with duration, peak, RMS loudness and spectral centroid (brightness). Agents tune sounds by looking at them.',
  params: {
    sound: { type: 'string', required: true, desc: 'Sound id (audio.list).', enum: Object.keys(SOUNDS) },
    scale: { type: 'integer', default: 2, min: 1, max: 4, desc: 'Image upscale.' },
  },
  example: { sound: 'hit_crit' },
  async run({ sound, scale }, ctx) {
    const rate = 22050;
    const x = await renderSound(sound, rate);
    let peak = 0, sum = 0;
    for (const v of x) {
      peak = Math.max(peak, Math.abs(v));
      sum += v * v;
    }
    const rms = Math.sqrt(sum / Math.max(1, x.length));
    const win = 512, hop = 128, frames = Math.max(1, Math.floor((x.length - win) / hop) + 1);
    const W = Math.min(480, Math.max(120, frames)), bins = 64, waveH = 48, H = waveH + bins + 12;
    const img = newImg(W, H, rgba('#0b0a10'));
    // Waveform (min/max per column).
    const per = x.length / W;
    for (let c = 0; c < W; c++) {
      let lo = 0, hi = 0;
      for (let i = Math.floor(c * per); i < Math.floor((c + 1) * per); i++) {
        lo = Math.min(lo, x[i]);
        hi = Math.max(hi, x[i]);
      }
      line(img, c, waveH / 2 - hi * (waveH / 2 - 2), c, waveH / 2 - lo * (waveH / 2 - 2), rgba('#7fd4ff'));
    }
    // Spectrogram: log-spaced bins from 60 Hz to Nyquist.
    const freqs = Array.from({ length: bins }, (_, b) => 60 * Math.pow(rate / 2 / 60, b / (bins - 1)));
    let centroidNum = 0, centroidDen = 0;
    const mags: number[][] = [];
    let maxMag = 1e-9;
    for (let c = 0; c < W; c++) {
      const start = Math.floor((c / W) * Math.max(1, x.length - win));
      const col = freqs.map((f) => goertzel(x, start, win, f, rate));
      col.forEach((m, b) => {
        centroidNum += m * freqs[b];
        centroidDen += m;
        maxMag = Math.max(maxMag, m);
      });
      mags.push(col);
    }
    for (let c = 0; c < W; c++)
      for (let b = 0; b < bins; b++) {
        const db = 20 * Math.log10(mags[c][b] / maxMag + 1e-6);
        setPx(img, c, waveH + bins - 1 - b, heat((db + 60) / 60));
      }
    text(img, `${sound} ${(x.length / rate).toFixed(2)}s`, 2, H - 8, rgba('#e8e4da'), 1, null);
    return {
      sound, seconds: Math.round((x.length / rate) * 100) / 100, peak: Math.round(peak * 1000) / 1000, rms: Math.round(rms * 1000) / 1000,
      centroidHz: Math.round(centroidNum / Math.max(1e-9, centroidDen)), layers: SOUNDS[sound].layers,
      image: ctx.image('spectrogram', img, scale), legend: 'top: waveform; bottom: spectrogram, 60 Hz (bottom) to 11 kHz (top), brighter = louder',
    };
  },
});
