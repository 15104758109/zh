import type { FactStateName } from "./common-types.js";

export function isFactStateTransitionAllowed(
  from: FactStateName | null,
  to: FactStateName,
  withinFormalReplacement = false,
): boolean {
  if (from === null) return to === "candidate";
  if (from === "candidate") return to === "formal" || to === "shadow";
  if (from === "formal") return withinFormalReplacement && to === "shadow";
  return false;
}
