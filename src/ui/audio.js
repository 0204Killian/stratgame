// Tiny synthesised sound effects. No audio files needed.
let actx = null;
export const sound = { on: true, volume: .7 };
export function unlockAudio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
}
function blip(freq, dur, type, vol, delay) {
  if (!sound.on || !actx) return;
  try {
    const t = actx.currentTime + (delay || 0), o = actx.createOscillator(), g = actx.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime((vol || .04) * sound.volume, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + dur + .02);
  } catch (e) {}
}
export const sfx = {
  tick: () => blip(1500, .025, 'square', .025),
  ding: () => { blip(880, .22, 'triangle', .1); blip(1320, .3, 'triangle', .08, .09); },
  found: () => { blip(523, .18, 'triangle', .1); blip(659, .18, 'triangle', .1, .15); blip(784, .4, 'triangle', .1, .3); },
  boom: () => { blip(70, .45, 'sawtooth', .09); blip(45, .6, 'square', .05, .05); },
  click: () => blip(660, .05, 'triangle', .05),
  error: () => blip(180, .15, 'square', .05),
};
