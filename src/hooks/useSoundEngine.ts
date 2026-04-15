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
      // Tone can quantize scheduled times to internal ticks/blocks under heavy event spam.
      // Keep a generous per-voice gap so retriggers are always strictly increasing.
      const MIN_TRIGGER_GAP = 0.02;
      const lastTriggerTimeByVoice: Record<string, number> = {};
      let lastBounceTriggerTime = -Infinity;
      const BOUNCE_MIN_INTERVAL = 0.012;
      const isStrictStartTimeError = (err: unknown): boolean => {
        if (!err) return false;
        if (err instanceof Error) {
          return err.message.includes('Start time must be strictly greater than previous start time');
        }
        return String(err).includes('Start time must be strictly greater than previous start time');
      };
      const runToneSafely = (fn: () => void): void => {
        try {
          fn();
        } catch (err) {
          if (isStrictStartTimeError(err)) {
            // Under heavy collision spam, Tone may still reject nearly-identical starts.
            // Ignore this single trigger instead of crashing the animation/runtime.
            return;
          }
          throw err;
        }
      };
      const getMonotonicStartTime = (voiceKey: string, requestedStartTime = Tone.now()): number => {
        const currentNow = Tone.now();
        const requested = Math.max(requestedStartTime, currentNow);
        const last = lastTriggerTimeByVoice[voiceKey];
        const safeStart =
          last === undefined || requested > last
            ? requested
            : last + MIN_TRIGGER_GAP;
        lastTriggerTimeByVoice[voiceKey] = safeStart;
        return safeStart;
      };

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

      let startPromise: Promise<void> | null = null;

      const engine: SoundEngine = {
        start: async () => {
          if (startedRef.current) return;
          if (startPromise) {
            await startPromise;
            return;
          }

          startPromise = (async () => {
            await Tone.start();
            if (!startedRef.current) {
              runToneSafely(() => {
                humOsc.start();
              });
              startedRef.current = true;
            }
          })();

          try {
            await startPromise;
          } finally {
            startPromise = null;
          }
        },

        playLaunch: () => {
          if (!startedRef.current) return;
          runToneSafely(() => {
            launchSynth.triggerAttackRelease('C3', '16n', getMonotonicStartTime('launchSynth'));
          });
        },

        playBounce: (speed: number) => {
          if (!startedRef.current) return;
          const now = Tone.now();
          if (now - lastBounceTriggerTime < BOUNCE_MIN_INTERVAL) return;
          const t = Math.min(1, speed / MAX_SPEED);
          const freq = 180 + t * 620; // 180 Hz slow → 800 Hz fast
          runToneSafely(() => {
            bounceSynth.triggerAttackRelease(freq, '32n', getMonotonicStartTime('bounceSynth', now));
          });
          lastBounceTriggerTime = now;
        },

        playBallCollision: (speed: number) => {
          if (!startedRef.current) return;
          const t = Math.min(1, speed / MAX_SPEED);
          const bodyFreq = 900 + t * 700;
          const snapFreq = 2200 + t * 1200;
          const now = Tone.now();
          runToneSafely(() => {
            collisionBodySynth.triggerAttackRelease(
              bodyFreq,
              '128n',
              getMonotonicStartTime('collisionBodySynth', now)
            );
            collisionSnapSynth.triggerAttackRelease(
              snapFreq,
              '256n',
              getMonotonicStartTime('collisionSnapSynth', now + 0.008)
            );
          });
        },

        updateHum: (speed: number) => {
          if (!startedRef.current) return;
          const t = Math.max(0, (speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED));
          const targetFreq = 80 + t * 740; // 80 Hz → 820 Hz
          const targetGain = t * 0.18;
          runToneSafely(() => {
            humOsc.frequency.rampTo(targetFreq, 0.12);
            humGain.gain.rampTo(targetGain, 0.12);
          });
        },

        playCrash: () => {
          if (!startedRef.current) return;
          const now = Tone.now();
          runToneSafely(() => {
            crashNoise.triggerAttackRelease('8n', getMonotonicStartTime('crashNoise', now));
            crashTone.triggerAttackRelease('A1', '4n', getMonotonicStartTime('crashTone', now + 0.005));
            // Pitch sweep downward for dramatic effect
            crashTone.frequency.rampTo(30, 1.0);
          });
        },

        playShatter: () => {
          if (!startedRef.current) return;
          const now = Tone.now();
          // Main noise burst
          runToneSafely(() => {
            shatterNoise.triggerAttackRelease('4n', getMonotonicStartTime('shatterNoise', now));
            // High-frequency glass shimmer
            shatterHigh.triggerAttackRelease(
              '16n',
              getMonotonicStartTime('shatterHigh', now + 0.004)
            );
            // Deep sub rumble sweeping down
            shatterSub.triggerAttackRelease(
              'A0',
              '2n',
              getMonotonicStartTime('shatterSub', now + 0.008)
            );
            shatterSub.frequency.rampTo(20, 2.0);
          });
          // Additional crash layer for extra impact
          runToneSafely(() => {
            crashNoise.triggerAttackRelease('4n', getMonotonicStartTime('crashNoise', now + 0.012));
          });
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
