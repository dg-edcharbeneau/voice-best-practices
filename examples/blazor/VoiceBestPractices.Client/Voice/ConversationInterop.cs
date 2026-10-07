using Microsoft.JSInterop;

namespace VoiceBestPractices.Client.Voice;

/// <summary>
/// The Blazor "edge" over the framework-agnostic orchestrator — the direct
/// analog of React's <c>useConversation</c> hook. It owns the isolated JS module
/// (imported, never a <c>window.*</c> global), relays the orchestrator's
/// callbacks up as C# events, and exposes start/stop/interrupt down to JS.
///
/// Per the JS-interop best practices: a plain typed class (mock <see cref="IJSRuntime"/>
/// to test it), method/module names as <c>const</c> so a typo can't silently
/// break interop, and <see cref="IAsyncDisposable"/> that tolerates a lost circuit.
/// </summary>
public sealed class ConversationInterop : IAsyncDisposable
{
    private const string ModulePath = "./js/voice-interop.js";
    private const string InitializeMethod = "initialize";
    private const string PreflightMethod = "preflight";
    private const string StartMethod = "start";
    private const string StopMethod = "stop";
    private const string InterruptMethod = "interruptResponse";
    private const string DisposeMethod = "dispose";

    private readonly IJSRuntime _js;
    private IJSObjectReference? _module;
    private DotNetObjectReference<ConversationInterop>? _selfRef;

    public ConversationInterop(IJSRuntime js) => _js = js;

    // Events flow up to the owning component, which marshals them onto the UI
    // thread. They are Func<…, Task> so the whole JS→.NET→StateHasChanged path
    // stays awaited end-to-end (no fire-and-forget).
    public event Func<ConversationState, Task>? StateChanged;
    public event Func<TranscriptUpdate, Task>? TranscriptUpdated;
    public event Func<double, Task>? LevelChanged;
    public event Func<string, Task>? ErrorRaised;
    public event Func<DiagnosticEvent, Task>? DiagnosticRaised;

    /// <summary>
    /// Import the module, hand it a reference back to this object, and run the
    /// browser-capability preflight. Returns a blocker message if the browser
    /// can't run the demo (Best practice #10), otherwise null.
    /// Call from <c>OnAfterRenderAsync(firstRender)</c> — JS is not available
    /// during prerender.
    /// </summary>
    public async ValueTask<string?> InitializeAsync()
    {
        _module = await _js.InvokeAsync<IJSObjectReference>("import", ModulePath);
        _selfRef = DotNetObjectReference.Create(this);
        await _module.InvokeVoidAsync(InitializeMethod, _selfRef);
        return await _module.InvokeAsync<string?>(PreflightMethod);
    }

    public async ValueTask StartAsync()
    {
        if (_module is not null)
            await _module.InvokeVoidAsync(StartMethod);
    }

    public async ValueTask StopAsync()
    {
        if (_module is not null)
            await _module.InvokeVoidAsync(StopMethod);
    }

    public async ValueTask InterruptResponseAsync()
    {
        if (_module is not null)
            await _module.InvokeVoidAsync(InterruptMethod);
    }

    // --- JS → .NET callbacks. Must be public or they silently fail at runtime. ---

    [JSInvokable]
    public Task OnStateChanged(string state)
        => StateChanged?.Invoke(ConversationStates.Parse(state)) ?? Task.CompletedTask;

    [JSInvokable]
    public Task OnTranscript(TranscriptUpdate update)
        => TranscriptUpdated?.Invoke(update) ?? Task.CompletedTask;

    [JSInvokable]
    public Task OnLevel(double level)
        => LevelChanged?.Invoke(level) ?? Task.CompletedTask;

    [JSInvokable]
    public Task OnError(JsError error)
        => ErrorRaised?.Invoke(ConversationStates.Humanize(error)) ?? Task.CompletedTask;

    [JSInvokable]
    public Task OnDiagnostic(DiagnosticEvent evt)
        => DiagnosticRaised?.Invoke(evt) ?? Task.CompletedTask;

    public async ValueTask DisposeAsync()
    {
        try
        {
            if (_module is not null)
            {
                await _module.InvokeVoidAsync(DisposeMethod);
                await _module.DisposeAsync();
            }
        }
        catch (JSDisconnectedException)
        {
            // Circuit/runtime already gone — nothing to clean up on the JS side.
        }

        _selfRef?.Dispose();
    }
}
