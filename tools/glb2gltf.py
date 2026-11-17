#!/usr/bin/env python3
"""Unpack a .glb into a folder (scene.gltf + scene.bin + textures/) so that
tools/optimize_gltf.py can compress it.

Usage:  python3 tools/glb2gltf.py model.glb /tmp/out/model
"""
import hashlib, json, os, struct, sys

EXT = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp'}


def unpack(src, dst):
    data = open(src, 'rb').read()
    magic, _version, _length = struct.unpack('<4sII', data[:12])
    if magic != b'glTF':
        sys.exit(f'{src}: not a .glb file')
    off, gltf, binc = 12, None, b''
    while off < len(data):
        n, kind = struct.unpack('<I4s', data[off:off + 8])
        chunk = data[off + 8:off + 8 + n]
        if kind == b'JSON': gltf = json.loads(chunk)
        elif kind == b'BIN\x00': binc = chunk
        off += 8 + n
    os.makedirs(os.path.join(dst, 'textures'), exist_ok=True)

    # images stored in buffer views become files
    views = gltf.get('bufferViews', [])
    image_views, seen = set(), {}
    for i, im in enumerate(gltf.get('images', [])):
        if 'bufferView' not in im: continue
        bv = views[im['bufferView']]
        start = bv.get('byteOffset', 0)
        blob = binc[start:start + bv['byteLength']]
        key = hashlib.sha1(blob).hexdigest()
        name = seen.get(key) or f'textures/image_{i}{EXT.get(im.get("mimeType"), ".png")}'
        if key not in seen:            # identical pictures are written once and shared
            open(os.path.join(dst, name), 'wb').write(blob); seen[key] = name
        image_views.add(im['bufferView'])
        im.pop('bufferView'); im.pop('mimeType', None); im['uri'] = name

    # repack the remaining buffer views into scene.bin
    out, remap = bytearray(), {}
    for i, bv in enumerate(views):
        if i in image_views: continue
        while len(out) % 4: out.append(0)
        start = bv.get('byteOffset', 0)
        nbv = dict(bv); nbv['byteOffset'] = len(out); nbv['buffer'] = 0
        out += binc[start:start + bv['byteLength']]
        remap[i] = len(remap); views[i] = nbv
    gltf['bufferViews'] = [views[i] for i in sorted(remap, key=remap.get)]
    for a in gltf.get('accessors', []):
        if 'bufferView' in a: a['bufferView'] = remap[a['bufferView']]
        sp = a.get('sparse')
        if sp:
            sp['indices']['bufferView'] = remap[sp['indices']['bufferView']]
            sp['values']['bufferView'] = remap[sp['values']['bufferView']]
    gltf['buffers'] = [{'uri': 'scene.bin', 'byteLength': len(out)}]
    open(os.path.join(dst, 'scene.bin'), 'wb').write(out)
    json.dump(gltf, open(os.path.join(dst, 'scene.gltf'), 'w'))


if __name__ == '__main__':
    unpack(sys.argv[1], sys.argv[2])
    print('written', sys.argv[2])
