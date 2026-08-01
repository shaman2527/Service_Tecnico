import type { Stack, PagePlan, GenerateOptions, BuildResult, EngineState } from "../../core/types";
import { generateAll } from "../../../code-generator/engine";
import type { PageConfig, GeneratedFile } from "../../../code-generator/types";
import { runBuild } from "../../../governance/build-validator";
import { allPages as astroPlans } from "../../../code-generator/plans/mvp-pages";

function toPageConfig(plan: PagePlan, defaultRole: string = "user"): PageConfig {
  const match = astroPlans.find(p => p.route === plan.route || p.componentName === plan.componentName);
  if (match) return match;

  return {
    route: plan.route,
    role: plan.role || defaultRole,
    title: plan.title,
    singularTitle: plan.singularTitle,
    activeSection: plan.route.split("/").pop() || plan.route,
    layout: plan.route.startsWith("admin") ? "AdminLayout" : (plan.route.startsWith("panel") ? "PanelLayout" : "BaseLayout"),
    componentName: plan.componentName,
    apiEndpoint: plan.apiEndpoint,
    table: plan.table,
    description: "",
    pageType: plan.pageType === "placeholder" ? "crud" : plan.pageType,
    logToJunta: plan.pageType === "crud",
    pkField: plan.pkField,
    listFields: plan.listFields,
    formFields: plan.formFields,
    statsFields: plan.statsFields,
    searchFields: plan.searchFields,
    filters: plan.filters,
    emptyMessage: plan.emptyMessage || "No hay registros",
  };
}

export const astroStack: Stack = {
  id: "astro-react-supabase",
  name: "Astro 4 + React + Tailwind + Supabase",
  description: "Full-stack web app with Astro, React islands, Tailwind CSS, and Supabase database",

  build: (timeoutMs?: number): BuildResult => {
    return runBuild("npm", ["run", "build"], timeoutMs);
  },

  test: (timeoutMs?: number): BuildResult => {
    return runBuild("npm", ["test", "--", "--run"], timeoutMs);
  },

  generate: (plans: PagePlan[], options: GenerateOptions = {}): EngineState => {
    const configs = plans.map(toPageConfig);
    const result = generateAll(configs, {
      writeMode: options.writeMode,
      dryRun: options.dryRun,
      filterPages: options.filterPages,
      verbose: options.verbose,
      incremental: options.incremental,
    });

    return {
      generated: result.generated,
      errors: result.errors,
    };
  },
};
