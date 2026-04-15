'use client';

import { useEffect, useRef, useState } from 'react';

export interface MicVolumeResult {
  volumeRef: React.MutableRefObject<number>;
  permitted: boolean;
  error: string | null;
}

/**
 * Hook that streams real-time microphone volume as a normalized [0, 1] value.
 * Volume is updated continuously and accessible via volumeRef for use in animation loops
 * without triggering React re-renders.
 */
export function useMicVolume(): MicVolumeResult {
  const volumeRef = useRef<number>(0);
  const [permitted, setPermitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let rafId: number | null = null;
    let audioCtx: AudioContext | null = null;
    let stream: MediaStream | null = null;

    const init = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.fftSize);
        setPermitted(true);

        const tick = () => {
          analyser.getByteTimeDomainData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const sample = (dataArray[i] - 128) / 128;
            sum += sample * sample;
          }
          const rms = Math.sqrt(sum / dataArray.length);
          // Amplify slightly so normal speech registers well
          volumeRef.current = Math.min(1, rms * 5);
          rafId = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Microphone access denied or unavailable.'
        );
      }
    };

    init();

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
      audioCtx?.close();
    };
  }, []);

  return { volumeRef, permitted, error };
}
