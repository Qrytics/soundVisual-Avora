/** @type {import('next').NextConfig} */
const nextConfig = {
  // Set via env so local dev still works at localhost:3000/
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
  // Enable static export only when requested (production deploy)
  ...(process.env.STATIC_EXPORT === '1' && { output: 'export' }),
};

export default nextConfig;
