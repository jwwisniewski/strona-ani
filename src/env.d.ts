/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly CONTENTFUL_SPACE_ID: string;
  readonly CONTENTFUL_DELIVERY_TOKEN: string;
  readonly CONTENTFUL_ENVIRONMENT: string;
  readonly PUBLIC_WEB3FORMS_ACCESS_KEY: string;
  readonly PUBLIC_CONTENTFUL_SPACE_ID: string;
  readonly PUBLIC_CONTENTFUL_PREVIEW_TOKEN: string;
  readonly PUBLIC_PREVIEW_SECRET: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
