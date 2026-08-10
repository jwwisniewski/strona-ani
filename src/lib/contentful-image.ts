export interface ImageUrlOptions {
  width?: number;
  quality?: number;
  format?: 'webp' | 'avif' | 'jpg' | 'png';
}

// Contentful asset URLs are protocol-relative (e.g. "//images.ctfassets.net/...").
function toAbsoluteUrl(assetUrl: string): string {
  return assetUrl.startsWith('//') ? `https:${assetUrl}` : assetUrl;
}

export function buildImageUrl(assetUrl: string, { width, quality = 80, format = 'webp' }: ImageUrlOptions = {}): string {
  const url = new URL(toAbsoluteUrl(assetUrl));
  if (width) url.searchParams.set('w', String(width));
  url.searchParams.set('q', String(quality));
  url.searchParams.set('fm', format);
  return url.toString();
}

export function buildSrcSet(assetUrl: string, widths: number[], options: Omit<ImageUrlOptions, 'width'> = {}): string {
  return widths.map((width) => `${buildImageUrl(assetUrl, { ...options, width })} ${width}w`).join(', ');
}
