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
  AUTO_RELAUNCH_VOLUME_MULTIPLIER,
  LAUNCH_SPEED,
  MAX_CRACKS,
  BOUNCE_ANGLE_JITTER,
  INTERIOR_CRACK_START_FRACTION,
  INTERIOR_CRACK_MAX_INTERVAL,
  INTERIOR_CRACK_INTERVAL_RANGE,
  TRAIL_STEP_PX,
  TRAIL_MAX_STEPS,
  BALL_COLLISION_SOUND_THROTTLE_MS,
  GAMES_DEPLOYMENT_BASE_PATH,
  BALL_COLLISION_RESTITUTION,
  COLLISION_EPSILON,
} from '@/lib/constants';

// ─── Ball type ────────────────────────────────────────────────────────────────
interface Ball {
  // Balls are simulated as equal-mass circles for pairwise collision response.
  pos: { x: number; y: number };
  prevPos: { x: number; y: number };
  vel: { dx: number; dy: number };
  speed: number;
  state: 'idle' | 'moving' | 'critical';
}

function createBall(x: number, y: number): Ball {
  return {
    pos: { x, y },
    prevPos: { x, y },
    vel: { dx: 0, dy: 0 },
    speed: 0,
    state: 'idle',
  };
}

function launchBall(ball: Ball, angle?: number): void {
  const a = angle ?? Math.random() * Math.PI * 2;
  ball.vel = { dx: Math.cos(a) * LAUNCH_SPEED, dy: Math.sin(a) * LAUNCH_SPEED };
  ball.speed = LAUNCH_SPEED;
  ball.state = 'moving';
}

function applySpeedAndState(ball: Ball): void {
  let speed = Math.sqrt(ball.vel.dx ** 2 + ball.vel.dy ** 2);
  if (speed > MAX_SPEED) {
    const scale = MAX_SPEED / speed;
    ball.vel.dx *= scale;
    ball.vel.dy *= scale;
    speed = MAX_SPEED;
  }
  ball.speed = speed;

  if (speed < STOP_THRESHOLD) {
    ball.state = 'idle';
    ball.vel = { dx: 0, dy: 0 };
    ball.speed = 0;
  } else if (ball.state === 'idle') {
    ball.state = 'moving';
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function CanvasScene() {
  // Canvas refs
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const crackCanvasRef = useRef<HTMLCanvasElement>(null);

  // UI state
  const [hasLaunched, setHasLaunched] = useState(false);
  const [showSilentOverlay, setShowSilentOverlay] = useState(false);
  const showBackToGames = process.env.NEXT_PUBLIC_BASE_PATH === GAMES_DEPLOYMENT_BASE_PATH;

  // Ball state (array to support multiple balls after shatter resets)
  const ballsRef = useRef<Ball[]>([]);
  const ballCountRef = useRef(1);
  const hasLaunchedRef = useRef(false);

  // Visual refs
  const cracksRef = useRef<Crack[]>([]);
  const flashRef = useRef(0);
  const fullBreakRef = useRef(false);
  const shakeRef = useRef({ x: 0, y: 0, endTime: 0 });

  // Shatter sequence
  const shatterPhaseRef = useRef<'none' | 'shattering'>('none');
  const shatterStartRef = useRef(0);

  // Silence detection refs
  const silenceStartRef = useRef<number | null>(null);
  const silentOverlayActiveRef = useRef(false);

  // Throttle refs
  const lastCrashTimeRef = useRef(0);
  const lastBallCollisionSoundTimeRef = useRef(0);
  const lastInteriorCrackTimeRef = useRef(0);
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

    // Initialise first ball when nothing has launched yet
    if (!hasLaunchedRef.current) {
      if (ballsRef.current.length === 0) {
        ballsRef.current = [createBall(w / 2, h / 2)];
      } else {
        // Keep ball centred while idle on resize
        ballsRef.current.forEach((b) => {
          b.pos = { x: w / 2, y: h / 2 };
          b.prevPos = { x: w / 2, y: h / 2 };
        });
      }
    }
  }, []);

  // ─── Click handler ───────────────────────────────────────────────────────────
  const handleClick = useCallback(() => {
    const engine = soundEngineRef.current;

    if (!hasLaunchedRef.current) {
      // First launch: start audio context and fire
      if (engine) {
        engine.start().then(() => engine.playLaunch());
      }

      const w = mainCanvasRef.current?.width ?? window.innerWidth;
      const h = mainCanvasRef.current?.height ?? window.innerHeight;
      if (ballsRef.current.length === 0) {
        ballsRef.current = [createBall(w / 2, h / 2)];
      }

      ballsRef.current.forEach((ball, i) => {
        const angle = (Math.PI * 2 * i) / ballsRef.current.length + Math.random() * 0.3;
        launchBall(ball, angle);
      });

      hasLaunchedRef.current = true;
      setHasLaunched(true);
      silenceStartRef.current = null;
      silentOverlayActiveRef.current = false;
      setShowSilentOverlay(false);
    } else {
      // Re-launch any stopped balls on click (alternative to mic auto-relaunch)
      let launched = false;
      ballsRef.current.forEach((ball) => {
        if (ball.state === 'idle') {
          launchBall(ball);
          launched = true;
        }
      });
      if (launched) {
        engine?.playLaunch();
        silentOverlayActiveRef.current = false;
        setShowSilentOverlay(false);
      }
    }
  }, [soundEngineRef]);

  // ─── Animation loop ───────────────────────────────────────────────────────────
  useEffect(() => {
    const mainCanvas = mainCanvasRef.current;
    const crackCanvas = crackCanvasRef.current;
    if (!mainCanvas || !crackCanvas) return;

    resizeCanvases();

    const ctx = mainCanvas.getContext('2d')!;
    const crackCtx = crackCanvas.getContext('2d')!;

    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);

    const animate = () => {
      const w = mainCanvas.width;
      const h = mainCanvas.height;
      const volume = volumeRef.current;
      const now = Date.now();

      // ── Shatter sequence (early-exit branch) ──────────────────────────────────
      if (shatterPhaseRef.current === 'shattering') {
        const elapsed = now - shatterStartRef.current;
        const progress = Math.min(1, elapsed / 2000);

        if (progress < 0.25) {
          // Rapid white flash
          const flashAlpha = Math.sin((progress / 0.25) * Math.PI);
          ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha * 0.97})`;
          ctx.fillRect(0, 0, w, h);
        } else if (progress < 0.65) {
          // Solid white — cracks visible through screen blend
          ctx.fillStyle = 'rgba(255, 255, 255, 0.97)';
          ctx.fillRect(0, 0, w, h);
        } else {
          // Fade to black
          const fade = (progress - 0.65) / 0.35;
          ctx.fillStyle = `rgba(5, 5, 8, ${fade * 0.97})`;
          ctx.fillRect(0, 0, w, h);
        }

        if (progress >= 1) {
          // ── Reset and add one more ball ──────────────────────────────────────
          shatterPhaseRef.current = 'none';
          ballCountRef.current += 1;
          const newCount = ballCountRef.current;

          cracksRef.current = [];
          crackCtx.clearRect(0, 0, w, h);
          fullBreakRef.current = false;
          flashRef.current = 0;

          ballsRef.current = [];
          for (let i = 0; i < newCount; i++) {
            const ball = createBall(w / 2, h / 2);
            const angle = (Math.PI * 2 * i) / newCount + (Math.random() - 0.5) * 0.4;
            launchBall(ball, angle);
            ballsRef.current.push(ball);
          }

          ctx.fillStyle = '#050508';
          ctx.fillRect(0, 0, w, h);
          silenceStartRef.current = null;
        }

        rafRef.current = requestAnimationFrame(animate);
        return;
      }

      // ── Physics ──────────────────────────────────────────────────────────────
      let maxSpeed = 0;

      for (const ball of ballsRef.current) {
        if (
          !Number.isFinite(ball.pos.x) ||
          !Number.isFinite(ball.pos.y) ||
          !Number.isFinite(ball.vel.dx) ||
          !Number.isFinite(ball.vel.dy) ||
          !Number.isFinite(ball.speed)
        ) {
          ball.pos = { x: w / 2, y: h / 2 };
          ball.prevPos = { x: w / 2, y: h / 2 };
          ball.vel = { dx: 0, dy: 0 };
          ball.speed = 0;
          ball.state = 'idle';
          continue;
        }

        // ── Auto-relaunch idle ball when mic detects volume ─────────────────
        if (ball.state === 'idle') {
          if (hasLaunchedRef.current && volume > SILENCE_VOLUME_THRESHOLD * AUTO_RELAUNCH_VOLUME_MULTIPLIER) {
            launchBall(ball);
            soundEngineRef.current?.playLaunch();
            silentOverlayActiveRef.current = false;
            setShowSilentOverlay(false);
          }
          continue;
        }

        // Save previous position for smooth trail rendering
        ball.prevPos = { ...ball.pos };

        // Audio acceleration in current direction
        if (volume > SILENCE_VOLUME_THRESHOLD && ball.speed > 0) {
          const boost = volume * MAX_BOOST;
          const invSpd = 1 / ball.speed;
          ball.vel.dx += ball.vel.dx * invSpd * boost;
          ball.vel.dy += ball.vel.dy * invSpd * boost;
        }

        // Friction decay
        ball.vel.dx *= FRICTION;
        ball.vel.dy *= FRICTION;

        // Recalculate speed and cap
        let newSpeed = Math.sqrt(ball.vel.dx ** 2 + ball.vel.dy ** 2);
        if (newSpeed > MAX_SPEED) {
          const scale = MAX_SPEED / newSpeed;
          ball.vel.dx *= scale;
          ball.vel.dy *= scale;
          newSpeed = MAX_SPEED;
        }
        ball.speed = newSpeed;

        // Move
        ball.pos.x += ball.vel.dx;
        ball.pos.y += ball.vel.dy;

        // ── Bounce detection ────────────────────────────────────────────────
        let bounced = false;
        let hitX: -1 | 0 | 1 = 0;
        let hitY: -1 | 0 | 1 = 0;
        let bounceX = ball.pos.x;
        let bounceY = ball.pos.y;

        if (ball.pos.x - BALL_RADIUS <= 0) {
          ball.pos.x = BALL_RADIUS;
          ball.vel.dx = Math.abs(ball.vel.dx);
          hitX = -1;
          bounceX = 0;
          bounced = true;
        } else if (ball.pos.x + BALL_RADIUS >= w) {
          ball.pos.x = w - BALL_RADIUS;
          ball.vel.dx = -Math.abs(ball.vel.dx);
          hitX = 1;
          bounceX = w;
          bounced = true;
        }

        if (ball.pos.y - BALL_RADIUS <= 0) {
          ball.pos.y = BALL_RADIUS;
          ball.vel.dy = Math.abs(ball.vel.dy);
          hitY = -1;
          bounceY = 0;
          bounced = true;
        } else if (ball.pos.y + BALL_RADIUS >= h) {
          ball.pos.y = h - BALL_RADIUS;
          ball.vel.dy = -Math.abs(ball.vel.dy);
          hitY = 1;
          bounceY = h;
          bounced = true;
        }

        if (bounced) {
          // Small random angle jitter so the ball doesn't loop on the same path
          if (ball.speed > 0) {
            const jitter = (Math.random() - 0.5) * BOUNCE_ANGLE_JITTER * 2;
            const cos = Math.cos(jitter);
            const sin = Math.sin(jitter);
            const newDx = ball.vel.dx * cos - ball.vel.dy * sin;
            const newDy = ball.vel.dx * sin + ball.vel.dy * cos;
            ball.vel.dx = newDx;
            ball.vel.dy = newDy;
          }

          // Keep post-jitter velocity pointed away from any wall hit this frame.
          if (hitX === -1) {
            ball.vel.dx = Math.abs(ball.vel.dx);
          } else if (hitX === 1) {
            ball.vel.dx = -Math.abs(ball.vel.dx);
          }
          if (hitY === -1) {
            ball.vel.dy = Math.abs(ball.vel.dy);
          } else if (hitY === 1) {
            ball.vel.dy = -Math.abs(ball.vel.dy);
          }

          soundEngineRef.current?.playBounce(ball.speed);

          if (ball.speed > CRITICAL_THRESHOLD) {
            ball.state = 'critical';

            if (!fullBreakRef.current) {
              // Edge crack at impact point
              const edgeCrack = generateCrack(bounceX, bounceY, w, h, 'edge');
              cracksRef.current.push(edgeCrack);
              drawCracks(crackCtx, [edgeCrack], ball.speed);

              // 50% chance of a simultaneous interior crack
              if (Math.random() < 0.5) {
                const ix = BALL_RADIUS * 3 + Math.random() * (w - BALL_RADIUS * 6);
                const iy = BALL_RADIUS * 3 + Math.random() * (h - BALL_RADIUS * 6);
                const intCrack = generateCrack(ix, iy, w, h, 'interior');
                cracksRef.current.push(intCrack);
                drawCracks(crackCtx, [intCrack], ball.speed);
              }
            }

            // Screen shake
            shakeRef.current = {
              x: (Math.random() - 0.5) * 16,
              y: (Math.random() - 0.5) * 16,
              endTime: now + 130,
            };

            // Crash sound (throttled)
            if (now - lastCrashTimeRef.current > 1500) {
              soundEngineRef.current?.playCrash();
              lastCrashTimeRef.current = now;
            }

            // Check edge-crack count for shatter trigger
            const edgeCount = cracksRef.current.filter((c) => c.type === 'edge').length;
            if (!fullBreakRef.current && edgeCount >= MAX_CRACKS) {
              fullBreakRef.current = true;
              flashRef.current = 6;
              shatterPhaseRef.current = 'shattering';
              shatterStartRef.current = now;
              soundEngineRef.current?.playShatter();
            }
          } else {
            ball.state = 'moving';
          }
        }

        // Ball stopped
        if (ball.speed < STOP_THRESHOLD) {
          ball.state = 'idle';
          ball.vel = { dx: 0, dy: 0 };
          ball.speed = 0;
        }

        maxSpeed = Math.max(maxSpeed, ball.speed);
      }

      // ── Ball-to-ball collisions ──────────────────────────────────────────────
      let maxCollisionImpact = 0;
      for (let i = 0; i < ballsRef.current.length; i++) {
        for (let j = i + 1; j < ballsRef.current.length; j++) {
          const a = ballsRef.current[i];
          const b = ballsRef.current[j];
          const minDist = BALL_RADIUS * 2;
          const dx = b.pos.x - a.pos.x;
          const dy = b.pos.y - a.pos.y;
          const distSq = dx * dx + dy * dy;
          if (distSq >= minDist * minDist) continue;

          let nx = 0;
          let ny = 0;
          let dist = Math.sqrt(distSq);
          if (dist > COLLISION_EPSILON) {
            nx = dx / dist;
            ny = dy / dist;
          } else {
            const rvx = b.vel.dx - a.vel.dx;
            const rvy = b.vel.dy - a.vel.dy;
            const rvMag = Math.sqrt(rvx * rvx + rvy * rvy);
            if (rvMag > COLLISION_EPSILON) {
              nx = rvx / rvMag;
              ny = rvy / rvMag;
            } else {
              const angle = Math.random() * Math.PI * 2;
              nx = Math.cos(angle);
              ny = Math.sin(angle);
            }
            dist = 0;
          }

          const overlap = minDist - dist;
          if (overlap > 0) {
            const half = overlap * 0.5;
            a.pos.x -= nx * half;
            a.pos.y -= ny * half;
            b.pos.x += nx * half;
            b.pos.y += ny * half;
          }

          const rvx = b.vel.dx - a.vel.dx;
          const rvy = b.vel.dy - a.vel.dy;
          const velAlongNormal = rvx * nx + rvy * ny;
          if (velAlongNormal < 0) {
            const impulse = -(1 + BALL_COLLISION_RESTITUTION) * velAlongNormal * 0.5;
            const ix = impulse * nx;
            const iy = impulse * ny;
            a.vel.dx -= ix;
            a.vel.dy -= iy;
            b.vel.dx += ix;
            b.vel.dy += iy;
            maxCollisionImpact = Math.max(maxCollisionImpact, impulse);
            applySpeedAndState(a);
            applySpeedAndState(b);
          }
        }
      }

      if (
        maxCollisionImpact > 0 &&
        now - lastBallCollisionSoundTimeRef.current > BALL_COLLISION_SOUND_THROTTLE_MS
      ) {
        soundEngineRef.current?.playBallCollision(maxCollisionImpact);
        lastBallCollisionSoundTimeRef.current = now;
      }

      // Recompute from final post-collision velocities so hum reflects the actual frame result.
      maxSpeed = 0;
      for (const ball of ballsRef.current) {
        maxSpeed = Math.max(maxSpeed, ball.speed);
      }

      // Update hum with the fastest ball's speed
      soundEngineRef.current?.updateHum(maxSpeed);

      // ── Periodic interior cracks (gradual spread across screen) ─────────────
      const edgeCount = cracksRef.current.filter((c) => c.type === 'edge').length;
      if (
        hasLaunchedRef.current &&
        !fullBreakRef.current &&
        edgeCount >= Math.floor(MAX_CRACKS * INTERIOR_CRACK_START_FRACTION) &&
        maxSpeed > 0
      ) {
        // Interval shrinks as more cracks accumulate (3s → 0.8s)
        const ratio = edgeCount / MAX_CRACKS;
        const interval = INTERIOR_CRACK_MAX_INTERVAL - ratio * INTERIOR_CRACK_INTERVAL_RANGE;
        if (now - lastInteriorCrackTimeRef.current > interval) {
          const ix = BALL_RADIUS * 3 + Math.random() * (w - BALL_RADIUS * 6);
          const iy = BALL_RADIUS * 3 + Math.random() * (h - BALL_RADIUS * 6);
          const intCrack = generateCrack(ix, iy, w, h, 'interior');
          cracksRef.current.push(intCrack);
          drawCracks(crackCtx, [intCrack], CRITICAL_THRESHOLD);
          lastInteriorCrackTimeRef.current = now;
        }
      }

      // ── Silence detection ────────────────────────────────────────────────────
      if (hasLaunchedRef.current) {
        const allIdle = ballsRef.current.every((b) => b.state === 'idle');
        const isSilentNow = volume < SILENCE_VOLUME_THRESHOLD && allIdle;

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

      // ── Draw ─────────────────────────────────────────────────────────────────
      const t = Math.min(1, maxSpeed / MAX_SPEED);

      // Ghost-clear: lower alpha = longer trail at high speed
      const trailAlpha = 0.35 - t * 0.31;
      ctx.fillStyle = `rgba(5, 5, 8, ${trailAlpha})`;
      ctx.fillRect(0, 0, w, h);

      // White flash on critical impact
      if (flashRef.current > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${(flashRef.current / 6) * 0.9})`;
        ctx.fillRect(0, 0, w, h);
        flashRef.current = Math.max(0, flashRef.current - 1);
      }

      const shaking = now < shakeRef.current.endTime;
      if (shaking) {
        ctx.save();
        ctx.translate(shakeRef.current.x, shakeRef.current.y);
      }

      // Draw each ball
      for (const ball of ballsRef.current) {
        const bt = Math.min(1, ball.speed / MAX_SPEED);
        const glowSize = 10 + bt * 52;
        const glowColor =
          bt > 0.6 ? 'rgba(255, 120, 50, 0.9)' : 'rgba(200, 225, 255, 0.9)';

        // ── Smooth motion trail ───────────────────────────────────────────────
        if (ball.state !== 'idle' && ball.speed > MIN_SPEED) {
          const dx = ball.pos.x - ball.prevPos.x;
          const dy = ball.pos.y - ball.prevPos.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const steps = Math.min(Math.ceil(dist / TRAIL_STEP_PX), TRAIL_MAX_STEPS);

          for (let i = 1; i < steps; i++) {
            const f = i / steps;
            const tx = ball.prevPos.x + dx * f;
            const ty = ball.prevPos.y + dy * f;
            const alpha = f * 0.28 * bt;
            const radius = BALL_RADIUS * (0.35 + f * 0.65);
            ctx.beginPath();
            ctx.arc(tx, ty, radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(200, 200, 210, ${alpha})`;
            ctx.fill();
          }
        }

        // Draw ball with glow
        ctx.shadowBlur = glowSize;
        ctx.shadowColor = glowColor;
        ctx.beginPath();
        ctx.arc(ball.pos.x, ball.pos.y, BALL_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200, 200, 210, 1)';
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      if (shaking) {
        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

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
      {showBackToGames && (
        <a
          href="https://mario-belmonte.com/games"
          className="absolute top-4 left-4 z-20 px-3 py-1.5 border border-white/25 text-white/90 text-xs tracking-wide uppercase bg-black/35 hover:bg-black/55 transition-colors"
        >
          Back to Games
        </a>
      )}

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
