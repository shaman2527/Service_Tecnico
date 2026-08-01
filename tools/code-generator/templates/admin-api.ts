import type { PageConfig, TableSchema } from "../types";
import { getTableSchema } from "../types";

export function generateAdminCrudApi(page: PageConfig, _apiDir?: string): string {
  const schema = getTableSchema(page.table);
  const pk = page.pkField;
  const singular = page.singularTitle;

  const listFields = page.listFields.filter(f => f !== pk);
  const formFields = page.formFields.filter(f => f !== "publicado_por" && (f !== pk || pk !== "id"));

  const listSelect = listFields.map(f => `"${f}"`).join(", ");
  const insertFields = [...new Set([...formFields, ...(pk !== "id" ? [pk] : [])])].map(f => {
    if (f === "publicado_por") return `    ${f}: authUser.id`;
    if (f === pk) return `    ${pk}: body.${pk}`;
    return `    ${f}: body.${f}`;
  }).join(",\n");
  const updateFields = formFields.map(f => {
    if (f === pk || f === "fecha_publicacion" || f === "created_at" || f === "updated_at") return "";
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

  const orderCandidates = ["created_at", "orden", "fecha_publicacion", "titulo", "nombre", "clave"];
  const orderCol = orderCandidates.find(c => schema.columns.some(col => col.name === c));
  const listOrder = orderCol ? `.order("${orderCol}"${orderCol === "created_at" || orderCol === "fecha_publicacion" ? ', { ascending: false }' : ''})` : '';

  const nonNullableFields = formFields
    .filter(f => {
      const col = schema.columns.find(c => c.name === f);
      return col && !col.nullable && col.type === "string" && f !== "imagen_url" && f !== pk;
    });
  const bodyValidation = nonNullableFields.length > 0
    ? nonNullableFields.map(f => `    if (!body.${f}) {
      return new Response(JSON.stringify({ error: "${f} es requerido" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }`).join("\n")
    : `    // All fields are optional or non-string`;

  const getHandler = `// GET /api/${page.apiEndpoint}
export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const search = url.searchParams.get("q") || "";

    let query = supabaseAdmin
      .from("${page.table}")
      .select(${page.listFields.length > 0 ? `"${[...new Set([pk, ...listFields])].join(", ")}"` : '"*"'});

    if (search) {
      query = query.or(\`${page.searchFields.map(f => `${f}.ilike.%\${search}%`).join(",")}\`);
    }

${page.table === "configuracion" ? `
    // Excluir claves de estado interno de la garita
    query = query.not("clave", "like", "dentro_%").not("clave", "like", "historial_%").not("clave", "like", "vehiculo_%");` : ""}
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
    if (!user || user.rol !== "admin") {
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

${page.logToJunta ? `    await supabaseAdmin.rpc("registrar_accion_junta", {
      p_accion: "crear_${page.table}",
      p_contexto: { ${pk}: data.${pk} },
      p_descripcion: \`Admin \${user.nombre_completo} creó ${singular}: \${data.${pk}}\`,
    });` : ""}

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
    if (!user || user.rol !== "admin") {
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
      .eq("${pk}", body.${pk});

    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

${page.logToJunta ? `    await supabaseAdmin.rpc("registrar_accion_junta", {
      p_accion: "actualizar_${page.table}",
      p_contexto: { ${pk}: body.${pk}, cambios: updates },
      p_descripcion: \`Admin \${user.nombre_completo} actualizó ${singular} \${body.${pk}}\`,
    });` : ""}

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Error interno del servidor" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};`;

  const deleteHandler = `// DELETE /api/${page.apiEndpoint}
export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const user = locals.user;
    if (!user || user.rol !== "admin") {
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

    const { error: deleteError } = await supabaseAdmin
      .from("${page.table}")
      .delete()
      .eq("${pk}", body.${pk});

    if (deleteError) {
      return new Response(JSON.stringify({ error: deleteError.message }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

${page.logToJunta ? `    await supabaseAdmin.rpc("registrar_accion_junta", {
      p_accion: "eliminar_${page.table}",
      p_contexto: { ${pk}: body.${pk} },
      p_descripcion: \`Admin \${user.nombre_completo} eliminó ${singular} \${body.${pk}}\`,
    });` : ""}

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Error interno del servidor" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};`;

  const isReadonly = page.pageType === "readonly";

  return `import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/supabase-admin";

export const prerender = false;

${getHandler}
${!isReadonly ? `\n${postHandler}\n${putHandler}\n${deleteHandler}` : ""}
`;
}
