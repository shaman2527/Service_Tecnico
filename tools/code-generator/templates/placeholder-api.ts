import type { PageConfig } from "../types";

export function generatePlaceholderApi(page: PageConfig, _apiDir?: string): string {
  return `import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/supabase-admin";

export const prerender = false;

// GET /api/${page.apiEndpoint}
export const GET: APIRoute = async () => {
  return new Response(JSON.stringify({ message: "${page.title} API — pendiente de implementación" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
`;
}
