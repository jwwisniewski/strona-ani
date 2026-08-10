import type { EntryFieldTypes, EntrySkeletonType } from 'contentful';

export type CategorySkeleton = EntrySkeletonType<
  {
    name: EntryFieldTypes.Symbol;
    slug: EntryFieldTypes.Symbol;
    description: EntryFieldTypes.Text;
  },
  'category'
>;

export type BlogPostSkeleton = EntrySkeletonType<
  {
    title: EntryFieldTypes.Symbol;
    excerpt: EntryFieldTypes.Symbol;
    body: EntryFieldTypes.RichText;
    slug: EntryFieldTypes.Symbol;
    featuredImage: EntryFieldTypes.AssetLink;
    categories: EntryFieldTypes.Array<EntryFieldTypes.EntryLink<CategorySkeleton>>;
    tags: EntryFieldTypes.Array<EntryFieldTypes.Symbol>;
    publishDate: EntryFieldTypes.Date;
    seoTitle: EntryFieldTypes.Symbol;
    seoDescription: EntryFieldTypes.Symbol;
  },
  'blogPost'
>;

export type GallerySkeleton = EntrySkeletonType<
  {
    title: EntryFieldTypes.Symbol;
    slug: EntryFieldTypes.Symbol;
    description: EntryFieldTypes.Text;
    coverImage: EntryFieldTypes.AssetLink;
    images: EntryFieldTypes.Array<EntryFieldTypes.AssetLink>;
  },
  'gallery'
>;

export type SiteSettingsSkeleton = EntrySkeletonType<
  {
    siteTitle: EntryFieldTypes.Symbol;
    siteDescription: EntryFieldTypes.Text;
    logo: EntryFieldTypes.AssetLink;
    facebookUrl: EntryFieldTypes.Symbol;
    instagramUrl: EntryFieldTypes.Symbol;
    contactEmail: EntryFieldTypes.Symbol;
  },
  'siteSettings'
>;

// Normalized shapes returned by the fetch helpers in contentful.ts —
// flattened from the raw SDK entries so pages don't deal with .fields/.sys.

export interface ContentfulImage {
  url: string;
  alt: string;
  width?: number;
  height?: number;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
}

export interface BlogPost {
  id: string;
  title: string;
  excerpt?: string;
  bodyHtml: string;
  slug: string;
  featuredImage?: ContentfulImage;
  categories: Category[];
  tags: string[];
  publishDate: string;
  seoTitle?: string;
  seoDescription?: string;
}

export interface Gallery {
  id: string;
  title: string;
  slug: string;
  description?: string;
  coverImage?: ContentfulImage;
  images: ContentfulImage[];
}

export interface SiteSettings {
  siteTitle: string;
  siteDescription?: string;
  logo?: ContentfulImage;
  facebookUrl?: string;
  instagramUrl?: string;
  contactEmail: string;
}
