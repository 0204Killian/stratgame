import { S, MONTH, YEAR } from '../sim/game.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const num = v => Math.round(v).toLocaleString('en-IE');
export const kfmt = v => v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'k' : String(Math.round(v));
export const fmtPop = m => num(m * 1e6);
// Money is kept internally in large units; shown in euros scaled to a stone-age tribe (a loaf is worth about €0.18).
export const EURO = 1e9 / 300;
export const fmtEur = v => { const a = Math.abs(v), s = v < 0 ? '−' : ''; return s + '€' + (a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M' : a >= 1e4 ? Math.round(a / 1e3) + 'k' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'k' : a >= 10 ? Math.round(a).toString() : a >= 1 ? a.toFixed(1) : a.toFixed(2)); };
export const fmtGdp = b => fmtEur(b * EURO);
export const fmtPrice = dollars => fmtEur(dollars * EURO / 1e9);
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
