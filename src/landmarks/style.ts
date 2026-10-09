import * as THREE from 'three';

/** Shared low-poly palette — flat shading, emissive windows, fog matches Terrain ocean. */
export const palette = {
  stone: 0x8a7f72,
  stoneDark: 0x5c5348,
  metal: 0x6b7280,
  gold: 0xc9a227,
  sand: 0xc4a574,
  roof: 0x7a4a3a,
  glass: 0x88b4c8,
  window: 0xfff0b0,
  water: 0x4a90a8,
  fog: 0xa8c8d2,
};

export function makeMaterials(themeFog = palette.fog) {
  const body = (color: number, emissive = 0x000000, emissiveInt = 0) =>
    new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: emissiveInt, flatShading: true });
  return {
    stone: body(palette.stone),
    stoneDark: body(palette.stoneDark),
    sand: body(palette.sand),
    metal: body(palette.metal),
    gold: body(palette.gold, palette.window, 0.35),
    roof: body(palette.roof),
    glass: body(palette.glass, palette.window, 0.25),
    window: body(palette.stoneDark, palette.window, 0.55),
    fogColor: themeFog,
  };
}

export function addLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xf4efe0, 0x6b7d85, 0.85));
  const sun = new THREE.DirectionalLight(0xfff5e6, 0.65);
  sun.position.set(-0.6, 0.8, 1.2).normalize();
  scene.add(sun);
}

export function setFog(scene: THREE.Scene, fogColor: number) {
  scene.fog = new THREE.Fog(fogColor, 400, 2200);
}
