// Minimal shim of the dripline plugin API.
// When this plugin is built inside (or installed alongside) the real
// `dripline` package, its types take precedence and this shim is ignored.
// Source of truth: packages/dripline/src/plugin/{api,types}.ts in
// https://github.com/Michaelliv/dripline

declare module "dripline" {
  export type ColumnType =
    | "string"
    | "number"
    | "boolean"
    | "json"
    | "datetime";

  export interface ColumnDef {
    name: string;
    type: ColumnType;
    description?: string;
  }

  export interface KeyColumn {
    name: string;
    required: "required" | "optional" | "any_of";
    operators?: string[];
  }

  export interface Qual {
    column: string;
    operator: string;
    value: unknown;
  }

  export interface ConnectionConfig {
    name: string;
    plugin: string;
    config: Record<string, unknown>;
  }

  export interface QueryContext {
    connection: ConnectionConfig;
    quals: Qual[];
    columns: string[];
    limit?: number;
    cursor?: { column: string; value: unknown } | null;
    signal?: AbortSignal;
    fetch: typeof globalThis.fetch;
  }

  export type ListFunc = (
    ctx: QueryContext,
  ) =>
    | Generator<Record<string, unknown>>
    | AsyncGenerator<Record<string, unknown>>;

  export type GetFunc = (
    ctx: QueryContext,
  ) => Record<string, unknown> | null;

  export type HydrateFunc = (
    ctx: QueryContext,
    row: Record<string, unknown>,
  ) => Record<string, unknown>;

  export interface TableDefinition {
    description?: string;
    columns: ColumnDef[];
    keyColumns?: KeyColumn[];
    primaryKey?: string[];
    cursor?: string;
    syncParams?: Record<string, unknown>;
    initialCursor?:
      | unknown
      | ((params: Record<string, unknown>) => unknown);
    list?: ListFunc;
    get?: GetFunc;
    hydrate?: Record<string, HydrateFunc>;
  }

  export interface SchemaField {
    type: "string" | "number" | "boolean";
    required?: boolean;
    description?: string;
    default?: unknown;
    env?: string;
  }

  export interface DriplinePluginAPI {
    setName(name: string): void;
    setVersion(version: string): void;
    setConnectionSchema(schema: Record<string, SchemaField>): void;
    registerTable(name: string, def: TableDefinition): void;
    onInit(fn: (config: Record<string, unknown>) => void): void;
    log: {
      info(msg: string): void;
      warn(msg: string): void;
      error(msg: string): void;
    };
  }

  export interface FetchResponse {
    status: number;
    headers: Record<string, string>;
    body: unknown;
  }

  /** Synchronous HTTP helper exported by dripline for use inside list() generators. */
  export function syncGet(
    url: string,
    headers?: Record<string, string>,
  ): FetchResponse;
}
