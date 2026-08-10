import { createClient, type Asset, type Entry } from 'contentful';
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

export const DEFAULT_LOCALE = 'pl-PL';

const client = createClient({
  space: import.meta.env.CONTENTFUL_SPACE_ID,
  accessToken: import.meta.env.CONTENTFUL_DELIVERY_TOKEN,
  environment: import.meta.env.CONTENTFUL_ENVIRONMENT || 'master',
});

// A single malformed entry (missing required field, broken reference) must not
// take down the whole static build. Mapping functions below throw on invalid
// data; safeMap catches that per-entry, logs it, and skips just that entry.
function safeMap<T, R>(items: T[], mapFn: (item: T) => R, label: string): R[] {
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

function mapAsset(asset: Asset | undefined | null): ContentfulImage | undefined {
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

const richTextOptions: Options = {
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

function mapCategory(entry: Entry<CategorySkeleton>): Category {
  const { name, slug, description } = entry.fields;
  if (!name || !slug) throw new Error(`Category ${entry.sys.id} is missing name/slug`);
  return { id: entry.sys.id, name, slug, description };
}

function mapBlogPost(entry: Entry<BlogPostSkeleton>): BlogPost {
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

function mapGallery(entry: Entry<GallerySkeleton>): Gallery {
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

function mapSiteSettings(entry: Entry<SiteSettingsSkeleton>): SiteSettings {
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

export async function getAllPosts(locale = DEFAULT_LOCALE): Promise<BlogPost[]> {
  const res = await client.getEntries<BlogPostSkeleton>({
    content_type: 'blogPost',
    locale,
    order: ['-fields.publishDate'],
    include: 2,
  });
  return safeMap(res.items, mapBlogPost, 'blogPost');
}

export async function getPostBySlug(slug: string, locale = DEFAULT_LOCALE): Promise<BlogPost | null> {
  const res = await client.getEntries<BlogPostSkeleton>({
    content_type: 'blogPost',
    'fields.slug': slug,
    locale,
    include: 2,
    limit: 1,
  });
  const entry = res.items[0];
  if (!entry) return null;
  try {
    return mapBlogPost(entry);
  } catch (err) {
    console.error(`[contentful] Blog post with slug "${slug}" is malformed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function getAllCategories(locale = DEFAULT_LOCALE): Promise<Category[]> {
  const res = await client.getEntries<CategorySkeleton>({ content_type: 'category', locale });
  return safeMap(res.items, mapCategory, 'category');
}

export async function getCategoryBySlug(slug: string, locale = DEFAULT_LOCALE): Promise<Category | null> {
  const res = await client.getEntries<CategorySkeleton>({
    content_type: 'category',
    'fields.slug': slug,
    locale,
    limit: 1,
  });
  const entry = res.items[0];
  if (!entry) return null;
  try {
    return mapCategory(entry);
  } catch (err) {
    console.error(`[contentful] Category with slug "${slug}" is malformed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function getPostsByCategory(categorySlug: string, locale = DEFAULT_LOCALE): Promise<BlogPost[]> {
  const category = await getCategoryBySlug(categorySlug, locale);
  if (!category) return [];
  const res = await client.getEntries<BlogPostSkeleton>({
    content_type: 'blogPost',
    'fields.categories.sys.id': category.id,
    locale,
    order: ['-fields.publishDate'],
    include: 2,
  });
  return safeMap(res.items, mapBlogPost, 'blogPost');
}

export async function getAllGalleries(locale = DEFAULT_LOCALE): Promise<Gallery[]> {
  const res = await client.getEntries<GallerySkeleton>({ content_type: 'gallery', locale });
  return safeMap(res.items, mapGallery, 'gallery');
}

export async function getGalleryBySlug(slug: string, locale = DEFAULT_LOCALE): Promise<Gallery | null> {
  const res = await client.getEntries<GallerySkeleton>({
    content_type: 'gallery',
    'fields.slug': slug,
    locale,
    limit: 1,
  });
  const entry = res.items[0];
  if (!entry) return null;
  try {
    return mapGallery(entry);
  } catch (err) {
    console.error(`[contentful] Gallery with slug "${slug}" is malformed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function getSiteSettings(locale = DEFAULT_LOCALE): Promise<SiteSettings> {
  const res = await client.getEntries<SiteSettingsSkeleton>({ content_type: 'siteSettings', locale, limit: 1 });
  const entry = res.items[0];
  if (!entry) throw new Error('No Site Settings entry found in Contentful — create the singleton entry.');
  return mapSiteSettings(entry);
}
