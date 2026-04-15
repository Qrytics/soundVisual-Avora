'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { useMicVolume } from '@/hooks/useMicVolume';
import { useSoundEngine } from '@/hooks/useSoundEngine';
import { generateCrack, drawCracks, Crack } from '@/lib/crackRenderer';
import {
  FRICTION,
  MAX_BOOST,
  MAX_SPEED,
  MIN_SPEED,
  STOP_THRESHOLD,
  CRITICAL_THRESHOLD,
  BALL_RADIUS,
  SILENCE_TIMEOUT,
  SILENCE_VOLUME_THRESHOLD,
  LAUNCH_SPEED,
  MAX_CRACKS,
} from '@/lib/constants';

export default function CanvasScene() {
  // Canvas refs
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const crackCanvasRef = useRef<HTMLCanvasElement>(null);

  // UI state (triggers React re-renders only when these actually change)
  const [hasLaunched, setHasLaunched] = useState(false);
  const [showSilentOverlay, setShowSilentOverlay] = useState(false);

  // Physics refs (never trigger re-renders — updated inside rAF loop)
  const posRef = useRef({ x: 0, y: 0 });
  const velRef = useRef({ dx: 0, dy: 0 });
  const speedRef = useRef(0);
  const stateRef = useRef<'idle' | 'moving' | 'critical'>('idle');
  const hasLaunchedRef = useRef(false);

  // Visual refs
  const cracksRef = useRef<Crack[]>([]);
  const flashRef = useRef(0);
  const fullBreakRef = useRef(false);
  const shakeRef = useRef({ x: 0, y: 0, endTime: 0 });

  // Silence detection refs
  const silenceStartRef = useRef<number | null>(null);
  const silentOverlayActiveRef = useRef(false);

  // Throttle refs
  const lastCrashTimeRef = useRef(0);
  const rafRef = useRef<number>(0);

  const { volumeRef, error } = useMicVolume();
  const soundEngineRef = useSoundEngine();

  // ─── Canvas resize ───────────────────────────────────────────────────────────
  const resizeCanvases = useCallback(() => {
    const main = mainCanvasRef.current;
    const crack = crackCanvasRef.current;
    if (!main || !crack) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    main.width = w;
    main.height = h;
    crack.width = w;
    crack.height = h;

    // Re-centre ball only when it hasn't launched yet
    if (!hasLaunchedRef.current) {
      posRef.current = { x: w / 2, y: h / 2 };
    }
  }, []);

  // ─── Launch on click ─────────────────────────────────────────────────────────
  const handleClick = useCallback(() => {
    if (stateRef.current !== 'idle') return;

    const engine = soundEngineRef.current;
    if (engine) {
      engine.start().then(() => {
        engine.playLaunch();
      });
    }

    const angle = Math.random() * Math.PI * 2;
    velRef.current = {
      dx: Math.cos(angle) * LAUNCH_SPEED,
      dy: Math.sin(angle) * LAUNCH_SPEED,
    };
    speedRef.current = LAUNCH_SPEED;
    stateRef.current = 'moving';
    hasLaunchedRef.current = true;
    setHasLaunched(true);

    // Dismiss silence overlay on launch
    silenceStartRef.current = null;
    silentOverlayActiveRef.current = false;
    setShowSilentOverlay(false);
  }, [soundEngineRef]);

  // ─── Animation loop ───────────────────────────────────────────────────────────
  useEffect(() => {
    const mainCanvas = mainCanvasRef.current;
    const crackCanvas = crackCanvasRef.current;
    if (!mainCanvas || !crackCanvas) return;

    resizeCanvases();

    const ctx = mainCanvas.getContext('2d')!;
    const crackCtx = crackCanvas.getContext('2d')!;

    // Paint initial background
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);

    const animate = () => {
      const w = mainCanvas.width;
      const h = mainCanvas.height;
      const volume = volumeRef.current;
      const now = Date.now();

      // ── Physics ─────────────────────────────────────────────────────────────
      if (stateRef.current !== 'idle') {
        const spd = speedRef.current;

        // Audio acceleration: boost in current direction
        if (volume > SILENCE_VOLUME_THRESHOLD && spd > 0) {
          const boost = volume * MAX_BOOST;
          const invSpd = 1 / spd;
          velRef.current.dx += velRef.current.dx * invSpd * boost;
          velRef.current.dy += velRef.current.dy * invSpd * boost;
        }

        // Friction decay
        velRef.current.dx *= FRICTION;
        velRef.current.dy *= FRICTION;

        // Recalculate speed and cap
        let newSpeed = Math.sqrt(velRef.current.dx ** 2 + velRef.current.dy ** 2);
        if (newSpeed > MAX_SPEED) {
          const scale = MAX_SPEED / newSpeed;
          velRef.current.dx *= scale;
          velRef.current.dy *= scale;
          newSpeed = MAX_SPEED;
        }
        speedRef.current = newSpeed;

        // Move
        posRef.current.x += velRef.current.dx;
        posRef.current.y += velRef.current.dy;

        // ── Bounce detection ──────────────────────────────────────────────────
        let bounced = false;
        let bounceX = posRef.current.x;
        let bounceY = posRef.current.y;

        if (posRef.current.x - BALL_RADIUS <= 0) {
          posRef.current.x = BALL_RADIUS;
          velRef.current.dx = Math.abs(velRef.current.dx);
          bounceX = 0;
          bounced = true;
        } else if (posRef.current.x + BALL_RADIUS >= w) {
          posRef.current.x = w - BALL_RADIUS;
          velRef.current.dx = -Math.abs(velRef.current.dx);
          bounceX = w;
          bounced = true;
        }

        if (posRef.current.y - BALL_RADIUS <= 0) {
          posRef.current.y = BALL_RADIUS;
          velRef.current.dy = Math.abs(velRef.current.dy);
          bounceY = 0;
          bounced = true;
        } else if (posRef.current.y + BALL_RADIUS >= h) {
          posRef.current.y = h - BALL_RADIUS;
          velRef.current.dy = -Math.abs(velRef.current.dy);
          bounceY = h;
          bounced = true;
        }

        if (bounced) {
          soundEngineRef.current?.playBounce(speedRef.current);

          if (speedRef.current > CRITICAL_THRESHOLD) {
            stateRef.current = 'critical';

            // Spawn crack on persistent layer
            if (!fullBreakRef.current) {
              const crack = generateCrack(bounceX, bounceY, w, h);
              cracksRef.current.push(crack);
              drawCracks(crackCtx, [crack], speedRef.current);
            }

            // Screen shake
            shakeRef.current = {
              x: (Math.random() - 0.5) * 16,
              y: (Math.random() - 0.5) * 16,
              endTime: now + 130,
            };

            // Crash sound (throttled to avoid overlapping)
            if (now - lastCrashTimeRef.current > 1500) {
              soundEngineRef.current?.playCrash();
              lastCrashTimeRef.current = now;
            }

            // Full-break trigger
            if (!fullBreakRef.current && cracksRef.current.length >= MAX_CRACKS) {
              fullBreakRef.current = true;
              flashRef.current = 6;
              soundEngineRef.current?.playCrash();
            }
          } else {
            stateRef.current = 'moving';
          }
        }

        // Update continuous hum
        soundEngineRef.current?.updateHum(speedRef.current);

        // Ball stopped
        if (speedRef.current < STOP_THRESHOLD) {
          stateRef.current = 'idle';
          velRef.current = { dx: 0, dy: 0 };
          speedRef.current = 0;
          soundEngineRef.current?.updateHum(0);
        }

        // ── Silence detection ─────────────────────────────────────────────────
        if (hasLaunchedRef.current) {
          const isSilentNow =
            volume < SILENCE_VOLUME_THRESHOLD && speedRef.current < MIN_SPEED;

          if (isSilentNow) {
            if (silenceStartRef.current === null) {
              silenceStartRef.current = now;
            } else if (now - silenceStartRef.current > SILENCE_TIMEOUT) {
              if (!silentOverlayActiveRef.current) {
                silentOverlayActiveRef.current = true;
                setShowSilentOverlay(true);
              }
            }
          } else {
            silenceStartRef.current = null;
            if (silentOverlayActiveRef.current) {
              silentOverlayActiveRef.current = false;
              setShowSilentOverlay(false);
            }
          }
        }
      }

      // ── Draw ──────────────────────────────────────────────────────────────────
      const t = Math.min(1, speedRef.current / MAX_SPEED);

      // Ghost-clear: opacity maps speed → trail length
      const trailAlpha = 0.35 - t * 0.31; // 0.35 (short) → 0.04 (long)
      ctx.fillStyle = `rgba(5, 5, 8, ${trailAlpha})`;
      ctx.fillRect(0, 0, w, h);

      // White flash on full-break
      if (flashRef.current > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${(flashRef.current / 6) * 0.9})`;
        ctx.fillRect(0, 0, w, h);
        flashRef.current = Math.max(0, flashRef.current - 1);
      }

      // Apply screen shake via context translation
      const shaking = now < shakeRef.current.endTime;
      if (shaking) {
        ctx.save();
        ctx.translate(shakeRef.current.x, shakeRef.current.y);
      }

      // Draw ball with glow
      const glowSize = 10 + t * 52;
      const glowColor =
        t > 0.6 ? 'rgba(255, 120, 50, 0.9)' : 'rgba(200, 225, 255, 0.9)';

      ctx.shadowBlur = glowSize;
      ctx.shadowColor = glowColor;
      ctx.beginPath();
      ctx.arc(posRef.current.x, posRef.current.y, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(200, 200, 210, 1)';
      ctx.fill();
      ctx.shadowBlur = 0;

      if (shaking) {
        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    // Resize handling
    const handleResize = () => resizeCanvases();
    window.addEventListener('resize', handleResize);
    const ro = new ResizeObserver(handleResize);
    ro.observe(document.documentElement);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', handleResize);
      ro.disconnect();
    };
  }, [volumeRef, soundEngineRef, resizeCanvases]);

  // ─── Render ───────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="fixed inset-0 bg-[#050508] flex items-center justify-center">
        <div className="text-center text-white px-6">
          <p className="text-xl mb-3 font-light">Microphone access required</p>
          <p className="text-sm text-gray-500 max-w-xs">{error}</p>
          <p className="text-xs text-gray-600 mt-4">
            Please allow microphone access in your browser settings and reload.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#050508]">
      {/* Main drawing canvas */}
      <canvas
        ref={mainCanvasRef}
        className="absolute inset-0 cursor-pointer"
        onClick={handleClick}
      />

      {/* Persistent crack overlay (screen blend for additive glow) */}
      <canvas
        ref={crackCanvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ mixBlendMode: 'screen', opacity: 0.9 }}
      />

      {/* Silence / mic overlay */}
      {showSilentOverlay && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="mic-pulse">
            <Mic size={64} className="text-gray-400" />
          </div>
        </div>
      )}

      {/* Pre-launch hint */}
      {!hasLaunched && (
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-14 pointer-events-none z-10 gap-2">
          <p className="text-gray-500 text-xs tracking-[0.35em] uppercase animate-pulse select-none">
            click anywhere to launch
          </p>
          <p className="text-gray-700 text-[10px] tracking-widest uppercase select-none">
            then use your voice to fuel the ball
          </p>
        </div>
      )}
    </div>
  );
}
