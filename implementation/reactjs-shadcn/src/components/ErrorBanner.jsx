import { AlertCircle } from "lucide-react";

// Friendly, in-UI error surface (Best practice #10). role="alert" so assistive
// tech announces it immediately. Renders nothing when there's no error.
export function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
