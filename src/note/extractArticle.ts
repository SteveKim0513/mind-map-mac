import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

export interface Extracted {
  title: string;
  markdown: string; // article body as Markdown ('' if extraction failed)
  siteName?: string;
  excerpt?: string;
}

/** Extract a readable article from raw page HTML and convert it to Markdown.
 * Runs in the renderer so it can use the native DOM (no jsdom needed). */
export function extractArticle(html: string, finalUrl: string): Extracted {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // A <base> makes Readability/Turndown resolve relative links and images.
  if (doc.head && !doc.querySelector('base')) {
    const base = doc.createElement('base');
    base.setAttribute('href', finalUrl);
    doc.head.prepend(base);
  }

  const metaTitle =
    doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
    doc.querySelector('title')?.textContent ||
    finalUrl;
  let title = (metaTitle || finalUrl).trim();
  let markdown = '';
  let siteName: string | undefined;
  let excerpt: string | undefined;

  try {
    // Readability mutates the document, so it operates on our throwaway parse.
    const article = new Readability(doc).parse();
    if (article) {
      if (article.title) title = article.title.trim();
      siteName = article.siteName ?? undefined;
      excerpt = article.excerpt ?? undefined;
      const td = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
      });
      markdown = td.turndown(article.content || '').trim();
    }
  } catch {
    /* extraction failed → fall back to title + empty body */
  }

  return { title, markdown, siteName, excerpt };
}
