import type { NextConfig } from 'next';

/**
 * Base path / output:
 * - Vercel (`VERCEL=1`) → root path, Next.js server (dynamic routes)
 * - Local Apache static export → set NEXT_PUBLIC_BASE_PATH=/ConstructFlow
 * - `next dev` → empty base path, no static export (dynamic routes must work)
 *
 * Client asset URLs must follow NEXT_PUBLIC_BASE_PATH only (see publicAsset.ts).
 */
const onVercel = Boolean(process.env.VERCEL);
const isProdBuild = process.env.NODE_ENV === 'production';
const configured = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/, '');
// Prefer no basePath on Vercel / local next dev. Apache static export can set
// NEXT_PUBLIC_BASE_PATH or FORCE_BASE_PATH when needed.
const basePath =
  process.env.FORCE_BASE_PATH
    ? (process.env.FORCE_BASE_PATH.replace(/\/$/, ''))
    : onVercel
    ? ''
    : process.env.NODE_ENV === 'development'
    ? ''
    : configured;

// Static export only for production Apache builds — never during `next dev`,
// otherwise dynamic URLs like /projects/{id}/boq fail with generateStaticParams errors.
const useStaticExport = !onVercel && isProdBuild;

const nextConfig: NextConfig = {
  ...(useStaticExport ? { output: 'export' as const } : {}),
  ...(basePath ? { basePath } : {}),
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
