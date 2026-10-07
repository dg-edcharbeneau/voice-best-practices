using System.Globalization;

namespace VoiceBestPractices.Client.Voice;

/// <summary>
/// The one explicit source of truth for the voice UI (Best practice #2). Every
/// state maps to a visible indicator; the UI is a pure projection of this value.
/// The orchestrator in conversation.js drives the transitions; this enum is the
/// C# mirror the Razor components render.
/// </summary>
public enum ConversationState
{
    Idle,
    Connecting,
    Listening,
    Thinking,
    Speaking,
    Error,
}

/// <summary>
/// One interim/committed transcript update from the Flux turn stream.
/// <c>Committed = true</c> means the in-progress turn is final.
/// </summary>
public sealed record TranscriptUpdate(string Interim, bool Committed);

/// <summary>A raw browser error marshalled up from JS, before humanizing.</summary>
public sealed record JsError(string Name, string Message);

/// <summary>
/// One row of the turn-taking / barge-in trace emitted by conversation.js (see
/// diagnostics.js for the shape). <c>At</c> is milliseconds since the session's
/// first event, so it reads as latency rather than wall-clock time.
/// </summary>
public sealed record DiagnosticEvent(int Seq, double At, string Channel, string Label, string? Detail)
{
    /// <summary>Relative timestamp, e.g. <c>+4.21s</c>.</summary>
    public string FormattedAt => $"+{(At / 1000).ToString("0.00", CultureInfo.InvariantCulture)}s";
}

public static class ConversationStates
{
    /// <summary>Human-readable label for each state (single source of meaning).</summary>
    public static string Label(this ConversationState state) => state switch
    {
        ConversationState.Idle => "Idle",
        ConversationState.Connecting => "Connecting…",
        ConversationState.Listening => "Listening",
        ConversationState.Thinking => "Thinking…",
        ConversationState.Speaking => "Speaking",
        ConversationState.Error => "Error",
        _ => state.ToString(),
    };

    /// <summary>The <c>data-state</c> value that drives all state-based CSS.</summary>
    public static string DataAttribute(this ConversationState state)
        => state.ToString().ToLowerInvariant();

    /// <summary>Parse the lowercase state string sent by conversation.js.</summary>
    public static ConversationState Parse(string value) => value switch
    {
        "idle" => ConversationState.Idle,
        "connecting" => ConversationState.Connecting,
        "listening" => ConversationState.Listening,
        "thinking" => ConversationState.Thinking,
        "speaking" => ConversationState.Speaking,
        _ => ConversationState.Error,
    };

    /// <summary>
    /// Turn a raw capture/permission error into a friendly, actionable message
    /// (Best practice #10). Doing this in C# keeps the "edge" logic on the
    /// framework side, where the UI can show it.
    /// </summary>
    public static string Humanize(JsError error) => error.Name switch
    {
        "NotAllowedError" or "SecurityError"
            => "Microphone access was blocked. Allow the mic and try again.",
        "NotFoundError"
            => "No microphone was found. Plug one in and try again.",
        _ => string.IsNullOrWhiteSpace(error.Message)
            ? "Something went wrong. Check the console for details."
            : error.Message,
    };
}
