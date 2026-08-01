import type { PageConfig } from "../types";

export function generatePlaceholderComponent(page: PageConfig): string {
  return `import React from "react";

interface ${page.componentName}Props {}

export const ${page.componentName}: React.FC<${page.componentName}Props> = () => {
  return (
    <div className="text-center py-16">
      <h2 className="text-xl font-semibold text-teal-500 mb-2">${page.title}</h2>
      <p className="text-card/60">${page.description}</p>
    </div>
  );
};

export default ${page.componentName};
`;
}
