/** Tiny synthesizer. Browser audio is optional; agent mode never starts it. */
import type { Run } from "../sim/run";
export class EmberAudio {
  private context: AudioContext | null = null;
  private seq = 0;
  private disabled = false;
  unlock() {
    if (this.context || this.disabled) return;
    try {
      this.context = new AudioContext();
      void this.context.resume().catch(() => {
        this.disabled = true;
      });
    } catch {
      this.disabled = true;
    }
  }
  update(run: Run) {
    if (!this.context || this.disabled || this.context.state !== "running")
      return;
    for (const e of run.events.filter((e) => e.seq > this.seq)) {
      if (e.type === "combat.skill")
        this.tone(e.skill === "cleave" ? 160 : 280, 0.07, "sawtooth", 0.012);
      if (e.type === "combat.hit") this.tone(80, 0.045, "triangle", 0.025);
      if (e.type === "loot.pickup") this.tone(700, 0.09, "sine", 0.02);
      if (e.type === "progress.level") {
        this.tone(440, 0.3, "sine", 0.02);
        this.tone(660, 0.4, "sine", 0.015);
      }
      if (e.type === "combat.dash") this.tone(230, 0.1, "triangle", 0.016);
    }
    this.seq = run.seq;
  }
  private tone(
    freq: number,
    duration: number,
    type: OscillatorType,
    volume: number,
  ) {
    const ctx = this.context!,
      osc = ctx.createOscillator(),
      gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(
      freq * 0.4,
      ctx.currentTime + duration,
    );
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }
  dispose() {
    void this.context?.close();
  }
}
