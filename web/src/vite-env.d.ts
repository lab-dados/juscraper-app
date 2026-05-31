/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PROXY_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Glue Python importado como string crua.
declare module "*.py?raw" {
  const src: string;
  export default src;
}
