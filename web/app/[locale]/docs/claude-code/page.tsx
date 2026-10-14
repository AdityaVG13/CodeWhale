import { DocArticle } from "../_components/doc-article";
import { getDocsClaudeCode } from "@/lib/i18n/dictionaries";
import { buildPageMetadata } from "@/lib/page-meta";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = getDocsClaudeCode(locale);
  return buildPageMetadata({ path: "/docs/claude-code", locale, title: t.metaTitle, description: t.metaDescription });
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <DocArticle t={getDocsClaudeCode(locale)} locale={locale} />;
}
