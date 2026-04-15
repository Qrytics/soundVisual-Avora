import CanvasScene from '@/components/CanvasScene';

// CanvasScene is a Client Component ('use client') that accesses browser APIs
// only inside useEffect — safe to import directly in a Server Component page.
export default function Home() {
  return <CanvasScene />;
}
