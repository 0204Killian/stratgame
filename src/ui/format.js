import { S, MONTH, YEAR } from '../sim/game.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const num = v => Math.round(v).toLocaleString('en-IE');
export const kfmt = v => v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'k' : String(Math.round(v));
export const fmtPop = m => num(m * 1e6);
export const fmtGdp = b => { const a = Math.abs(b), s = b < 0 ? '−' : ''; return s + (a >= 1000 ? '$' + (a / 1000).toFixed(2) + 'T' : a >= 100 ? '$' + Math.round(a) + 'B' : a >= 1 ? '$' + a.toFixed(1) + 'B' : a >= .1 ? '$' + Math.round(a * 1000) + 'M' : a >= .001 ? '$' + (a * 1000).toFixed(a >= .01 ? 1 : 2) + 'M' : a >= 1e-6 ? '$' + Math.round(a * 1e6) + 'k' : '$' + Math.round(a * 1e9)); };
export const fmtPct = p => (Math.round(p * 10) / 10) + '%';
export const dateStr = d => { const y = Math.floor(d / YEAR) + 1, m = Math.floor((d % YEAR) / MONTH), dd = d % MONTH + 1; return `${dd} ${MONTHS[m]}, Year ${y}`; };
export const shortDate = d => { const y = Math.floor(d / YEAR) + 1, m = Math.floor((d % YEAR) / MONTH); return `${MONTHS[m]} Y${y}`; };
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const chip = n => `<span class="sw" style="background:${n.color}"></span>`;
export const natName = n => `<b class="nn" style="color:${n.color}">${esc(n.name)}${n.you ? ' (you)' : ''}</b>`;

// Turns sim log tokens into HTML: {{n:3}} nation, {{p:12}} province, [[text]] muted aside.
export function fmtMsg(m) {
  return esc(m)
    .replace(/\{\{n:(\d+)\}\}/g, (_, i) => natName(S.nations[+i]))
    .replace(/\{\{p:(\d+)\}\}/g, (_, i) => `<b>${esc(S.P[+i].name)}</b>`)
    .replace(/\[\[(.*?)\]\]/g, (_, t) => `<span class="cas">${/^\d+ /.test(t) ? t.replace(/^(\d+)/, x => num(+x)) : t}</span>`);
}
export const plainMsg = m => fmtMsg(m).replace(/<[^>]+>/g, '');
