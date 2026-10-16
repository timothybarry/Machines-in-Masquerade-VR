// Static instanced decor where each instance can later be hidden or moved (when its building
// collapses, or a prop is knocked loose and handed to the physics engine).
import * as THREE from 'three';
import { V } from './util.js';

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const m4 = new THREE.Matrix4(), IDQ = new THREE.Quaternion();

export class Batch {
  // opts: { shadow, receive, tint, attrs: { name: itemSize }, extra: capacity to append after build }
  constructor(geo, mat, opts = {}) {
    this.geo = geo; this.mat = mat; this.opts = opts;
    this.items = [];
    this.attrs = Object.fromEntries(Object.entries(opts.attrs ?? {}).map(([k, size]) => [k, { size, values: [] }]));
    this.mesh = null;
  }
  // Returns the instance index. attrValues: { name: number | number[] }
  add(pos, quat = IDQ, scale = V(1, 1, 1), color = null, attrValues = {}) {
    this.items.push({ pos: pos.clone(), quat: quat.clone(), scale: scale.clone(), color: color ? new THREE.Color(color) : null });
    for (const [k, a] of Object.entries(this.attrs)) {
      const v = attrValues[k] ?? 0;
      a.values.push(...(Array.isArray(v) ? v : [v]));
    }
    return this.items.length - 1;
  }
  build(scene) {
    const cap = Math.max(1, this.items.length + (this.opts.extra ?? 0));
    for (const [k, a] of Object.entries(this.attrs)) {
      const arr = new Float32Array(cap * a.size); arr.set(a.values);
      this.geo.setAttribute(k, new THREE.InstancedBufferAttribute(arr, a.size));
    }
    const m = this.mesh = new THREE.InstancedMesh(this.geo, this.mat, cap);
    m.castShadow = this.opts.shadow ?? true;
    m.receiveShadow = this.opts.receive ?? true;
    this.items.forEach((it, i) => {
      m.setMatrixAt(i, m4.compose(it.pos, it.quat, it.scale));
      if (this.opts.tint) m.setColorAt(i, it.color ?? new THREE.Color(1, 1, 1));
    });
    if (this.opts.tint && !this.items.length) m.setColorAt(0, new THREE.Color(1, 1, 1));
    m.count = this.items.length;
    m.computeBoundingSphere();
    if (this.opts.cull === false || this.opts.extra) m.frustumCulled = false;
    scene.add(m);
    return m;
  }
  hide(i) { this.mesh.setMatrixAt(i, ZERO); this.mesh.instanceMatrix.needsUpdate = true; }
  set(i, pos, quat, scale) { this.mesh.setMatrixAt(i, m4.compose(pos, quat, scale)); this.mesh.instanceMatrix.needsUpdate = true; }
  // Append after build (needs opts.extra spare capacity).
  append(pos, quat = IDQ, scale = V(1, 1, 1), color = null) {
    const m = this.mesh;
    if (m.count >= m.instanceMatrix.count) return -1;
    const i = m.count++;
    this.items.push({ pos: pos.clone(), quat: quat.clone(), scale: scale.clone(), color: color ? new THREE.Color(color) : null });
    m.setMatrixAt(i, m4.compose(pos, quat, scale));
    if (m.instanceColor && color) { m.setColorAt(i, new THREE.Color(color)); m.instanceColor.needsUpdate = true; }
    m.instanceMatrix.needsUpdate = true;
    return i;
  }
}
