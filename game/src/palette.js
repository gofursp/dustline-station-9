// The look plan, in one place. Dusk at a freight yard: sodium amber against teal
// shadow, rust on the containers, bone-white markings. Six values only; the
// lighting makes every shade the game needs, so no other colour appears in the
// code. The same six names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#10151b',
  surface: '#1b232c',
  hairline: '#2e3a45',
  ink: '#e9e2d4',
  muted: '#8b98a3',
  accent: '#f0a830',
};

export const TEAM = {
  vanguard: '#f0a830',
  dusk: '#e0533d',
};

export function shade(name) {
  return PALETTE[name];
}
