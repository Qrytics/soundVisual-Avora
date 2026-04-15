'use client';

import { useEffect, useRef } from 'react';
import { MAX_SPEED, MIN_SPEED } from '@/lib/constants';

export interface SoundEngine {
  /** Must be called on first user gesture to resume AudioContext. */
  start: () => Promise<void>;
  playLaunch: () => void;
  playBounce: (speed: number) => void;
  playBallCollision: (speed: number) => void;
  updateHum: (speed: number) => void;
  playCrash: () => void;
  /** Dramatic full-screen shattering sound. */
  playShatter: () => void;
}

/**
 * Lazily initializes Tone.js synthesizers after the first user gesture.
 * Returns a ref so the animation loop can call sound methods without stale closures.
 */
export function useSoundEngine(): React.MutableRefObject<SoundEngine | null> {
  const engineRef = useRef<SoundEngine | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      // Dynamic import keeps Tone.js out of the SSR bundle
      const Tone = await import('tone');
      if (cancelled) return;

      // --- Launch: crisp membrane click ---
      const launchSynth = new Tone.MembraneSynth({
        pitchDecay: 0.015,
        octaves: 5,
        envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.1 },
      }).toDestination();
      launchSynth.volume.value = -4;

      // --- Bounce: short sine blip, pitch scales with speed ---
      const bounceSynth = new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.06 },
      }).toDestination();
      bounceSynth.volume.value = -16;

      // --- Ball collision click: short mechanical-style tick ---
      const collisionBodySynth = new Tone.Synth({
        oscillator: { type: 'square' },
        envelope: { attack: 0.0005, decay: 0.02, sustain: 0, release: 0.015 },
      }).toDestination();
      collisionBodySynth.volume.value = -12;

      const collisionSnapSynth = new Tone.Synth({
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.0005, decay: 0.01, sustain: 0, release: 0.01 },
      }).toDestination();
      collisionSnapSynth.volume.value = -18;

      // --- Velocity hum: continuous oscillator gated by gain ---
      const humGain = new Tone.Gain(0).toDestination();
      const humOsc = new Tone.Oscillator({ type: 'sine', frequency: 80 }).connect(humGain);

      // --- Crash: white noise burst ---
      const crashNoise = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.005, decay: 0.4, sustain: 0, release: 0.9 },
      }).toDestination();
      crashNoise.volume.value = -6;

      // --- Crash sub-tone: low rumble sweep ---
      const crashTone = new Tone.Synth({
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.01, decay: 0.5, sustain: 0, release: 1.0 },
      }).toDestination();
      crashTone.volume.value = -12;

      // --- Shatter: dramatic multi-layer glass break ---
      const shatterNoise = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 1.8, sustain: 0.05, release: 1.2 },
      }).toDestination();
      shatterNoise.volume.value = 2;

      const shatterHighFilter = new Tone.Filter({ frequency: 6000, type: 'highpass' }).toDestination();
      const shatterHigh = new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.6 },
      }).connect(shatterHighFilter);
      shatterHigh.volume.value = -4;

      const shatterSub = new Tone.Synth({
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.005, decay: 1.2, sustain: 0, release: 1.5 },
      }).toDestination();
      shatterSub.volume.value = -8;

      const engine: SoundEngine = {
        start: async () => {
          if (startedRef.current) return;
          await Tone.start();
          humOsc.start();
          startedRef.current = true;
        },

        playLaunch: () => {
          if (!startedRef.current) return;
          launchSynth.triggerAttackRelease('C3', '16n');
        },

        playBounce: (speed: number) => {
          if (!startedRef.current) return;
          const t = Math.min(1, speed / MAX_SPEED);
          const freq = 180 + t * 620; // 180 Hz slow → 800 Hz fast
          bounceSynth.triggerAttackRelease(freq, '32n');
        },

        playBallCollision: (speed: number) => {
          if (!startedRef.current) return;
          const t = Math.min(1, speed / MAX_SPEED);
          const bodyFreq = 900 + t * 700;
          const snapFreq = 2200 + t * 1200;
          const now = Tone.now();
          collisionBodySynth.triggerAttackRelease(bodyFreq, '128n', now);
          collisionSnapSynth.triggerAttackRelease(snapFreq, '256n', now + 0.008);
        },

        updateHum: (speed: number) => {
          if (!startedRef.current) return;
          const t = Math.max(0, (speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED));
          const targetFreq = 80 + t * 740; // 80 Hz → 820 Hz
          const targetGain = t * 0.18;
          humOsc.frequency.rampTo(targetFreq, 0.12);
          humGain.gain.rampTo(targetGain, 0.12);
        },

        playCrash: () => {
          if (!startedRef.current) return;
          crashNoise.triggerAttackRelease('8n');
          crashTone.triggerAttackRelease('A1', '4n');
          // Pitch sweep downward for dramatic effect
          crashTone.frequency.rampTo(30, 1.0);
        },

        playShatter: () => {
          if (!startedRef.current) return;
          // Main noise burst
          shatterNoise.triggerAttackRelease('4n');
          // High-frequency glass shimmer
          shatterHigh.triggerAttackRelease('16n');
          // Deep sub rumble sweeping down
          shatterSub.triggerAttackRelease('A0', '2n');
          shatterSub.frequency.rampTo(20, 2.0);
          // Additional crash layer for extra impact
          crashNoise.triggerAttackRelease('4n');
        },
      };

      engineRef.current = engine;
    };

    init();

    return () => {
      cancelled = true;
    };
  }, []);

  return engineRef;
}
