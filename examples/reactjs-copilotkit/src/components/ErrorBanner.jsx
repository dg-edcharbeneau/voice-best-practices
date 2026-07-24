// Friendly, in-UI error surface (Best practice #10). role="alert" so assistive
// tech announces it immediately. Renders nothing when there's no error.
export function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <p className="error" role="alert">
      {message}
    </p>
  );
}
