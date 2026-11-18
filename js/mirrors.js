// Working mirrors for the cockpit view. Three small cameras look backwards from
// the car (rear-view mirror at the driver's eye, two door mirrors), each into
// its own low-resolution render target; the targets are then drawn over the
// screen as framed, horizontally flipped mirrors. The two passes alternate
// between frames, so a frame costs at most two extra small renders.
import * as THREE from 'three';

const vert = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// rounded-rectangle mask with a dark plastic frame, mirrored horizontally, slight vignette
const frag = `
  uniform sampler2D map; uniform vec2 size; uniform float radius, frame;
  varying vec2 vUv;
  float box(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  void main() {
    vec2 p = (vUv - 0.5) * size;
    float d = box(p, size * 0.5, radius);
    if (d > 0.0) discard;
    vec3 col = texture2D(map, vec2(1.0 - vUv.x, vUv.y)).rgb;
    col *= 0.86 + 0.14 * smoothstep(-radius * 2.0, 0.0, -d);
    if (d > -frame) col = vec3(0.05, 0.055, 0.06) + 0.06 * smoothstep(-frame, 0.0, d);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function createMirrors() {
  const mk = (w, h) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 2 });
  const views = [
    { name: 'rear', target: mk(512, 128), cam: new THREE.PerspectiveCamera(22, 4, 0.1, 320) },
    { name: 'left', target: mk(224, 160), cam: new THREE.PerspectiveCamera(30, 1.4, 0.1, 260) },
    { name: 'right', target: mk(224, 160), cam: new THREE.PerspectiveCamera(30, 1.4, 0.1, 260) },
  ];
  const overlay = new THREE.Scene(), ortho = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  for (const v of views) {
    v.mat = new THREE.ShaderMaterial({ uniforms: { map: { value: v.target.texture }, size: { value: new THREE.Vector2(1, 1) }, radius: { value: 12 }, frame: { value: 5 } }, vertexShader: vert, fragmentShader: frag, depthTest: false, depthWrite: false });
    v.quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), v.mat);
    overlay.add(v.quad);
    v.cam.layers.set(0);                    // the driver's head (layer 1) never shows in the mirrors
  }
  let frame = 0;
  const tmp = new THREE.Vector3(), look = new THREE.Vector3();

  // lay the mirrors out for a canvas of w × h pixels (rear-view at the top, door mirrors at the sides)
  function layout(w, h) {
    const place = (v, x, y, pw, ph, r) => {          // x, y: centre in pixels from bottom-left
      v.quad.position.set(x / w, y / h, 0); v.quad.scale.set(pw / w, ph / h, 1);
      v.mat.uniforms.size.value.set(pw, ph); v.mat.uniforms.radius.value = r; v.mat.uniforms.frame.value = Math.max(3, ph * 0.05);
      v.cam.aspect = pw / ph; v.cam.updateProjectionMatrix();
    };
    const portrait = h > w, rw = Math.min(w * (portrait ? 0.62 : 0.34), 560), rh = rw / 4.2;
    place(views[0], w / 2, h - rh / 2 - h * (portrait ? 0.13 : 0.1), rw, rh, rh * 0.45);
    const sw = Math.min(w * (portrait ? 0.3 : 0.15), 240), sh = sw / 1.35;
    place(views[1], sw / 2 + w * 0.012, h * 0.58, sw, sh, sh * 0.32);
    place(views[2], w - sw / 2 - w * 0.012, h * 0.58, sw, sh, sh * 0.32);
  }

  // point the cameras from the car: positions and directions in car coordinates (x forward, z right)
  function aim(car) {
    const E = car.driverEye, half = car.size.z / 2;
    const set = (cam, p, dir) => {
      cam.position.copy(car.body.localToWorld(tmp.copy(p)));
      look.copy(p).add(dir); cam.lookAt(car.body.localToWorld(look));
    };
    set(views[0].cam, new THREE.Vector3(E.x + 0.35, E.y + 0.08, 0), new THREE.Vector3(-1, -0.04, 0));
    set(views[1].cam, new THREE.Vector3(E.x + 0.45, E.y - 0.12, -half - 0.08), new THREE.Vector3(-1, -0.06, -0.22));
    set(views[2].cam, new THREE.Vector3(E.x + 0.45, E.y - 0.12, half + 0.08), new THREE.Vector3(-1, -0.06, 0.22));
  }

  return {
    render(renderer, scene, car) {
      const size = renderer.getSize(new THREE.Vector2());
      layout(size.x, size.y);
      car.root.updateMatrixWorld(true);
      aim(car);
      // one pass per frame: the rear-view mirror, then both door mirrors
      const shadows = renderer.shadowMap.autoUpdate, prevTarget = renderer.getRenderTarget();
      renderer.shadowMap.autoUpdate = false;
      const todo = frame++ % 2 === 0 ? [views[0]] : [views[1], views[2]];
      for (const v of todo) { renderer.setRenderTarget(v.target); renderer.clear(); renderer.render(scene, v.cam); }
      renderer.setRenderTarget(prevTarget);
      renderer.shadowMap.autoUpdate = shadows;
      // draw the three mirrors over the frame
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(overlay, ortho);
      renderer.autoClear = auto;
    },
    dispose() { views.forEach(v => { v.target.dispose(); v.mat.dispose(); v.quad.geometry.dispose(); }); },
  };
}
