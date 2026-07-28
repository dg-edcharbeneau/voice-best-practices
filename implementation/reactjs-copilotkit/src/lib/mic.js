// Microphone capture: getUserMedia -> AudioWorklet -> 16 kHz linear16 chunks.
//
// Best practice #6 (correct capture) and #10 (permission handling).
//
// We request the browser's built-in voice processing (echo cancellation, noise
// suppression, auto gain). Echo cancellation matters for a voice UI: without it
// the TTS output leaking into the mic can trip Flux's turn detection.

import { MIC } from "./config.js";

/**
 * @param {(frame: ArrayBuffer) => void} onFrame  called with each ~80 ms linear16 chunk
 * @param {(level: number) => void} onLevel       called with RMS level 0..1 for the meter
 * @returns {Promise<{ stop: () => void }>}
 */
export async function startMic({ onFrame, onLevel }) {
  // Throws NotAllowedError if the user denies, NotFoundError if no device.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule("/pcm-worklet.js");

  const source = ctx.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(ctx, "pcm-worklet", {
    processorOptions: {
      targetSampleRate: MIC.targetSampleRate,
      chunkMs: MIC.chunkMs,
    },
  });

  worklet.port.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === "audio") onFrame(msg.buffer);
    else if (msg.type === "level") onLevel(msg.level);
  };

  // A worklet only runs while it's part of a graph that reaches a destination.
  // Route through a muted gain node so it's pulled WITHOUT playing the mic back
  // to the user (which would be an echo).
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(worklet);
  worklet.connect(mute);
  mute.connect(ctx.destination);

  return {
    stop() {
      // Best practice #8 (teardown): release the OS mic indicator and free the graph.
      stream.getTracks().forEach((t) => t.stop());
      try {
        source.disconnect();
        worklet.disconnect();
        mute.disconnect();
      } catch {}
      ctx.close();
    },
  };
}
