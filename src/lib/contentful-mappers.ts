import type { Asset, Entry } from 'contentful';
import { documentToHtmlString, type Options } from '@contentful/rich-text-html-renderer';
import { BLOCKS, INLINES } from '@contentful/rich-text-types';
import type {
  BlogPostSkeleton,
  CategorySkeleton,
  GallerySkeleton,
  SiteSettingsSkeleton,
  BlogPost,
  Category,
  ContentfulImage,
  Gallery,
  SiteSettings,
} from './contentful-types';

// Pure mapping functions, no Contentful client instantiation and no
// import.meta.env access — safe to import from both build-time code
// (contentful.ts) and client-side preview code (podglad.astro), which
// use different clients/credentials (Delivery vs Preview API).

// A single malformed entry (missing required field, broken reference) must not
// take down the whole static build. Mapping functions below throw on invalid
// data; safeMap catches that per-entry, logs it, and skips just that entry.
export function safeMap<T, R>(items: T[], mapFn: (item: T) => R, label: string): R[] {
  const results: R[] = [];
  for (const item of items) {
    try {
      results.push(mapFn(item));
    } catch (err) {
      const id = (item as { sys?: { id?: string } })?.sys?.id ?? 'unknown';
      console.error(`[contentful] Skipping malformed ${label} entry (${id}):`, err instanceof Error ? err.message : err);
    }
  }
  return results;
}

export function mapAsset(asset: Asset | undefined | null): ContentfulImage | undefined {
  if (!asset) return undefined;
  const url = asset.fields?.file?.url;
  if (!url) throw new Error(`Asset ${asset.sys?.id ?? 'unknown'} has no file URL`);
  const dimensions = asset.fields.file?.details?.image;
  return {
    url: url.startsWith('//') ? `https:${url}` : url,
    alt: asset.fields.description || asset.fields.title || '',
    width: dimensions?.width,
    height: dimensions?.height,
  };
}

// Resolves an entry linked in rich text (entry-hyperlink / embedded-entry) to a
// site URL, based on which content type it is. Returns null for unresolved
// links (e.g. the target was unpublished/deleted) so callers can degrade
// gracefully instead of producing a broken href.
function resolveEntryUrl(target: unknown): string | null {
  const t = target as { sys?: { contentType?: { sys?: { id?: string } } }; fields?: { slug?: string } } | undefined;
  const contentTypeId = t?.sys?.contentType?.sys?.id;
  const slug = t?.fields?.slug;
  if (!contentTypeId || !slug) return null;
  switch (contentTypeId) {
    case 'blogPost':
      return `/blog/${slug}`;
    case 'category':
      return `/kategoria/${slug}`;
    case 'gallery':
      return `/galeria/${slug}`;
    default:
      return null;
  }
}

function entryTitle(target: unknown): string | null {
  const t = target as { fields?: { title?: string; name?: string } } | undefined;
  return t?.fields?.title ?? t?.fields?.name ?? null;
}

export const richTextOptions: Options = {
  renderNode: {
    [INLINES.ENTRY_HYPERLINK]: (node, next) => {
      const url = resolveEntryUrl(node.data.target);
      const text = next(node.content);
      return url ? `<a href="${url}">${text}</a>` : text;
    },
    [BLOCKS.EMBEDDED_ENTRY]: (node) => {
      const url = resolveEntryUrl(node.data.target);
      const title = entryTitle(node.data.target);
      if (!url || !title) return '';
      return `<a class="embedded-entry-card" href="${url}">${title}</a>`;
    },
    [INLINES.EMBEDDED_ENTRY]: (node) => {
      const url = resolveEntryUrl(node.data.target);
      const title = entryTitle(node.data.target) ?? '';
      return url ? `<a href="${url}">${title}</a>` : title;
    },
  },
};

export function mapCategory(entry: Entry<CategorySkeleton>): Category {
  const { name, slug, description } = entry.fields;
  if (!name || !slug) throw new Error(`Category ${entry.sys.id} is missing name/slug`);
  return { id: entry.sys.id, name, slug, description };
}

export function mapBlogPost(entry: Entry<BlogPostSkeleton>): BlogPost {
  const { title, excerpt, body, slug, featuredImage, categories, tags, publishDate, seoTitle, seoDescription } =
    entry.fields;
  if (!title || !slug || !body || !publishDate) {
    throw new Error(`Blog post ${entry.sys.id} is missing a required field (title/slug/body/publishDate)`);
  }
  const resolvedCategories = safeMap(
    (categories ?? []).filter((c): c is Entry<CategorySkeleton> => !!c && 'fields' in c),
    mapCategory,
    'category (nested in blogPost)',
  );
  return {
    id: entry.sys.id,
    title,
    excerpt,
    bodyHtml: documentToHtmlString(body, richTextOptions),
    slug,
    featuredImage: mapAsset(featuredImage as Asset | undefined),
    categories: resolvedCategories,
    tags: tags ?? [],
    publishDate,
    seoTitle,
    seoDescription,
  };
}

export function mapGallery(entry: Entry<GallerySkeleton>): Gallery {
  const { title, slug, description, coverImage, images } = entry.fields;
  if (!title || !slug) throw new Error(`Gallery ${entry.sys.id} is missing title/slug`);
  const resolvedImages = (images ?? [])
    .map((img) => mapAsset(img as Asset | undefined))
    .filter((img): img is ContentfulImage => !!img);
  return {
    id: entry.sys.id,
    title,
    slug,
    description,
    coverImage: mapAsset(coverImage as Asset | undefined),
    images: resolvedImages,
  };
}

export function mapSiteSettings(entry: Entry<SiteSettingsSkeleton>): SiteSettings {
  const { siteTitle, siteDescription, logo, facebookUrl, instagramUrl, contactEmail } = entry.fields;
  if (!siteTitle || !contactEmail) throw new Error(`Site Settings ${entry.sys.id} is missing siteTitle/contactEmail`);
  return {
    siteTitle,
    siteDescription,
    logo: mapAsset(logo as Asset | undefined),
    facebookUrl,
    instagramUrl,
    contactEmail,
  };
}
