// Mints short-lived ("ephemeral") OpenAI Realtime API session tokens so the
// browser can open a WebRTC connection DIRECTLY to OpenAI for a genuine
// voice-to-voice conversation — no speech-to-text step, no text-to-speech
// step, no round trip through our own server for the actual audio (that
// round trip, plus the separate "think in text, then synthesize speech"
// pipeline the old Professor used, is what Felipe kept hearing as lag and
// a robotic voice). Our server's only job here is this one token-minting
// call, made with the athlete's OWN OpenAI API key (same bring-your-own-key
// model as the Anthropic key — see apiKeyFor in server.js). The ephemeral
// key handed back to the browser is safe to expose client-side: it expires
// in minutes and can only open a Realtime session, nothing else on the
// athlete's OpenAI account.
async function mintRealtimeSession(apiKey, instructions, opts) {
  if (!apiKey) throw new Error('missing_api_key');
  opts = opts || {};
  const model = opts.model || 'gpt-realtime-2.1';
  // 'marin' and 'cedar' are OpenAI's newest, highest-quality realtime voices
  // (released together, both explicitly recommended by OpenAI for best
  // quality) — marin reads female, cedar reads male. Felipe wants a male
  // voice for the Professor, so cedar is the natural pick: same quality
  // tier as the default, just the male counterpart.
  const voice = opts.voice || 'cedar';
  // "Estou achando a fala do professor lenta, não parece uma conversa" —
  // eagerness:'high' below already made the model decide "your turn's over"
  // faster, but that's turn-taking latency, not the pace of the voice
  // itself. `speed` is the documented lever for literal talking pace
  // (confirmed live against OpenAI's current realtime session schema: a
  // 0.25–1.5 multiplier on the spoken output, default 1.0). Kept modest —
  // community reports describe voice character and instruction-following
  // degrading at more extreme values, so this nudges the pace up without
  // pushing into that territory. First tried 1.15 — Felipe then found that
  // too fast — so this settles on a middle ground between the 1.0 default
  // and that 1.15.
  const speed = opts.speed || 1.08;

  const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      session: {
        type: 'realtime',
        model,
        instructions,
        audio: {
          input: {
            // semantic_vad is what actually fixes both of Felipe's complaints
            // at once: it lets the athlete talk naturally without a
            // push-to-talk button or repeating "Hey Professor" every turn
            // (the model decides by MEANING, not a fixed silence window,
            // when a turn is really over), and it supports real barge-in —
            // talking over the Professor mid-reply stops it and listens, the
            // same way interrupting a person works.
            //
            // NOTE: as of the current Realtime API, turn_detection lives
            // under session.audio.input, not directly under session — the
            // API rejected session.turn_detection with "Unknown parameter"
            // (confirmed live against OpenAI's docs after Felipe hit this in
            // production; the schema moved it here at some point).
            //
            // eagerness:'high' makes the model decide "the athlete is done
            // talking" as fast as it reasonably can, instead of the default
            // ('auto' == 'medium') pause. Felipe said the live call still
            // didn't feel like real-time conversation even once connected —
            // this is the documented lever for exactly that (OpenAI's own
            // VAD guide: high "will chunk the audio as soon as possible").
            // create_response/interrupt_response are already true by
            // default but spelled out here so the intent (auto-reply, real
            // barge-in) is explicit rather than relying on defaults.
            turn_detection: { type: 'semantic_vad', eagerness: 'high', create_response: true, interrupt_response: true },
            // Pins the ASR to Portuguese instead of letting it auto-detect.
            // Felipe reported the Professor's VOICE sounding like "another
            // language" — a mis-detected input language is one real cause
            // (a silence-model guessing the wrong language for a turn can
            // drag the reply's language/accent with it), and this is the
            // documented field for it (confirmed live against OpenAI's
            // current realtime-transcription docs: it's `languages` on
            // gpt-transcribe/gpt-live-transcribe, plural, not `language`).
            transcription: { model: 'gpt-transcribe', languages: ['pt'] },
          },
          output: { voice, speed },
        },
      },
    }),
  });

  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data; // { value: '<ephemeral client secret>', expires_at, session: {...} }
}

// Text-to-speech with the same voice family the Professor uses live. Used for
// the two fixed lines of the "bom dia" ritual ("Bom dia, meu atleta!" / "Como
// você está hoje? Como foram os treinos?"): they are synthesized ONCE here,
// cached by the server, and played by the browser together with the music at
// exact times — nothing about their timing depends on a live model session.
async function synthesizeSpeech(apiKey, text, opts) {
  if (!apiKey) throw new Error('missing_api_key');
  opts = opts || {};
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: opts.model || 'gpt-4o-mini-tts',
      voice: opts.voice || 'cedar',
      input: text,
      instructions: opts.instructions || 'Fale em português do Brasil, como um treinador de corrida animado cumprimentando um atleta de manhã: voz natural, enérgica e calorosa, ritmo ágil de conversa, sem arrastar as palavras.',
      response_format: 'mp3',
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error('tts_failed_' + res.status);
    err.status = res.status;
    err.detail = detail.slice(0, 300);
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { mintRealtimeSession, synthesizeSpeech };
