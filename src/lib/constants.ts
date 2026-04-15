// Physics
export const FRICTION = 0.993;
export const MAX_BOOST = 1.5;
export const MAX_SPEED = 80;
export const MIN_SPEED = 0.5;
export const STOP_THRESHOLD = 0.1;
export const LAUNCH_SPEED = 8;
export const BALL_RADIUS = 18;
export const BOUNCE_ANGLE_JITTER = 0.25; // radians, adds variability so ball doesn't loop forever

// Crack system
export const CRITICAL_THRESHOLD = 22;
export const MAX_CRACKS = 20; // edge cracks before full shatter
/** Interior cracks begin spawning once this fraction of MAX_CRACKS edge cracks exist. */
export const INTERIOR_CRACK_START_FRACTION = 0.25;
/** Maximum interval (ms) between periodic interior crack spawns. */
export const INTERIOR_CRACK_MAX_INTERVAL = 3000;
/** Range subtracted from the interval as cracks accumulate (makes spawning accelerate). */
export const INTERIOR_CRACK_INTERVAL_RANGE = 2200;

// Motion trail
/** Minimum pixel spacing between ghost circles along the motion trail. */
export const TRAIL_STEP_PX = 3;
/** Maximum number of ghost circles drawn per frame for the motion trail. */
export const TRAIL_MAX_STEPS = 24;
/** Minimum interval between ball-vs-ball collision click sounds. */
export const BALL_COLLISION_SOUND_THROTTLE_MS = 40;

// Silence detection
export const SILENCE_TIMEOUT = 1500;
export const SILENCE_VOLUME_THRESHOLD = 0.05;
/** Volume multiplier above SILENCE_VOLUME_THRESHOLD required to auto-relaunch a stopped ball. */
export const AUTO_RELAUNCH_VOLUME_MULTIPLIER = 2.5;
