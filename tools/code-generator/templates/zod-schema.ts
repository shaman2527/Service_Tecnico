import type { PageConfig, ColumnDef } from "../types";
import { getTableSchema } from "../types";

export function generateZodSchema(page: PageConfig): string {
  const schema = getTableSchema(page.table);
  const formCols = schema.columns.filter(c =>
    page.formFields.includes(c.name) && c.name !== "id" && c.name !== "publicado_por"
  );

  const rules = formCols.map(c => {
    let rule = `  ${c.name}: `;
    if (c.type === "string") {
      rule += "z.string()";
      if (c.nullable) rule += ".nullable()";
      if (c.isEnum) rule += `.refine(v => !v || ${JSON.stringify(c.isEnum)}.includes(v), "Valor inválido")`;
      if (c.name === "titulo") rule += ".min(1, 'Requerido').max(200)";
      if (c.name === "contenido") rule += ".min(1, 'Requerido')";
      if (c.name === "telefono") rule += ".min(7).max(20)";
    } else if (c.type === "number") {
      rule += "z.number()";
      if (c.nullable) rule += ".nullable()";
      rule += ".min(0)";
    } else if (c.type === "boolean") {
      rule += "z.boolean()";
      if (c.nullable) rule += ".nullable()";
    }
    return rule + ",";
  });

  const extendFields = formCols
    .filter(c => c.isEnum)
    .map(c => `  ${c.name}: ${page.table}Schema.shape.${c.name},`).join("\n");

  const createFields = formCols
    .filter(c => !c.nullable && c.name !== "fijo" && c.name !== "visible")
    .map(c => `  ${c.name}: ${page.table}Schema.shape.${c.name},`).join("\n");

  return `import { z } from "zod";

export const ${page.table}Schema = z.object({
${rules.join("\n")}
});

export const ${page.table}UpdateSchema = z.object({
${extendFields ? extendFields : rules.join("\n")}
});

export const ${page.table}CreateSchema = z.object({
${createFields ? createFields : rules.filter(r => !r.includes(".nullable()")).join("\n")}
});

export type ${page.table.charAt(0).toUpperCase() + page.table.slice(1)}FormData = z.infer<typeof ${page.table}Schema>;
`;
}
