import {
  BEEP_DURATION_S,
  BEEP_FREQUENCY_HZ,
  BEEP_GAIN,
  BEEP_MIN_GAIN,
} from '@/lib/wifi-sense/constants';

/** A short sine beep, generated on the fly (no audio files). */
export function playBeep(ctx: AudioContext): void {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = BEEP_FREQUENCY_HZ;
  gain.gain.setValueAtTime(BEEP_GAIN, now);
  gain.gain.exponentialRampToValueAtTime(BEEP_MIN_GAIN, now + BEEP_DURATION_S);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + BEEP_DURATION_S);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}
