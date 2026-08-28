import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // libSQL ships a native binding. Leaving it external keeps the bundler from
  // tracing it into the server output, where it would not load.
  serverExternalPackages: ['@libsql/client', 'libsql'],

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
