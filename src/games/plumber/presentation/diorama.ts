// Procedural prototype art for the plumber collection (§9).
//
// FINAL ART IS BLOCKED_ASSET: unique hand-crafted project art has not been
// generated, so these are transparent geometric prototypes (never emoji), used
// to build and test the album/diorama logic. They are intentionally simple and
// carry data-prototype="1" so they can never be mistaken for finished art.
import type { Collectible, Theme, ThemeId } from '../domain/progression';

const PALETTE: Record<ThemeId, { main: string; accent: string; water: string }> = {
  garden: { main: '#3fae6a', accent: '#8fce6a', water: '#4fa8e0' },
  city: { main: '#6d7f8f', accent: '#9bb0bd', water: '#4fa8e0' },
  industry: { main: '#8a7f6d', accent: '#c2b49a', water: '#4fa8e0' },
  special: { main: '#8a6dc2', accent: '#b79be6', water: '#4fa8e0' },
};

function shapeBody(shape: string, p: { main: string; accent: string; water: string }): string {
  switch (shape) {
    case 'can':
      return `<rect x="26" y="30" width="44" height="38" rx="8" fill="${p.main}"/><path d="M70 38 l18 -8 l4 8 l-14 8 z" fill="${p.accent}"/><rect x="34" y="24" width="28" height="8" rx="4" fill="${p.accent}"/>`;
    case 'fountain':
      return `<rect x="20" y="60" width="60" height="10" rx="2" fill="${p.main}"/><rect x="46" y="34" width="8" height="26" fill="${p.accent}"/><path d="M30 30 q20 -22 40 0" fill="none" stroke="${p.water}" stroke-width="5" stroke-linecap="round"/>`;
    case 'arch':
      return `<path d="M22 70 q28 -46 56 0" fill="none" stroke="${p.main}" stroke-width="10" stroke-linecap="round"/><circle cx="50" cy="26" r="5" fill="${p.water}"/>`;
    case 'patch':
      return `<rect x="24" y="36" width="52" height="30" rx="6" fill="${p.main}"/><rect x="40" y="42" width="20" height="18" rx="3" fill="${p.accent}"/><circle cx="50" cy="51" r="4" fill="${p.water}"/>`;
    case 'hydrant':
      return `<rect x="42" y="34" width="16" height="34" rx="6" fill="${p.main}"/><rect x="30" y="46" width="40" height="8" rx="4" fill="${p.accent}"/><circle cx="50" cy="30" r="7" fill="${p.accent}"/>`;
    case 'tank':
      return `<rect x="26" y="30" width="48" height="42" rx="8" fill="${p.main}"/><rect x="26" y="44" width="48" height="8" fill="${p.water}" opacity="0.75"/>`;
    case 'mixer':
      return `<circle cx="50" cy="52" r="20" fill="${p.main}"/><path d="M50 34 v18 l14 10" stroke="${p.accent}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
    case 'turbine':
      return `<circle cx="50" cy="52" r="20" fill="none" stroke="${p.main}" stroke-width="6"/><path d="M50 52 l16 -10 M50 52 l-16 -10 M50 52 v18" stroke="${p.accent}" stroke-width="5" stroke-linecap="round"/>`;
    case 'well':
      return `<rect x="30" y="48" width="40" height="24" rx="4" fill="${p.main}"/><path d="M30 48 l10 -16 h20 l10 16 z" fill="${p.accent}"/><rect x="46" y="40" width="8" height="12" fill="${p.water}"/>`;
    case 'tower':
      return `<path d="M34 30 h32 l6 40 h-44 z" fill="${p.main}"/><rect x="40" y="70" width="20" height="6" fill="${p.accent}"/><rect x="38" y="38" width="24" height="8" fill="${p.water}"/>`;
    case 'aqueduct':
      return `<rect x="20" y="40" width="60" height="10" fill="${p.main}"/><rect x="26" y="50" width="8" height="24" fill="${p.main}"/><rect x="46" y="50" width="8" height="24" fill="${p.main}"/><rect x="66" y="50" width="8" height="24" fill="${p.main}"/>`;
    default:
      return `<circle cx="50" cy="52" r="18" fill="${p.main}"/>`;
  }
}

/** Inline SVG for one project. `alive` animates it; `silhouette` hides detail. */
export function projectSvg(c: Collectible, opts: { alive?: boolean; silhouette?: boolean } = {}): string {
  const p = PALETTE[c.theme];
  const cls = `project-svg${opts.alive ? ' alive' : ''}${opts.silhouette ? ' silhouette' : ''}`;
  const body = opts.silhouette
    ? `<path d="M26 34 h48 v40 h-48 z" fill="#5b6470" opacity="0.55"/>`
    : shapeBody(c.shape, p);
  const sparkle = opts.alive ? `<circle class="spark" cx="76" cy="24" r="3" fill="${p.accent}"/>` : '';
  return `<svg class="${cls}" viewBox="0 0 100 90" role="img" aria-hidden="true" data-prototype="1" data-shape="${c.shape}" data-version="${c.version}">${body}${sparkle}</svg>`;
}

/** Big living composition for a whole themed set. */
export function themeComposition(theme: Theme, items: Collectible[], owned: string[]): string {
  const p = PALETTE[theme.id];
  const placed = items
    .map((c, i) => {
      const x = 20 + i * 100;
      const alive = owned.includes(c.id);
      const inner = alive ? shapeBody(c.shape, p) : `<path d="M35 38 h30 v30 h-30 z" fill="#5b6470" opacity="0.4"/>`;
      return `<g transform="translate(${x},20)" class="${alive ? 'alive' : 'locked'}">${inner}</g>`;
    })
    .join('');
  return `<svg class="composition-svg" viewBox="0 0 340 150" role="img" aria-hidden="true" data-prototype="1" data-theme="${theme.id}">
    <rect x="0" y="118" width="340" height="32" rx="8" fill="${p.main}" opacity="0.35"/>
    <path d="M0 118 q170 -18 340 0" fill="none" stroke="${p.water}" stroke-width="4" opacity="0.6"/>
    ${placed}
  </svg>`;
}
