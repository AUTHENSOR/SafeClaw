#!/usr/bin/env node
// Static blog generator for SafeClaw site
// Reads markdown posts from bot-network/data/seo/posts/ and generates
// static HTML pages in site/blog/ matching the SafeClaw site aesthetic.
//
// Usage: node site/generate-blog.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = path.resolve('/Users/johnkearney/Desktop/Autonomous Network/bot-network/data/seo/posts');
const AISEO_DIR = path.resolve('/Users/johnkearney/Desktop/Autonomous Network/bot-network/data/seo/aiseo-posts');
const BLOG_OUT = path.join(__dirname, 'blog');
const KNOWLEDGE_OUT = path.join(__dirname, 'knowledge');

// --- Minimal Markdown to HTML converter ---

function md2html(md) {
  let html = md;

  // Code blocks (fenced)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<pre><code class="lang-${lang || 'text'}">${escaped.trimEnd()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr/>');

  // Unordered lists
  html = html.replace(/^(?:- (.+)\n?)+/gm, (match) => {
    const items = match.trim().split('\n').map(line => {
      const content = line.replace(/^- /, '');
      return `<li>${content}</li>`;
    }).join('\n');
    return `<ul>\n${items}\n</ul>`;
  });

  // Ordered lists
  html = html.replace(/^(?:\d+\. (.+)\n?)+/gm, (match) => {
    const items = match.trim().split('\n').map(line => {
      const content = line.replace(/^\d+\. /, '');
      return `<li>${content}</li>`;
    }).join('\n');
    return `<ol>\n${items}\n</ol>`;
  });

  // Paragraphs: wrap remaining text blocks
  const lines = html.split('\n\n');
  html = lines.map(block => {
    block = block.trim();
    if (!block) return '';
    if (block.startsWith('<h') || block.startsWith('<ul') || block.startsWith('<ol') ||
        block.startsWith('<pre') || block.startsWith('<hr') || block.startsWith('<blockquote')) {
      return block;
    }
    return `<p>${block.replace(/\n/g, '<br/>')}</p>`;
  }).join('\n\n');

  return html;
}

// --- Frontmatter parser ---

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta = {};
  const yamlLines = match[1].split('\n');
  let currentKey = null;
  let currentArray = null;

  for (const line of yamlLines) {
    if (line.startsWith('  - ')) {
      if (currentArray) currentArray.push(line.replace('  - ', '').replace(/^"|"$/g, ''));
    } else {
      if (currentArray && currentKey) {
        meta[currentKey] = currentArray;
        currentArray = null;
      }
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (kv) {
        currentKey = kv[1];
        const val = kv[2].replace(/^"|"$/g, '');
        if (val === '') {
          currentArray = [];
        } else {
          meta[currentKey] = val;
        }
      }
    }
  }
  if (currentArray && currentKey) meta[currentKey] = currentArray;

  return { meta, body: match[2] };
}

// --- HTML Templates ---

function blogPostHTML(meta, bodyHtml, isAiseo = false) {
  const keywords = Array.isArray(meta.targetKeywords) ? meta.targetKeywords.join(', ') : '';
  const description = meta.metaDescription || meta.title || '';
  const backPath = isAiseo ? '/knowledge/' : '/blog/';
  const backLabel = isAiseo ? 'Knowledge Base' : 'Blog';
  const pageType = isAiseo ? 'TechArticle' : 'BlogPosting';

  // JSON-LD structured data
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': pageType,
    headline: meta.title,
    description: description,
    datePublished: meta.publishDate || '2026-02-13',
    author: {
      '@type': 'Organization',
      name: 'Authensor',
      url: 'https://authensor.com'
    },
    publisher: {
      '@type': 'Organization',
      name: 'Authensor',
      url: 'https://authensor.com'
    },
    mainEntityOfPage: {
      '@type': 'WebPage'
    }
  };

  if (keywords) {
    jsonLd.keywords = keywords;
  }

  // Add FAQ schema for AISEO posts that have Q&A sections
  const faqSchema = isAiseo ? generateFaqSchema(bodyHtml) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${meta.title} | SafeClaw by Authensor</title>
  <meta name="description" content="${description}"/>
  ${keywords ? `<meta name="keywords" content="${keywords}"/>` : ''}
  <meta name="author" content="${meta.author || 'Authensor'}"/>
  <meta name="robots" content="index, follow"/>
  <link rel="canonical" href="https://safeclaw-site.pages.dev${backPath}${meta.slug}"/>

  <!-- Open Graph -->
  <meta property="og:title" content="${meta.title}"/>
  <meta property="og:description" content="${description}"/>
  <meta property="og:type" content="article"/>
  <meta property="og:url" content="https://safeclaw-site.pages.dev${backPath}${meta.slug}"/>
  <meta property="og:site_name" content="SafeClaw"/>

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${meta.title}"/>
  <meta name="twitter:description" content="${description}"/>

  <link rel="icon" href="/icon.svg" type="image/svg+xml"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Anton&family=Plus+Jakarta+Sans:wght@300;400;600;700&display=swap" rel="stylesheet"/>

  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  ${faqSchema}

  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --navy: #171e19;
      --sage: #b7c6c2;
      --taupe: #9f8d8b;
      --beige: #d7c5b2;
      --cyan: #d5f4f9;
      --charcoal: #302b2f;
      --white: #faf9f7;
    }
    body {
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      font-weight: 400;
      color: var(--navy);
      background: var(--white);
      line-height: 1.7;
      -webkit-font-smoothing: antialiased;
    }
    body::before, body::after {
      content: '';
      position: fixed;
      width: 400px;
      height: 400px;
      border-radius: 50%;
      filter: blur(120px);
      opacity: 0.25;
      pointer-events: none;
      z-index: -1;
    }
    body::before { top: -100px; right: -100px; background: var(--cyan); }
    body::after { bottom: -100px; left: -100px; background: var(--sage); }

    .container { max-width: 720px; margin: 0 auto; padding: 0 24px; }

    /* Nav */
    nav {
      padding: 20px 0;
      border-bottom: 1px solid rgba(23, 30, 25, 0.06);
      margin-bottom: 48px;
    }
    nav .inner {
      max-width: 720px;
      margin: 0 auto;
      padding: 0 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    nav a {
      text-decoration: none;
      color: var(--navy);
    }
    nav .brand {
      font-family: 'Anton', sans-serif;
      font-size: 20px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    nav .back {
      font-size: 14px;
      font-weight: 600;
      color: var(--taupe);
    }
    nav .back:hover { color: var(--navy); }

    /* Article */
    article { padding-bottom: 64px; }
    article .meta {
      font-size: 13px;
      color: var(--taupe);
      margin-bottom: 8px;
      letter-spacing: 0.02em;
    }
    article h1 {
      font-family: 'Anton', sans-serif;
      font-weight: 400;
      text-transform: uppercase;
      font-size: clamp(1.6rem, 4vw, 2.4rem);
      line-height: 1.1;
      margin-bottom: 32px;
    }
    article h2 {
      font-family: 'Anton', sans-serif;
      font-weight: 400;
      text-transform: uppercase;
      font-size: 1.3rem;
      margin-top: 48px;
      margin-bottom: 16px;
    }
    article h3 {
      font-weight: 700;
      font-size: 1.05rem;
      margin-top: 36px;
      margin-bottom: 12px;
    }
    article h4 {
      font-weight: 600;
      font-size: 1rem;
      margin-top: 28px;
      margin-bottom: 10px;
    }
    article p {
      margin-bottom: 18px;
      font-weight: 300;
      font-size: 16px;
      color: var(--charcoal);
    }
    article ul, article ol {
      margin-bottom: 18px;
      padding-left: 28px;
    }
    article li {
      margin-bottom: 8px;
      font-weight: 300;
      font-size: 16px;
      color: var(--charcoal);
    }
    article strong { font-weight: 600; color: var(--navy); }
    article a { color: var(--navy); text-decoration: underline; text-underline-offset: 3px; }
    article a:hover { color: var(--taupe); }
    article code {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 14px;
      background: rgba(183, 198, 194, 0.15);
      padding: 2px 6px;
      border-radius: 4px;
    }
    article pre {
      background: var(--navy);
      border-radius: 10px;
      padding: 20px;
      margin-bottom: 24px;
      overflow-x: auto;
    }
    article pre code {
      background: none;
      padding: 0;
      color: var(--cyan);
      font-size: 14px;
      line-height: 1.6;
    }
    article hr {
      border: none;
      height: 1px;
      background: rgba(23, 30, 25, 0.08);
      margin: 40px 0;
    }

    /* CTA */
    .post-cta {
      margin-top: 48px;
      padding: 32px;
      background: rgba(213, 244, 249, 0.12);
      border: 1px solid rgba(213, 244, 249, 0.3);
      border-radius: 14px;
      text-align: center;
    }
    .post-cta h3 {
      font-family: 'Anton', sans-serif;
      font-weight: 400;
      text-transform: uppercase;
      font-size: 1.2rem;
      margin-bottom: 10px;
      margin-top: 0;
    }
    .post-cta p {
      font-size: 14px;
      margin-bottom: 16px;
    }
    .post-cta .command-box {
      display: inline-flex;
      align-items: center;
      background: var(--navy);
      border-radius: 8px;
      padding: 10px 16px;
      gap: 8px;
    }
    .post-cta .command-box code {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 15px;
      color: var(--cyan);
      background: none;
      padding: 0;
    }

    /* Footer */
    footer {
      text-align: center;
      padding: 24px 0;
      border-top: 1px solid rgba(23, 30, 25, 0.06);
      font-size: 13px;
      font-weight: 300;
      color: var(--taupe);
    }
    footer a { color: var(--taupe); text-decoration: underline; text-underline-offset: 3px; }

    @media (max-width: 600px) {
      .container { padding: 0 16px; }
      nav .inner { padding: 0 16px; }
    }
  </style>
</head>
<body>
  <nav>
    <div class="inner">
      <a href="/" class="brand">SafeClaw</a>
      <a href="${backPath}" class="back">&larr; ${backLabel}</a>
    </div>
  </nav>

  <div class="container">
    <article>
      <div class="meta">${meta.publishDate || '2026-02-13'} &middot; ${meta.author || 'Authensor'}</div>
      ${bodyHtml}

      <div class="post-cta">
        <h3>Try SafeClaw</h3>
        <p>Action-level gating for AI agents. Set it up in your browser in 60 seconds.</p>
        <div class="command-box">
          <code>$ npx @authensor/safeclaw</code>
        </div>
      </div>
    </article>
  </div>

  <footer>
    SafeClaw is open source &middot; <a href="https://github.com/AUTHENSOR/SafeClaw">GitHub</a> &middot; <a href="https://authensor.com">Authensor</a>
  </footer>
</body>
</html>`;
}

function generateFaqSchema(bodyHtml) {
  // Extract Q&A patterns from AISEO content (h3 questions + following paragraphs)
  const faqItems = [];
  const regex = /<h3>([^<]*\?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g;
  let match;
  while ((match = regex.exec(bodyHtml)) !== null) {
    faqItems.push({
      '@type': 'Question',
      name: match[1].replace(/<[^>]+>/g, ''),
      acceptedAnswer: {
        '@type': 'Answer',
        text: match[2].replace(/<[^>]+>/g, '')
      }
    });
  }
  if (faqItems.length === 0) return '';
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems
  };
  return `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
}

function blogIndexHTML(posts, isAiseo = false) {
  const title = isAiseo ? 'Knowledge Base' : 'Blog';
  const subtitle = isAiseo
    ? 'Technical reference and in-depth knowledge about AI agent security, action-level gating, and the SafeClaw policy engine.'
    : 'Insights on AI agent security, action-level gating, and building trustworthy agent systems.';
  const basePath = isAiseo ? '/knowledge/' : '/blog/';

  const categories = {};
  for (const post of posts) {
    const cat = post.category || 'general';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(post);
  }

  const categoryLabels = {
    'launch': 'Launch',
    'problem-awareness': 'Security Risks',
    'comparison': 'Comparisons',
    'how-to': 'Guides',
    'technical-deep-dive': 'Technical Deep Dives',
    'thought-leadership': 'Industry',
    'aiseo-faq': 'Frequently Asked Questions',
    'aiseo-reference': 'Technical Reference',
    'aiseo-comparison': 'Comparison Data',
    'aiseo-glossary': 'Glossary & Definitions',
    'aiseo-spec': 'Specifications',
    'aiseo-guide': 'Guides & How-Tos',
    'aiseo-threat': 'Threats & Prevention',
    'aiseo-pattern': 'Architecture Patterns',
    'aiseo-compliance': 'Compliance & Regulatory',
    'aiseo-industry': 'Industry & Adoption',
    'general': 'General'
  };

  let categoryHtml = '';
  const catOrder = isAiseo
    ? ['aiseo-faq', 'aiseo-reference', 'aiseo-comparison', 'aiseo-glossary', 'aiseo-spec', 'aiseo-guide', 'aiseo-threat', 'aiseo-pattern', 'aiseo-compliance', 'aiseo-industry', 'general']
    : ['launch', 'problem-awareness', 'comparison', 'how-to', 'technical-deep-dive', 'thought-leadership'];

  for (const cat of catOrder) {
    if (!categories[cat]) continue;
    const label = categoryLabels[cat] || cat;
    const items = categories[cat].map(p =>
      `<li><a href="${basePath}${p.slug}">${p.title}</a></li>`
    ).join('\n          ');

    categoryHtml += `
      <div class="cat-section">
        <h2>${label}</h2>
        <ul>${items}</ul>
      </div>`;
  }

  // JSON-LD for the index
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `SafeClaw ${title}`,
    description: subtitle,
    publisher: {
      '@type': 'Organization',
      name: 'Authensor',
      url: 'https://authensor.com'
    }
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title} | SafeClaw by Authensor</title>
  <meta name="description" content="${subtitle}"/>
  <meta name="robots" content="index, follow"/>
  <link rel="canonical" href="https://safeclaw-site.pages.dev${basePath}"/>
  <link rel="icon" href="/icon.svg" type="image/svg+xml"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Anton&family=Plus+Jakarta+Sans:wght@300;400;600;700&display=swap" rel="stylesheet"/>

  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>

  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --navy: #171e19;
      --sage: #b7c6c2;
      --taupe: #9f8d8b;
      --cyan: #d5f4f9;
      --charcoal: #302b2f;
      --white: #faf9f7;
    }
    body {
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      color: var(--navy);
      background: var(--white);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    body::before, body::after {
      content: '';
      position: fixed;
      width: 400px;
      height: 400px;
      border-radius: 50%;
      filter: blur(120px);
      opacity: 0.25;
      pointer-events: none;
      z-index: -1;
    }
    body::before { top: -100px; right: -100px; background: var(--cyan); }
    body::after { bottom: -100px; left: -100px; background: var(--sage); }

    .container { max-width: 720px; margin: 0 auto; padding: 0 24px; }

    nav {
      padding: 20px 0;
      border-bottom: 1px solid rgba(23, 30, 25, 0.06);
      margin-bottom: 48px;
    }
    nav .inner {
      max-width: 720px;
      margin: 0 auto;
      padding: 0 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    nav a { text-decoration: none; color: var(--navy); }
    nav .brand { font-family: 'Anton', sans-serif; font-size: 20px; text-transform: uppercase; letter-spacing: 1px; }
    nav .back { font-size: 14px; font-weight: 600; color: var(--taupe); }
    nav .back:hover { color: var(--navy); }

    .page-header {
      text-align: center;
      margin-bottom: 56px;
    }
    .page-header h1 {
      font-family: 'Anton', sans-serif;
      font-weight: 400;
      text-transform: uppercase;
      font-size: clamp(2rem, 5vw, 3rem);
      line-height: 1.1;
      margin-bottom: 12px;
    }
    .page-header p {
      font-size: 16px;
      font-weight: 300;
      color: var(--charcoal);
      max-width: 520px;
      margin: 0 auto;
    }

    .cat-section { margin-bottom: 48px; }
    .cat-section h2 {
      font-family: 'Anton', sans-serif;
      font-weight: 400;
      text-transform: uppercase;
      font-size: 1.1rem;
      color: var(--taupe);
      letter-spacing: 2px;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(23, 30, 25, 0.06);
    }
    .cat-section ul { list-style: none; padding: 0; }
    .cat-section li {
      margin-bottom: 6px;
    }
    .cat-section a {
      display: block;
      padding: 12px 16px;
      border-radius: 8px;
      text-decoration: none;
      color: var(--navy);
      font-weight: 400;
      font-size: 15px;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .cat-section a:hover {
      background: rgba(183, 198, 194, 0.12);
      transform: translateX(4px);
    }

    footer {
      text-align: center;
      padding: 24px 0;
      border-top: 1px solid rgba(23, 30, 25, 0.06);
      font-size: 13px;
      font-weight: 300;
      color: var(--taupe);
      margin-top: 32px;
    }
    footer a { color: var(--taupe); text-decoration: underline; text-underline-offset: 3px; }
  </style>
</head>
<body>
  <nav>
    <div class="inner">
      <a href="/" class="brand">SafeClaw</a>
      <a href="/" class="back">&larr; Home</a>
    </div>
  </nav>

  <div class="container">
    <div class="page-header">
      <h1>${title}</h1>
      <p>${subtitle}</p>
    </div>

    ${categoryHtml}
  </div>

  <footer>
    SafeClaw is open source &middot; <a href="https://github.com/AUTHENSOR/SafeClaw">GitHub</a> &middot; <a href="https://authensor.com">Authensor</a>
  </footer>
</body>
</html>`;
}

function generateSitemap(blogPosts, aiseoPosts) {
  const base = 'https://safeclaw-site.pages.dev';
  let urls = `  <url><loc>${base}/</loc><priority>1.0</priority></url>\n`;
  urls += `  <url><loc>${base}/blog/</loc><priority>0.8</priority></url>\n`;

  for (const p of blogPosts) {
    urls += `  <url><loc>${base}/blog/${p.slug}</loc><lastmod>${p.publishDate || '2026-02-13'}</lastmod><priority>0.7</priority></url>\n`;
  }

  if (aiseoPosts.length > 0) {
    urls += `  <url><loc>${base}/knowledge/</loc><priority>0.8</priority></url>\n`;
    for (const p of aiseoPosts) {
      urls += `  <url><loc>${base}/knowledge/${p.slug}</loc><lastmod>${p.publishDate || '2026-02-13'}</lastmod><priority>0.6</priority></url>\n`;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
                            http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
${urls}</urlset>`;
}

// --- Main ---

function processDirectory(postsDir, outDir, isAiseo) {
  if (!fs.existsSync(postsDir)) {
    console.log(`  Skipping ${postsDir} (not found)`);
    return [];
  }

  fs.mkdirSync(outDir, { recursive: true });

  const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.md'));
  const posts = [];

  for (const file of files) {
    const raw = fs.readFileSync(path.join(postsDir, file), 'utf-8');
    const { meta, body } = parseFrontmatter(raw);
    const slug = meta.slug || file.replace('.md', '');
    const bodyHtml = md2html(body);
    const html = blogPostHTML({ ...meta, slug }, bodyHtml, isAiseo);

    // Determine category from content-index or frontmatter
    const category = meta.category || 'general';
    posts.push({ slug, title: meta.title || slug, category, publishDate: meta.publishDate, author: meta.author });

    fs.writeFileSync(path.join(outDir, `${slug}.html`), html);
  }

  console.log(`  Generated ${posts.length} pages in ${outDir}`);

  // Generate index
  const indexHtml = blogIndexHTML(posts, isAiseo);
  fs.writeFileSync(path.join(outDir, 'index.html'), indexHtml);
  console.log(`  Generated index.html`);

  return posts;
}

// Assign categories from content-index.json if available
function enrichWithCategories(posts, postsDir) {
  const indexPath = path.join(path.dirname(postsDir), 'content-index.json');
  if (!fs.existsSync(indexPath)) return posts;

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const catMap = {};
  for (const p of index.posts) {
    catMap[p.slug] = p.category;
  }

  return posts.map(p => ({
    ...p,
    category: catMap[p.slug] || p.category
  }));
}

console.log('SafeClaw Blog Generator');
console.log('=======================\n');

console.log('Processing SEO blog posts...');
let blogPosts = processDirectory(POSTS_DIR, BLOG_OUT, false);
blogPosts = enrichWithCategories(blogPosts, POSTS_DIR);
// Regenerate index with proper categories
const blogIndex = blogIndexHTML(blogPosts, false);
fs.writeFileSync(path.join(BLOG_OUT, 'index.html'), blogIndex);

console.log('\nProcessing AISEO knowledge base...');
let aiseoPosts = processDirectory(AISEO_DIR, KNOWLEDGE_OUT, true);
if (fs.existsSync(path.join(path.dirname(AISEO_DIR), 'aiseo-content-index.json'))) {
  // Will enrich once AISEO posts exist
}

console.log('\nGenerating sitemap...');
const sitemap = generateSitemap(blogPosts, aiseoPosts);
fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), sitemap);
console.log('  Generated sitemap.xml');

// robots.txt
const robots = `User-agent: *
Allow: /
Sitemap: https://safeclaw-site.pages.dev/sitemap.xml
`;
fs.writeFileSync(path.join(__dirname, 'robots.txt'), robots);
console.log('  Generated robots.txt');

console.log('\nDone!');
console.log(`Blog: ${blogPosts.length} posts → ${BLOG_OUT}/`);
console.log(`Knowledge: ${aiseoPosts.length} posts → ${KNOWLEDGE_OUT}/`);
