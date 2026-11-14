// Tuning options shared by the car loader and the tuning panel.
export const FINISHES = {
  gloss: { label: 'გლუვი', metalness: 0.1, roughness: 0.22, clearcoat: 1 },
  metallic: { label: 'მეტალიკი', metalness: 0.6, roughness: 0.3, clearcoat: 1 },
  matte: { label: 'მქრქალი', metalness: 0.15, roughness: 0.78, clearcoat: 0 },
  chrome: { label: 'ქრომი', metalness: 1, roughness: 0.06, clearcoat: 0.6 },
};
export const RIM_COLORS = { silver: ['ვერცხლი', 0xd0d4da, 1, 0.18], black: ['შავი', 0x18191b, 0.6, 0.35], gold: ['ოქრო', 0xc9a24a, 1, 0.22], graphite: ['გრაფიტი', 0x4a4d52, 0.9, 0.3] };
export const TINTS = { clear: ['გამჭვირვალე', 0.22, 0x9fb2c4], mid: ['საშუალო', 0.5, 0x2b3644], dark: ['მუქი', 0.82, 0x07090c] };
export const LIGHTS = { white: ['თეთრი', 0xfff4dc], yellow: ['ყვითელი', 0xffc844], blue: ['ცისფერი', 0x9fd0ff] };
export const INTERIORS = { black: ['შავი', 0x1c1c1e], tan: ['ყავისფერი', 0x8a5a33], red: ['წითელი', 0x7d1418], cream: ['კრემისფერი', 0xd9cdb4] };

// Starting point; glbCar.js overrides most of it with the model's original look.
export function defaultTuning(m) {
  return { color: m.palette[0], finish: 'gloss', rimColor: 'silver', ride: 0, tint: 'clear', lights: 'white', interior: 'black' };
}
