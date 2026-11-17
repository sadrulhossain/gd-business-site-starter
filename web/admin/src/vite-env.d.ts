/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin at build time; empty (default) means same origin. */
  readonly VITE_API_URL?: string
}
