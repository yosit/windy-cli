import { encode } from "@toon-format/toon";

export const OUTPUT_FORMAT_CHOICES = ["toon", "json"] as const;
export type OutputFormat = (typeof OUTPUT_FORMAT_CHOICES)[number];
export const DEFAULT_OUTPUT_FORMAT: OutputFormat = "json";

export function formatToon(data: unknown): string {
  return encode(data);
}
