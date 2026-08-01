/**
 * Next.js Stack Adapter for Harness ENGINEERING
 *
 * Implements the Stack interface for Next.js 14+ with App Router.
 *
 * Created by Shaman / Roberth Silva — https://github.com/shaman2527
 */

import type { Stack, PagePlan, GenerateOptions, BuildResult, EngineState } from "../../core/types";
import type { PageConfig } from "../../../code-generator/types";
import { runBuild } from "../../../governance/build-validator";

function toPageConfig(plan: PagePlan, defaultRole: string = "user"): PageConfig {
  return {
    route: plan.route,
    role: plan.role || defaultRole,
    title: plan.title,
    singularTitle: plan.singularTitle,
    activeSection: plan.route.split("/").pop() || plan.route,
    layout: plan.route.startsWith("admin") ? "AdminLayout" : "BaseLayout",
    componentName: plan.componentName,
    apiEndpoint: plan.apiEndpoint,
    table: plan.table,
    description: plan.description,
    pageType: plan.pageType || "crud",
    logToJunta: false,
    pkField: plan.pkField,
    listFields: plan.listFields,
    formFields: plan.formFields,
    searchFields: plan.searchFields,
  };
}

export const nextStack: Stack = {
  id: "next",
  name: "Next.js + React + Tailwind 4",
  description: "Next.js 14+ App Router with React Server Components and Tailwind CSS",

  build: async (timeoutMs?: number): Promise<BuildResult> => {
    return runBuild("npm", ["run", "build"], timeoutMs);
  },

  test: async (timeoutMs?: number): Promise<BuildResult> => {
    return runBuild("npm", ["test", "--run"], timeoutMs);
  },

  generate: (plans: PagePlan[], _options?: GenerateOptions): EngineState => {
    // TODO: Implement Next.js code generation
    // Uses code-generator/engine.ts with Next.js templates
    const configs = plans.map(p => toPageConfig(p));
    // For now, delegate to existing generator with note
    console.log("  ⚡ Next.js generation coming soon. Astro generator active.");
    return { pages: configs, generated: [], errors: [] };
  },
};
