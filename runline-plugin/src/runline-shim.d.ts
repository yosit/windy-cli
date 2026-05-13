// Minimal shim of the runline plugin API.
// When this file is dropped into the runline monorepo, the real types from
// `runline` take precedence and this shim is ignored.

declare module "runline" {
  export type FieldType = "string" | "number" | "boolean" | "object" | "array";

  export interface ConnectionField {
    type: FieldType;
    required?: boolean;
    description?: string;
    env?: string;
    default?: unknown;
  }

  export interface InputField {
    type: FieldType;
    required?: boolean;
    description?: string;
    default?: unknown;
    enum?: readonly unknown[];
  }

  export interface ActionContext {
    connection: { config: Record<string, unknown> };
  }

  export interface ActionDefinition {
    description: string;
    inputSchema: Record<string, InputField>;
    execute(
      input: Record<string, unknown>,
      ctx: ActionContext,
    ): Promise<unknown>;
  }

  export interface RunlinePluginAPI {
    setName(name: string): void;
    setVersion(version: string): void;
    setConnectionSchema(schema: Record<string, ConnectionField>): void;
    registerAction(name: string, def: ActionDefinition): void;
  }
}
