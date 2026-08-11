# Implementation Guide: Contentful + Astro + Cloudflare Workers

Reusable notes for building another site on this stack (headless CMS blog/marketing site, static output, zero traditional backend). Extracted from building `strona-ani`. Project-specific naming (Polish routes, "Ania") is called out explicitly so it's obvious what to rename.

## Stack

| Layer | Choice | Why |
|---|---|---|
| CMS | Contentful (Content Delivery + Preview APIs) | Free tier is enough for a single-editor site; clean typed SDK |
| Framework | Astro, `output: 'static'` | No SSR needed — content changes trigger a rebuild, not a live request |
| Hosting | Cloudflare Workers (static assets), **not Pages** | Cloudflare now routes new "Connect to Git" projects through the unified Workers deploy pipeline. Functionally very similar to Pages (same `_headers`/`_redirects`, same preview-URL-per-branch behavior) but configured via `wrangler.jsonc`, not `wrangler.toml` + Pages-specific dashboard fields |
| Contact form | Web3Forms | Static `<form>` POST, no backend, free tier, built-in honeypot |
| CI/CD | Cloudflare Workers Builds (git integration) | Not GitHub Actions — Cloudflare's own dashboard-configured build/deploy on push |

No UI framework (React/Vue/etc.) — plain `.astro` components are sufficient for a content site with no client-side interactivity beyond the contact form and the live-preview page.

## Scaffolding

```
npm create astro@latest .   # TypeScript strict, no UI framework, empty template
```

```
├── astro.config.mjs
├── wrangler.jsonc                  # minimal — see Deployment section
├── .nvmrc                          # pin Node LTS; Cloudflare auto-detects it
├── .npmrc                          # supply-chain hardening — see Security section
├── .env.example
├── public/
│   └── _headers                    # HSTS/CSP — see Security section
├── src/
│   ├── components/                 # Header, Footer, PostCard, CategoryBadge, GalleryGrid, ContactForm, Pagination
│   ├── layouts/                    # BaseLayout (SEO/OG meta), PostLayout
│   ├── lib/
│   │   ├── contentful.ts           # client singleton + typed fetch helpers, build-time only
│   │   ├── contentful-mappers.ts   # pure mapping functions — see Data Layer section
│   │   ├── contentful-types.ts     # hand-written EntrySkeletonType field interfaces
│   │   └── contentful-image.ts     # Images API URL/srcset builder
│   ├── pages/
│   │   ├── index.astro
│   │   ├── blog/[...page].astro    # paginated index, Astro's `paginate()` helper
│   │   ├── blog/[slug].astro       # post detail
│   │   ├── kategoria/[slug]/[...page].astro   # category archive, same pagination pattern
│   │   ├── galeria/index.astro, galeria/[slug].astro
│   │   ├── kontakt.astro, dziekujemy.astro    # contact form + thank-you page
│   │   ├── podglad.astro           # live preview — see that section
│   │   └── robots.txt.ts           # custom endpoint, not a static file (needs the sitemap URL)
│   └── styles/global.css
```

`astro.config.mjs` essentials:

```js
export default defineConfig({
  output: 'static',
  site: 'https://your-real-domain.com',
  build: {
    // Force external stylesheets instead of inlined <style> tags — needed to
    // keep the CSP's style-src free of 'unsafe-inline'. See Security section.
    inlineStylesheets: 'never',
  },
  integrations: [
    sitemap({ filter: (page) => !page.includes('/podglad') }), // exclude the preview page
  ],
});
```

## Contentful Setup

1. New space. Settings → Locales: add your target locale and set it as **default** (overrides Contentful's `en-US` default). Leave per-field localization off until you actually need a second language — turning it on later doesn't lose data, the existing value just becomes the default locale's value.
2. Content model — adapt this table to the actual site, but the shape (a singleton settings type + a couple of content types + tags-as-plain-array rather than a Reference type) generalizes well to most small content sites:

| Content Type | Key fields |
|---|---|
| Post (`blogPost`) | `title`, `excerpt`, `body` (Rich text), `slug`, `featuredImage` (Media), `categories` (Reference, many), `tags` (Short text list, freeform), `publishDate`, optional `seoTitle`/`seoDescription` |
| Category (`category`) | `name`, `slug`, `description` (optional) |
| Gallery (`gallery`) | `title`, `slug`, `description`, `coverImage`, `images` (Media, many) |
| Site Settings (`siteSettings`, singleton — exactly one entry) | `siteTitle`, `siteDescription`, `logo`, social URLs, `contactEmail` |

- No `Author` type for a single-author site — hardcode the byline in the layout. Add the content type only when there's an actual second author.
- Image captions come from each Asset's own `title`/`description` field — no separate "Photo" content type needed just to hold a caption.
3. Two API keys needed: a **Content Delivery API** access token (published content only, used at build time) and a **Content Preview API** access token (draft/unpublished content, used by the live-preview page). Space Settings → API keys.

## Data Layer Architecture

The key structural decision: **split the Contentful client from the pure mapping logic.**

- `contentful.ts` — instantiates the SDK client with `import.meta.env` credentials, exports `getAllPosts`/`getPostBySlug`/etc. Only ever imported by build-time Astro frontmatter.
- `contentful-mappers.ts` — pure functions only (`mapBlogPost`, `mapAsset`, `escapeHtml`, `safeMap`, the rich-text `renderNode` overrides). No client instantiation, no `import.meta.env` access. This makes it safe to import from **both** the build-time code and the client-side live-preview script, which uses a different client (Preview API, different token) — the mapping logic is identical either way, so it's written once.

Two resilience patterns worth carrying over verbatim:

```ts
// contentful-mappers.ts
// A single malformed entry (missing required field, broken reference) must not
// take down the whole static build. Mapping functions throw on invalid data;
// safeMap catches that per-entry, logs it, and skips just that entry.
export function safeMap<T, R>(items: T[], mapFn: (item: T) => R, label: string): R[] {
  const results: R[] = [];
  for (const item of items) {
    try {
      results.push(mapFn(item));
    } catch (err) {
      const id = (item as { sys?: { id?: string } })?.sys?.id ?? 'unknown';
      console.error(`[contentful] Skipping malformed ${label} entry (${id}):`, err);
    }
  }
  return results;
}
```

```ts
// Contentful field values (slug, title, name) have no format validation at the
// schema level, so anything interpolated into raw HTML strings must be escaped
// — unlike the rich-text renderer's own text nodes, which already escape
// internally. This matters wherever renderNode overrides or any other code
// builds an HTML string by interpolation instead of JSX/templating.
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
```

Apply `escapeHtml` to every value interpolated into a raw HTML string built via custom `renderNode` overrides (entry-hyperlink, embedded-entry cards) and anywhere else HTML is assembled by string concatenation rather than Astro/JSX templating (e.g. the live-preview page's `innerHTML` rendering).

**Images:** hotlink Contentful's CDN directly (`images.ctfassets.net`) with a manually built `srcset` against the Images API (`?w=...&fm=webp&q=80&fm=webp`) rather than routing through Astro's own image pipeline — Contentful's CDN already resizes/transcodes, so a second pipeline would be redundant. Only reconsider (Cloudflare Images / R2 sync / a proxy Worker) if Contentful's CDN becomes an actual measured problem — the added sync/maintenance surface isn't worth it preemptively.

**Build resilience:** every `get*BySlug` helper should catch mapping errors per-entry and return `null` rather than letting one malformed entry 500 a whole page; every `getAll*` helper should use `safeMap` so one bad entry in a list doesn't drop the whole list.

## Routing Pattern (Astro)

- Paginated index: `[...page].astro` + `getStaticPaths(({ paginate }) => paginate(items, { pageSize: N }))`, page data via `Astro.props.page`. Same pattern reused for both the blog index and category archives (`kategoria/[slug]/[...page].astro`).
- Detail page: `[slug].astro` + `getStaticPaths()` returning `{ params: { slug }, props: { post } }` for every item — avoids a second Contentful fetch inside the page itself.
- Custom non-HTML routes (`robots.txt.ts`) as an Astro endpoint (`APIRoute`) rather than a static file when the content needs to reference `Astro`-derived values (here, the sitemap URL via `site`).

## Live Preview

Lets an editor see draft changes instantly without waiting for publish + rebuild, while keeping the whole site static (no SSR, no Cloudflare adapter).

- `src/pages/podglad.astro` (rename per project) is a static shell whose **client-side** script calls the Contentful **Preview API** (`host: 'preview.contentful.com'`, using the Preview token) directly from the browser, using the exact same `mapBlogPost`/`richTextOptions` functions from `contentful-mappers.ts` that build time uses.
- Access control: a shared secret (`PUBLIC_PREVIEW_SECRET`) required as a `?secret=` query param, checked client-side. The page is `noindex`ed and excluded from the sitemap. This is not real security (the secret ships in client JS) — it's obscurity against search-engine indexing and casual discovery, appropriate for a low-stakes editor tool, not for anything sensitive.
- `@contentful/live-preview` SDK (`ContentfulLivePreview.init({ locale, enableInspectorMode: true, enableLiveUpdates: true })`) adds inspector mode (click-to-edit from the live preview back into Contentful's editor) via `data-contentful-field-id`/`data-contentful-entry-id`/`data-contentful-locale` attributes on rendered elements, plus live re-render via `ContentfulLivePreview.subscribe()` when the editor changes a field.
- **Default `targetOrigin`** the SDK expects to be embedded by (used for both the CSP `frame-ancestors` and the SDK's own origin check) is `['https://app.contentful.com', 'https://app.eu.contentful.com']` — override via `targetOrigin` in `.init()` if using a region-specific Contentful app domain.
- Contentful wiring: Settings → Content preview → create a preview URL template for the content type, e.g. `https://your-domain/podglad?slug={entry.fields.slug}&type=blogPost&secret=<PUBLIC_PREVIEW_SECRET>`. This makes a "Preview" button appear directly in the entry editor.
- New env vars, all `PUBLIC_`-prefixed (client-exposed, so not really secret regardless of the prefix): `PUBLIC_CONTENTFUL_SPACE_ID`, `PUBLIC_CONTENTFUL_PREVIEW_TOKEN`, `PUBLIC_PREVIEW_SECRET`.
- To test a PR/branch's preview page against Contentful's live preview: temporarily swap just the domain in the Content preview URL template to the branch's Cloudflare preview URL (see Deployment section) — the secret and other env vars carry over unchanged since Workers Builds doesn't support separate bindings for preview vs. production by default.

## Contact Form

Static `<form action="https://api.web3forms.com/submit" method="POST">` with a hidden `access_key` input (`PUBLIC_WEB3FORMS_ACCESS_KEY`), a `redirect` input pointing at a thank-you page, and a honeypot checkbox field (`name="botcheck"`, hidden via a CSS class — **not** an inline `style=""` attribute, see Security section) — no backend code at all. Good default for a low-volume personal/small-business site. Revisit only if more control over the send pipeline is actually needed (swap to a server function + email API — isolated change).

## Deployment (Cloudflare Workers, git integration)

Cloudflare's dashboard now routes new "Connect to Git" projects through the unified Workers deploy pipeline, not the classic Pages-specific one.

1. Push the repo to GitHub.
2. Cloudflare dashboard → Workers & Pages → Create → Connect to Git → select repo. It asks for a **build command** (`npm run build`) and a **deploy command** (pre-filled `npx wrangler deploy`; non-production branches default to `npx wrangler versions upload` instead, for preview versions).
3. `wrangler.jsonc` at repo root — minimal, no Worker entry point needed for a pure static site:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "your-project-name",
  "compatibility_date": "2026-08-11",   // today's date at setup time
  "assets": { "directory": "./dist" }
}
```

4. Env vars via the project's dashboard fields (build-time): Contentful IDs/tokens, `PUBLIC_WEB3FORMS_ACCESS_KEY`, etc. — mark secrets as "Encrypt".
5. `.nvmrc` pins the Node version; Cloudflare auto-detects it.
6. Every push to the production branch (default `main`) deploys to production. **Preview URLs for other branches require an explicit opt-in**: dashboard → Settings → Build → Branch control → check "Builds for non-production branches". Without it, pushing a feature branch either does nothing or (if branch control is misconfigured) could deploy straight to production — verify this setting is on and the production branch is actually set correctly before relying on branch pushes being safe.
7. Once enabled, every push to a branch gets both a **Commit Preview URL** (pinned to that exact commit, `<hash>-<project>.<subdomain>.workers.dev`) and a stable **Branch Preview URL** (`<branch-name>-<project>.<subdomain>.workers.dev`, updates with each push) — Cloudflare posts both as a PR comment automatically.
8. Cloudflare's default trailing-slash redirect for static assets (`/blog` → `307` → `/blog/` → `200`) is expected behavior, not a bug.
9. **Deploy-failure notifications are not simple.** There's no toggle. Classic dashboard "Notifications" doesn't cover Workers Builds — you'd need a separate Queue + a second Worker consuming build events (`build.failed`/etc.) via Event Subscriptions, using Cloudflare's `workers-builds-notifications-template`, which only supports Slack/Discord webhooks out of the box (would need code changes for email). Decide if this is worth it per-project — for a low-traffic personal site it usually isn't.

### Custom Domain + DNS

1. Project → Custom domains → add the subdomain.
2. If the domain's DNS is already on Cloudflare, it auto-detects the zone and offers to create the record.
3. If DNS is elsewhere, Cloudflare shows the exact CNAME target — add it at the other DNS provider. This only touches the one subdomain label; the root domain's existing DNS/hosting/email (e.g. MX records) is untouched.
4. SSL cert auto-issues once DNS resolves.

### Rebuild-on-publish automation

Contentful → Cloudflare's equivalent of Pages' "Build hooks" is now called **Deploy Hooks**:

1. Cloudflare dashboard → project → Settings → Builds → Deploy Hooks → create one tied to the production branch → copy the POST URL.
2. Contentful → Settings → Webhooks → add a webhook pointing at that URL, triggered on Entry publish/unpublish/delete + Asset publish, scoped to just the content types that should trigger a rebuild (avoids spurious rebuilds from unrelated changes).
3. Result: editor publishes → webhook fires → Cloudflare rebuilds → live in ~1-2 minutes. Cloudflare dedupes bursts of webhook calls automatically.

## Security Hardening

Apply all of this before calling a project done — every item below came from an actual review/scan finding, not speculative hardening.

### Supply chain (`.npmrc`, commit it)

```ini
# Block preinstall/install/postinstall scripts for every dependency by
# default. Verify the build still works without them first — native-binary
# packages (esbuild, fsevents, workerd) resolve via optionalDependencies, not
# their postinstall script, so this is usually safe. Document any package
# that genuinely needs scripts in package.json's "allowScripts" as a
# consciously-reviewed exception rather than silently disabling the block.
ignore-scripts=true

# Refuse to resolve to a package version published less than 7 days ago.
# Most malicious/compromised-maintainer releases are caught and pulled
# within hours — this turns that detection window into a real defense.
# Only affects `npm install`/`npm update` (version resolution); `npm ci`
# always replays package-lock.json's exact pinned versions regardless of
# age, so this protects the moment a dependency is added/bumped, not every
# CI build.
min-release-age=7
```

**Gotcha:** Cloudflare Workers Builds' image runs an older npm that predates both of these flags' semantics. Its `npm clean-install` step won't enforce either setting — but since CI replays an already-reviewed, already-pinned lockfile exactly, the actual risk window (someone running `npm install`/`update` and regenerating the lockfile) is wherever that command is actually run, i.e. a developer's local machine on a current npm version. Not a hole in practice, just worth knowing the protection is local-only.

### HTTP security headers (`public/_headers`)

Cloudflare Workers with static assets support the `_headers` file natively (same convention as Cloudflare Pages) — a file in the static asset directory gets copied into the build output as-is.

**The critical gotcha, confirmed empirically (not documented clearly by Cloudflare):** `_headers` rules are **cumulative**, not override-by-specificity. If a wildcard rule (`/*`) and a more specific rule (`/some-path/*`) both set the same header (e.g. `Content-Security-Policy`), **both headers get sent**, and browsers enforce multiple same-name CSP headers as an AND — the most restrictive value per directive always wins, silently defeating any "override" you intended. There is no negative/exclusion path syntax to work around this.

**The fix:** never let a wildcard rule and a path-specific rule set the *same header* for overlapping paths. Either:
- Split by header name — put headers that should be truly universal (e.g. `Strict-Transport-Security`) on their own `/*` block, and put headers that need to differ per route (e.g. `Content-Security-Policy`, when one page like a CMS live-preview embed needs a different `frame-ancestors`) into **non-overlapping, explicitly enumerated path blocks** (`/`, `/blog/*`, `/some-special-page/*`, etc. — no shared `/*` catch-all for that header at all).
- Verify path-matching is exact for non-wildcard patterns: a rule for `/foo` does **not** match a request to `/foo/` — match your actual served URL (Astro serves directory-style routes with a trailing slash, so the rule needs the trailing slash or a `/foo/*` wildcard).

Example structure (adapt paths to the real route list):

```
/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload

/
  Content-Security-Policy: default-src 'self'; img-src 'self' https://images.ctfassets.net data:; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; style-src 'self'; form-action 'self' https://api.web3forms.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none'

/blog/*
  Content-Security-Policy: [same as above]

/podglad/*
  Content-Security-Policy: default-src 'self'; img-src 'self' https://images.ctfassets.net data:; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com https://preview.contentful.com https://cdn.contentful.com; style-src 'self'; frame-ancestors https://app.contentful.com https://app.eu.contentful.com; base-uri 'self'; object-src 'none'
```

`frame-ancestors 'none'` in the CSP satisfies "anti-clickjacking" scanner findings on its own — a separate `X-Frame-Options` header isn't needed (and actively gets in the way on any page, like a live-preview page, that legitimately needs to be iframed by a specific origin, since `X-Frame-Options` can't allowlist a specific cross-origin parent the way `frame-ancestors` can).

**CSP allowlist derivation:** grep the whole `src/` tree for `https://`/`http://` literals and trace every `<script src>`/`<img>`/`action=`/`fetch()` target before writing the policy — don't guess. Common entries for this stack: `images.ctfassets.net` (img-src, if hotlinking Contentful images), `static.cloudflareinsights.com` + `cloudflareinsights.com` (script-src/connect-src, if using Cloudflare Web Analytics — the manual-embed beacon reports to `cloudflareinsights.com`, not `'self'`), the contact form's submission endpoint (`form-action`), and `preview.contentful.com`/`cdn.contentful.com` (connect-src, only on the live-preview page).

**Keeping `style-src` free of `'unsafe-inline'`:** Astro inlines component CSS into a `<style>` tag by default, which requires `'unsafe-inline'` in `style-src` unless disabled. Set `build.inlineStylesheets: 'never'` in `astro.config.mjs` to force an external stylesheet instead. Then hunt down every remaining inline `style=""` attribute in the codebase (`grep -rn 'style="' src/` and check the built `dist/` output too, since some markup — e.g. a live-preview page's client-rendered `innerHTML` — is generated at runtime, not visible in source) and move it to a CSS class. A single `'unsafe-inline'` anywhere in the CSP is a scanner finding worth fixing, not accepting, since it's almost always avoidable this way.

**Verification recipe** (do this before shipping any `_headers` change — don't trust the file syntax alone):

```bash
npm run build
npx wrangler dev --port 8793 &
# wrangler logs "Parsed N valid header rules" on startup — confirms the file parsed
curl -sI http://localhost:8793/some/route | grep -i content-security-policy
# repeat per distinct route group, and specifically count header occurrences to
# catch the cumulative-rules gotcha above:
curl -sI http://localhost:8793/some/route | grep -ic '^content-security-policy:'   # must be 1
```

### XSS via CMS fields

See `escapeHtml` in the Data Layer section above — Contentful field values have no format validation at the schema level, so any code that builds raw HTML strings from field values (custom rich-text `renderNode` overrides, client-side preview rendering) must escape them explicitly, even though this requires trusted CMS editor access to exploit (not public input) on a single/few-editor site.

### Security scanning

Aikido's free tier (2 users, 10 repos, real SAST/SCA/Secrets/IaC scanning — free forever, not a trial) comfortably covers a project like this. Setup is dashboard-only (connect the GitHub repo via Aikido's onboarding flow) — no CLI/API path for automating the initial connection. Once connected, its MCP server (if configured in the CLI/IDE) can run local SAST/secrets scans and list issues by branch/repo without leaving the terminal.

## Verification Checklist

- [ ] `npm run dev` renders every page against real Contentful data before any deploy.
- [ ] First automatic Cloudflare deploy succeeds; the `*.workers.dev` URL is live.
- [ ] Publish a test entry in Contentful, confirm the webhook triggers a rebuild and the change appears live within ~1-2 minutes.
- [ ] Submit a real test message through the contact form, confirm delivery, confirm the post-submit redirect resolves correctly (only fully testable once the real production domain is set in `astro.config.mjs`'s `site`).
- [ ] Once DNS is configured, load the custom domain directly and confirm SSL is valid and Cloudflare shows the custom domain as Active.
- [ ] Deliberately break one sample entry (missing required field) and confirm the build logs a skip/warning rather than failing entirely.
- [ ] Run the `_headers` verification recipe above against every distinct route group before merging any header change.
- [ ] Open the live-preview page from an actual Contentful entry editor (not just `localhost`) at least once, to confirm the CSP `frame-ancestors`/SDK `targetOrigin` config actually permits the embed in practice.
