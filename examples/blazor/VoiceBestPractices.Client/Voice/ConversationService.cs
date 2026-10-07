using Microsoft.JSInterop;

namespace VoiceBestPractices.Client.Voice;

/// <summary>
/// The voice session manager — the single owner of conversation state and the
/// orchestrator interop. Components inject it, read its state, call its commands,
/// and re-render when <see cref="Changed"/> fires. Keeping this out of the page
/// means the logic is testable (mock <see cref="IJSRuntime"/>) and reusable, and
/// the component stays a thin view.
///
/// Registered scoped (see the client Program.cs). It raises <see cref="Changed"/>
/// but never touches <c>StateHasChanged</c> — marshalling to the UI thread is the
/// component's job, so the service has no dependency on the renderer.
/// </summary>
public sealed class ConversationService : IAsyncDisposable
{
    /// <summary>
    /// Ring-buffer cap for the Diagnostics panel. A long session would otherwise
    /// grow the trace without limit, so the oldest rows fall off the front.
    /// (The console mirror is gated separately, in wwwroot/js/config.js.)
    /// </summary>
    public const int MaxDiagnostics = 200;

    private readonly ConversationInterop _interop;
    private readonly List<string> _committed = [];
    private readonly List<DiagnosticEvent> _diagnostics = [];
    private bool _initialized;

    public ConversationService(IJSRuntime js)
    {
        _interop = new ConversationInterop(js);
        _interop.StateChanged += OnStateChanged;
        _interop.TranscriptUpdated += OnTranscript;
        _interop.LevelChanged += OnLevel;
        _interop.ErrorRaised += OnError;
        _interop.DiagnosticRaised += OnDiagnostic;
    }

    // --- observable state -------------------------------------------------------
    public ConversationState State { get; private set; } = ConversationState.Idle;
    public IReadOnlyList<string> Committed => _committed;
    public string Interim { get; private set; } = "";
    public double Level { get; private set; }
    public string? Error { get; private set; }
    public IReadOnlyList<DiagnosticEvent> Diagnostics => _diagnostics;

    /// <summary>Raised whenever any observable state changes. Components subscribe
    /// and marshal a re-render onto the UI thread.</summary>
    public event Action? Changed;

    // --- commands ---------------------------------------------------------------

    /// <summary>
    /// One-time browser-capability check + module import. Call from the owning
    /// component's <c>OnAfterRenderAsync(firstRender)</c> — JS isn't available
    /// during prerender. Safe to call more than once.
    /// </summary>
    public async Task InitializeAsync()
    {
        if (_initialized)
        {
            return;
        }
        _initialized = true;

        var blocker = await _interop.InitializeAsync();
        if (blocker is not null)
        {
            Error = blocker;
            State = ConversationState.Error;
            Changed?.Invoke();
        }
    }

    public async Task StartAsync()
    {
        Error = null;
        _committed.Clear();
        Interim = "";
        // The orchestrator restarts its clock at +0.00s, so clear the old rows too.
        _diagnostics.Clear();
        Changed?.Invoke();
        await _interop.StartAsync();
    }

    public Task StopAsync() => _interop.StopAsync().AsTask();

    public Task InterruptResponseAsync() => _interop.InterruptResponseAsync().AsTask();

    public void ClearDiagnostics()
    {
        _diagnostics.Clear();
        Changed?.Invoke();
    }

    // --- orchestrator callbacks: update state, then notify ----------------------

    private Task OnStateChanged(ConversationState state)
    {
        State = state;
        Changed?.Invoke();
        return Task.CompletedTask;
    }

    private Task OnTranscript(TranscriptUpdate update)
    {
        if (update.Committed)
        {
            // The in-progress turn is final: append it and clear the interim line.
            var text = update.Interim.Trim();
            if (text.Length > 0)
            {
                _committed.Add(text);
            }
            Interim = "";
        }
        else
        {
            // Interim update (or reset) — replace the live line in place.
            Interim = update.Interim;
        }
        Changed?.Invoke();
        return Task.CompletedTask;
    }

    private Task OnLevel(double level)
    {
        Level = level;
        Changed?.Invoke();
        return Task.CompletedTask;
    }

    private Task OnError(string message)
    {
        Error = message;
        Changed?.Invoke();
        return Task.CompletedTask;
    }

    // Turn-taking / barge-in trace: kept in a bounded buffer for the Diagnostics
    // panel. (The console mirror already happened on the JS side.)
    private Task OnDiagnostic(DiagnosticEvent evt)
    {
        _diagnostics.Add(evt);
        if (_diagnostics.Count > MaxDiagnostics)
        {
            _diagnostics.RemoveRange(0, _diagnostics.Count - MaxDiagnostics);
        }
        Changed?.Invoke();
        return Task.CompletedTask;
    }

    public async ValueTask DisposeAsync()
    {
        _interop.StateChanged -= OnStateChanged;
        _interop.TranscriptUpdated -= OnTranscript;
        _interop.LevelChanged -= OnLevel;
        _interop.ErrorRaised -= OnError;
        _interop.DiagnosticRaised -= OnDiagnostic;
        await _interop.DisposeAsync();
    }
}
