#!/usr/bin/env python3
"""Shrink a .gltf model folder (scene.gltf + scene.bin + textures/) for the web.

Only needs Python 3, numpy and Pillow. Writes a new folder; the input is untouched.

  * vertex data is re-packed with KHR_mesh_quantization (supported by three.js):
      POSITION  -> int16  (the dequantisation goes into a new child node)
      NORMAL    -> int8
      TEXCOORD  -> uint16 / int16 when the values allow it, else float
  * UV sets no material reads, and TANGENT, are dropped
  * 32-bit indices become 16-bit where possible
  * textures: opaque PNG -> JPEG, longest side capped (2048 colour, 1024 others)

Usage:  python3 tools/optimize_gltf.py models/sls /tmp/out/sls
"""
import json, os, shutil, sys
import numpy as np
from PIL import Image

COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}
CT = {np.dtype(np.int8): 5120, np.dtype(np.uint8): 5121, np.dtype(np.int16): 5122,
      np.dtype(np.uint16): 5123, np.dtype(np.uint32): 5125, np.dtype(np.float32): 5126}


def read_accessor(g, bins, i):
    a = g['accessors'][i]
    assert 'sparse' not in a, 'sparse accessors are not supported'
    n = NCOMP[a['type']]
    dt = np.dtype(COMP[a['componentType']])
    if 'bufferView' not in a:
        return np.zeros((a['count'], n), dt)
    bv = g['bufferViews'][a['bufferView']]
    buf = bins[bv['buffer']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride') or dt.itemsize * n
    arr = np.ndarray((a['count'], n), dt, buffer=buf, offset=off, strides=(stride, dt.itemsize))
    return np.array(arr)


def tex_infos(obj):
    """Yield every textureInfo dict inside a material (core + extensions)."""
    if isinstance(obj, dict):
        if 'index' in obj and isinstance(obj['index'], int) and len(obj) <= 6:
            yield obj
        for v in obj.values():
            yield from tex_infos(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from tex_infos(v)


def used_texcoords(mat):
    sets = set()
    for ti in tex_infos(mat):
        tc = ti.get('texCoord', 0)
        tt = ti.get('extensions', {}).get('KHR_texture_transform', {})
        sets.add(tt.get('texCoord', tc))
    return sets


class Packer:
    def __init__(self):
        self.chunks, self.size, self.views = [], 0, []

    def add(self, data: bytes, stride=None, target=None):
        pad = (-self.size) % 4
        if pad:
            self.chunks.append(b'\0' * pad); self.size += pad
        bv = {'buffer': 0, 'byteOffset': self.size, 'byteLength': len(data)}
        if stride: bv['byteStride'] = stride
        if target: bv['target'] = target
        self.chunks.append(data); self.size += len(data)
        self.views.append(bv)
        return len(self.views) - 1


def padded(arr, stride):
    """Rows of `arr` written with `stride` bytes each (zero padding)."""
    raw = arr.tobytes()
    row = arr.dtype.itemsize * arr.shape[1]
    if row == stride:
        return raw
    out = bytearray(stride * arr.shape[0])
    view = np.frombuffer(raw, np.uint8).reshape(arr.shape[0], row)
    o = np.frombuffer(out, np.uint8).reshape(arr.shape[0], stride)
    o[:, :row] = view
    return bytes(out)


def optimize(src, dst, max_color=2048, max_other=1024, jpeg_q=85):
    g = json.load(open(os.path.join(src, 'scene.gltf')))
    bins = [open(os.path.join(src, b['uri']), 'rb').read() for b in g['buffers']]
    os.makedirs(os.path.join(dst, 'textures'), exist_ok=True)

    new_acc, pk = [], Packer()
    cache = {}

    def emit(arr, dt_target, typ, normalized=False, target=34962, minmax=False):
        arr = np.ascontiguousarray(arr.astype(dt_target))
        n = arr.shape[1]
        row = arr.dtype.itemsize * n
        if target == 34963:   # indices: no stride
            view = pk.add(arr.tobytes(), target=target)
        else:
            stride = (row + 3) // 4 * 4
            view = pk.add(padded(arr, stride), stride=stride, target=target)
        acc = {'bufferView': view, 'componentType': CT[arr.dtype], 'count': int(arr.shape[0]), 'type': typ}
        if normalized: acc['normalized'] = True
        if minmax:
            acc['min'] = [x.item() for x in arr.min(0)]
            acc['max'] = [x.item() for x in arr.max(0)]
        new_acc.append(acc)
        return len(new_acc) - 1

    mats = g.get('materials', [])
    mat_sets = [used_texcoords(m) for m in mats]

    # per-mesh position quantisation parameters (uniform scale keeps normals right)
    mesh_q = []
    for m in g.get('meshes', []):
        lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
        for p in m['primitives']:
            pos = read_accessor(g, bins, p['attributes']['POSITION']).astype(np.float64)
            lo = np.minimum(lo, pos.min(0)); hi = np.maximum(hi, pos.max(0))
        centre = (lo + hi) / 2
        half = float(max((hi - lo).max() / 2, 1e-9))
        mesh_q.append((centre, half))

    for mi, m in enumerate(g.get('meshes', [])):
        centre, half = mesh_q[mi]
        for p in m['primitives']:
            assert not p.get('targets'), 'morph targets are not supported'
            used = mat_sets[p['material']] if 'material' in p else {0}
            attrs = {}
            for name, ai in p['attributes'].items():
                key = (ai, name, mi if name == 'POSITION' else None)
                if key in cache:
                    attrs[name] = cache[key]; continue
                a = g['accessors'][ai]
                arr = read_accessor(g, bins, ai)
                if a.get('normalized') and arr.dtype != np.float32:
                    info = np.iinfo(arr.dtype)
                    arr = np.maximum(arr.astype(np.float64) / info.max, -1.0)
                if name == 'TANGENT':
                    continue
                if name.startswith('TEXCOORD_') and int(name[9:]) not in used:
                    continue
                if name == 'POSITION':
                    q = np.round((arr - centre) / half * 32767).clip(-32767, 32767)
                    out = emit(q, np.int16, 'VEC3', normalized=True, minmax=True)
                elif name == 'NORMAL':
                    nrm = arr / np.maximum(np.linalg.norm(arr, axis=1, keepdims=True), 1e-12)
                    out = emit(np.round(nrm * 127).clip(-127, 127), np.int8, 'VEC3', normalized=True)
                elif name.startswith('TEXCOORD_'):
                    mn, mx = arr.min(), arr.max()
                    if mn >= 0 and mx <= 1:
                        out = emit(np.round(arr * 65535), np.uint16, 'VEC2', normalized=True)
                    elif mn >= -1 and mx <= 1:
                        out = emit(np.round(arr * 32767), np.int16, 'VEC2', normalized=True)
                    else:
                        out = emit(arr, np.float32, 'VEC2')
                else:   # COLOR_0 and anything else: keep as float / original type
                    keep = arr.astype(np.float32) if a.get('normalized') else arr
                    out = emit(keep, keep.dtype, a['type'])
                    if a.get('normalized'):
                        pass
                cache[key] = out
                attrs[name] = out
            p['attributes'] = attrs
            if 'indices' in p:
                idx = read_accessor(g, bins, p['indices']).reshape(-1, 1)
                dt = np.uint16 if idx.max() < 65535 else np.uint32
                p['indices'] = emit(idx, dt, 'SCALAR', target=34963)

    # move each mesh into a child node that carries the dequantisation
    nodes = g.get('nodes', [])
    for n in list(nodes):
        if 'mesh' not in n:
            continue
        mi = n.pop('mesh')
        centre, half = mesh_q[mi]
        # same name as the parent, so name-based lookups keep finding the part
        child = {'mesh': mi, 'translation': [float(x) for x in centre], 'scale': [half, half, half]}
        if 'name' in n: child['name'] = n['name']
        nodes.append(child)
        n.setdefault('children', []).append(len(nodes) - 1)

    # textures
    img_role = {}
    for m in mats:
        bc = m.get('pbrMetallicRoughness', {}).get('baseColorTexture')
        for ti in tex_infos(m):
            src_i = g['textures'][ti['index']].get('source')
            if src_i is None: continue
            role = 'color' if ti is bc else 'other'
            if img_role.get(src_i) != 'color': img_role[src_i] = role
    for i, im in enumerate(g.get('images', [])):
        uri = im.get('uri')
        if not uri:
            continue
        pic = Image.open(os.path.join(src, uri))
        pic.load()
        cap = max_color if img_role.get(i) == 'color' else max_other
        if max(pic.size) > cap:
            k = cap / max(pic.size)
            pic = pic.resize((max(1, round(pic.width * k)), max(1, round(pic.height * k))), Image.LANCZOS)
        has_alpha = pic.mode in ('RGBA', 'LA') or (pic.mode == 'P' and 'transparency' in pic.info)
        if has_alpha:
            rgba = pic.convert('RGBA')
            if rgba.getchannel('A').getextrema()[0] >= 250:
                has_alpha = False
                pic = rgba.convert('RGB')
            else:
                pic = rgba
        base = os.path.splitext(os.path.basename(uri))[0]
        if has_alpha:
            name = f'textures/{base}.png'
            pic.save(os.path.join(dst, name), optimize=True)
            im['mimeType'] = 'image/png'
        else:
            name = f'textures/{base}.jpg'
            pic.convert('RGB').save(os.path.join(dst, name), quality=jpeg_q, optimize=True, progressive=True)
            im['mimeType'] = 'image/jpeg'
        im['uri'] = name

    g['accessors'] = new_acc
    g['bufferViews'] = pk.views
    data = b''.join(pk.chunks)
    g['buffers'] = [{'uri': 'scene.bin', 'byteLength': len(data)}]
    for k in ('extensionsUsed', 'extensionsRequired'):
        lst = g.setdefault(k, [])
        if 'KHR_mesh_quantization' not in lst: lst.append('KHR_mesh_quantization')
    open(os.path.join(dst, 'scene.bin'), 'wb').write(data)
    json.dump(g, open(os.path.join(dst, 'scene.gltf'), 'w'), separators=(',', ':'))
    lic = os.path.join(src, 'license.txt')
    if os.path.exists(lic):
        shutil.copy(lic, dst)


def du(path):
    return sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(path) for f in fs)


if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    optimize(src, dst)
    print(f'{src}: {du(src) / 1048576:.1f} MB -> {du(dst) / 1048576:.1f} MB')
