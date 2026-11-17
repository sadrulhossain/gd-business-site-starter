/**
 * Static export: `next build` writes out/ and nothing runs on a server. Every page is generated at build time from the
 * live API (BUILD_API_URL); scripts/finalize-export.mjs then moves the default-language tree to the root.
 */
export default {
  output: 'export',
  trailingSlash: true,
  poweredByHeader: false,
  // The browser makes the WebP variants (admin upload), so Next does not re-encode anything.
  images: { unoptimized: true },
}
