import { db } from "../db";
import { zendeskArticles } from "../../shared/schema";
import { eq } from "drizzle-orm";

const ZENDESK_SUBDOMAIN = "pitcrewsupport";
const BASE_URL = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/help_center/en-us`;

interface ZendeskArticleResponse {
  id: number;
  title: string;
  body: string;
  html_url: string;
  section_id: number;
  created_at: string;
  updated_at: string;
}

interface ZendeskArticlesPage {
  articles: ZendeskArticleResponse[];
  next_page: string | null;
  count: number;
}

interface ZendeskSection {
  id: number;
  name: string;
  category_id: number;
}

interface ZendeskCategory {
  id: number;
  name: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<h[1-6][^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchSections(): Promise<Map<number, { name: string; categoryId: number }>> {
  const res = await fetch(`${BASE_URL}/sections.json`);
  if (!res.ok) throw new Error(`Failed to fetch sections: ${res.status}`);
  const data = await res.json();
  const map = new Map<number, { name: string; categoryId: number }>();
  for (const s of data.sections as ZendeskSection[]) {
    map.set(s.id, { name: s.name.trim(), categoryId: s.category_id });
  }
  return map;
}

async function fetchCategories(): Promise<Map<number, string>> {
  const res = await fetch(`${BASE_URL}/categories.json`);
  if (!res.ok) throw new Error(`Failed to fetch categories: ${res.status}`);
  const data = await res.json();
  const map = new Map<number, string>();
  for (const c of data.categories as ZendeskCategory[]) {
    map.set(c.id, c.name.trim());
  }
  return map;
}

async function fetchAllArticles(): Promise<ZendeskArticleResponse[]> {
  const articles: ZendeskArticleResponse[] = [];
  let url: string | null = `${BASE_URL}/articles.json?per_page=100`;

  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch articles: ${res.status}`);
    const data: ZendeskArticlesPage = await res.json();
    articles.push(...data.articles);
    url = data.next_page;
  }

  return articles;
}

export async function syncZendeskArticles(): Promise<{ synced: number; total: number }> {
  console.log(`[ZendeskSync] Starting sync from ${ZENDESK_SUBDOMAIN}.zendesk.com...`);

  const [sections, categories, articles] = await Promise.all([
    fetchSections(),
    fetchCategories(),
    fetchAllArticles(),
  ]);

  console.log(`[ZendeskSync] Fetched ${articles.length} articles, ${sections.size} sections, ${categories.size} categories`);

  let synced = 0;
  for (const article of articles) {
    const section = sections.get(article.section_id);
    const categoryName = section ? categories.get(section.categoryId) : undefined;
    const plainBody = stripHtml(article.body || "");

    if (!plainBody || plainBody.length < 10) {
      console.log(`[ZendeskSync] Skipping article ${article.id} "${article.title}" - empty body`);
      continue;
    }

    const externalId = String(article.id);

    const existing = await db.select({ id: zendeskArticles.id, updatedAt: zendeskArticles.updatedAt })
      .from(zendeskArticles)
      .where(eq(zendeskArticles.externalId, externalId))
      .limit(1);

    const articleUpdatedAt = new Date(article.updated_at);

    if (existing.length > 0) {
      if (existing[0].updatedAt && existing[0].updatedAt >= articleUpdatedAt) {
        continue;
      }
      await db.update(zendeskArticles)
        .set({
          title: article.title,
          body: plainBody,
          htmlUrl: article.html_url,
          sectionId: article.section_id ? String(article.section_id) : null,
          sectionName: section?.name || null,
          categoryId: section ? String(section.categoryId) : null,
          categoryName: categoryName || null,
          updatedAt: articleUpdatedAt,
          syncedAt: new Date(),
        })
        .where(eq(zendeskArticles.externalId, externalId));
      synced++;
      console.log(`[ZendeskSync] Updated: "${article.title}"`);
    } else {
      await db.insert(zendeskArticles).values({
        externalId,
        title: article.title,
        body: plainBody,
        htmlUrl: article.html_url,
        sectionId: article.section_id ? String(article.section_id) : null,
        sectionName: section?.name || null,
        categoryId: section ? String(section.categoryId) : null,
        categoryName: categoryName || null,
        locale: "en-us",
        createdAt: new Date(article.created_at),
        updatedAt: articleUpdatedAt,
      });
      synced++;
      console.log(`[ZendeskSync] Inserted: "${article.title}"`);
    }
  }

  console.log(`[ZendeskSync] Sync complete: ${synced} articles synced/updated out of ${articles.length} total`);
  return { synced, total: articles.length };
}
