export const FRAME_RATE = 60;
// 手付けのシュート演出(3.0秒以降)は削除した。実測クリップの尺のみ。
export const DURATION_SECONDS = 3.0;
export const FINAL_FRAME = FRAME_RATE * DURATION_SECONDS;

const SUPPORTED_SPEEDS = new Set([0.25, 0.5, 1]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function frameToSeconds(frame) {
  return clamp(Number(frame) || 0, 0, FINAL_FRAME) / FRAME_RATE;
}

export function secondsToFrame(seconds) {
  return Math.round(clamp(Number(seconds) || 0, 0, DURATION_SECONDS) * FRAME_RATE);
}

export class AnimationPlayer {
  #time = 0;
  #speed = 1;
  #playing = false;
  #ended = false;

  play() {
    if (this.#time >= DURATION_SECONDS) {
      this.#time = 0;
    }
    this.#ended = false;
    this.#playing = true;
  }

  pause() {
    this.#playing = false;
  }

  seekFrame(frame) {
    this.#time = frameToSeconds(frame);
    this.#playing = false;
    this.#ended = this.#time >= DURATION_SECONDS;
  }

  stepFrames(delta) {
    this.seekFrame(secondsToFrame(this.#time) + (Number(delta) || 0));
  }

  syncTime(seconds) {
    this.#time = clamp(Number(seconds) || 0, 0, DURATION_SECONDS);
    this.#ended = this.#time >= DURATION_SECONDS;
    if (this.#ended) this.#playing = false;
    return this.snapshot();
  }

  setSpeed(speed) {
    this.#speed = SUPPORTED_SPEEDS.has(Number(speed)) ? Number(speed) : 1;
  }

  update(deltaSeconds) {
    if (!this.#playing) return this.snapshot();

    this.#time += Math.max(0, Number(deltaSeconds) || 0) * this.#speed;
    if (this.#time >= DURATION_SECONDS) {
      this.#time = DURATION_SECONDS;
      this.#playing = false;
      this.#ended = true;
    }
    return this.snapshot();
  }

  snapshot() {
    return {
      frame: secondsToFrame(this.#time),
      time: this.#time,
      speed: this.#speed,
      playing: this.#playing,
      ended: this.#ended,
    };
  }
}
