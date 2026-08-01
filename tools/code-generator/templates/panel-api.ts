import type { PageConfig, TableSchema } from "../types";
import { getTableSchema } from "../types";

export function generatePanelApi(page: PageConfig, _apiDir?: string): string {
  const schema = getTableSchema(page.table);
  const pk = page.pkField;
  const singular = page.singularTitle;
  const isReadonly = page.pageType === "readonly" || page.pageType === "dashboard";

  const listFields = page.listFields.filter(f => f !== pk);
  const formFields = page.formFields.filter(f => f !== pk && f !== "apartamento_id");

  const listSelect = listFields.map(f => `"${f}"`).join(", ");
  const insertFields = [...new Set([...formFields, ...(pk !== "id" ? [pk] : [])])].map(f => {
    if (f === "apartamento_id") return `    apartamento_id: user.apartamento_id`;
    return `    ${f}: body.${f}`;
  }).join(",\n");
  const updateFields = formFields.map(f => {
    if (f === pk || f === "apartamento_id" || f === "created_at" || f === "updated_at") return "";
    return `  if (body.${f} !== undefined) updates.${f} = body.${f};`;
  }).filter(Boolean).join("\n");

  const hasEnum = schema.columns.some(c => c.isEnum && formFields.includes(c.name));
  const enumValidations = schema.columns
    .filter(c => c.isEnum && formFields.includes(c.name))
    .map(c => {
      const vals = c.isEnum!.map(v => `"${v}"`).join(", ");
      return `  const ${c.name}Validos = [${vals}];
  if (body.${c.name} && !${c.name}Validos.includes(body.${c.name})) {
    return new Response(JSON.stringify({ error: "${c.name} inválido" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }`;
    }).join("\n");

  const hasAptoFilter = schema.columns.some(c => c.name === "apartamento_id");
  const aptoFilter = hasAptoFilter
    ? `\n      .eq("apartamento_id", user.apartamento_id ?? "")`
    : "";

  const orderCandidates = ["created_at", "orden", "fecha_publicacion", "titulo", "nombre", "clave"];
  const orderCol = orderCandidates.find(c => schema.columns.some(col => col.name === c));
  const listOrder = orderCol ? `.order("${orderCol}"${orderCol === "created_at" || orderCol === "fecha_publicacion" ? ', { ascending: false }' : ''})` : '';

  const nonNullableFields = formFields
    .filter(f => {
      const col = schema.columns.find(c => c.name === f);
      return col && !col.nullable && col.type === "string" && f !== pk;
    });
  const bodyValidation = nonNullableFields.length > 0
    ? nonNullableFields.map(f => `    if (!body.${f}) {
      return new Response(JSON.stringify({ error: "${f} es requerido" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }`).join("\n")
    : `    // All fields are optional or non-string`;

  const getHandler = `// GET /api/${page.apiEndpoint}
export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const user = locals.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 403, headers: { "Content-Type": "application/json" },
      });
    }

    const url = new URL(request.url);
    const search = url.searchParams.get("q") || "";

    let query = supabaseAdmin
      .from("${page.table}")
      .select(${page.listFields.length > 0 ? `"${[...new Set([pk, ...listFields])].join(", ")}"` : '"*"'})${aptoFilter};

    if (search) {
      query = query.or(\`${page.searchFields.map(f => `${f}.ilike.%\${search}%`).join(",")}\`);
    }

    const { data, error } = await query${listOrder};

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Error interno del servidor" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};`;

  const postHandler = `// POST /api/${page.apiEndpoint}
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const user = locals.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 403, headers: { "Content-Type": "application/json" },
      });
    }

    const body = await request.json();

${bodyValidation}

${hasEnum ? enumValidations : ""}

    const { data, error } = await supabaseAdmin
      .from("${page.table}")
      .insert({
${insertFields}
      })
      .select("${pk}")
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, ${pk}: data.${pk} }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Error interno del servidor" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};`;

  const putHandler = `// PUT /api/${page.apiEndpoint}
export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const user = locals.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 403, headers: { "Content-Type": "application/json" },
      });
    }

    const body = await request.json();
    if (!body.${pk}) {
      return new Response(JSON.stringify({ error: "ID requerido" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const updates: Record<string, any> = {};
${updateFields}

    if (Object.keys(updates).length === 0) {
      return new Response(JSON.stringify({ error: "No hay campos para actualizar" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const { error: updateError } = await supabaseAdmin
      .from("${page.table}")
      .update(updates)
      .eq("${pk}", body.${pk})
${hasAptoFilter ? `      .eq("apartamento_id", user.apartamento_id)` : ""}

    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Error interno del servidor" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};`;

  return `import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/supabase-admin";

export const prerender = false;

${getHandler}
${!isReadonly ? `\n${postHandler}\n${putHandler}` : ""}
`;
}
