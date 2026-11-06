import { TOKENS } from '../generated/tokens';
import type { RGB, Theme, ThemeTokens } from './model-types';
import { hex } from './util';

const resolve = (name: string, t: ThemeTokens): Theme => ({
  name,
  bg: hex(t.bg), unlit: hex(t.unlit), grid: hex(t.grid), fade: hex(t.fade), text: hex(t.text), textHi: hex(t.textHi),
  snow: hex(t.snow), up: hex(t.up), down: hex(t.down), tooltipBg: t.tooltipBg, tooltipBorder: t.tooltipBorder,
  palette: t.palette.map(hex), terrain: t.terrain.map(hex), diverging: t.diverging.map(hex),
});

const BUILT_IN: Record<string, ThemeTokens> = TOKENS.themes as any;

/** 'dark' | 'light' | partial tokens (merged over dark, or over light when tokens.base === 'light'). */
export function resolveTheme(opt: any, prefersLight = false): Theme {
  if (opt == null || opt === 'dark') return resolve('dark', BUILT_IN.dark);
  if (opt === 'light') return resolve('light', BUILT_IN.light);
  if (opt === 'auto') return prefersLight ? resolve('light', BUILT_IN.light) : resolve('dark', BUILT_IN.dark);
  if (typeof opt === 'object') {
    const base = opt.base === 'light' ? 'light' : 'dark';
    return resolve('custom', { ...BUILT_IN[base], ...opt });
  }
  throw new Error(`craggy-charts: unknown theme "${opt}"`);
}

/** Series colours: options.series[name].color, then options.colors (list or map), then the palette. */
export function seriesColors(opts: any, names: string[], theme: Theme): RGB[] {
  const c = opts.colors, s = opts.series || {};
  return names.map((n, i) => {
    const v = (s[n] && s[n].color) || (Array.isArray(c) ? c[i] : c && c[n]);
    return v ? hex(v) : theme.palette[i % theme.palette.length];
  });
}
