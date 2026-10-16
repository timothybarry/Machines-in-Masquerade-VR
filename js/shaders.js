// Small GLSL helpers shared by the world's materials.
export const NOISE_GLSL = `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;
// World position of the vertex, instancing included, into vWP.
export const WORLD_POS_VERT = `#include <begin_vertex>
  vec4 wp4 = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wp4 = instanceMatrix * wp4;
  #endif
  vWP = (modelMatrix * wp4).xyz;`;

const f3 = x => x.toFixed(3);
// Breaks up the tiling of big textured surfaces with a slow world-space brightness wobble.
export function macroTint(mat, scale, amount, extraFrag = '') {
  mat.onBeforeCompile = sh => {
    sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <begin_vertex>', WORLD_POS_VERT);
    sh.fragmentShader = 'varying vec3 vWP;\n' + NOISE_GLSL + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  diffuseColor.rgb *= 1.0 + ${f3(amount)} * (vnoise(vWP.xz / ${f3(scale)}) - 0.5) + ${f3(amount * 0.6)} * (vnoise(vWP.xz / ${f3(scale * 0.17)}) - 0.5);
  ${extraFrag}`);
  };
  mat.customProgramCacheKey = () => 'macro' + scale + amount + extraFrag.length;
}
