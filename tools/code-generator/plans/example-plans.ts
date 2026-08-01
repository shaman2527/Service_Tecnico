/**
 * Harness ENGINEERING — Example Page Plans
 *
 * Replace this file with your project's actual page plans.
 * Each plan describes WHAT a page does, not HOW (the code-generator handles that).
 *
 * Copy this file to mvp-pages.ts and customize for your project.
 */

import type { PagePlan } from "../types";

export const plans: PagePlan[] = [
  {
    route: "/",
    role: "user",
    title: "Dashboard",
    description: "Main dashboard with stats and quick actions",
    ui: "dashboard",
    apiEndpoint: "/api/dashboard",
    apiMethods: ["GET"],
    features: [
      "Show summary stats",
      "Quick action buttons",
      "Recent activity feed",
    ],
  },
  {
    route: "/items",
    role: "admin",
    title: "Items",
    description: "CRUD management for items",
    ui: "crud",
    apiEndpoint: "/api/items",
    apiMethods: ["GET", "POST", "PUT", "DELETE"],
    features: [
      "List items with search and pagination",
      "Create new item",
      "Edit existing item",
      "Delete item",
    ],
  },
  {
    route: "/profile",
    role: "user",
    title: "Profile",
    description: "User profile page",
    ui: "readonly",
    apiEndpoint: "/api/profile",
    apiMethods: ["GET"],
    features: [
      "View profile information",
      "Edit name and email",
      "Change password",
    ],
  },
];
