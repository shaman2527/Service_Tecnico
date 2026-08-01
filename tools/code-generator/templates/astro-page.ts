import type { PageConfig } from "../types";

export function generateAstroPage(page: PageConfig): string {
  const importPath = page.layout === "AdminLayout"
    ? `../../layouts/AdminLayout.astro`
    : `../../layouts/PanelLayout.astro`;

  const componentImport = page.layout === "AdminLayout"
    ? `../../components/admin/${page.componentName}`
    : `../../components/panel/${page.componentName}`;

  const routePrefix = page.layout === "AdminLayout" ? "admin" : "panel";

  return `---
export const prerender = false;
import ${page.layout} from "${importPath}";
import ${page.componentName} from "${componentImport}";
---
<${page.layout} title="${page.title}" activeSection="${page.activeSection}">
  <${page.componentName} client:load />
</${page.layout}>
`;
}
