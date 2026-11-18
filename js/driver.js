// A driver for the test drive, built in code: head, torso, legs and two arms
// whose hands hold the steering wheel rim. Each frame the hands are moved to
// their grip points on the turned wheel and the arms follow with a two-bone IK
// (shoulder → elbow → wrist). Everything is in the car body's coordinates.
import * as THREE from 'three';

const UPPER = 0.31, FORE = 0.34;          // upper arm / forearm + hand to the grip (m)
const GRIP_DEG = 68;                       // hands at "ten to two"
const HAND_LIMIT = 1.9;                    // the hands follow the rim up to ~110°, then slide

// cylinder between two points (joints get spheres), re-placed every frame for the arms
function limb(radius, mat) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.08, 1, 12), mat);
  m.castShadow = true;
  m.place = (a, b) => {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    m.position.copy(a).addScaledVector(d, 0.5);
    m.scale.set(1, Math.max(0.001, len), 1);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  };
  return m;
}

// elbow for a two-bone chain from shoulder S to target T, bending towards `pole`
function solveElbow(S, T, pole) {
  const d = new THREE.Vector3().subVectors(T, S);
  let len = d.length();
  const reach = UPPER + FORE - 0.002;
  if (len > reach) { d.multiplyScalar(reach / len); len = reach; }
  const dir = d.clone().normalize();
  const a = (UPPER * UPPER - FORE * FORE + len * len) / (2 * len);      // along the chain from S
  const h = Math.sqrt(Math.max(0, UPPER * UPPER - a * a));             // away from it, towards the pole
  const side = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  return { elbow: S.clone().addScaledVector(dir, a).addScaledVector(side, h), wrist: S.clone().add(d) };
}

export function createDriver(car) {
  const E = car.driverEye.clone();
  const group = new THREE.Group();
  group.name = 'driver';

  const skin = new THREE.MeshStandardMaterial({ color: 0xc99877, roughness: 0.7 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.9 });
  const jacket = new THREE.MeshStandardMaterial({ color: 0x1f2a3a, roughness: 0.8 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x2b3a52, roughness: 0.85 });
  const jeans = new THREE.MeshStandardMaterial({ color: 0x2c3a52, roughness: 0.9 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x1b1b1e, roughness: 0.55 });
  const shoe = new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.6 });
  const shades = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.1, metalness: 0.6 });
  const add = (geo, mat, pos, parent = group) => { const o = new THREE.Mesh(geo, mat); o.castShadow = true; if (pos) o.position.copy(pos); parent.add(o); return o; };

  // ---- head (hidden in the cockpit view: the camera is inside it) ----
  const head = new THREE.Group(); group.add(head);
  const hc = E.clone().add(new THREE.Vector3(-0.075, 0.025, 0));
  const skull = add(new THREE.SphereGeometry(0.1, 24, 18), skin, hc, head); skull.scale.set(1.08, 1.15, 0.95);
  const hairCap = add(new THREE.SphereGeometry(0.106, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, hc.clone().add(new THREE.Vector3(-0.012, 0.02, 0)), head);
  hairCap.scale.set(1.08, 1.12, 0.98); hairCap.rotation.z = 0.25;
  const glasses = add(new THREE.BoxGeometry(0.02, 0.035, 0.16), shades, hc.clone().add(new THREE.Vector3(0.095, 0.012, 0)), head);
  void glasses;
  add(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 14), skin, hc.clone().add(new THREE.Vector3(-0.02, -0.15, 0)), head);   // neck

  // ---- torso, leaning back with the seat ----
  const shoulderY = E.y - 0.25, shoulderX = E.x - 0.1;
  const hip = new THREE.Vector3(E.x - 0.2, E.y - 0.66, E.z);
  const chestTop = new THREE.Vector3(shoulderX - 0.01, shoulderY + 0.02, E.z);
  const torso = add(new THREE.CapsuleGeometry(0.14, 1, 6, 16), jacket);
  { const d = new THREE.Vector3().subVectors(chestTop, hip), len = d.length();
    torso.position.copy(hip).addScaledVector(d, 0.5); torso.scale.set(0.72, len * 0.86, 1.3);
    torso.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); }
  const shoulders = [-1, 1].map(s => new THREE.Vector3(shoulderX, shoulderY, E.z + s * 0.19));
  shoulders.forEach(p => add(new THREE.SphereGeometry(0.075, 16, 12), jacket, p));

  // ---- legs: thighs along the seat, shins down to the pedals ----
  for (const s of [-1, 1]) {
    const h = hip.clone().add(new THREE.Vector3(0.02, 0.0, s * 0.1));
    const knee = h.clone().add(new THREE.Vector3(0.42, 0.1, s * 0.03));
    const foot = knee.clone().add(new THREE.Vector3(0.24, -0.34, 0));
    const th = limb(0.07, jeans); th.place(h, knee); group.add(th);
    const sh = limb(0.055, jeans); sh.place(knee, foot); group.add(sh);
    add(new THREE.SphereGeometry(0.07, 12, 10), jeans, knee);
    const sb = add(new THREE.BoxGeometry(0.24, 0.07, 0.09), shoe, foot.clone().add(new THREE.Vector3(0.06, -0.01, 0)));
    sb.rotation.z = 0.5;
  }

  // ---- arms and hands ----
  const wheel = car.wheelGrip || {
    center: E.clone().add(new THREE.Vector3(0.5, -0.27, 0)), axis: new THREE.Vector3(Math.cos(0.35), -Math.sin(0.35), 0), radius: 0.18,
  };
  const axis = wheel.axis.clone().normalize();
  // rim basis: "up" on the wheel face and "left" (towards -z), both perpendicular to the column
  const up = new THREE.Vector3(0, 1, 0).sub(axis.clone().multiplyScalar(axis.y)).normalize();
  const left = new THREE.Vector3().crossVectors(up, axis).normalize();       // up × forward = left (-z)
  if (left.z > 0) left.negate();
  const arms = [-1, 1].map(s => {                                            // s = -1 left hand (towards -z), +1 right
    const upper = limb(0.038, sleeve), fore = limb(0.031, sleeve);
    const elbowBall = add(new THREE.SphereGeometry(0.04, 12, 10), sleeve);
    group.add(upper, fore);
    const hand = new THREE.Group(); group.add(hand);
    // gloved fist closed around the rim: an oval fist, a row of knuckles and the thumb on top
    const fist = add(new THREE.SphereGeometry(0.045, 16, 12), glove, null, hand); fist.scale.set(1.35, 0.85, 1.0); fist.position.x = 0.02;
    for (let i = 0; i < 4; i++) { const k = add(new THREE.SphereGeometry(0.016, 10, 8), glove, null, hand); k.position.set(0.065, -0.012, -0.03 + i * 0.02); }
    const thumb = add(new THREE.CapsuleGeometry(0.013, 0.035, 4, 8), glove, null, hand); thumb.position.set(0.05, 0.03, -s * 0.025); thumb.rotation.z = -1.2;
    const cuffRing = add(new THREE.CylinderGeometry(0.036, 0.036, 0.03, 14), glove, null, hand); cuffRing.rotation.z = Math.PI / 2; cuffRing.position.x = -0.035;
    return { s, upper, fore, elbowBall, hand, shoulder: shoulders[s < 0 ? 0 : 1] };
  });

  const tmp = new THREE.Vector3(), q = new THREE.Quaternion();
  function update(wheelAngle) {
    // the hands ride on the rim up to a point, then the rim slides through them
    const a = THREE.MathUtils.clamp(wheelAngle, -HAND_LIMIT, HAND_LIMIT);
    for (const arm of arms) {
      const th = (GRIP_DEG * Math.PI / 180) * (arm.s < 0 ? 1 : -1);          // left hand at +68° (towards left), right at -68°
      tmp.copy(up).multiplyScalar(Math.cos(th)).addScaledVector(left, Math.sin(th)).multiplyScalar(wheel.radius);
      q.setFromAxisAngle(axis, -a); tmp.applyQuaternion(q);                    // same turn as the steering wheel
      const grip = wheel.center.clone().add(tmp).addScaledVector(axis, -0.012);
      const pole = new THREE.Vector3(-0.3, -1, arm.s * 0.9).normalize();      // elbows down and out
      const { elbow, wrist } = solveElbow(arm.shoulder, grip, pole);
      const cuff = elbow.clone().lerp(wrist, (FORE - 0.08) / FORE);
      arm.upper.place(arm.shoulder, elbow); arm.fore.place(elbow, cuff); arm.elbowBall.position.copy(elbow);
      // hand: along the forearm, palm turned onto the rim
      const fwdDir = new THREE.Vector3().subVectors(wrist, elbow).normalize();
      const rimTangent = new THREE.Vector3().crossVectors(axis, tmp).normalize();
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), fwdDir, rimTangent);
      arm.hand.position.copy(wrist).lerp(cuff, 0.45);
      arm.hand.quaternion.setFromRotationMatrix(m).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
    }
  }
  update(0);
  car.body.add(group);

  return {
    group,
    update,
    setCockpit(on) { head.visible = !on; },
    dispose() {
      car.body.remove(group);
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      [skin, hair, jacket, sleeve, jeans, glove, shoe, shades].forEach(m => m.dispose());
    },
  };
}
