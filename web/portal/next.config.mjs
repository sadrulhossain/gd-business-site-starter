const dev = process.env.NODE_ENV === 'development'
const defaultLocale = process.env.LOCALE_DEFAULT ?? 'en'
const other = (process.env.LOCALE_SUPPORTED ?? 'en').split(',').map((s) => s.trim()).filter((c) => c && c !== defaultLocale)

/**
 * Static export: `next build` writes out/ and nothing runs on a server. Every page is generated at build time from the
 * live API (BUILD_API_URL); scripts/finalize-export.mjs then moves the default-language tree to the root.
 */
export default {
  // Export is a build-only mode: in dev it rejects the rewritten default-language paths.
  ...(dev ? {} : { output: 'export' }),
  trailingSlash: true,
  poweredByHeader: false,
  // The browser makes the WebP variants (admin upload), so Next does not re-encode anything.
  images: { unoptimized: true },
  // Dev server only (never in the build, where rewrites are not allowed): serve the default language unprefixed,
  // like the finalize step does for the export.
  ...(dev
    ? {
        async rewrites() {
          const skip = ['_next', 'api', defaultLocale, ...other].join('|')
          return [
            { source: '/', destination: `/${defaultLocale}/` },
            { source: `/:path((?!${skip}(?:/|$)).*)`, destination: `/${defaultLocale}/:path` },
          ]
        },
      }
    : {}),
}
