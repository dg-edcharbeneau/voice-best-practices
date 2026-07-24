// Gap-free playback of streamed linear16 PCM using the Web Audio API.
//
// Best practice #7 (glitch-free playback): we schedule each incoming chunk on a
// running timeline (`nextTime`) instead of playing them "now", so consecutive
// chunks butt up against each other sample-accurately with no clicks or gaps.
//
// Best practice #4 (barge-in): flush() stops every scheduled source instantly,
// which is how we cut the agent off the moment the user starts talking.
//
// Output level (onLevel): an AnalyserNode taps the playback signal so the UI can
// visualize how loud the agent is speaking — the mirror image of the mic meter
// on the input side. Every source plays through the analyser into the speakers.

export function createPlayer({ sampleRate, onStart, onEnd, onLevel }) {
  const ctx = new AudioContext();

  // Tap the output for level metering, then on to the speakers.
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.6;
  analyser.connect(ctx.destination);
  const levelBuf = new Float32Array(analyser.fftSize);

  const sources = new Set();
  let nextTime = 0;
  let playing = false;
  let rafId = null;

  // While audio is playing, sample the analyser each frame and report an RMS
  // level (0..1). Stops — and reports 0 — as soon as playback ends.
  function measure() {
    analyser.getFloatTimeDomainData(levelBuf);
    let sumSquares = 0;
    for (let i = 0; i < levelBuf.length; i++) sumSquares += levelBuf[i] * levelBuf[i];
    onLevel?.(Math.sqrt(sumSquares / levelBuf.length));
    rafId = requestAnimationFrame(measure);
  }
  function startMeter() {
    if (rafId === null && onLevel) rafId = requestAnimationFrame(measure);
  }
  function stopMeter() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    onLevel?.(0);
  }

  function enqueue(arrayBuffer) {
    const pcm = new Int16Array(arrayBuffer);
    if (pcm.length === 0) return;

    const float = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) float[i] = pcm[i] / 0x8000;

    const buffer = ctx.createBuffer(1, float.length, sampleRate);
    buffer.copyToChannel(float, 0);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(analyser);

    // Small lead so the very first chunk doesn't start in the past.
    const now = ctx.currentTime;
    if (nextTime < now) nextTime = now + 0.02;
    src.start(nextTime);
    nextTime += buffer.duration;

    sources.add(src);
    if (!playing) {
      playing = true;
      startMeter();
      onStart?.();
    }
    src.onended = () => {
      sources.delete(src);
      if (sources.size === 0 && playing) {
        playing = false;
        stopMeter();
        onEnd?.();
      }
    };
  }

  function flush() {
    for (const src of sources) {
      try {
        src.onended = null;
        src.stop();
      } catch {}
    }
    sources.clear();
    nextTime = 0;
    if (playing) {
      playing = false;
      stopMeter();
      onEnd?.();
    }
  }

  return {
    /** Must be called from a user gesture to satisfy autoplay policies. */
    resume: () => ctx.resume(),
    enqueue,
    flush,
    get isPlaying() {
      return playing;
    },
    close: () => {
      flush();
      ctx.close();
    },
  };
}
