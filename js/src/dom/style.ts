// The chart's DOM styles, injected once per document (or shadow root).
import { FONT } from '../render/text';

export const CSS = `
.cc{position:relative;display:flex;flex-direction:column;box-sizing:border-box;width:100%;height:100%;min-height:0;
  font:400 10px/1.35 ${FONT};font-variant-numeric:tabular-nums;color:var(--cc-text);background:var(--cc-bg);border-radius:inherit;overflow:hidden}
.cc *{box-sizing:border-box}
.cc-head{padding:10px 12px 0;flex:none}
.cc-title{font-size:13px;font-weight:700;color:var(--cc-text-hi);letter-spacing:.01em}
.cc-sub{font-size:11px;margin-top:2px}
.cc-legend{display:flex;flex-wrap:wrap;gap:4px 14px;padding:8px 12px 2px;flex:none}
.cc-legend.cc-right{flex-direction:column;flex-wrap:nowrap;padding:10px 12px;gap:6px;overflow:auto;max-width:40%}
.cc-legend button{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--cc-text-hi);border-radius:3px;padding:1px 2px;white-space:nowrap}
.cc-legend button:focus-visible{outline:1px solid var(--cc-text)}
.cc-legend button[aria-pressed="false"]{opacity:.38}
.cc-key{width:8px;height:8px;border-radius:2px;flex:none}
.cc-body{flex:1 1 auto;min-height:0;display:flex}
.cc-body.cc-col{flex-direction:column}
.cc-plot{position:relative;flex:1 1 auto;min-width:0;min-height:0}
.cc-plot canvas{position:absolute;left:0;top:0;width:100%;height:100%;outline:none;touch-action:pan-y;display:block}
.cc-plot canvas:focus-visible{box-shadow:inset 0 0 0 1px var(--cc-text)}
.cc-tip{position:absolute;left:0;top:0;pointer-events:none;z-index:2;min-width:96px;max-width:260px;padding:7px 9px;border-radius:6px;
  background:var(--cc-tip-bg);border:1px solid var(--cc-tip-border);color:var(--cc-text-hi);font-size:11px;
  box-shadow:0 6px 24px rgba(0,0,0,.28);opacity:0;transition:opacity .12s;will-change:transform}
.cc-tip.cc-on{opacity:1}
.cc-tip b{display:block;font-weight:700;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cc-tip div{display:flex;align-items:center;gap:6px;white-space:nowrap;line-height:1.6}
.cc-tip span{flex:1;color:var(--cc-text);overflow:hidden;text-overflow:ellipsis}
.cc-tip i{width:7px;height:7px;border-radius:2px;flex:none}
.cc-tip em{font-style:normal;margin-left:10px}
.cc-sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}
`;

const done = new WeakSet<Document | ShadowRoot>();

export function injectStyles(root: Document | ShadowRoot = document) {
  if (done.has(root)) return;
  done.add(root);
  const s = document.createElement('style');
  s.setAttribute('data-craggy-charts', '');
  s.textContent = CSS;
  (root instanceof Document ? root.head : root).appendChild(s);
}
