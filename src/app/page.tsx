import dynamic from 'next/dynamic';

// CanvasScene uses browser APIs — load client-side only
const CanvasScene = dynamic(() => import('@/components/CanvasScene'), { ssr: false });

export default function Home() {
  return <CanvasScene />;
}
