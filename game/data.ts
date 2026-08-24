import type { AircraftConfig, AircraftId } from './types';
import aethra from '../data/aircraft/aethra.json';
import amoria from '../data/aircraft/amoria.json';
import cecilia from '../data/aircraft/cecilia.json';

export const AIRCRAFT: Record<AircraftId, AircraftConfig> = {
  aethra: aethra as AircraftConfig,
  amoria: amoria as AircraftConfig,
  cecilia: cecilia as AircraftConfig,
};

export const WEAPON_COPY = {
  GUN: 'SG-25 / BALLISTIC FCC',
  'ST-1': 'PASSIVE IIR / HMD HIGH-OFF-BORESIGHT',
  'ST-1X': 'SARH / CONTINUOUS STT SUPPORT',
  'ST-1AX': 'ARH / TWS MIDCOURSE + ACTIVE',
} as const;

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
export const length3 = (x: number, y: number, z: number) => Math.hypot(x, y, z);

export type BuildingVolume = { x: number; z: number; base: number; height: number; width: number; depth: number };

export function terrainHeight(x: number, z: number) {
  const valley = Math.min(1, Math.abs(x) / 9000);
  const ridge = 260 + valley * valley * 1480;
  const broad = Math.sin(z * 0.00013) * 220 + Math.sin((x + z) * 0.00022) * 130;
  const folded = Math.pow(Math.abs(Math.sin(x * 0.00017 + z * 0.000085)), 3.2) * (135 + valley * 330);
  const escarpment = Math.pow(Math.abs(Math.sin(x * 0.00033 - z * 0.00014)), 7) * valley * 250;
  const detail = Math.sin(x * 0.00082) * Math.cos(z * 0.00061) * 72
    + Math.sin((x * 1.7 - z) * 0.00122) * 34
    + Math.cos((x + z * 2.1) * 0.0021) * 17;
  const airfield = Math.hypot(x - 900, z - 4200) < 2100 ? -190 : 0;
  return Math.max(25, ridge + broad + folded + escarpment + detail + airfield);
}

export function cityBuildings(): BuildingVolume[] {
  const buildings: BuildingVolume[] = [];
  for (let lane = -4; lane <= 4; lane += 1) {
    for (let block = -3; block < 19; block += 1) {
      const x = lane * 320 + Math.sin(block * 2.7 + lane) * 48;
      const z = block * 510 + 3400;
      buildings.push({
        x, z, base: terrainHeight(x, z),
        height: 42 + ((block * 13 + lane * 7 + 80) % 8) * 23,
        width: 76 + ((lane * 17 + block * 11 + 80) % 4) * 19,
        depth: 88 + ((block * 9 + lane * 5 + 80) % 3) * 24,
      });
    }
  }
  return buildings;
}

export const CITY_BUILDINGS = cityBuildings();

export function collidesBuilding(position: { x: number; y: number; z: number }, margin = 0) {
  return CITY_BUILDINGS.find((building) =>
    Math.abs(position.x - building.x) <= building.width * .5 + margin
    && Math.abs(position.z - building.z) <= building.depth * .5 + margin
    && position.y >= building.base - margin
    && position.y <= building.base + building.height + margin);
}
