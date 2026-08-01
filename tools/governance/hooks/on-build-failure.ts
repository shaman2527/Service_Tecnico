import type { HookPayload } from "../types";

export async function onBuildFailure(payload: HookPayload): Promise<void> {
  const errors = payload.data.errors as { file: string; message: string; line?: number }[];

  if (errors.length === 0) return;

  console.log(`   ⚠️  Build failed with ${errors.length} errors — suggesting fixes...`);

  const suggestions: string[] = [];
  const errorMessages = errors.map(e => e.message);

  for (const msg of errorMessages) {
    if (msg.includes("is not assignable to type") || msg.includes("Type '")) {
      suggestions.push("🔧 Error de tipo: verificar si el schema de la tabla cambió o si falta una columna en la interfaz");
    }
    if (msg.includes("Cannot find name") || msg.includes("not found")) {
      suggestions.push("🔧 Error de import: verificar que el módulo existe y el path es correcto");
    }
    if (msg.includes("is possibly 'null'") || msg.includes("is possibly 'undefined'")) {
      suggestions.push("🔧 Null check faltante: agregar ? o if antes de acceder a la propiedad");
    }
    if (msg.includes("Property '") && msg.includes("does not exist")) {
      suggestions.push("🔧 Propiedad inexistente: verificar el nombre en la interfaz o agregarla si es nueva");
    }
    if (msg.includes("class=") || msg.includes("className")) {
      suggestions.push("🔧 En JSX usar className= en vez de class=");
    }
    if (msg.includes("export") && msg.includes("not found")) {
      suggestions.push("🔧 Export faltante: verificar que el archivo exporta el símbolo correctamente");
    }
  }

  // Deduplicate and print unique suggestions
  const uniqueSuggestions = [...new Set(suggestions)];
  for (const s of uniqueSuggestions) {
    console.log(`   ${s}`);
  }

  // Save recurring errors to learning injector patterns
  if (errors.length > 2) {
    try {
      const { savePatternLearning } = await import("../learning-injector");
      const topErrors = errors.slice(0, 3);
      for (const err of topErrors) {
        savePatternLearning({
          kind: "recurring-error",
          description: `Build error: ${err.message.slice(0, 120)}`,
          severity: "high",
          evidence: [`${err.file}:${err.line || "?"}`],
          suggestedFix: uniqueSuggestions[0] || undefined,
        });
      }
      console.log(`   📝 Saved ${topErrors.length} recurring errors to patterns.md`);
    } catch {
      // learning-injector not available
    }
  }
}
