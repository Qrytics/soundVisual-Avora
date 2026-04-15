export interface CrackSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  opacity: number;
}

export interface Crack {
  segments: CrackSegment[];
  originX: number;
  originY: number;
}

/**
 * Generate a crack network originating from (originX, originY).
 * Creates 3-5 main branches that recursively sub-branch with decreasing opacity.
 */
export function generateCrack(
  originX: number,
  originY: number,
  canvasWidth: number,
  canvasHeight: number
): Crack {
  const segments: CrackSegment[] = [];
  const numBranches = Math.floor(Math.random() * 3) + 3; // 3-5 main branches

  for (let i = 0; i < numBranches; i++) {
    const baseAngle = (Math.PI * 2 * i) / numBranches + (Math.random() - 0.5) * 0.9;
    generateBranch(
      originX,
      originY,
      baseAngle,
      1.0,
      0,
      4,
      segments,
      canvasWidth,
      canvasHeight
    );
  }

  return { segments, originX, originY };
}

function generateBranch(
  x: number,
  y: number,
  angle: number,
  opacity: number,
  depth: number,
  maxDepth: number,
  segments: CrackSegment[],
  canvasWidth: number,
  canvasHeight: number
): void {
  if (depth >= maxDepth || opacity < 0.05) return;

  const lengthScale = 1 - depth / maxDepth;
  const length = (Math.random() * 80 + 40) * lengthScale;
  const jitter = (Math.random() - 0.5) * 0.5;
  const actualAngle = angle + jitter;

  const x2 = x + Math.cos(actualAngle) * length;
  const y2 = y + Math.sin(actualAngle) * length;

  segments.push({ x1: x, y1: y, x2, y2, opacity });

  // 1-2 sub-branches from endpoint
  const numSubs = depth < 2 ? Math.floor(Math.random() * 2) + 1 : 1;
  for (let i = 0; i < numSubs; i++) {
    const subAngle = actualAngle + (Math.random() - 0.5) * 1.3;
    generateBranch(
      x2,
      y2,
      subAngle,
      opacity * 0.65,
      depth + 1,
      maxDepth,
      segments,
      canvasWidth,
      canvasHeight
    );
  }
}

/**
 * Draw a list of cracks onto the given canvas context.
 * At extreme speed, cracks glow orange/red.
 */
export function drawCracks(
  ctx: CanvasRenderingContext2D,
  cracks: Crack[],
  speed: number
): void {
  const isExtreme = speed > 35;

  ctx.save();
  for (const crack of cracks) {
    for (const seg of crack.segments) {
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);

      if (isExtreme) {
        ctx.strokeStyle = `rgba(255, 90, 20, ${seg.opacity * 0.95})`;
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(255, 80, 0, 0.8)';
      } else {
        ctx.strokeStyle = `rgba(210, 210, 230, ${seg.opacity * 0.85})`;
        ctx.shadowBlur = 4;
        ctx.shadowColor = 'rgba(180, 190, 255, 0.6)';
      }

      ctx.lineWidth = Math.max(0.5, seg.opacity * 1.8);
      ctx.stroke();
    }
  }
  ctx.shadowBlur = 0;
  ctx.restore();
}
