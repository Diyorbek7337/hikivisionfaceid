const isDev = process.env.NODE_ENV === 'development';

/**
 * Production: static export (web/out) served by the server.
 * Development (`npm run dev`): API calls are proxied to the running server on :3000.
 */
const nextConfig = {
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  ...(isDev
    ? { async rewrites() { return [{ source: '/api/:path*', destination: 'http://localhost:3000/api/:path*' }]; } }
    : { output: 'export' }),
};
export default nextConfig;
