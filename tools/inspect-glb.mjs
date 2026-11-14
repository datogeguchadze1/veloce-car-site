#!/usr/bin/env node
// Prints what is inside a .glb so the catalog entry in js/models.js can be
// configured: node names (doors, hood, wheels …), materials, size, compression.
// No dependencies. Usage:  node tools/inspect-glb.mjs models/300sl.glb
import { readFileSync, statSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('Usage: node tools/inspect-glb.mjs <file.glb>'); process.exit(1); }

const buf = readFileSync(file);
if (buf.readUInt32LE(0) !== 0x46546c67) { console.error('Not a binary glTF (.glb) file.'); process.exit(1); }
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));

const nodes = gltf.nodes || [];
const meshes = gltf.meshes || [];
const mats = gltf.materials || [];
const scene = gltf.scenes?.[gltf.scene ?? 0];
const ext = gltf.extensionsUsed || [];

console.log(`${file}  ${(statSync(file).size / 1048576).toFixed(1)} MB`);
console.log(`nodes ${nodes.length} · meshes ${meshes.length} · materials ${mats.length} · textures ${(gltf.textures || []).length} · images ${(gltf.images || []).length}`);
console.log(`extensions: ${ext.join(', ') || '—'}`);
if (!ext.some(e => /draco|meshopt/i.test(e))) console.log('tip: not compressed. See models/README.md for the optimize command.');

// local bounding box of a mesh from its POSITION accessors (min/max are required by the spec)
function meshBox(mi) {
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const pr of meshes[mi].primitives || []) {
    const a = gltf.accessors?.[pr.attributes?.POSITION];
    if (!a?.min) continue;
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a.min[k]); hi[k] = Math.max(hi[k], a.max[k]); }
  }
  return hi[0] < lo[0] ? null : { lo, hi };
}
const f = v => v.toFixed(2);

console.log('\nNODE TREE  (name · mesh · local size x/y/z)');
function walk(i, depth) {
  const n = nodes[i];
  let line = `${'  '.repeat(depth)}${n.name ?? `(node ${i})`}`;
  if (n.mesh !== undefined) {
    const b = meshBox(n.mesh);
    line += `  · mesh "${meshes[n.mesh].name ?? n.mesh}"`;
    if (b) line += `  · ${f(b.hi[0] - b.lo[0])} × ${f(b.hi[1] - b.lo[1])} × ${f(b.hi[2] - b.lo[2])}`;
    const used = [...new Set((meshes[n.mesh].primitives || []).map(p => mats[p.material]?.name ?? p.material))];
    if (used.length) line += `  · mat: ${used.join(', ')}`;
  }
  console.log(line);
  (n.children || []).forEach(c => walk(c, depth + 1));
}
(scene?.nodes || []).forEach(i => walk(i, 0));

console.log('\nMATERIALS');
mats.forEach((m, i) => {
  const pbr = m.pbrMetallicRoughness || {};
  const c = (pbr.baseColorFactor || [1, 1, 1, 1]).slice(0, 3).map(x => Math.round(x * 255)).join(',');
  const tags = [m.alphaMode && m.alphaMode !== 'OPAQUE' ? m.alphaMode : '', pbr.baseColorTexture ? 'texture' : '', m.extensions?.KHR_materials_clearcoat ? 'clearcoat' : ''].filter(Boolean).join(' ');
  console.log(`  ${i}: ${m.name ?? '(unnamed)'}  rgb(${c})  metal ${pbr.metallicFactor ?? 1}  rough ${pbr.roughnessFactor ?? 1}  ${tags}`);
});

console.log('\nHints');
const find = re => nodes.filter(n => re.test(n.name || '')).map(n => n.name);
for (const [label, re] of [['doors', /door/i], ['hood', /hood|bonnet/i], ['trunk', /trunk|boot|tailgate/i], ['wheels', /wheel|tire|tyre|rim/i], ['glass', /glass|window/i]]) {
  const hit = find(re);
  console.log(`  ${label}: ${hit.length ? hit.slice(0, 12).join(', ') : 'none found by name'}`);
}
