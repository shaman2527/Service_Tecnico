import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { PageConfig } from "../code-generator/types";
import type { PatternMatch } from "./types";
import { config } from "../config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");

export function findAllAstroPages(baseDir?: string): {
  route: string;
  layout: string;
  isPlaceholder: boolean;
  title: string;
}[] {
  const pagesDir = path.join(projectRoot, baseDir || config.paths.pagesDir);
  if (!fs.existsSync(pagesDir)) return [];

  const results: { route: string; layout: string; isPlaceholder: boolean; title: string }[] = [];

  function scan(dir: string, prefix: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath, `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith(".astro")) {
        const routeName = entry.name === "index.astro" ? `${prefix}index` : `${prefix}${entry.name.replace(".astro", "")}`;
        const content = fs.readFileSync(fullPath, "utf-8");
        const layoutMatch = content.match(/import\s+(\w+Layout)\s+from/);
        const placeholderMatch = content.match(/Pendiente de implementaci[oó]n/);
        const titleMatch = content.match(/title="([^"]+)"/);
        results.push({
          route: routeName,
          layout: layoutMatch ? layoutMatch[1] : "unknown",
          isPlaceholder: !!placeholderMatch,
          title: titleMatch ? titleMatch[1] : routeName,
        });
      }
    }
  }

  scan(pagesDir, "");
  return results;
}

export function detectPatterns(pages: PageConfig[]): PatternMatch[] {
  const patterns: PatternMatch[] = [];
  const astroPages = findAllAstroPages();

  // Pattern 1: Placeholder pages
  const placeholders = astroPages.filter(p => p.isPlaceholder);
  if (placeholders.length > 0) {
    patterns.push({
      kind: "placeholder",
      confidence: 0.95,
      description: `${placeholders.length} páginas placeholder detectadas`,
      files: placeholders.map(p => `${config.paths.pagesDir}/${p.route}.astro`),
      suggestedAction: "run-engine",
    });

    // Group placeholders by layout
    const byLayout: Record<string, typeof placeholders> = {};
    for (const p of placeholders) {
      byLayout[p.layout] = [...(byLayout[p.layout] || []), p];
    }

    for (const [layout, pages] of Object.entries(byLayout)) {
      if (pages.length >= 3) {
        patterns.push({
          kind: "repetition",
          confidence: 0.85,
          description: `${pages.length} páginas ${layout} placeholder siguen el mismo patrón (repetitivo)`,
          files: pages.map(p => `${config.paths.pagesDir}/${p.route}.astro`),
          suggestedAction: "create-template",
        });
      }
    }
  }

  // Pattern 2: Pages with defined config but no component
  for (const page of pages) {
    const adminPages = astroPages.filter(p => p.route === page.route);
    if (adminPages.length === 0) {
      patterns.push({
        kind: "missing-feature",
        confidence: 0.9,
        description: `Página "${page.route}" definida en plan pero sin archivo .astro`,
        files: [],
        suggestedAction: "run-engine",
      });
    }
  }

  // Pattern 3: Missing templates for PanelLayout
  const panelPlaceholders = placeholders.filter(p => p.layout === "PanelLayout");
  if (panelPlaceholders.length >= 3) {
    patterns.push({
      kind: "missing-template",
      confidence: 0.8,
      description: `${panelPlaceholders.length} páginas PanelLayout sin template especializado. Se necesita template panel-component + panel-api`,
      files: panelPlaceholders.map(p => `${config.paths.pagesDir}/${p.route}.astro`),
      templateName: "panel-component",
      suggestedAction: "create-template",
    });
  }

  return patterns;
}
