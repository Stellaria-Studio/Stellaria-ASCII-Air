import { CITY_BUILDINGS, clamp, terrainHeight, wrapAngle } from './data';
import type { Entity, SimulationSnapshot, Track, Vec3, WeaponId } from './types';
import { BasicWebCameraProjector, type ProjectedPoint } from '../engine/basic-web-core/camera';

type Projected = ProjectedPoint;
const TERRAIN_GLYPHS = ['.', ',', ':', ';', '+', '*', '#', '%', '@'];
type FighterPart = 'fuselage' | 'engine' | 'controls' | 'leftWing' | 'rightWing' | 'tail';
type FighterVertex = readonly [number, number, number];
const FIGHTER_VERTICES: FighterVertex[] = [
  [0, 0, 12], [0, .9, 6], [0, 1, 0], [0, .35, -8], [-1.2, 0, -10], [1.2, 0, -10],
  [-1.4, 0, 4], [-8.5, -.15, -1], [-6.2, -.1, -4.5], [-1.5, 0, -3],
  [1.4, 0, 4], [8.5, -.15, -1], [6.2, -.1, -4.5], [1.5, 0, -3],
  [-4, 0, -8], [4, 0, -8], [0, 3.8, -7], [0, -.85, 0],
  [-.8, 1.15, 3], [.8, 1.15, 3], [-1.45, -.5, 2], [1.45, -.5, 2],
];
const FIGHTER_EDGES: Array<readonly [number, number, FighterPart]> = [
  [0, 1, 'fuselage'], [1, 2, 'fuselage'], [2, 3, 'fuselage'], [3, 4, 'engine'], [3, 5, 'engine'], [4, 5, 'engine'],
  [0, 6, 'fuselage'], [0, 10, 'fuselage'], [6, 7, 'leftWing'], [7, 8, 'leftWing'], [8, 9, 'leftWing'], [9, 6, 'leftWing'],
  [10, 11, 'rightWing'], [11, 12, 'rightWing'], [12, 13, 'rightWing'], [13, 10, 'rightWing'],
  [9, 14, 'tail'], [14, 3, 'tail'], [3, 15, 'tail'], [15, 13, 'tail'], [3, 16, 'tail'],
  [2, 16, 'tail'], [1, 18, 'controls'], [18, 19, 'controls'], [19, 1, 'controls'],
  [6, 20, 'engine'], [20, 17, 'engine'], [17, 21, 'engine'], [21, 10, 'engine'], [17, 3, 'fuselage'],
];
const FIGHTER_FACES: Array<{ vertices: number[]; part: FighterPart }> = [
  { vertices: [0, 6, 7, 8, 9, 3, 2, 1], part: 'leftWing' },
  { vertices: [0, 1, 2, 3, 13, 12, 11, 10], part: 'rightWing' },
  { vertices: [1, 18, 19], part: 'controls' },
  { vertices: [3, 14, 16], part: 'tail' },
  { vertices: [3, 16, 15], part: 'tail' },
];

export class AsciiWorldRenderer {
  private ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private projector = new BasicWebCameraProjector();
  private terrainDepth = new Float32Array(1);
  private terrainCols = 1;
  private terrainRows = 1;
  private readonly cellWidth = 6;
  private readonly cellHeight = 9;

  constructor(private canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('2D canvas unavailable');
    this.ctx = context;
  }

  render(snapshot: SimulationSnapshot) {
    this.resize();
    const { ctx, width: w, height: h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#010504'); sky.addColorStop(0.48, '#02100b'); sky.addColorStop(1, '#010704');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    this.projector.update({ position: snapshot.player.position, heading: snapshot.player.heading, pitch: snapshot.player.pitch, roll: snapshot.player.roll, fovY: 80 * Math.PI / 180 }, { width: this.width, height: this.height });
    this.drawSky(snapshot);
    this.drawTerrain(snapshot);
    this.drawNearTerrainStructure(snapshot);
    this.drawInfrastructure(snapshot);
    this.drawGroundDetails(snapshot);
    this.drawCity(snapshot);
    this.drawEntities(snapshot);
    this.drawHud(snapshot);
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    const pixelWidth = Math.floor(this.width * this.dpr);
    const pixelHeight = Math.floor(this.height * this.dpr);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
  }

  private project(point: Vec3, snapshot: SimulationSnapshot): Projected {
    void snapshot;
    return this.projector.project(point);
  }

  private drawSky(snapshot: SimulationSnapshot) {
    const { ctx, width: w, height: h } = this;
    ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const haze = ctx.createLinearGradient(0, h * 0.22, 0, h * 0.74);
    haze.addColorStop(0, 'rgba(35,103,69,0)'); haze.addColorStop(0.62, 'rgba(35,103,69,.055)'); haze.addColorStop(1, 'rgba(35,103,69,0)');
    ctx.fillStyle = haze; ctx.fillRect(0, h * 0.2, w, h * 0.58);
    for (let index = 0; index < 150; index += 1) {
      const x = ((index * 83 + snapshot.player.heading * 410) % (w + 80)) - 40;
      const y = 54 + ((index * 47) % Math.max(90, h * 0.43));
      const alpha = 0.07 + (index % 5) * 0.027;
      ctx.fillStyle = `rgba(114,255,178,${alpha})`;
      ctx.fillText(index % 17 === 0 ? '·+' : index % 11 === 0 ? '+' : '.', x, y);
    }
  }

  private drawTerrain(snapshot: SimulationSnapshot) {
    const { ctx } = this;
    ctx.font = '600 9.5px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.terrainCols = Math.max(1, Math.ceil(this.width / this.cellWidth));
    this.terrainRows = Math.max(1, Math.ceil(this.height / this.cellHeight));
    const cellCount = this.terrainCols * this.terrainRows;
    if (this.terrainDepth.length !== cellCount) this.terrainDepth = new Float32Array(cellCount);
    this.terrainDepth.fill(Number.POSITIVE_INFINITY);
    const glyphs = new Array<string>(cellCount);
    const alphas = new Float32Array(cellCount);
    const tones = new Uint8Array(cellCount);
    // When the nose passes vertical during a loop, the camera's horizontal
    // look direction reverses. Sample terrain in that hemisphere as well.
    const heading = snapshot.player.heading + (Math.cos(snapshot.player.pitch) < 0 ? Math.PI : 0);
    const sideX = Math.cos(heading);
    const sideZ = -Math.sin(heading);
    const frontX = Math.sin(heading);
    const frontZ = Math.cos(heading);
    const projected: Projected = { x: 0, y: 0, depth: 0, visible: false };
    const sampleRows = clamp(Math.floor(this.height / 10), 66, 94);
    const sideSamples = clamp(Math.floor(this.width / 13), 88, 150);
    for (let row = 1; row <= sampleRows; row += 1) {
        const depth = 180 + Math.pow(row / sampleRows, 1.58) * 62_000;
        const step = 118 + depth * 0.0152;
      for (let col = -sideSamples / 2; col <= sideSamples / 2; col += 1) {
        const side = col * step;
        const worldX = snapshot.player.position.x + frontX * depth + sideX * side;
        const worldZ = snapshot.player.position.z + frontZ * depth + sideZ * side;
        const y = terrainHeight(worldX, worldZ);
        this.projector.projectXYZ(worldX, y, worldZ, projected);
        if (!projected.visible || projected.x < 0 || projected.x >= this.width || projected.y < 42 || projected.y >= this.height) continue;
        const cellX = Math.floor(projected.x / this.cellWidth);
        const cellY = Math.floor(projected.y / this.cellHeight);
        const index = cellY * this.terrainCols + cellX;
        if (projected.depth >= this.terrainDepth[index]) continue;
        const slopeX = terrainHeight(worldX + 110, worldZ) - terrainHeight(worldX - 110, worldZ);
        const slopeZ = terrainHeight(worldX, worldZ + 110) - terrainHeight(worldX, worldZ - 110);
        const slope = Math.hypot(slopeX, slopeZ);
        const distanceFade = clamp(1 - depth / 66_000, 0.07, 1);
        const contour = Math.abs((y / 210) - Math.round(y / 210)) < 0.055;
        const glyphIndex = clamp(Math.floor(distanceFade * 5.4 + slope * 0.012 + ((row + col) & 1)), 0, TERRAIN_GLYPHS.length - 1);
        glyphs[index] = contour ? (Math.abs(slopeX) > Math.abs(slopeZ) ? '=' : '-') : slope > 330 ? (slopeX > 0 ? '/' : '\\') : TERRAIN_GLYPHS[glyphIndex];
        alphas[index] = 0.14 + distanceFade * 0.84;
        tones[index] = contour ? 2 : y < 120 ? 1 : slope > 260 ? 3 : 0;
        this.terrainDepth[index] = projected.depth;
      }
    }
    for (let index = 0; index < cellCount; index += 1) {
      if (!glyphs[index]) continue;
      const x = (index % this.terrainCols + 0.5) * this.cellWidth;
      const y = (Math.floor(index / this.terrainCols) + 0.5) * this.cellHeight;
      ctx.fillStyle = tones[index] === 2 ? `rgba(210,181,118,${alphas[index] * .88})`
        : tones[index] === 1 ? `rgba(103,143,157,${alphas[index] * .9})`
          : tones[index] === 3 ? `rgba(163,142,121,${alphas[index] * .92})`
            : `rgba(119,137,105,${alphas[index] * .88})`;
      ctx.fillText(glyphs[index], x, y);
    }
  }

  private drawNearTerrainStructure(snapshot: SimulationSnapshot) {
    const { ctx } = this;
    const heading = snapshot.player.heading + (Math.cos(snapshot.player.pitch) < 0 ? Math.PI : 0);
    const front = { x: Math.sin(heading), z: Math.cos(heading) };
    const side = { x: Math.cos(heading), z: -Math.sin(heading) };
    const depths = [180, 280, 420, 620, 900, 1300, 1850, 2600, 3600, 4900, 6500];
    const drawSurfacePath = (points: Vec3[], alpha: number, width: number, dash: number[] = []) => {
      ctx.save(); ctx.strokeStyle = `rgba(205,174,119,${alpha})`; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.beginPath(); let drawing = false;
      for (const world of points) {
        const point = this.project(world, snapshot);
        if (!point.visible || point.x < -20 || point.x > this.width + 20 || point.y < 42 || point.y > this.height + 10) { drawing = false; continue; }
        const cellX = Math.floor(point.x / this.cellWidth); const cellY = Math.floor(point.y / this.cellHeight);
        const surfaceDepth = cellX >= 0 && cellX < this.terrainCols && cellY >= 0 && cellY < this.terrainRows
          ? this.terrainDepth[cellY * this.terrainCols + cellX]
          : Number.POSITIVE_INFINITY;
        if (Number.isFinite(surfaceDepth) && surfaceDepth + 85 < point.depth) { drawing = false; continue; }
        if (!drawing) { ctx.moveTo(point.x, point.y); drawing = true; } else ctx.lineTo(point.x, point.y);
      }
      ctx.stroke(); ctx.restore();
    };
    depths.forEach((depth, index) => {
      const span = depth * 1.18 + 340; const points: Vec3[] = [];
      for (let step = -24; step <= 24; step += 1) {
        const offset = span * step / 24;
        const x = snapshot.player.position.x + front.x * depth + side.x * offset;
        const z = snapshot.player.position.z + front.z * depth + side.z * offset;
        points.push({ x, z, y: terrainHeight(x, z) + 4 });
      }
      const proximity = 1 - index / depths.length;
      drawSurfacePath(points, .09 + proximity * .32, proximity > .72 ? 1.35 : .8, index % 2 ? [2, 5] : []);
    });
    for (const lane of [-1, -.75, -.5, -.25, 0, .25, .5, .75, 1]) {
      const points: Vec3[] = [];
      for (const depth of depths) {
        const offset = lane * (depth * 1.18 + 340);
        const x = snapshot.player.position.x + front.x * depth + side.x * offset;
        const z = snapshot.player.position.z + front.z * depth + side.z * offset;
        points.push({ x, z, y: terrainHeight(x, z) + 5 });
      }
      drawSurfacePath(points, lane === 0 ? .34 : .16, lane === 0 ? 1.25 : .7, lane === 0 ? [] : [3, 7]);
    }

    const cell = 480; const centerX = Math.round(snapshot.player.position.x / cell); const centerZ = Math.round(snapshot.player.position.z / cell);
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.shadowColor = 'rgba(0,0,0,.92)'; ctx.shadowBlur = 3;
    for (let gx = centerX - 9; gx <= centerX + 9; gx += 1) for (let gz = centerZ - 9; gz <= centerZ + 9; gz += 1) {
      const seed = Math.sin(gx * 91.733 + gz * 47.193) * 43758.5453; const hash = seed - Math.floor(seed);
      if (hash < .43) continue;
      const x = gx * cell + (hash - .5) * cell * .62; const z = gz * cell + ((hash * 7.13) % 1 - .5) * cell * .62;
      const y = terrainHeight(x, z); const world = { x, y: y + 7, z }; const point = this.project(world, snapshot);
      if (!point.visible || point.depth > 6800 || point.x < 8 || point.x > this.width - 8 || point.y < 42 || point.y > this.height || this.terrainOccludes(world, point, snapshot.player.position)) continue;
      const slope = Math.hypot(terrainHeight(x + 80, z) - terrainHeight(x - 80, z), terrainHeight(x, z + 80) - terrainHeight(x, z - 80));
      const scale = clamp(5600 / point.depth, .65, 2.7); ctx.font = `bold ${Math.round(8 * scale)}px ui-monospace, monospace`;
      if (slope > 150) { ctx.fillStyle = 'rgba(190,159,128,.9)'; ctx.fillText(hash > .75 ? '/##\\' : '[//]', point.x, point.y); }
      else if (y > 280 && hash > .62) { ctx.fillStyle = 'rgba(132,154,91,.88)'; ctx.fillText(hash > .82 ? '/Y\\' : 'Y', point.x, point.y); }
      else { ctx.fillStyle = 'rgba(181,161,125,.78)'; ctx.fillText(hash > .78 ? '[::]' : '··', point.x, point.y); }
    }
    ctx.restore();
  }

  private terrainOccludes(point: Vec3, projected: Projected, observer: Vec3) {
    const cellX = Math.floor(projected.x / this.cellWidth);
    const cellY = Math.floor(projected.y / this.cellHeight);
    if (cellX >= 0 && cellX < this.terrainCols && cellY >= 0 && cellY < this.terrainRows) {
      const surfaceDepth = this.terrainDepth[cellY * this.terrainCols + cellX];
      if (Number.isFinite(surfaceDepth) && surfaceDepth + 45 < projected.depth) return true;
    }
    const steps = clamp(Math.floor(projected.depth / 900), 7, 22);
    for (let step = 1; step < steps; step += 1) {
      const t = step / steps;
      const x = observer.x + (point.x - observer.x) * t;
      const z = observer.z + (point.z - observer.z) * t;
      const rayY = observer.y + (point.y - observer.y) * t;
      if (terrainHeight(x, z) + 28 > rayY) return true;
    }
    return false;
  }

  private drawInfrastructure(snapshot: SimulationSnapshot) {
    const { ctx } = this;
    const drawWorldLine = (points: Vec3[], color: string, dash: number[] = []) => {
      ctx.save(); ctx.strokeStyle = color; ctx.setLineDash(dash); ctx.beginPath(); let drawing = false;
      for (const point of points) {
        const projected = this.project(point, snapshot);
        const visible = projected.visible && projected.x >= 0 && projected.x < this.width && projected.y > 40 && projected.y < this.height && !this.terrainOccludes(point, projected, snapshot.player.position);
        if (!visible) { drawing = false; continue; }
        if (!drawing) { ctx.moveTo(projected.x, projected.y); drawing = true; } else ctx.lineTo(projected.x, projected.y);
      }
      ctx.stroke(); ctx.restore();
    };
    const highway: Vec3[] = [];
    for (let z = -18_000; z <= 30_000; z += 300) {
      const x = Math.sin(z * .00043) * 520;
      highway.push({ x, z, y: terrainHeight(x, z) + 7 });
    }
    drawWorldLine(highway, 'rgba(119,255,184,.34)', [5, 6]);
    for (const lane of [-1, 1]) {
      const road: Vec3[] = [];
      for (let z = -12_000; z <= 22_000; z += 380) {
        const x = lane * 980 + Math.sin(z * .0007 + lane) * 160;
        road.push({ x, z, y: terrainHeight(x, z) + 6 });
      }
      drawWorldLine(road, 'rgba(119,255,184,.2)', [2, 7]);
    }
    const runway: Vec3[] = [];
    for (let z = 3000; z <= 5450; z += 95) runway.push({ x: 900, z, y: terrainHeight(900, z) + 10 });
    drawWorldLine(runway, 'rgba(255,204,112,.68)', [9, 5]);
  }

  private drawGroundDetails(snapshot: SimulationSnapshot) {
    const { ctx } = this;
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (let index = 0; index < 220; index += 1) {
      const z = -2500 + (index % 55) * 280 + Math.sin(index * 4.17) * 90;
      const side = Math.floor(index / 55) - 1.5;
      const x = side * 1450 + Math.sin(index * 2.31) * 720;
      const point = { x, z, y: terrainHeight(x, z) + 8 };
      const projected = this.project(point, snapshot);
      if (!projected.visible || projected.depth > 11_000 || projected.x < 0 || projected.x > this.width || projected.y < 40 || projected.y > this.height || this.terrainOccludes(point, projected, snapshot.player.position)) continue;
      const scale = clamp(6200 / projected.depth, .55, 2.2);
      ctx.font = `bold ${Math.round(8 * scale)}px ui-monospace, monospace`;
      ctx.fillStyle = index % 7 === 0 ? 'rgba(151,169,139,.68)' : 'rgba(101,132,119,.58)';
      ctx.fillText(index % 7 === 0 ? '/|\\' : index % 5 === 0 ? '[#]' : '^', projected.x, projected.y);
      if (scale > 1.35 && index % 7 === 0) { ctx.fillStyle = 'rgba(72,176,118,.64)'; ctx.fillText(' Y ', projected.x, projected.y - 4 * scale); }
    }
    ctx.restore();
  }

  private drawCity(snapshot: SimulationSnapshot) {
    const { ctx } = this;
    ctx.font = '600 8px ui-monospace, SFMono-Regular, Menlo, monospace';
    const buildings = [...CITY_BUILDINGS];
    buildings.sort((a, b) => this.projector.depth({ x: b.x, y: b.base, z: b.z }) - this.projector.depth({ x: a.x, y: a.base, z: a.z }));
    for (const building of buildings) {
      const topCenter = { x: building.x, y: building.base + building.height, z: building.z };
      const top = this.project(topCenter, snapshot);
      if (!top.visible || top.x < -50 || top.x > this.width + 50 || top.y > this.height || this.terrainOccludes(topCenter, top, snapshot.player.position)) continue;
      const alpha = clamp(1 - top.depth / 24_000, 0.16, 0.72);
      const corners = [
        { x: building.x - building.width / 2, z: building.z - building.depth / 2 }, { x: building.x + building.width / 2, z: building.z - building.depth / 2 },
        { x: building.x + building.width / 2, z: building.z + building.depth / 2 }, { x: building.x - building.width / 2, z: building.z + building.depth / 2 },
      ];
      const bottom = corners.map((corner) => this.project({ x: corner.x, y: building.base, z: corner.z }, snapshot));
      const roof = corners.map((corner) => this.project({ x: corner.x, y: building.base + building.height, z: corner.z }, snapshot));
      if (bottom.some((point) => !point.visible) || roof.some((point) => !point.visible)) continue;
      const polygon = (points: Projected[], fill: string) => { ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y); for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.stroke(); };
      ctx.strokeStyle = `rgba(119,170,166,${alpha})`; ctx.lineWidth = 1;
      polygon([roof[0], roof[1], bottom[1], bottom[0]], `rgba(2,15,10,${.76 + alpha * .18})`);
      polygon([roof[1], roof[2], bottom[2], bottom[1]], `rgba(1,10,7,${.82 + alpha * .14})`);
      polygon(roof, `rgba(90,211,143,${alpha * .22})`);
      const screenHeight = Math.abs(bottom[0].y - roof[0].y);
      if (screenHeight > 9) {
        ctx.fillStyle = `rgba(255,211,112,${alpha * .72})`;
        const rows = clamp(Math.floor(screenHeight / 8), 1, 7);
        for (let row = 1; row <= rows; row += 1) {
          const t = row / (rows + 1);
          const leftX = roof[0].x + (bottom[0].x - roof[0].x) * t; const leftY = roof[0].y + (bottom[0].y - roof[0].y) * t;
          const rightX = roof[1].x + (bottom[1].x - roof[1].x) * t; const rightY = roof[1].y + (bottom[1].y - roof[1].y) * t;
          ctx.strokeStyle = `rgba(123,170,166,${alpha * .38})`; ctx.beginPath(); ctx.moveTo(leftX, leftY); ctx.lineTo(rightX, rightY); ctx.stroke();
          for (let column = 1; column <= 3; column += 1) { const u = column / 4; ctx.fillText((row + column) % 3 ? '·' : ':', leftX + (rightX - leftX) * u, leftY + (rightY - leftY) * u); }
        }
        if (screenHeight > 24) { ctx.strokeStyle = `rgba(163,255,202,${alpha * .65})`; ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(top.x, top.y - clamp(screenHeight * .24, 4, 14)); ctx.stroke(); ctx.fillText('+', top.x, top.y - clamp(screenHeight * .24, 4, 14)); }
      }
    }
  }

  private drawEntities(snapshot: SimulationSnapshot) {
    const ordered = [...snapshot.entities].sort((a, b) => this.projector.depth(b.position) - this.projector.depth(a.position));
    for (const entity of ordered) {
      const point = this.project(entity.position, snapshot);
      if (!point.visible || point.x < -80 || point.x > this.width + 80 || point.y < 40 || point.y > this.height + 30) continue;
      if (this.terrainOccludes(entity.position, point, snapshot.player.position)) continue;
      if (entity.kind === 'enemy') this.drawAircraft(entity, point, snapshot);
      else if (entity.kind === 'missile') this.drawMissile(entity, point, snapshot);
      else if (entity.kind === 'tracer') this.drawTracer(entity, point, snapshot);
      else if (entity.kind === 'smoke') this.drawSmoke(entity, point);
      else this.drawBlast(entity, point);
    }
  }

  private drawAircraft(entity: Entity, point: Projected, snapshot: SimulationSnapshot) {
    const { ctx } = this;
    const size = clamp(72_000 / point.depth, 7, 76);
    const axis = { x: Math.sin(entity.heading) * Math.cos(entity.pitch), y: Math.sin(entity.pitch), z: Math.cos(entity.heading) * Math.cos(entity.pitch) };
    const baseRight = { x: Math.cos(entity.heading), y: 0, z: -Math.sin(entity.heading) };
    const baseUp = { x: -Math.sin(entity.heading) * Math.sin(entity.pitch), y: Math.cos(entity.pitch), z: -Math.cos(entity.heading) * Math.sin(entity.pitch) };
    const right = {
      x: baseRight.x * Math.cos(entity.roll) + baseUp.x * Math.sin(entity.roll),
      y: baseRight.y * Math.cos(entity.roll) + baseUp.y * Math.sin(entity.roll),
      z: baseRight.z * Math.cos(entity.roll) + baseUp.z * Math.sin(entity.roll),
    };
    const up = {
      x: baseUp.x * Math.cos(entity.roll) - baseRight.x * Math.sin(entity.roll),
      y: baseUp.y * Math.cos(entity.roll) - baseRight.y * Math.sin(entity.roll),
      z: baseUp.z * Math.cos(entity.roll) - baseRight.z * Math.sin(entity.roll),
    };
    ctx.save();
    if (size < 11) {
      ctx.fillStyle = entity.fatal ? '#ff625f' : entity.team === 2 ? '#ffbf62' : '#7dffb8';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold 13px ui-monospace, monospace';
      ctx.fillText(entity.fatal ? '×' : '◇', point.x, point.y);
    } else {
      const scale = 3.25;
      const projected = FIGHTER_VERTICES.map(([localX, localY, localZ]) => this.project({
        x: entity.position.x + (right.x * localX + up.x * localY + axis.x * localZ) * scale,
        y: entity.position.y + (right.y * localX + up.y * localY + axis.y * localZ) * scale,
        z: entity.position.z + (right.z * localX + up.z * localY + axis.z * localZ) * scale,
      }, snapshot));
      const damageFor = (part: FighterPart) => entity.damage?.[part] ?? 0;
      const faces = FIGHTER_FACES.filter((face) => damageFor(face.part) < .82 && face.vertices.every((index) => projected[index].visible))
        .sort((a, b) => b.vertices.reduce((sum, index) => sum + projected[index].depth, 0) / b.vertices.length - a.vertices.reduce((sum, index) => sum + projected[index].depth, 0) / a.vertices.length);
      for (const face of faces) {
        ctx.beginPath();
        face.vertices.forEach((index, vertexIndex) => vertexIndex ? ctx.lineTo(projected[index].x, projected[index].y) : ctx.moveTo(projected[index].x, projected[index].y));
        ctx.closePath();
        ctx.fillStyle = entity.fatal ? 'rgba(62,12,6,.52)' : entity.team === 2 ? 'rgba(35,20,7,.64)' : 'rgba(5,31,20,.62)';
        ctx.fill();
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `bold ${clamp(size * .17, 7, 11)}px ui-monospace, monospace`;
      for (const [startIndex, endIndex, part] of FIGHTER_EDGES) {
        const damage = damageFor(part);
        if (damage > .92) continue;
        const start = projected[startIndex]; const end = projected[endIndex];
        if (!start.visible || !end.visible) continue;
        const dx = end.x - start.x; const dy = end.y - start.y;
        const pixelLength = Math.hypot(dx, dy); const steps = clamp(Math.ceil(pixelLength / 4.5), 1, 22);
        const glyph = Math.abs(dx) > Math.abs(dy) * 1.8 ? '—' : Math.abs(dy) > Math.abs(dx) * 1.8 ? '|' : dx * dy > 0 ? '\\' : '/';
        ctx.fillStyle = damage > .25 || entity.fatal && part === entity.lastHitPart ? '#ff625f' : entity.team === 2 ? '#ffd276' : '#83ffc0';
        for (let step = 0; step <= steps; step += 1) ctx.fillText(glyph, start.x + dx * step / steps, start.y + dy * step / steps);
      }
      if (size > 22) {
        ctx.font = `bold ${clamp(size * .18, 8, 12)}px ui-monospace, monospace`;
        ctx.fillStyle = entity.fatal ? '#ff625f' : '#ffd276';
        for (const index of [0, 2, 4, 5, 7, 11, 16]) if (projected[index].visible) ctx.fillText(index === 2 ? '##' : index === 16 ? '^' : '+', projected[index].x, projected[index].y);
      }
    }
    ctx.restore();
    if (entity.team === 2 && point.depth < 14_000) {
      const barW = clamp(size * .9, 22, 68); const barY = point.y + size * .72 + 18;
      ctx.save(); ctx.fillStyle = 'rgba(1,8,5,.88)'; ctx.fillRect(point.x - barW / 2 - 2, barY - 2, barW + 4, 7);
      ctx.strokeStyle = 'rgba(255,190,92,.62)'; ctx.strokeRect(point.x - barW / 2, barY, barW, 3);
      ctx.fillStyle = entity.fatal ? '#ff4f4f' : entity.health > 55 ? '#ffbf62' : entity.health > 25 ? '#ff8b54' : '#ff4f4f'; ctx.fillRect(point.x - barW / 2, barY, barW * clamp(entity.health / 100, 0, 1), 3);
      if (entity.fatal) { ctx.fillStyle = '#ff625f'; ctx.font = 'bold 8px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillText(`FATAL ${entity.lastHitPart?.toUpperCase() ?? ''}`, point.x, barY + 12); }
      ctx.restore();
    }
  }

  private drawMissile(entity: Entity, point: Projected, snapshot: SimulationSnapshot) {
    const { ctx } = this;
    const size = clamp(24_000 / point.depth, 5, 24);
    ctx.strokeStyle = entity.team === 2 ? '#ff625f' : '#ffd577';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = `bold ${clamp(size, 9, 15)}px ui-monospace, monospace`;
    if (size < 9) ctx.fillText(entity.team === 2 ? 'M' : '>', point.x, point.y);
    else {
      ctx.save(); ctx.translate(point.x, point.y); ctx.beginPath(); ctx.moveTo(0, -size * .55); ctx.lineTo(size * .18, size * .18); ctx.lineTo(size * .42, size * .42); ctx.lineTo(0, size * .28); ctx.lineTo(-size * .42, size * .42); ctx.lineTo(-size * .18, size * .18); ctx.closePath(); ctx.stroke(); ctx.fillText(entity.team === 2 ? 'M' : 'A', 0, size * .06); ctx.restore();
    }
    const motorBurning = entity.life < (entity.motorBurnTime ?? 4);
    const tail = this.project({ x: entity.position.x - entity.velocity.x * 0.18, y: entity.position.y - entity.velocity.y * 0.18, z: entity.position.z - entity.velocity.z * 0.18 }, snapshot);
    if (motorBurning && tail.visible) {
      ctx.globalAlpha = 0.46; ctx.beginPath(); ctx.moveTo(point.x, point.y); ctx.lineTo(tail.x, tail.y); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }

  private drawTracer(entity: Entity, point: Projected, snapshot: SimulationSnapshot) {
    const { ctx } = this;
    const tail = this.project({ x: entity.position.x - entity.velocity.x * .035, y: entity.position.y - entity.velocity.y * .035, z: entity.position.z - entity.velocity.z * .035 }, snapshot);
    ctx.save(); ctx.strokeStyle = '#ffd34f'; ctx.fillStyle = '#ffe27a'; ctx.lineWidth = 1.6; ctx.shadowColor = '#ffb52e'; ctx.shadowBlur = 5;
    ctx.beginPath(); ctx.moveTo(point.x, point.y); if (tail.visible) ctx.lineTo(tail.x, tail.y); else ctx.lineTo(point.x, point.y + 5); ctx.stroke(); ctx.fillRect(point.x - 1, point.y - 1, 3, 3); ctx.restore();
  }

  private drawSmoke(entity: Entity, point: Projected) {
    const { ctx } = this;
    const trailLife = entity.trailLife ?? 3.4;
    const fade = clamp(1 - entity.life / trailLife, 0, 1);
    const radius = clamp((4 + entity.life * 9) * 1600 / Math.max(700, point.depth), .8, 9);
    ctx.save(); ctx.globalAlpha = fade * .42; ctx.fillStyle = 'rgba(225,234,226,.58)'; ctx.strokeStyle = 'rgba(245,250,244,.48)';
    ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fill();
    ctx.font = `${clamp(radius * 1.15, 6, 15)}px ui-monospace, monospace`; ctx.textAlign = 'center'; ctx.fillText(entity.life < .7 ? '::' : entity.life < 1.7 ? '··' : ' . ', point.x, point.y); ctx.restore();
  }

  private drawBlast(entity: Entity, point: Projected) {
    const { ctx } = this;
    const growth = clamp(entity.life / 1.1, 0, 1); const radius = clamp((18 + growth * 105) * 1700 / Math.max(500, point.depth), 5, 92);
    ctx.save(); ctx.globalAlpha = 1 - growth; ctx.strokeStyle = '#ff4f4f'; ctx.fillStyle = 'rgba(255,183,70,.34)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffd34f'; ctx.font = `bold ${clamp(radius * .45, 10, 28)}px ui-monospace, monospace`; ctx.textAlign = 'center'; ctx.fillText('*#*', point.x, point.y); ctx.restore();
  }

  private drawHud(snapshot: SimulationSnapshot) {
    const { ctx, width: w, height: h } = this;
    const green = '#7dffb8';
    const dim = 'rgba(125,255,184,.58)';
    const amber = '#ffbf62';
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = green;
    ctx.fillStyle = green;
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    this.drawHeadingTape(snapshot);
    const displayPitch = Math.asin(Math.sin(snapshot.player.pitch));
    const inverted = Math.cos(snapshot.player.pitch) < 0;
    const horizonY = h * 0.49 + displayPitch * h * 0.74;
    ctx.save(); ctx.translate(w * 0.5, horizonY); ctx.rotate(snapshot.player.roll + (inverted ? Math.PI : 0));
    for (let degree = -40; degree <= 40; degree += 5) {
      const y = -degree * 4.55;
      ctx.globalAlpha = degree === 0 ? 0.88 : 0.48;
      ctx.setLineDash(degree < 0 ? [6, 4] : []);
      const span = degree % 10 === 0 ? 72 : 49;
      ctx.beginPath(); ctx.moveTo(-span, y); ctx.lineTo(-19, y); ctx.moveTo(19, y); ctx.lineTo(span, y); ctx.stroke();
      if (degree !== 0 && degree % 10 === 0) { ctx.fillText(String(Math.abs(degree)), -84, y); ctx.fillText(String(Math.abs(degree)), 84, y); }
    }
    ctx.setLineDash([]); ctx.restore(); ctx.globalAlpha = 1;

    ctx.save(); ctx.translate(w * 0.5, h * 0.22);
    ctx.beginPath(); ctx.arc(0, 0, 82, Math.PI * 1.12, Math.PI * 1.88); ctx.strokeStyle = dim; ctx.stroke();
    for (let degree = -60; degree <= 60; degree += 15) {
      const angle = degree * Math.PI / 180 - Math.PI / 2;
      const inner = degree % 30 === 0 ? 72 : 76;
      ctx.beginPath(); ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner); ctx.lineTo(Math.cos(angle) * 82, Math.sin(angle) * 82); ctx.stroke();
    }
    ctx.fillStyle = green; ctx.beginPath(); ctx.moveTo(-5, -86); ctx.lineTo(5, -86); ctx.lineTo(0, -78); ctx.closePath(); ctx.stroke(); ctx.restore();

    ctx.beginPath();
    ctx.moveTo(w * 0.5 - 16, h * 0.49); ctx.lineTo(w * 0.5 - 5, h * 0.49);
    ctx.moveTo(w * 0.5 + 5, h * 0.49); ctx.lineTo(w * 0.5 + 16, h * 0.49);
    ctx.moveTo(w * 0.5, h * 0.49 - 10); ctx.lineTo(w * 0.5, h * 0.49 - 3); ctx.stroke();
    const velocityWorld = {
      x: snapshot.player.position.x + snapshot.player.velocity.x * 5,
      y: snapshot.player.position.y + snapshot.player.velocity.y * 5,
      z: snapshot.player.position.z + snapshot.player.velocity.z * 5,
    };
    const velocityPoint = this.project(velocityWorld, snapshot);
    const velocityX = velocityPoint.visible ? velocityPoint.x : w * .5;
    const velocityY = velocityPoint.visible ? velocityPoint.y : h * .52;
    ctx.beginPath(); ctx.arc(velocityX, velocityY, 8, 0, Math.PI * 2); ctx.moveTo(velocityX - 20, velocityY); ctx.lineTo(velocityX - 8, velocityY); ctx.moveTo(velocityX + 8, velocityY); ctx.lineTo(velocityX + 20, velocityY); ctx.moveTo(velocityX, velocityY - 8); ctx.lineTo(velocityX, velocityY - 15); ctx.stroke();
    const commandX = clamp(w * 0.5 + snapshot.commandX * w * 0.46, 28, w - 28);
    const commandY = clamp(h * 0.5 + snapshot.commandY * h * 0.43, 38, h - 42);
    ctx.globalAlpha = .78; ctx.beginPath(); ctx.arc(commandX, commandY, 18, 0, Math.PI * 2); ctx.moveTo(commandX - 28, commandY); ctx.lineTo(commandX - 18, commandY); ctx.moveTo(commandX + 18, commandY); ctx.lineTo(commandX + 28, commandY); ctx.moveTo(commandX, commandY - 28); ctx.lineTo(commandX, commandY - 18); ctx.stroke(); ctx.globalAlpha = 1;
    if (snapshot.radarMode === 'HMD') {
      ctx.save(); ctx.strokeStyle = amber; ctx.fillStyle = amber; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(commandX, commandY, 31, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.font = 'bold 8px ui-monospace, monospace'; ctx.fillText('HMD ACQ', commandX, commandY - 38); ctx.restore();
    }
    ctx.fillStyle = dim; ctx.font = '8px ui-monospace, monospace'; ctx.fillText('MOUSE AIM', commandX, commandY + 29);

    const densityRatio = clamp(Math.exp(-Math.max(0, snapshot.player.position.y) / 8500), .18, 1);
    const cas = Math.round(snapshot.player.speed * Math.sqrt(densityRatio) * 1.944);
    const tas = Math.round(snapshot.player.speed * 1.944);
    const alt = Math.round(snapshot.player.position.y * 3.281);
    const radarAlt = Math.max(0, Math.round(snapshot.clearance * 3.281));
    const soundSpeed = 340.3 - Math.min(44, Math.max(0, snapshot.player.position.y) * .0031);
    const heading = Math.round((((snapshot.player.heading * 180 / Math.PI) % 360) + 360) % 360);
    this.drawFlightTape(w * .5 - 194, h * 0.49, cas, 50, 'CAS', 'KT', 'left');
    this.drawFlightTape(w * .5 + 194, h * 0.49, alt, 1000, 'ALT', 'FT', 'right');
    ctx.textAlign = 'left'; ctx.fillStyle = green; ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.fillText(`TAS ${tas} KT  M ${(snapshot.player.speed / soundSpeed).toFixed(2)}`, w * .5 - 252, h * .49 + 128);
    ctx.fillStyle = dim; ctx.font = '9px ui-monospace, monospace';
    ctx.fillText(`G ${snapshot.player.g.toFixed(1)}  α ${snapshot.player.aoa.toFixed(1)}°  β ${snapshot.sideslip.toFixed(1)}°`, w * .5 - 252, h * .49 + 145);
    ctx.fillStyle = snapshot.player.energyRate >= 0 ? '#7dffb8' : '#ffbf62';
    ctx.fillText(`ENERGY ${snapshot.player.energyRate >= 0 ? '+' : ''}${Math.round(snapshot.player.energyRate)} M/S`, 34, h - 42);
    const radarAltColor = radarAlt < 500 ? '#ff4f4f' : radarAlt < 1500 ? amber : green;
    ctx.textAlign = 'right'; ctx.fillStyle = radarAltColor; ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.fillText(`RALT ${String(radarAlt).padStart(5, '0')} FT`, w * .5 + 252, h * .49 + 128);
    ctx.fillStyle = dim; ctx.font = '9px ui-monospace, monospace';
    ctx.fillText(`V/S ${Math.round(snapshot.player.velocity.y * 196.85)} FPM`, w * .5 + 252, h * .49 + 145);
    ctx.fillText(`HDG ${String(heading).padStart(3, '0')} MAG`, w * .5 + 252, h * .49 + 162);

    ctx.textAlign = 'center';
    ctx.fillStyle = amber;
    ctx.font = '10px ui-monospace, monospace'; ctx.fillText(snapshot.message, w * 0.5, 104);

    this.drawTrackCues(snapshot);
    if (snapshot.selectedWeapon === 'GUN') this.drawGunFunnel(snapshot);
    const targetTrack = snapshot.tracks.find((track) => track.entityId === snapshot.targetId);
    if (targetTrack) {
      const target = this.project(targetTrack.position, snapshot);
      if (target.visible) {
        const box = clamp(34 + targetTrack.uncertainty * 0.035, 38, 72);
        ctx.strokeStyle = amber;
        const memoryTrack = this.terrainOccludes(targetTrack.position, target, snapshot.player.position) || targetTrack.state === 'COAST';
        ctx.setLineDash(memoryTrack ? [5, 4] : []);
        this.drawLockFrame(target.x, target.y, box);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(1,8,5,.86)'; ctx.fillRect(target.x - 74, target.y - box / 2 - 22, 148, 14);
        ctx.fillStyle = amber; ctx.font = 'bold 9px ui-monospace, monospace';
        ctx.fillText(`FCR ${memoryTrack ? 'MEM' : 'LOCK'} · T${String(targetTrack.id).padStart(3, '0')} · Q${Math.round(targetTrack.quality * 100)}`, target.x, target.y - box / 2 - 15);
        const range = Math.hypot(targetTrack.position.x - snapshot.player.position.x, targetTrack.position.y - snapshot.player.position.y, targetTrack.position.z - snapshot.player.position.z);
        ctx.fillText(`${(range / 1000).toFixed(1)} KM`, target.x, target.y + box / 2 + 12);
        if (snapshot.selectedWeapon === 'GUN' && range < 7000) this.drawGunSolution(snapshot, targetTrack, range);
        else if (snapshot.selectedWeapon !== 'GUN') this.drawDlz(range, targetTrack.quality);
      }
    }

    this.drawRadar(snapshot);
    this.drawRwr(snapshot);
    this.drawThrottleGauge(snapshot);
    this.drawDamagePanel(snapshot);
    this.drawWeaponPanel(snapshot, targetTrack);
    ctx.textAlign = 'right'; ctx.fillStyle = dim;
    ctx.fillText(`SCORE ${String(snapshot.score).padStart(6, '0')}  KILLS ${snapshot.kills}`, w - 28, h - 20);
    const missileWarning = snapshot.rwr.some((contact) => contact.threat === 'MISSILE');
    if (snapshot.afterburnerThermalLimited && Math.floor(snapshot.elapsed * 4) % 2 === 0) {
      ctx.fillStyle = snapshot.afterburnerOverride ? '#ff4f4f' : '#ffbf62'; ctx.font = 'bold 16px ui-monospace, monospace'; ctx.textAlign = 'center';
      ctx.fillText(snapshot.afterburnerOverride ? 'AB THERMAL OVERRIDE // ENGINE DAMAGE AT 100%' : 'AB OVERHEAT // AUTO MIL · COOL TO ZERO', w * .5, h * .2);
    }
    if (missileWarning && Math.floor(snapshot.elapsed * 5) % 2 === 0) {
      const beamCue = snapshot.entities.some((entity) => entity.active && entity.kind === 'missile' && entity.team === 2 && entity.notched);
      ctx.fillStyle = '#ff4f4f'; ctx.font = 'bold 18px ui-monospace, monospace'; ctx.textAlign = 'center';
      ctx.fillText(beamCue ? '3/9 BEAM // HOLD CROSSING · G CHAFF' : 'MISSILE // 3/9 BEAM · F FLARE · G CHAFF', w * 0.5, h * 0.27);
    }
    else if (snapshot.aeroState === 'SPIN') this.drawSpinRecovery(snapshot);
    else if (snapshot.warning === 'STALL') this.drawStallRecovery(snapshot);
    else if (snapshot.warning) {
      ctx.fillStyle = '#ff4f4f'; ctx.font = `bold ${snapshot.warning === 'PULL UP' ? 24 : 18}px ui-monospace, monospace`; ctx.textAlign = 'center';
      ctx.fillText(snapshot.warning, w * .5, h * .29);
      if (snapshot.warning === 'PULL UP') ctx.fillText('TERRAIN', w * .5, h * .29 + 27);
    } else if (snapshot.flightState === 'UNCONTROLLED') { ctx.fillStyle = '#ff4f4f'; ctx.font = 'bold 18px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillText('CONTROL LOST // BRACE FOR IMPACT', w * 0.5, h * 0.24); }
    else if (snapshot.flightState === 'DAMAGED') { ctx.fillStyle = '#ffbf62'; ctx.font = 'bold 15px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillText('AIRFRAME DAMAGE // CHECK CONTROL', w * 0.5, h * 0.24); }
    if (snapshot.explosion > 0) {
      const pulse = clamp(snapshot.explosion / 2.4, 0, 1);
      ctx.fillStyle = `rgba(255,69,32,${.13 + pulse * .25})`; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ff4f4f'; ctx.font = 'bold 28px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillText('IMPACT // AIRFRAME LOST', w * .5, h * .34);
    }
    if (snapshot.impactSeverity > 0 && snapshot.flightState !== 'CRASHED') {
      const hit = clamp(snapshot.impactSeverity, 0, 1);
      const pulse = .55 + Math.sin(snapshot.elapsed * 52) * .16;
      const vignette = ctx.createRadialGradient(w * .5, h * .48, Math.min(w, h) * .18, w * .5, h * .48, Math.max(w, h) * .7);
      vignette.addColorStop(0, 'rgba(255,210,125,0)'); vignette.addColorStop(1, `rgba(255,28,24,${hit * .48 * pulse})`);
      ctx.fillStyle = vignette; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = `rgba(255,92,54,${.45 + hit * .45})`; ctx.lineWidth = 2;
      for (let index = 0; index < 7; index += 1) {
        const angle = index * 2.41 + snapshot.elapsed * .08; const radius = Math.min(w, h) * (.08 + index * .025);
        ctx.beginPath(); ctx.moveTo(w * .5 + Math.cos(angle) * radius * .35, h * .5 + Math.sin(angle) * radius * .2); ctx.lineTo(w * .5 + Math.cos(angle) * radius, h * .5 + Math.sin(angle) * radius); ctx.stroke();
      }
      ctx.fillStyle = '#ff4f4f'; ctx.font = 'bold 24px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillText('MISSILE IMPACT // CHECK DAMAGE', w * .5, h * .32);
    }
    ctx.restore();
  }

  private drawTrackCues(snapshot: SimulationSnapshot) {
    const { ctx } = this;
    ctx.save(); ctx.font = '8px ui-monospace, monospace'; ctx.textAlign = 'center';
    for (const track of snapshot.tracks) {
      const point = this.project(track.position, snapshot);
      if (!point.visible || point.x < 16 || point.x > this.width - 16 || point.y < 45 || point.y > this.height - 45) continue;
      const designated = track.entityId === snapshot.targetId;
      const twsIndex = snapshot.twsTargetIds.indexOf(track.entityId);
      const twsMaintained = twsIndex >= 0;
      const hidden = this.terrainOccludes(track.position, point, snapshot.player.position) || track.state === 'COAST';
      ctx.strokeStyle = designated ? '#ffbf62' : hidden ? 'rgba(125,255,184,.38)' : twsMaintained ? '#9dffd0' : '#7dffb8'; ctx.fillStyle = ctx.strokeStyle; ctx.setLineDash(hidden ? [3, 3] : []);
      const size = designated ? 24 : twsMaintained ? 17 : 13; ctx.strokeRect(point.x - size / 2, point.y - size / 2, size, size);
      if (twsMaintained && !designated) ctx.strokeRect(point.x - size / 2 - 3, point.y - size / 2 - 3, size + 6, size + 6);
      ctx.setLineDash([]);
      if (!designated) ctx.fillText(twsMaintained ? `TWS${twsIndex + 1}` : `T${track.id}`, point.x, point.y - size / 2 - 7);
    }
    ctx.restore();
  }

  private drawLockFrame(x: number, y: number, size: number) {
    const { ctx } = this; const half = size / 2; const corner = Math.max(6, size * .25);
    ctx.beginPath();
    ctx.moveTo(x - half, y - half + corner); ctx.lineTo(x - half, y - half); ctx.lineTo(x - half + corner, y - half);
    ctx.moveTo(x + half - corner, y - half); ctx.lineTo(x + half, y - half); ctx.lineTo(x + half, y - half + corner);
    ctx.moveTo(x + half, y + half - corner); ctx.lineTo(x + half, y + half); ctx.lineTo(x + half - corner, y + half);
    ctx.moveTo(x - half + corner, y + half); ctx.lineTo(x - half, y + half); ctx.lineTo(x - half, y + half - corner); ctx.stroke();
  }

  private drawGunFunnel(snapshot: SimulationSnapshot) {
    const { ctx, width: w, height: h } = this; const cx = w * .5; const top = h * .395; const bottom = h * .68;
    const halfWidth = (t: number) => 13 + Math.pow(1 - t, 1.08) * 59;
    ctx.save(); ctx.strokeStyle = 'rgba(125,255,184,.76)'; ctx.fillStyle = 'rgba(125,255,184,.78)'; ctx.lineWidth = 1.15; ctx.font = '8px ui-monospace, monospace'; ctx.textAlign = 'center';
    // EEGS Level II: the upper mouth is the close 600 ft reference and the
    // narrow lower end is the long 3000 ft reference for a 35 ft wingspan.
    for (const side of [-1, 1]) {
      ctx.beginPath();
      for (let index = 0; index <= 18; index += 1) {
        const t = index / 18; const x = cx + side * halfWidth(t); const y = top + (bottom - top) * t;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    for (const rangeHundreds of [6, 12, 18, 24, 30]) {
      const t = (rangeHundreds - 6) / 24; const y = top + (bottom - top) * t; const width = halfWidth(t);
      ctx.beginPath(); ctx.moveTo(cx - width - 5, y); ctx.lineTo(cx - width + 5, y); ctx.moveTo(cx + width - 5, y); ctx.lineTo(cx + width + 5, y); ctx.stroke();
      ctx.fillText(String(rangeHundreds), cx + width + 13, y);
    }
    const boreY = top - 29;
    ctx.beginPath(); ctx.moveTo(cx - 11, boreY); ctx.lineTo(cx - 3, boreY); ctx.moveTo(cx + 3, boreY); ctx.lineTo(cx + 11, boreY); ctx.moveTo(cx, boreY - 7); ctx.lineTo(cx, boreY + 7); ctx.stroke();
    ctx.setLineDash([2, 5]);
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + side * 8, top + 14); ctx.quadraticCurveTo(cx + side * 22, h * .55, cx + side * 29, bottom + 18); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffd34f'; ctx.font = 'bold 9px ui-monospace, monospace';
    ctx.fillText(`EEGS L2  WS35  GUN ${snapshot.ammo.GUN}`, cx, bottom + 32); ctx.restore();
  }

  private drawSpinRecovery(snapshot: SimulationSnapshot) {
    const { ctx, width: w, height: h } = this;
    const direction = snapshot.spinDirection > 0 ? 'LEFT' : 'RIGHT';
    const rudder = snapshot.spinDirection > 0 ? 'Q' : 'E';
    ctx.save(); ctx.textAlign = 'center'; ctx.fillStyle = '#ff4f4f'; ctx.strokeStyle = '#ff4f4f';
    ctx.font = 'bold 22px ui-monospace, monospace'; ctx.fillText(`SPIN ${direction}`, w * .5, h * .25);
    ctx.font = 'bold 11px ui-monospace, monospace'; ctx.fillText(`W NOSE DOWN · ${rudder} OPPOSITE RUDDER · THR BELOW 55%`, w * .5, h * .25 + 25);
    const barW = 210; const x = w * .5 - barW * .5; const y = h * .25 + 39;
    ctx.strokeRect(x, y, barW, 7); ctx.fillRect(x, y, barW * snapshot.recoveryProgress, 7);
    ctx.font = '8px ui-monospace, monospace'; ctx.fillText(`RECOVERY ${Math.round(snapshot.recoveryProgress * 100)}% // COMPLETE ONLY AFTER ROTATION, AOA AND AIRSPEED RECOVER`, w * .5, y + 18); ctx.restore();
  }

  private drawStallRecovery(snapshot: SimulationSnapshot) {
    const { ctx, width: w, height: h } = this; const severity = clamp(snapshot.stallSeverity, 0, 1);
    ctx.save(); ctx.textAlign = 'center'; ctx.fillStyle = severity > .62 ? '#ff4f4f' : '#ffbf62'; ctx.strokeStyle = ctx.fillStyle;
    const early = snapshot.aeroState === 'NORMAL';
    ctx.font = 'bold 20px ui-monospace, monospace'; ctx.fillText(`${early ? 'STALL WARNING' : 'STALL'} // AOA ${snapshot.player.aoa.toFixed(1)}°`, w * .5, h * .25);
    ctx.font = 'bold 11px ui-monospace, monospace'; ctx.fillText('W UNLOAD / NOSE DOWN · LEVEL WINGS · MIL THR', w * .5, h * .25 + 24);
    const barW = 210; const x = w * .5 - barW * .5; const y = h * .25 + 37;
    ctx.strokeRect(x, y, barW, 7); ctx.fillRect(x, y, barW * snapshot.recoveryProgress, 7);
    const densityRatio = clamp(Math.exp(-Math.max(0, snapshot.player.position.y) / 8500), .18, 1);
    const cas = snapshot.player.speed * Math.sqrt(densityRatio) * 1.944;
    ctx.font = '8px ui-monospace, monospace'; ctx.fillText(`RECOVERY ${Math.round(snapshot.recoveryProgress * 100)}% // CAS ${Math.round(cas)}KT · AOA ${Math.abs(snapshot.player.aoa).toFixed(1)}°`, w * .5, y + 18); ctx.restore();
  }

  private drawGunSolution(snapshot: SimulationSnapshot, target: Track, range: number) {
    const { ctx, width: w, height: h } = this;
    const r = { x: target.position.x - snapshot.player.position.x, y: target.position.y - snapshot.player.position.y, z: target.position.z - snapshot.player.position.z };
    const v = { x: target.velocity.x - snapshot.player.velocity.x, y: target.velocity.y - snapshot.player.velocity.y, z: target.velocity.z - snapshot.player.velocity.z };
    const muzzle = 980;
    const a = v.x * v.x + v.y * v.y + v.z * v.z - muzzle * muzzle;
    const b = 2 * (r.x * v.x + r.y * v.y + r.z * v.z);
    const c = r.x * r.x + r.y * r.y + r.z * r.z;
    const disc = Math.max(0, b * b - 4 * a * c);
    const roots = Math.abs(a) < .001 ? [-c / Math.max(.001, b)] : [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)];
    const time = clamp(roots.filter((value) => value > 0).sort((x, y) => x - y)[0] ?? range / muzzle, .08, 6.8);
    const aim = {
      x: target.position.x + target.velocity.x * time,
      y: target.position.y + target.velocity.y * time + .5 * 9.81 * time * time,
      z: target.position.z + target.velocity.z * time,
    };
    const pipper = this.project(aim, snapshot);
    if (!pipper.visible) return;
    const radius = clamp(20 + target.uncertainty * .035, 21, 34);
    const rangeFeet = range * 3.281;
    const rangeFraction = clamp((rangeFeet - 600) / 2400, 0, 1);
    const closure = -(r.x * v.x + r.y * v.y + r.z * v.z) / Math.max(1, range) * 1.944;
    const focal = h / (2 * Math.tan(40 * Math.PI / 180));
    const wingspan = clamp(10.7 / Math.max(80, range) * focal, 4, 34);
    ctx.save(); ctx.strokeStyle = '#ffd34f'; ctx.fillStyle = '#ffd34f'; ctx.lineWidth = 1.4; ctx.font = 'bold 9px ui-monospace, monospace'; ctx.textAlign = 'center';
    ctx.beginPath(); ctx.arc(pipper.x, pipper.y, radius, 0, Math.PI * 2); ctx.stroke();
    for (let tick = 0; tick < 4; tick += 1) { const angle = tick * Math.PI / 2; ctx.beginPath(); ctx.moveTo(pipper.x + Math.cos(angle) * (radius - 4), pipper.y + Math.sin(angle) * (radius - 4)); ctx.lineTo(pipper.x + Math.cos(angle) * (radius + 5), pipper.y + Math.sin(angle) * (radius + 5)); ctx.stroke(); }
    const caretAngle = -Math.PI / 2 + rangeFraction * Math.PI * 2;
    const caretX = pipper.x + Math.cos(caretAngle) * (radius + 8); const caretY = pipper.y + Math.sin(caretAngle) * (radius + 8);
    ctx.beginPath(); ctx.moveTo(caretX, caretY); ctx.lineTo(caretX - Math.cos(caretAngle - .55) * 7, caretY - Math.sin(caretAngle - .55) * 7); ctx.lineTo(caretX - Math.cos(caretAngle + .55) * 7, caretY - Math.sin(caretAngle + .55) * 7); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.arc(pipper.x, pipper.y, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.globalAlpha = .5; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(w * .5, h * .49); ctx.lineTo(pipper.x, pipper.y); ctx.stroke(); ctx.restore();
    ctx.beginPath(); ctx.moveTo(pipper.x - wingspan * .5 - 5, pipper.y); ctx.lineTo(pipper.x - wingspan * .5, pipper.y); ctx.moveTo(pipper.x + wingspan * .5, pipper.y); ctx.lineTo(pipper.x + wingspan * .5 + 5, pipper.y); ctx.stroke();
    for (const side of [-1, 1]) for (let mark = 0; mark < 3; mark += 1) { const y = pipper.y + radius + 8 + mark * 5; ctx.fillRect(pipper.x + side * (6 + mark * 2), y, 5, 1); }
    const boreX = w * .5; const boreY = h * .49;
    ctx.fillText(`EEGS L5  TOF ${time.toFixed(1)}  RNG ${Math.round(rangeFeet)}FT  C${closure >= 0 ? '+' : ''}${Math.round(closure)}`, pipper.x, pipper.y + radius + 29);
    const validShot = rangeFeet >= 600 && rangeFeet <= 3900 && target.quality > .3 && Math.hypot(pipper.x - boreX, pipper.y - boreY) < radius * .72;
    if (validShot) { ctx.font = 'bold 13px ui-monospace, monospace'; ctx.fillText('GUN SHOOT', boreX, h * .365); }
    ctx.restore();
  }

  private drawDamagePanel(snapshot: SimulationSnapshot) {
    const { ctx, width: w, height: h } = this; const x = w < 980 ? 18 : 214; const y = h - 154; const panelW = 178; const panelH = 106; const cx = x + panelW * .5;
    const effectiveAirframe = Math.max(snapshot.damage.airframe, 1 - snapshot.player.health / 100, snapshot.flightState === 'UNCONTROLLED' || snapshot.flightState === 'CRASHED' ? 1 : 0);
    const color = (damage: number) => damage >= .72 ? '#ff3434' : damage > .28 ? '#ffbf62' : 'rgba(125,255,184,.72)';
    const readout = (label: string, damage: number) => damage >= .82 ? `${label} DEST` : `${label} ${Math.round((1 - damage) * 100)}`;
    const zone = (points: [number, number][], damage: number) => {
      ctx.beginPath(); ctx.moveTo(x + points[0][0], y + points[0][1]); for (let i = 1; i < points.length; i += 1) ctx.lineTo(x + points[i][0], y + points[i][1]); ctx.closePath();
      ctx.fillStyle = color(damage); ctx.globalAlpha = damage >= .82 ? .78 : .24 + damage * .42; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = color(damage); ctx.lineWidth = damage >= .82 ? 2 : 1; ctx.stroke(); ctx.lineWidth = 1;
    };
    ctx.save(); ctx.fillStyle = 'rgba(1,12,8,.84)'; ctx.fillRect(x, y, panelW, panelH); ctx.strokeStyle = 'rgba(125,255,184,.28)'; ctx.strokeRect(x, y, panelW, panelH);
    ctx.font = 'bold 8px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = color(effectiveAirframe); ctx.fillText(readout('AIRFRAME', effectiveAirframe), cx, y + 10);
    zone([[82,20],[96,20],[101,71],[89,86],[77,71]], effectiveAirframe);
    zone([[77,38],[28,61],[75,62]], snapshot.damage.leftWing);
    zone([[101,38],[150,61],[103,62]], snapshot.damage.rightWing);
    zone([[78,67],[57,82],[82,79]], snapshot.damage.tail);
    zone([[100,67],[121,82],[96,79]], snapshot.damage.tail);
    ctx.fillStyle = color(snapshot.damage.engine); ctx.beginPath(); ctx.arc(cx, y + 70, 7, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = color(snapshot.damage.engine); ctx.stroke();
    ctx.fillStyle = color(snapshot.damage.radar); ctx.beginPath(); ctx.arc(cx, y + 23, 4, 0, Math.PI * 2); ctx.fill();
    if (snapshot.damage.controls >= .72) { ctx.fillStyle = '#ff3434'; ctx.globalAlpha = .72; ctx.fillRect(cx - 6, y + 44, 12, 18); ctx.globalAlpha = 1; }
    ctx.font = '7px ui-monospace, monospace'; ctx.fillStyle = color(snapshot.damage.leftWing); ctx.fillText(readout('LW', snapshot.damage.leftWing), x + 28, y + 74);
    ctx.fillStyle = color(snapshot.damage.rightWing); ctx.fillText(readout('RW', snapshot.damage.rightWing), x + 150, y + 74);
    ctx.fillStyle = color(snapshot.damage.engine); ctx.fillText(readout('ENG', snapshot.damage.engine), cx, y + 96);
    ctx.textAlign = 'left'; ctx.fillStyle = color(snapshot.damage.controls); ctx.fillText(readout('FCS', snapshot.damage.controls), x + 7, y + 96);
    ctx.textAlign = 'right'; ctx.fillStyle = color(snapshot.damage.radar); ctx.fillText(readout('FCR', snapshot.damage.radar), x + panelW - 7, y + 96);
    ctx.textAlign = 'center'; ctx.fillStyle = snapshot.flightState === 'UNCONTROLLED' ? '#ff4f4f' : 'rgba(125,255,184,.52)'; ctx.fillText(`${snapshot.flightState} · CLR ${Math.max(0, Math.round(snapshot.clearance))}M`, cx, y + panelH - 3); ctx.restore();
  }

  private drawHeadingTape(snapshot: SimulationSnapshot) {
    const { ctx, width: w } = this;
    const heading = (((snapshot.player.heading * 180 / Math.PI) % 360) + 360) % 360;
    const centerX = w * .5; const y = 57; const half = Math.min(220, w * .22);
    ctx.save(); ctx.strokeStyle = 'rgba(125,255,184,.58)'; ctx.fillStyle = '#7dffb8'; ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'center';
    ctx.beginPath(); ctx.moveTo(centerX - half, y); ctx.lineTo(centerX + half, y); ctx.stroke();
    for (let offset = -30; offset <= 30; offset += 5) {
      const bearing = (Math.round(heading / 5) * 5 + offset + 360) % 360;
      const x = centerX + (bearing - heading - (bearing - heading > 180 ? 360 : bearing - heading < -180 ? -360 : 0)) * (half / 30);
      const major = bearing % 10 === 0; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + (major ? 9 : 5)); ctx.stroke();
      if (major) ctx.fillText(bearing % 90 === 0 ? ['N', 'E', 'S', 'W'][Math.round(bearing / 90) % 4] : String(Math.round(bearing / 10)).padStart(2, '0'), x, y - 9);
    }
    ctx.fillStyle = 'rgba(1,12,8,.88)'; ctx.fillRect(centerX - 23, y + 7, 46, 19); ctx.strokeStyle = '#7dffb8'; ctx.strokeRect(centerX - 23, y + 7, 46, 19); ctx.fillStyle = '#7dffb8'; ctx.fillText(String(Math.round(heading)).padStart(3, '0'), centerX, y + 17);
    ctx.restore();
  }

  private drawFlightTape(x: number, centerY: number, value: number, step: number, label: string, unit: string, side: 'left' | 'right') {
    const { ctx } = this;
    const direction = side === 'left' ? 1 : -1; const railX = x + direction * 54;
    ctx.save(); ctx.strokeStyle = 'rgba(125,255,184,.55)'; ctx.fillStyle = 'rgba(125,255,184,.72)'; ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = side;
    ctx.fillText(`${label} ${unit}`, x, centerY - 120); ctx.beginPath(); ctx.moveTo(railX, centerY - 102); ctx.lineTo(railX, centerY + 102); ctx.stroke();
    const base = Math.floor(value / step) * step;
    for (let tick = -5; tick <= 5; tick += 1) {
      const tickValue = base + tick * step; const y = centerY - ((tickValue - value) / step) * 20;
      if (y < centerY - 105 || y > centerY + 105) continue;
      ctx.beginPath(); ctx.moveTo(railX, y); ctx.lineTo(railX - direction * (tick % 2 === 0 ? 10 : 6), y); ctx.stroke();
      ctx.fillText(String(Math.max(0, tickValue)), railX - direction * 14, y);
    }
    ctx.fillStyle = 'rgba(1,12,8,.94)'; const boxX = side === 'left' ? x - 3 : x - 72; ctx.fillRect(boxX, centerY - 12, 75, 24); ctx.strokeStyle = '#7dffb8'; ctx.strokeRect(boxX, centerY - 12, 75, 24); ctx.fillStyle = '#7dffb8'; ctx.font = 'bold 13px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillText(String(Math.round(value)), boxX + 37.5, centerY);
    ctx.restore();
  }

  private drawWeaponPanel(snapshot: SimulationSnapshot, target: Track | undefined) {
    const { ctx, width: w, height: h } = this;
    const weapons: WeaponId[] = ['GUN', 'ST-1', 'ST-1X', 'ST-1AX'];
    const panelW = Math.min(460, w * .48); const x = (w - panelW) * .5; const y = h - 112; const itemW = panelW / 4;
    const range = target ? Math.hypot(target.position.x - snapshot.player.position.x, target.position.y - snapshot.player.position.y, target.position.z - snapshot.player.position.z) : null;
    const status = this.weaponStatus(snapshot.selectedWeapon, snapshot, target, range);
    const supportedMissile = [...snapshot.entities].reverse().find((entity) => entity.kind === 'missile' && entity.team === 1 && entity.weapon === snapshot.selectedWeapon);
    ctx.save(); ctx.fillStyle = 'rgba(1,12,8,.8)'; ctx.fillRect(x, y, panelW, 54); ctx.strokeStyle = 'rgba(125,255,184,.32)'; ctx.strokeRect(x, y, panelW, 54);
    weapons.forEach((weapon, index) => {
      const active = weapon === snapshot.selectedWeapon; const ix = x + itemW * index;
      ctx.fillStyle = active ? 'rgba(125,255,184,.12)' : 'transparent'; if (active) ctx.fillRect(ix, y, itemW, 34);
      ctx.strokeStyle = active ? '#7dffb8' : 'rgba(125,255,184,.2)'; ctx.strokeRect(ix, y, itemW, 34);
      ctx.fillStyle = active ? '#7dffb8' : 'rgba(125,255,184,.52)'; ctx.font = `${active ? 'bold ' : ''}9px ui-monospace, monospace`; ctx.textAlign = 'center';
      ctx.fillText(`${index + 1} ${weapon}`, ix + itemW / 2, y + 12); ctx.fillText(`${snapshot.ammo[weapon]} ${weapon === 'GUN' ? 'LMB' : 'SPACE'}`, ix + itemW / 2, y + 25);
    });
    ctx.fillStyle = status.ready ? '#ffbf62' : 'rgba(255,191,98,.68)'; ctx.font = 'bold 9px ui-monospace, monospace'; ctx.fillText(`${status.label}${range !== null ? ` · ${(range / 1000).toFixed(1)} KM` : ''}${supportedMissile?.guidancePhase ? ` · MSL ${supportedMissile.guidancePhase}` : ''}`, w / 2, y + 45);
    ctx.restore();
  }

  private weaponStatus(weapon: WeaponId, snapshot: SimulationSnapshot, target: Track | undefined, range: number | null) {
    if (snapshot.ammo[weapon] <= 0) return { label: 'EMPTY', ready: false };
    if (weapon === 'GUN') return { label: 'GUN HOT // LMB FIRES', ready: true };
    if (!target || range === null) return { label: 'NO TARGET // RMB OR T TO LOCK', ready: false };
    if (range < 650) return { label: 'MIN RANGE', ready: false };
    if (weapon === 'ST-1') {
      const ready = range <= 12_000 && snapshot.irSeekerQuality >= .16 && snapshot.irSeekerStatus === 'TRACK';
      return { label: ready ? `IR SHOOT · Q${Math.round(snapshot.irSeekerQuality * 100)}` : `IR ${snapshot.irSeekerStatus} · Q${Math.round(snapshot.irSeekerQuality * 100)}`, ready };
    }
    if (weapon === 'ST-1X') return { label: range <= 28_000 && target.quality >= .58 && snapshot.radarMode === 'STT' ? 'SARH SHOOT' : 'STT LOCK REQUIRED', ready: range <= 28_000 && target.quality >= .58 && snapshot.radarMode === 'STT' };
    return { label: range <= 42_000 && target.quality >= .35 ? 'ARH SHOOT' : 'TWS TRACK BUILDING', ready: range <= 42_000 && target.quality >= .35 };
  }

  private drawRadar(snapshot: SimulationSnapshot) {
    const { ctx, width: w, height: h } = this;
    const panelSize = Math.min(270, w * .27, h * .36);
    const x = w - panelSize - 24; const y = h - panelSize - 52;
    const left = x + 18; const right = x + panelSize - 18; const top = y + 34; const bottom = y + panelSize - 22;
    const plotW = right - left; const plotH = bottom - top; const centerX = (left + right) * .5;
    ctx.save(); ctx.strokeStyle = 'rgba(125,255,184,.55)'; ctx.fillStyle = 'rgba(1,12,8,.88)'; ctx.fillRect(x, y, panelSize, panelSize); ctx.strokeRect(x, y, panelSize, panelSize);
    const radarRange = 60_000;
    const lockedTrack = snapshot.tracks.find((track) => track.entityId === snapshot.targetId && track.state !== 'LOST');
    const scanLabel = snapshot.radarMode === 'STT' ? '1B · ±3° TRACK' : snapshot.radarMode === 'HMD' ? 'HMD LOS · ±6°' : snapshot.radarMode === 'ACM' ? '1B · ACM' : snapshot.radarMode === 'TWS' && lockedTrack ? '4B · ±20° L&S' : snapshot.radarMode === 'TWS' ? '4B · ±40°' : '4B · ±60°';
    ctx.fillStyle = '#7dffb8'; ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'left';
    ctx.fillText(`FCR ${snapshot.radarMode} · ${snapshot.radarDisplay}${snapshot.radarMode === 'TWS' ? ` · ${snapshot.twsTargetIds.length}/4` : ''}`, x + 9, y + 13);
    ctx.textAlign = 'right'; ctx.fillText(`${scanLabel} · 60 KM`, x + panelSize - 9, y + 13);
    ctx.strokeStyle = 'rgba(125,255,184,.18)';
    for (const fraction of [0.25, 0.5, 0.75, 1]) {
      const ry = bottom - plotH * fraction;
      if (snapshot.radarDisplay === 'B-SCOPE') { ctx.beginPath(); ctx.moveTo(left, ry); ctx.lineTo(right, ry); ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(centerX, bottom, plotH * fraction, Math.PI * 1.18, Math.PI * 1.82); ctx.stroke(); }
      ctx.fillStyle = 'rgba(125,255,184,.34)'; ctx.textAlign = 'left'; ctx.fillText(String(Math.round(60 * fraction)), left - 14, ry - 2);
    }
    for (const bearing of [-40, -20, 0, 20, 40]) {
      const bx = centerX + (bearing / 40) * plotW * .5;
      ctx.beginPath();
      if (snapshot.radarDisplay === 'B-SCOPE') { ctx.moveTo(bx, top); ctx.lineTo(bx, bottom); }
      else { ctx.moveTo(centerX, bottom); ctx.lineTo(bx, top); }
      ctx.stroke(); ctx.fillStyle = 'rgba(125,255,184,.38)'; ctx.textAlign = 'center'; ctx.fillText(String(bearing), bx, top - 7);
    }
    ctx.strokeStyle = 'rgba(125,255,184,.62)';
    const sweepX = centerX + snapshot.radarSweep * plotW * .5;
    if (snapshot.radarMode === 'STT') {
      ctx.setLineDash([3, 3]); ctx.strokeRect(sweepX - 8, top, 16, plotH); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(sweepX - 13, (top + bottom) * .5); ctx.lineTo(sweepX + 13, (top + bottom) * .5); ctx.stroke();
    } else {
      if (snapshot.radarMode === 'TWS' && lockedTrack) {
        const dx = lockedTrack.position.x - snapshot.player.position.x; const dz = lockedTrack.position.z - snapshot.player.position.z;
        const bearing = wrapAngle(Math.atan2(dx, dz) - snapshot.player.heading); const lockX = centerX + clamp(bearing / .7, -1, 1) * plotW * .5; const sector = plotW * .25;
        ctx.save(); ctx.strokeStyle = 'rgba(255,191,98,.42)'; ctx.setLineDash([4, 4]); ctx.strokeRect(lockX - sector, top, sector * 2, plotH); ctx.restore();
      } else if (snapshot.radarMode === 'HMD') {
        const cueX = centerX + clamp(snapshot.commandX * .76 / .7, -1, 1) * plotW * .5;
        ctx.save(); ctx.strokeStyle = 'rgba(255,191,98,.68)'; ctx.setLineDash([3, 3]); ctx.strokeRect(cueX - plotW * .07, top, plotW * .14, plotH); ctx.restore();
      } else if (snapshot.radarMode === 'ACM') {
        ctx.save(); ctx.strokeStyle = 'rgba(255,191,98,.42)'; ctx.setLineDash([4, 4]); ctx.strokeRect(centerX - plotW * .095, top, plotW * .19, plotH); ctx.restore();
      }
      ctx.beginPath();
      if (snapshot.radarDisplay === 'B-SCOPE') { ctx.moveTo(sweepX, top); ctx.lineTo(sweepX, bottom); }
      else { ctx.moveTo(centerX, bottom); ctx.lineTo(sweepX, top); }
      ctx.stroke();
    }
    if (snapshot.radarClutter > .06) {
      ctx.save(); ctx.fillStyle = `rgba(125,255,184,${.08 + snapshot.radarClutter * .2})`; ctx.font = '7px ui-monospace, monospace'; ctx.textAlign = 'center';
      const returns = Math.round(8 + snapshot.radarClutter * 32);
      for (let index = 0; index < returns; index += 1) {
        const phase = index * 19.73 + Math.floor(snapshot.elapsed * 7) * .37;
        const px = left + (Math.sin(phase) * .5 + .5) * plotW;
        const py = bottom - (Math.cos(phase * 1.71) * .5 + .5) * plotH * snapshot.radarClutter;
        ctx.fillText(index % 3 ? '.' : ':', px, py);
      }
      ctx.fillStyle = '#ffbf62'; ctx.textAlign = 'left'; ctx.fillText(`CLUTTER ${Math.round(snapshot.radarClutter * 100)}`, x + 9, y + 26); ctx.restore();
    }
    for (const track of snapshot.tracks) {
      const dx = track.position.x - snapshot.player.position.x; const dz = track.position.z - snapshot.player.position.z;
      const range = Math.hypot(dx, dz); const bearing = wrapAngle(Math.atan2(dx, dz) - snapshot.player.heading);
      if (range > radarRange || Math.abs(bearing) > 0.82) continue;
      const rangeFraction = range / radarRange;
      const tx = snapshot.radarDisplay === 'B-SCOPE'
        ? centerX + (bearing / .7) * plotW * .5
        : centerX + Math.sin(bearing) / Math.sin(.7) * plotW * .5 * rangeFraction;
      const ty = snapshot.radarDisplay === 'B-SCOPE'
        ? bottom - rangeFraction * plotH
        : bottom - Math.cos(bearing) * rangeFraction * plotH;
      const twsIndex = snapshot.twsTargetIds.indexOf(track.entityId);
      ctx.strokeStyle = track.designated ? '#ffbf62' : track.state === 'COAST' ? 'rgba(125,255,184,.4)' : twsIndex >= 0 ? '#a5ffd4' : '#7dffb8';
      ctx.setLineDash(track.state === 'COAST' ? [3, 2] : []);
      const size = track.designated ? 11 : twsIndex >= 0 ? 9 : 7; ctx.strokeRect(tx - size / 2, ty - size / 2, size, size); if (twsIndex >= 0 && !track.designated) ctx.fillRect(tx - 1, ty - 1, 2, 2); ctx.setLineDash([]);
      const speedVector = clamp(Math.hypot(track.velocity.x, track.velocity.z) / 50, 3, 9); ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx, ty - speedVector); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle; ctx.textAlign = 'center'; ctx.font = '8px ui-monospace, monospace'; ctx.fillText(twsIndex >= 0 ? `${twsIndex + 1}${track.designated ? 'L' : 'T'}` : `${String(track.id)}${track.source === 'FUSED' ? 'F' : ''}`, tx, ty - 11);
    }
    ctx.fillStyle = 'rgba(125,255,184,.5)'; ctx.textAlign = 'left'; ctx.fillText('R: MODE · X: BREAK', x + 9, y + panelSize - 8); ctx.textAlign = 'right'; ctx.fillText('T/RMB: L&S / STT', x + panelSize - 9, y + panelSize - 8); ctx.restore();
  }

  private drawThrottleGauge(snapshot: SimulationSnapshot) {
    const { ctx, height: h } = this; const x = 26; const y = h * .35; const gaugeH = 178; const gaugeW = 78;
    const percent = snapshot.player.throttle * 100; const fillH = gaugeH * clamp(percent / 110, 0, 1);
    const color = snapshot.afterburnerOverride ? '#ff4f4f' : snapshot.afterburnerActive ? '#ffbf62' : '#7dffb8';
    const showHeat = snapshot.afterburnerThermalLimited || snapshot.afterburnerHeat >= .7;
    ctx.save(); ctx.fillStyle = 'rgba(1,12,8,.84)'; ctx.fillRect(x, y, gaugeW, gaugeH + 52); ctx.strokeStyle = 'rgba(125,255,184,.34)'; ctx.strokeRect(x, y, gaugeW, gaugeH + 52);
    ctx.font = 'bold 9px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.fillText(snapshot.afterburnerOverride ? 'AB OVRD' : snapshot.afterburnerActive ? 'AB THR' : 'MIL THR', x + gaugeW / 2, y + 12);
    const railX = x + 12; const railY = y + 24; ctx.strokeStyle = 'rgba(125,255,184,.45)'; ctx.strokeRect(railX, railY, 10, gaugeH);
    ctx.fillStyle = color; ctx.fillRect(railX + 2, railY + gaugeH - fillH, 6, fillH);
    for (const tick of [0, 50, 100, 110]) { const ty = railY + gaugeH - gaugeH * tick / 110; ctx.strokeStyle = tick > 100 ? '#ffbf62' : 'rgba(125,255,184,.55)'; ctx.beginPath(); ctx.moveTo(railX + 10, ty); ctx.lineTo(railX + 17, ty); ctx.stroke(); ctx.fillStyle = ctx.strokeStyle; ctx.textAlign = 'left'; ctx.fillText(String(tick), railX + 20, ty); }
    if (showHeat) {
      const heatX = x + 57; const heatH = gaugeH * snapshot.afterburnerHeat;
      ctx.strokeStyle = '#ff4f4f'; ctx.strokeRect(heatX, railY, 8, gaugeH); ctx.fillStyle = snapshot.afterburnerHeat >= .92 ? '#ff3030' : '#ff8b54'; ctx.fillRect(heatX + 2, railY + gaugeH - heatH, 4, heatH);
      const warnY = railY + gaugeH * .3; ctx.strokeStyle = '#ffbf62'; ctx.beginPath(); ctx.moveTo(heatX - 3, warnY); ctx.lineTo(heatX + 11, warnY); ctx.stroke();
      ctx.save(); ctx.translate(heatX + 13, railY + gaugeH * .5); ctx.rotate(-Math.PI / 2); ctx.fillStyle = '#ff625f'; ctx.font = 'bold 7px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillText(`HEAT ${Math.round(snapshot.afterburnerHeat * 100)}%`, 0, 0); ctx.restore();
    }
    ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.font = 'bold 15px ui-monospace, monospace'; ctx.fillText(`${Math.round(percent)}%`, x + gaugeW / 2, y + gaugeH + 34);
    ctx.font = '8px ui-monospace, monospace'; ctx.fillStyle = showHeat ? '#ff625f' : '#ffbf62'; ctx.fillText(showHeat ? `COOL ${Math.round(snapshot.afterburnerHeat * 100)}%` : 'AB READY', x + gaugeW / 2, y + gaugeH + 47); ctx.restore();
  }

  private drawRwr(snapshot: SimulationSnapshot) {
    const { ctx, height: h } = this;
    const cx = 112; const cy = h - 181; const radius = 74;
    ctx.save(); ctx.fillStyle = 'rgba(1,12,8,.82)'; ctx.beginPath(); ctx.arc(cx, cy, radius + 13, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(125,255,184,.48)';
    for (const ring of [radius * .36, radius * .68, radius]) { ctx.beginPath(); ctx.arc(cx, cy, ring, 0, Math.PI * 2); ctx.stroke(); }
    for (let degree = 0; degree < 360; degree += 30) {
      const angle = degree * Math.PI / 180 - Math.PI / 2; const inner = degree % 90 === 0 ? radius - 9 : radius - 5;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner); ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(cx, cy - 10); ctx.lineTo(cx - 7, cy + 8); ctx.lineTo(cx, cy + 4); ctx.lineTo(cx + 7, cy + 8); ctx.closePath(); ctx.stroke();
    ctx.textAlign = 'center'; ctx.font = 'bold 10px ui-monospace, monospace';
    for (const contact of snapshot.rwr) {
      const threatRank = contact.threat === 'MISSILE' ? 0.3 : contact.threat === 'LOCK' ? 0.48 : contact.threat === 'TRACK' ? 0.7 : 0.88;
      const x = cx + Math.sin(contact.bearing) * radius * threatRank; const y = cy - Math.cos(contact.bearing) * radius * threatRank;
      ctx.fillStyle = contact.threat === 'MISSILE' || contact.threat === 'LOCK' ? '#ff625f' : '#ffbf62';
      const emitter = String(contact.entityId).slice(-2); const symbol = contact.threat === 'MISSILE' ? `M${emitter}` : contact.threat === 'LOCK' ? `L${emitter}` : contact.threat === 'TRACK' ? `T${emitter}` : `S${emitter}`;
      ctx.fillText(symbol, x, y);
      if (contact.threat === 'MISSILE') { ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.strokeStyle = '#ff625f'; ctx.stroke(); }
    }
    ctx.fillStyle = 'rgba(125,255,184,.62)'; ctx.font = '8px ui-monospace, monospace'; ctx.fillText('AN/ALR · RWR', cx, cy + radius + 15);
    const panelX = cx - 76; const panelY = cy + radius + 22; const panelW = 152; const panelH = 25;
    ctx.fillStyle = 'rgba(1,12,8,.9)'; ctx.fillRect(panelX, panelY, panelW, panelH); ctx.strokeStyle = 'rgba(125,255,184,.48)'; ctx.strokeRect(panelX, panelY, panelW, panelH);
    ctx.font = 'bold 9px ui-monospace, monospace';
    ctx.fillStyle = snapshot.countermeasures.flare <= 5 ? '#ff4f4f' : '#ffbf62'; ctx.textAlign = 'left'; ctx.fillText(`F FLR ${String(snapshot.countermeasures.flare).padStart(2, '0')}`, panelX + 8, panelY + 13);
    ctx.fillStyle = snapshot.countermeasures.chaff <= 5 ? '#ff4f4f' : '#7dffb8'; ctx.textAlign = 'right'; ctx.fillText(`G CHF ${String(snapshot.countermeasures.chaff).padStart(2, '0')}`, panelX + panelW - 8, panelY + 13); ctx.restore();
  }

  private drawDlz(range: number, quality: number) {
    const { ctx, width: w, height: h } = this;
    const x = w * 0.73; const top = h * 0.31; const bottom = h * 0.66;
    ctx.strokeStyle = '#ffbf62'; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    ctx.textAlign = 'left'; ctx.fillStyle = '#ffbf62'; ctx.font = '8px ui-monospace, monospace';
    ctx.fillText('RMAX', x + 8, top); ctx.fillText('RTR', x + 8, top + (bottom - top) * 0.4); ctx.fillText('RMIN', x + 8, bottom);
    const maxRange = 35_000 * (0.55 + quality * 0.45); const markerY = bottom - clamp(range / maxRange, 0, 1) * (bottom - top);
    ctx.beginPath(); ctx.moveTo(x - 9, markerY); ctx.lineTo(x + 4, markerY); ctx.stroke();
  }
}
