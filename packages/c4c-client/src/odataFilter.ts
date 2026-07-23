/**
 * Helpers para construir $filter de OData v1/v2 sin concatenar strings a
 * mano en cada dominio. C4C usa comillas simples para literales string;
 * escapamos duplicando comillas simples internas (regla estandar OData).
 */
export function odataStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function eq(field: string, value: string): string {
  return `${field} eq ${odataStringLiteral(value)}`;
}

export function eqBool(field: string, value: boolean): string {
  return `${field} eq ${value ? "true" : "false"}`;
}

export function eqRaw(field: string, rawValue: string): string {
  return `${field} eq ${rawValue}`;
}

export function and(...clauses: string[]): string {
  return clauses.filter(Boolean).join(" and ");
}

export function cmpRaw(field: string, operator: "gt" | "ge" | "le" | "lt", rawValue: string): string {
  return `${field} ${operator} ${rawValue}`;
}

/** Junta clausulas con OR, envolviendo en parentesis solo si hay mas de una. */
export function or(...clauses: string[]): string {
  const filtered = clauses.filter(Boolean);
  if (filtered.length <= 1) return filtered[0] ?? "";
  return `(${filtered.join(" or ")})`;
}
