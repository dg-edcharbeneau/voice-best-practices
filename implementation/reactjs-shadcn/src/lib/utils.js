import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// The standard shadcn/ui class helper: merge conditional class names (clsx) and
// de-duplicate conflicting Tailwind utilities (tailwind-merge). Every vendored
// ui/* component imports `cn` from here.
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
