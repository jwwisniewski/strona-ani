import { createClient } from 'contentful';
import type {
  BlogPostSkeleton,
  CategorySkeleton,
  GallerySkeleton,
  SiteSettingsSkeleton,
  BlogPost,
  Category,
  Gallery,
  SiteSettings,
} from './contentful-types';
import { safeMap, mapCategory, mapBlogPost, mapGallery, mapSiteSettings } from './contentful-mappers';

export const DEFAULT_LOCALE = 'pl-PL';

const client = createClient({
  space: import.meta.env.CONTENTFUL_SPACE_ID,
  accessToken: import.meta.env.CONTENTFUL_DELIVERY_TOKEN,
  environment: import.meta.env.CONTENTFUL_ENVIRONMENT || 'master',
});

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
