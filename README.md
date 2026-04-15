# soundVisual — Avora

> **Audio-Reactive Kinetic Ball** — An interactive audio-visual experiment where a bouncing ball is fuelled entirely by your voice. The louder you are, the faster it goes, until the screen shatters.

Built for the [Avora creative challenge](https://challenge.getavora.ai/submit).

---

## ✨ Features

| Feature | Description |
|---|---|
| 🎱 **Kinetic Ball** | A glowing sphere starts at the centre and launches in a random direction on click |
| 🎙️ **Voice Fuel** | Microphone RMS volume accelerates the ball in real time |
| 🌀 **Tracer System** | Ghost-clear trails: barely visible at low speed, vivid streaks at high speed |
| 💥 **Screen Cracks** | Jagged crack networks spawn at bounce impact points once the ball hits critical velocity |
| 📸 **Full-Break State** | At maximum chaos the screen flashes white, shakes, and cracks glow orange |
| 🔊 **Synthesized SFX** | All audio is synthesized via Tone.js — launch click, bounce pings, velocity hum, and crash noise |
| 🎤 **Silence Overlay** | A pulsing mic icon appears when the ball slows and no voice is detected |

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 14](https://nextjs.org/) (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Rendering | HTML5 Canvas (2D) |
| Audio input | Web Audio API (`AnalyserNode` + RMS) |
| Sound effects | [Tone.js](https://tonejs.github.io/) v15 (synthesized, no audio files) |
| Icons | [Lucide React](https://lucide.dev/) |
| Deployment | [Vercel](https://vercel.com/) via GitHub Actions |

---

## 🚀 Local Development

```bash
# 1. Clone the repo
git clone https://github.com/Qrytics/soundVisual-Avora.git
cd soundVisual-Avora

# 2. Install dependencies
npm install

# 3. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

> **Important:** The app requires microphone access. Allow the permission prompt when it appears. For best results, use Chrome or Edge (full Web Audio API support).

---

## 🎮 How to Play

1. **Click anywhere** — the ball launches from the centre in a random direction
2. **Make noise / speak / clap** — your mic volume accelerates the ball
3. Keep making sound to push the ball to **critical velocity** (screen starts cracking)
4. **Go silent** — the ball decelerates and eventually stops; the mic icon pulses as a hint
5. At maximum chaos, the screen **shatters** with an orange glow and crash sound

---

## 📁 Project Structure

```
src/
├── app/
│   ├── layout.tsx          # Root layout + metadata
│   ├── page.tsx            # Entry point (dynamic import of CanvasScene)
│   └── globals.css         # Tailwind base + mic-pulse keyframes
├── components/
│   └── CanvasScene.tsx     # Main canvas, animation loop, physics, UI overlays
├── hooks/
│   ├── useMicVolume.ts     # Web Audio API microphone volume hook
│   └── useSoundEngine.ts   # Tone.js synthesizer engine hook
└── lib/
    ├── constants.ts        # Physics & visual constants
    └── crackRenderer.ts    # Crack generation & canvas drawing
```

---

## ⚙️ Deploying to Vercel

### Option A — Vercel Dashboard (simplest)

1. Push to GitHub
2. Import the repo at [vercel.com/new](https://vercel.com/new)
3. Vercel auto-detects Next.js — click **Deploy**

### Option B — GitHub Actions CI/CD

The workflow at `.github/workflows/deploy.yml` automatically deploys to Vercel on every push to `main`.

Add the following **repository secrets** in `Settings → Secrets and variables → Actions`:

| Secret | How to get it |
|---|---|
| `VERCEL_TOKEN` | [vercel.com/account/tokens](https://vercel.com/account/tokens) |
| `VERCEL_ORG_ID` | Run `vercel link` locally → check `.vercel/project.json` |
| `VERCEL_PROJECT_ID` | Same as above |

Once secrets are configured, every push to `main` triggers a production deployment.

---

## 🔑 Physics Constants

| Constant | Value | Purpose |
|---|---|---|
| `FRICTION` | `0.992` | Per-frame velocity decay |
| `MAX_BOOST` | `0.8` | Mic-volume to acceleration multiplier |
| `MAX_SPEED` | `40 px/frame` | Ball speed cap |
| `CRITICAL_THRESHOLD` | `25 px/frame` | Speed at which cracks start appearing |
| `BALL_RADIUS` | `18 px` | Ball size |
| `SILENCE_TIMEOUT` | `1 500 ms` | Delay before mic icon appears |

---

## 📄 License

MIT
