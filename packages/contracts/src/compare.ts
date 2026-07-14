import type { ComparisonResult, SchemaDescriptor } from "./common-types.js";

export function compareSchemaDescriptors(
  left: SchemaDescriptor,
  right: SchemaDescriptor,
): ComparisonResult {
  return left.schema_id === right.schema_id
    && left.version === right.version
    && left.sha256 === right.sha256
    ? "SAME"
    : "CHANGED";
}
