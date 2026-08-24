import { AIRCRAFT, clamp, collidesBuilding, length3, terrainHeight, wrapAngle } from './data';
import type { AeroState, AircraftId, EnemyDamageState, Entity, FlightState, RadarDisplay, RadarMode, RwrContact, SimulationSnapshot, Track, Vec3, WeaponId } from './types';

type Difficulty = 'ROOKIE' | 'NORMAL' | 'ACE';

const PLAYER_ID = -1;
const forward = (heading: number, pitch: number): Vec3 => ({
  x: Math.sin(heading) * Math.cos(pitch),
  y: Math.sin(pitch),
  z: Math.cos(heading) * Math.cos(pitch),
});

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

function bodyBasis(heading: number, pitch: number, roll: number) {
  const sinH = Math.sin(heading); const cosH = Math.cos(heading);
  const sinP = Math.sin(pitch); const cosP = Math.cos(pitch);
  const sinR = Math.sin(roll); const cosR = Math.cos(roll);
  const nose = { x: sinH * cosP, y: sinP, z: cosH * cosP };
  const baseRight = { x: cosH, y: 0, z: -sinH };
  const baseUp = { x: -sinH * sinP, y: cosP, z: -cosH * sinP };
  return {
    nose,
    right: {
      x: baseRight.x * cosR + baseUp.x * sinR,
      y: baseRight.y * cosR + baseUp.y * sinR,
      z: baseRight.z * cosR + baseUp.z * sinR,
    },
    up: {
      x: baseUp.x * cosR - baseRight.x * sinR,
      y: baseUp.y * cosR - baseRight.y * sinR,
      z: baseUp.z * cosR - baseRight.z * sinR,
    },
  };
}

const distance = (a: Vec3, b: Vec3) => length3(a.x - b.x, a.y - b.y, a.z - b.z);

function segmentDistance(point: Vec3, start: Vec3, end: Vec3) {
  const sx = end.x - start.x; const sy = end.y - start.y; const sz = end.z - start.z;
  const lengthSquared = sx * sx + sy * sy + sz * sz;
  const t = clamp(((point.x - start.x) * sx + (point.y - start.y) * sy + (point.z - start.z) * sz) / Math.max(.001, lengthSquared), 0, 1);
  return distance(point, { x: start.x + sx * t, y: start.y + sy * t, z: start.z + sz * t });
}

function hasTerrainLos(a: Vec3, b: Vec3) {
  for (let i = 1; i < 12; i += 1) {
    const t = i / 12;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const lineY = a.y + (b.y - a.y) * t;
    if (terrainHeight(x, z) + 70 > lineY) return false;
  }
  return true;
}

function makePool(kind: Entity['kind'], count: number, start: number): Entity[] {
  return Array.from({ length: count }, (_, index) => ({
    id: start + index, kind, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
    heading: 0, pitch: 0, roll: 0, health: 0, team: 2, active: false, life: 0, targetId: null,
  }));
}

export class SimulationCore {
  readonly entities: Entity[] = [
    ...makePool('enemy', 24, 100),
    ...makePool('missile', 96, 1000),
    ...makePool('tracer', 256, 2000),
    ...makePool('smoke', 384, 3000),
    ...makePool('blast', 48, 4000),
  ];

  readonly tracks: Track[] = [];
  readonly rwr: RwrContact[] = [];
  readonly player = {
    position: { x: 0, y: 4700, z: -22_000 }, velocity: { x: 0, y: 0, z: 235 },
    heading: 0, pitch: 0.012, roll: 0, speed: 235, throttle: 0.64, health: 100, g: 1, aoa: 1, energyRate: 0,
  };

  aircraftId: AircraftId;
  radarMode: RadarMode = 'TWS';
  radarDisplay: RadarDisplay;
  selectedWeapon: WeaponId = 'GUN';
  ammo: Record<WeaponId, number>;
  commandX = 0;
  commandY = 0;
  score = 0;
  kills = 0;
  elapsed = 0;
  radarSweep = -1;
  targetId: number | null = null;
  twsTargetIds: number[] = [];
  afterburnerHeat = 0;
  afterburnerThermalLimited = false;
  message = 'SYSTEM READY';
  countermeasures = { flare: 30, chaff: 30 };
  warning: 'PULL UP' | 'TERRAIN' | 'STALL' | null = null;
  clearance = 1000;
  damage = { airframe: 0, engine: 0, controls: 0, radar: 0, leftWing: 0, rightWing: 0, tail: 0 };
  flightState: FlightState = 'FLYING';
  explosion = 0;
  impactSeverity = 0;
  radarClutter = 0;
  aeroState: AeroState = 'NORMAL';
  spinDirection: -1 | 0 | 1 = 0;
  spinSeverity = 0;
  sideslip = 0;
  private spinRecoveryTimer = 0;
  private enemyCount: number;
  private difficulty: Difficulty;
  private infinite: boolean;
  private accumulator = 0;
  private sensorClock = 0;
  private aiClock = 0;
  private gunClock = 0;
  private spawnClock = 0;
  private missileClock = 8;
  private trigger = false;
  private filteredRoll = 0;
  private filteredPitch = 0;
  private rollRate = 0;
  private pitchRate = 0;
  private yawRate = 0;
  private stallSeverity = 0;
  private stallLatched = false;
  private recoveryProgress = 1;
  private tumble = { roll: 0, pitch: 0, yaw: 0 };
  private afterburnerFailureLatched = false;
  private engineSpool = .64;
  private afterburnerSpool = 0;
  private acquisitionRadarMode: Exclude<RadarMode, 'STT'> = 'TWS';
  private keyState = new Set<string>();
  private noiseSeed = 23821;

  constructor(aircraftId: AircraftId, enemyCount: number, difficulty: Difficulty, infinite = false, radarDisplay: RadarDisplay = 'B-SCOPE') {
    this.aircraftId = aircraftId;
    this.radarDisplay = radarDisplay;
    this.enemyCount = enemyCount;
    this.difficulty = difficulty;
    this.infinite = infinite;
    const aircraft = AIRCRAFT[aircraftId];
    this.ammo = { GUN: aircraft.gunAmmo, ...aircraft.missiles };
    this.spawnInitial();
  }

  setCommand(x: number, y: number) {
    const radius = Math.hypot(x, y);
    const scale = radius > 1 ? 1 / radius : 1;
    this.commandX = x * scale;
    this.commandY = y * scale;
  }

  key(code: string, down: boolean) {
    if (down) this.keyState.add(code); else this.keyState.delete(code);
  }

  setTrigger(active: boolean) { this.trigger = active; }

  cycleRadar() {
    const current = this.radarMode === 'STT' ? this.acquisitionRadarMode : this.radarMode;
    this.radarMode = current === 'SRC' ? 'TWS' : current === 'TWS' ? 'ACM' : current === 'ACM' ? 'HMD' : 'SRC';
    this.acquisitionRadarMode = this.radarMode;
    this.message = `RADAR ${this.radarMode}`;
    this.targetId = null;
    this.tracks.forEach((track) => { track.designated = false; });
    if (this.radarMode !== 'TWS') this.twsTargetIds = [];
  }

  cueHmd() {
    this.radarMode = 'HMD';
    this.acquisitionRadarMode = 'HMD';
    this.targetId = null;
    this.twsTargetIds = [];
    this.tracks.forEach((track) => { track.designated = false; });
    this.message = 'HMD ACQUISITION // PLACE CIRCLE ON TARGET';
    return this.designate();
  }

  selectWeapon(weapon: WeaponId) {
    this.selectedWeapon = weapon;
    if (weapon === 'ST-1X' && this.radarMode !== 'STT') { this.radarMode = 'ACM'; this.acquisitionRadarMode = 'ACM'; }
    if (weapon === 'ST-1AX' && this.radarMode === 'SRC') { this.radarMode = 'TWS'; this.acquisitionRadarMode = 'TWS'; }
    this.message = weapon === 'GUN' ? 'GUN HOT // LMB' : `${weapon} SELECTED // T LOCK · SPACE FIRE`;
  }

  designate() {
    const cueBearing = this.radarMode === 'HMD' ? this.commandX * .76 : 0;
    const cueElevation = this.radarMode === 'HMD' ? -this.commandY * .54 : 0;
    const cueError = (position: Vec3) => {
      const bearing = wrapAngle(Math.atan2(position.x - this.player.position.x, position.z - this.player.position.z) - this.player.heading);
      const elevation = wrapAngle(Math.atan2(position.y - this.player.position.y, Math.hypot(position.x - this.player.position.x, position.z - this.player.position.z)) - this.player.pitch);
      return Math.hypot(wrapAngle(bearing - cueBearing), wrapAngle(elevation - cueElevation));
    };
    let candidates = this.tracks.filter((track) => track.state !== 'LOST');
    if (!candidates.length) {
      const visual = this.entities.filter((entity) => entity.active && entity.kind === 'enemy' && hasTerrainLos(this.player.position, entity.position)).sort((a, b) => {
        return cueError(a.position) - cueError(b.position);
      })[0];
      if (visual) {
        const error = cueError(visual.position);
        const acquisitionLimit = this.radarMode === 'HMD' ? .14 : .48;
        if (error < acquisitionLimit) {
          this.tracks.push({ id: 20 + this.tracks.length, entityId: visual.id, position: { ...visual.position }, velocity: { ...visual.velocity }, quality: .48, uncertainty: 55, age: 0, state: 'TRACK', source: 'FUSED', designated: false });
          candidates = this.tracks.filter((track) => track.state !== 'LOST');
        }
      }
    }
    candidates.sort((a, b) => {
      return cueError(a.position) - cueError(b.position) || b.quality - a.quality;
    });
    if (this.radarMode === 'HMD') candidates = candidates.filter((track) => cueError(track.position) < .17);
    if (this.radarMode === 'TWS') {
      const validIds = new Set(candidates.filter((track) => track.source === 'RADAR' && track.quality > .08).map((track) => track.entityId));
      this.twsTargetIds = this.twsTargetIds.filter((id) => validIds.has(id));
      for (const candidate of candidates) {
        if (candidate.source !== 'RADAR' || this.twsTargetIds.includes(candidate.entityId)) continue;
        this.twsTargetIds.push(candidate.entityId);
        if (this.twsTargetIds.length >= 4) break;
      }
      candidates = this.twsTargetIds.map((id) => candidates.find((track) => track.entityId === id)).filter((track): track is Track => Boolean(track));
    }
    this.tracks.forEach((track) => { track.designated = false; });
    if (candidates.length) {
      const current = candidates.findIndex((track) => track.entityId === this.targetId);
      const selected = candidates[(current + 1) % candidates.length];
      selected.designated = true;
      this.targetId = selected.entityId;
      const twsIndex = this.twsTargetIds.indexOf(selected.entityId);
      if (this.radarMode !== 'TWS') {
        if (this.radarMode !== 'STT') this.acquisitionRadarMode = this.radarMode;
        this.radarMode = 'STT';
        this.twsTargetIds = [];
      }
      this.message = this.radarMode === 'TWS'
        ? `TWS L&S ${twsIndex + 1}/${this.twsTargetIds.length} // T CYCLES`
        : `STT LOCK T${String(selected.id).padStart(3, '0')} // NARROW TRACK GATE`;
      return true;
    } else {
      this.targetId = null;
      this.message = 'NO TRACK';
      return false;
    }
  }

  undesignate() {
    this.targetId = null;
    this.tracks.forEach((track) => { track.designated = false; });
    if (this.radarMode === 'STT') this.radarMode = this.acquisitionRadarMode;
    this.message = `TARGET CLEARED // ${this.radarMode} SEARCH`;
  }

  releaseMissile() {
    const weapon = this.selectedWeapon;
    if (weapon === 'GUN' || this.ammo[weapon] <= 0) {
      this.message = weapon === 'GUN' ? 'GUN: USE LMB' : `${weapon} EMPTY`;
      return false;
    }
    if (this.targetId === null) this.designate();
    const track = this.tracks.find((item) => item.entityId === this.targetId && item.state !== 'LOST');
    if (!track) { this.message = 'NO TRACK // R RADAR · T LOCK'; return false; }
    const targetEntity = this.entities.find((entity) => entity.id === track.entityId && entity.active && entity.kind === 'enemy');
    const range = distance(this.player.position, track.position);
    if (range < 650) { this.message = 'MINIMUM RANGE // BREAK AWAY'; return false; }
    const irLaunch = weapon === 'ST-1' && targetEntity
      ? this.evaluateInfrared(this.player.position, this.player.heading, this.player.pitch, targetEntity.position, targetEntity.velocity)
      : null;
    if (weapon === 'ST-1' && (!irLaunch || range > 12_000 || irLaunch.offBoresight > 1.16 || irLaunch.quality < .16)) {
      this.message = irLaunch?.sunGlare && irLaunch.sunGlare > .35 ? 'ST-1 SUN / BACKGROUND REJECT' : 'ST-1 IR NO ACQUISITION'; return false;
    }
    if (weapon === 'ST-1X' && (range > 28_000 || track.quality < 0.58 || this.radarMode !== 'STT')) { this.message = 'ST-1X NEEDS STT LOCK'; return false; }
    if (weapon === 'ST-1AX' && (range > 42_000 || track.quality < 0.35)) { this.message = 'ST-1AX TRACK / RANGE LOW'; return false; }
    const missile = this.entities.find((entity) => entity.kind === 'missile' && !entity.active);
    if (!missile) { this.message = 'WEAPON POOL BUSY'; return false; }
    const dir = forward(this.player.heading, this.player.pitch);
    const motorBurnTime = weapon === 'ST-1' ? 2.8 : weapon === 'ST-1X' ? 4.4 : 5.2;
    Object.assign(missile, {
      active: true, team: 1, health: 1, life: 0, targetId: track.entityId, weapon,
      lockQuality: irLaunch?.quality ?? track.quality, lostTime: 0, irSignal: irLaunch?.contrast,
      irDecoyPosition: undefined, irDecoyVelocity: undefined, irDecoyTime: 0,
      guidancePhase: 'BOOST', motorBurnTime, seekerActive: weapon === 'ST-1X', datalinkAge: 0,
      inertialAim: { ...track.position }, inertialVelocity: { ...track.velocity }, launchPlatformId: PLAYER_ID,
      position: { ...this.player.position }, heading: this.player.heading, pitch: this.player.pitch, roll: this.player.roll,
      velocity: { x: dir.x * (this.player.speed + 310), y: dir.y * (this.player.speed + 310), z: dir.z * (this.player.speed + 310) },
    });
    this.ammo[weapon] -= 1;
    this.message = `${weapon} AWAY`;
    return true;
  }

  countermeasure(kind: 'FLARE' | 'CHAFF') {
    const key = kind === 'FLARE' ? 'flare' : 'chaff';
    if (this.countermeasures[key] <= 0) { this.message = `${kind} EMPTY`; return; }
    this.countermeasures[key] -= 1;
    this.message = `${kind} DISPENSE`;
    for (const missile of this.entities) {
      if (!missile.active || missile.kind !== 'missile' || missile.team !== 2) continue;
      const radarWeapon = missile.weapon !== 'ST-1';
      const effective = (kind === 'CHAFF') === radarWeapon;
      const missileRange = distance(missile.position, this.player.position);
      if (kind === 'FLARE' && missile.weapon === 'ST-1' && missileRange < 4800) {
        const currentTrack = missile.lockQuality ?? .7;
        const seductionChance = clamp(.88 - currentTrack * .42 + (4800 - missileRange) / 9000, .22, .92);
        if (this.random() < seductionChance) {
          const speed = Math.max(1, this.player.speed);
          const aft = { x: -this.player.velocity.x / speed, y: -this.player.velocity.y / speed, z: -this.player.velocity.z / speed };
          missile.irDecoyTime = 1.75;
          missile.irDecoyPosition = {
            x: this.player.position.x + aft.x * 42 + (this.random() - .5) * 34,
            y: this.player.position.y + aft.y * 42 - 8 + (this.random() - .5) * 18,
            z: this.player.position.z + aft.z * 42 + (this.random() - .5) * 34,
          };
          missile.irDecoyVelocity = {
            x: this.player.velocity.x * .48 + (this.random() - .5) * 16,
            y: this.player.velocity.y * .48 - 10,
            z: this.player.velocity.z * .48 + (this.random() - .5) * 16,
          };
          missile.lockQuality = clamp(currentTrack - .18, 0, 1);
          missile.lostTime = (missile.lostTime ?? 0) + .12;
        }
      } else if (effective && missileRange < 3200) {
        missile.lockQuality = clamp((missile.lockQuality ?? .8) - (.24 + this.random() * .48), 0, 1);
        missile.lostTime = (missile.lostTime ?? 0) + .35;
      }
    }
  }

  stepFrame(dt: number) {
    this.accumulator = Math.min(this.accumulator + Math.min(dt, 0.1), 0.25);
    const fixed = 1 / 120;
    while (this.accumulator >= fixed) {
      this.update(fixed);
      this.accumulator -= fixed;
    }
  }

  getSnapshot(): SimulationSnapshot {
    const irTarget = this.entities.find((entity) => entity.id === this.targetId && entity.active && entity.kind === 'enemy');
    const irCue = irTarget ? this.evaluateInfrared(this.player.position, this.player.heading, this.player.pitch, irTarget.position, irTarget.velocity) : null;
    const irSeekerStatus: SimulationSnapshot['irSeekerStatus'] = !irCue ? 'NO TARGET'
      : irCue.offBoresight > 1.16 ? 'GIMBAL'
        : irCue.sunGlare > .35 ? 'SUN'
          : irCue.groundBackground > .62 && irCue.quality < .28 ? 'BACKGROUND'
            : irCue.quality < .16 ? 'LOW SIGNAL' : 'TRACK';
    return {
      player: { ...this.player, position: { ...this.player.position }, velocity: { ...this.player.velocity } },
      entities: this.entities.filter((entity) => entity.active),
      tracks: this.tracks.filter((track) => track.state !== 'LOST'),
      rwr: this.rwr,
      radarMode: this.radarMode, radarDisplay: this.radarDisplay, radarSweep: this.radarSweep, selectedWeapon: this.selectedWeapon,
      ammo: { ...this.ammo }, score: this.score, kills: this.kills, elapsed: this.elapsed,
      message: this.message, commandX: this.commandX, commandY: this.commandY, targetId: this.targetId,
      twsTargetIds: [...this.twsTargetIds],
      afterburnerActive: this.player.throttle > 1 && this.damage.engine < .96,
      afterburnerHeat: this.afterburnerHeat, afterburnerThermalLimited: this.afterburnerThermalLimited,
      afterburnerOverride: this.afterburnerThermalLimited && this.player.throttle > 1,
      irSeekerQuality: irCue?.quality ?? 0, irSeekerStatus,
      countermeasures: { ...this.countermeasures },
      warning: this.warning, clearance: this.clearance, damage: { ...this.damage },
      flightState: this.flightState, explosion: this.explosion, radarClutter: this.radarClutter,
      impactSeverity: this.impactSeverity,
      aeroState: this.aeroState, spinDirection: this.spinDirection, spinSeverity: this.spinSeverity,
      stallSeverity: this.stallSeverity, recoveryProgress: this.recoveryProgress, sideslip: this.sideslip,
    };
  }

  private evaluateInfrared(origin: Vec3, seekerHeading: number, seekerPitch: number, targetPosition: Vec3, targetVelocity: Vec3, heatBoost = 0) {
    const delta = { x: targetPosition.x - origin.x, y: targetPosition.y - origin.y, z: targetPosition.z - origin.z };
    const range = Math.max(1, length3(delta.x, delta.y, delta.z));
    const los = { x: delta.x / range, y: delta.y / range, z: delta.z / range };
    const seekerNose = forward(seekerHeading, seekerPitch);
    const offBoresight = Math.acos(clamp(dot(seekerNose, los), -1, 1));
    const targetSpeed = Math.max(1, length3(targetVelocity.x, targetVelocity.y, targetVelocity.z));
    const targetForward = { x: targetVelocity.x / targetSpeed, y: targetVelocity.y / targetSpeed, z: targetVelocity.z / targetSpeed };
    const targetToSeeker = { x: -los.x, y: -los.y, z: -los.z };
    const rearAspect = clamp((1 - dot(targetForward, targetToSeeker)) * .5, 0, 1);
    const targetClearance = targetPosition.y - terrainHeight(targetPosition.x, targetPosition.z);
    const lookDown = clamp((origin.y - targetPosition.y + 260) / Math.max(800, range) * 2.8, 0, 1);
    const groundBackground = clamp(lookDown * (.34 + clamp((1050 - targetClearance) / 1050, 0, 1) * .66), 0, 1);
    const sun = { x: .39, y: .74, z: -.55 };
    const sunGlare = clamp((.2 - Math.acos(clamp(dot(los, sun), -1, 1))) / .16, 0, 1);
    const sourceHeat = clamp(.36 + rearAspect * .58 + heatBoost, .2, 1.35);
    const atmosphericRange = clamp((14_500 - range) / 10_500, .12, 1);
    const contrast = sourceHeat * atmosphericRange * (1 - groundBackground * .58) * (1 - sunGlare * .84);
    const gimbal = clamp((1.18 - offBoresight) / .34, 0, 1);
    return { quality: clamp(contrast * (.35 + gimbal * .65), 0, 1), contrast, offBoresight, groundBackground, sunGlare, rearAspect };
  }

  private update(dt: number) {
    this.elapsed += dt;
    this.sensorClock += dt;
    this.aiClock += dt;
    this.gunClock += dt;
    this.spawnClock += dt;
    this.missileClock += dt;
    this.spinRecoveryTimer = Math.max(0, this.spinRecoveryTimer - dt);
    if (this.explosion > 0) this.explosion = Math.max(0, this.explosion - dt);
    if (this.impactSeverity > 0) this.impactSeverity = Math.max(0, this.impactSeverity - dt * 1.15);
    this.updatePlayer(dt);
    this.updateEntities(dt);
    if (this.sensorClock >= 1 / 30) { this.updateSensors(this.sensorClock); this.sensorClock = 0; }
    if (this.aiClock >= 1 / 20) { this.updateAi(this.aiClock); this.aiClock = 0; }
    if (this.trigger && this.gunClock > 0.065) { this.fireGun(); this.gunClock = 0; }
    if (this.infinite && this.spawnClock > 4 && this.activeEnemies() < Math.min(this.enemyCount, 16)) { this.spawnEnemy(); this.spawnClock = 0; }
  }

  private updatePlayer(dt: number) {
    const config = AIRCRAFT[this.aircraftId];
    if (this.flightState === 'CRASHED') return;
    const throttleUp = this.keyState.has('ShiftLeft') || this.keyState.has('ShiftRight');
    if (throttleUp) this.player.throttle += dt * 0.42;
    if (this.keyState.has('ControlLeft') || this.keyState.has('ControlRight')) this.player.throttle -= dt * 0.42;
    this.player.throttle = clamp(this.player.throttle, 0, 1.1);
    const afterburnerRequested = this.player.throttle > 1 && this.damage.engine < .96;
    if (afterburnerRequested) {
      // 70% is reached after roughly 36 seconds of continuous augmentation.
      // The limiter automatically returns the throttle to MIL; pushing back
      // through the gate is a deliberate thermal override.
      this.afterburnerHeat = clamp(this.afterburnerHeat + dt * .0194, 0, 1);
      if (!this.afterburnerThermalLimited && this.afterburnerHeat >= .7) {
        this.afterburnerThermalLimited = true;
        this.player.throttle = 1;
        this.message = 'AB OVERHEAT 70% // AUTO MIL · COOL TO 0';
      } else if (this.afterburnerThermalLimited && this.afterburnerHeat >= .999 && !this.afterburnerFailureLatched) {
        this.afterburnerFailureLatched = true;
        this.damage.engine = clamp(this.damage.engine + .74, 0, 1);
        this.damage.airframe = clamp(this.damage.airframe + .12, 0, 1);
        this.player.health = Math.max(8, this.player.health - 28);
        this.player.throttle = .78;
        this.impactSeverity = Math.max(this.impactSeverity, .72);
        this.flightState = 'DAMAGED';
        this.message = 'ENGINE OVERHEAT DAMAGE // AB OVERRIDE FAILED';
      }
    } else {
      const coolingRate = this.player.throttle < .82 ? .038 : .026;
      this.afterburnerHeat = Math.max(0, this.afterburnerHeat - dt * coolingRate);
      if (this.afterburnerHeat <= .001) {
        this.afterburnerHeat = 0;
        this.afterburnerThermalLimited = false;
        this.afterburnerFailureLatched = false;
      }
    }
    const drySpoolTarget = Math.min(1, this.player.throttle);
    this.engineSpool += (drySpoolTarget - this.engineSpool) * (1 - Math.exp(-dt * (drySpoolTarget > this.engineSpool ? 1.7 : 2.8)));
    const afterburnerCommand = this.damage.engine < .96 ? clamp((this.player.throttle - 1) / .1, 0, 1) : 0;
    this.afterburnerSpool += (afterburnerCommand - this.afterburnerSpool) * (1 - Math.exp(-dt * (afterburnerCommand > this.afterburnerSpool ? 2.25 : 4.5)));

    const deadzone = (value: number) => Math.abs(value) < 0.025 ? 0 : Math.sign(value) * Math.pow((Math.abs(value) - 0.025) / 0.975, 1.24);
    const rollCommand = deadzone(this.commandX); const pitchInput = deadzone(this.commandY);
    const rollResponse = 1 - Math.exp(-dt * (Math.abs(rollCommand) < .025 ? 18 : 7.2));
    const pitchResponse = 1 - Math.exp(-dt * (Math.abs(pitchInput) < .025 ? 11 : 7.2));
    this.filteredRoll += (rollCommand - this.filteredRoll) * rollResponse;
    this.filteredPitch += (pitchInput - this.filteredPitch) * pitchResponse;
    const manualRoll = (this.keyState.has('KeyA') ? 1 : 0) - (this.keyState.has('KeyD') ? 1 : 0);
    const manualPitch = (this.keyState.has('KeyS') ? 1 : 0) - (this.keyState.has('KeyW') ? 1 : 0);
    const rudder = (this.keyState.has('KeyQ') ? -1 : 0) + (this.keyState.has('KeyE') ? 1 : 0);

    const altitude = Math.max(0, this.player.position.y);
    const densityRatio = clamp(Math.exp(-altitude / 8500), .18, 1);
    const soundSpeed = 340.3 - Math.min(44, altitude * .0031);
    const mach = this.player.speed / soundSpeed;
    const dynamicPressure = densityRatio * Math.pow(this.player.speed / 245, 2);
    const wingLift = clamp(1 - (this.damage.leftWing + this.damage.rightWing) * .25 - Math.max(this.damage.leftWing, this.damage.rightWing) * .22, .18, 1);
    const controlAuthority = (1 - this.damage.controls * .64) * (1 - this.damage.tail * .42) * clamp(dynamicPressure / (dynamicPressure + .24), .2, 1);
    const maxRollRate = config.rollRate * (.48 + controlAuthority * .72);
    const asymmetry = this.damage.rightWing - this.damage.leftWing;

    const structurallyLost = this.player.health <= 8
      || this.damage.airframe > .88
      || (Math.max(this.damage.leftWing, this.damage.rightWing) > .96 && this.damage.airframe > .55)
      || (this.damage.leftWing > .9 && this.damage.rightWing > .9)
      || (this.damage.controls > .94 && this.damage.tail > .7);
    if (structurallyLost) {
      if (this.flightState !== 'UNCONTROLLED') {
        const energy = clamp(this.player.speed / 180, .55, 2.2);
        const direction = Math.sign(asymmetry || this.rollRate || this.random() - .5) || 1;
        this.tumble = {
          roll: direction * (1.7 + this.random() * 2.8) * energy,
          pitch: (.35 + this.random() * 1.25) * (this.random() > .5 ? 1 : -1),
          yaw: direction * (.45 + this.random() * 1.15),
        };
        this.player.velocity.y = Math.min(this.player.velocity.y, -5);
        this.flightState = 'UNCONTROLLED';
      }
    } else if (Object.values(this.damage).some((value) => value > .14)) this.flightState = 'DAMAGED';

    const speed = Math.max(1, length3(this.player.velocity.x, this.player.velocity.y, this.player.velocity.z));
    const initialBasis = bodyBasis(this.player.heading, this.player.pitch, this.player.roll);
    const forwardVelocity = dot(this.player.velocity, initialBasis.nose);
    const verticalVelocity = dot(this.player.velocity, initialBasis.up);
    const lateralVelocity = dot(this.player.velocity, initialBasis.right);
    const aoaRadians = clamp(Math.atan2(-verticalVelocity, Math.max(1, forwardVelocity)), -.75, .75);
    this.sideslip = clamp(Math.atan2(-lateralVelocity, Math.max(1, forwardVelocity)), -.7, .7) * 180 / Math.PI;
    this.player.aoa = aoaRadians * 180 / Math.PI;
    const indicatedSpeed = speed * Math.sqrt(densityRatio);
    // Modern relaxed-stability fighters retain useful lift well beyond the
    // classic 14-16 degree wing stall. The FBW instructor protects this wider
    // envelope, while direct keyboard pitch can still exceed it and depart.
    const liftCommand = clamp(Math.max(0, manualPitch, -this.filteredPitch), 0, 1);
    const alphaStall = clamp((Math.abs(this.player.aoa) - 20.5) / 11.5, 0, 1);
    const lowSpeedStall = clamp((116 - indicatedSpeed) / 42, 0, 1)
      * clamp(.28 + liftCommand * .72 + Math.max(0, Math.abs(this.player.aoa) - 7) / 16, .28, 1);
    const liftReserveStall = clamp((.17 - dynamicPressure * wingLift) / .12, 0, 1) * clamp(.25 + liftCommand, .25, 1);
    const stallDemand = clamp(Math.max(alphaStall, lowSpeedStall, liftReserveStall), 0, 1);
    this.stallSeverity += (stallDemand - this.stallSeverity) * (1 - Math.exp(-dt * (stallDemand > this.stallSeverity ? 4.4 : 1.8)));
    if (stallDemand > .12 || this.stallSeverity > .16) this.stallLatched = true;

    const spinExcitation = Math.abs(rudder) * .55 + Math.abs(this.sideslip) / 38 + Math.abs(asymmetry) * .9
      + Math.abs(this.rollRate) * .16 + Math.abs(manualRoll) * .24 + Math.abs(this.filteredRoll) * .16;
    if (this.stallSeverity > .34 && spinExcitation > .42 && this.spinRecoveryTimer <= 0 && this.flightState !== 'UNCONTROLLED') {
      if (this.spinDirection === 0) this.spinDirection = (Math.sign(asymmetry || this.rollRate || rudder || this.random() - .5) || 1) as -1 | 1;
      this.spinSeverity = clamp(this.spinSeverity + dt * (.34 + spinExcitation * .28), 0, 1);
    }
    const recoveryRudder = this.spinDirection !== 0 && Math.sign(rudder) === -this.spinDirection;
    const recovery = manualPitch < 0 ? (recoveryRudder ? 2.1 : .92) * (this.player.throttle < .58 ? 1.3 : .74) : 0;
    this.spinSeverity = clamp(this.spinSeverity - dt * recovery - (this.stallSeverity < .2 ? dt * .7 : 0), 0, 1);
    if (this.spinSeverity < .04) {
      if (this.spinDirection !== 0 && recovery > 0) this.spinRecoveryTimer = 3.2;
      this.spinDirection = 0;
    }
    const speedRecovery = clamp((indicatedSpeed - 72) / 44, 0, 1);
    const alphaRecovery = clamp((28 - Math.abs(this.player.aoa)) / 14, 0, 1);
    const rotationRecovery = clamp(1 - this.spinSeverity * 1.35, 0, 1);
    const bankRecovery = clamp((2.25 - Math.abs(Math.sin(this.player.roll))) / 1.35, 0, 1);
    this.recoveryProgress = Math.min(speedRecovery, alphaRecovery, rotationRecovery, bankRecovery);
    if (this.stallLatched && this.recoveryProgress > .92 && this.stallSeverity < .13) this.stallLatched = false;
    this.aeroState = this.spinSeverity > .14 ? 'SPIN' : this.stallLatched ? 'STALL' : 'NORMAL';

    let targetRollRate = asymmetry * .52 * dynamicPressure;
    if (this.flightState === 'UNCONTROLLED') {
      targetRollRate = this.tumble.roll;
    } else if (manualRoll) targetRollRate = manualRoll * maxRollRate;
    else if (Math.abs(this.filteredRoll) > .035) {
      targetRollRate = -this.filteredRoll * maxRollRate * .92 + asymmetry * .42;
    }
    if (this.aeroState === 'SPIN') targetRollRate += this.spinDirection * (1.4 + this.spinSeverity * 3.4);
    const rollSettling = this.flightState === 'UNCONTROLLED' ? 2.8 : manualRoll || Math.abs(this.filteredRoll) > .035 ? 7.2 : 16;
    this.rollRate += (targetRollRate - this.rollRate) * (1 - Math.exp(-dt * rollSettling));

    const instructorPitch = Math.abs(this.filteredPitch) > .035 ? -this.filteredPitch : 0;
    const maxPitchRate = config.turnRate * (.34 + controlAuthority * .36);
    const instructorAoALimit = 14 + clamp((indicatedSpeed - 82) / 95, 0, 1) * 9;
    const keyboardAoALimit = 15 + clamp((indicatedSpeed - 82) / 95, 0, 1) * 11;
    const pitchCommand = manualPitch || instructorPitch;
    const positiveLimit = manualPitch > 0 ? keyboardAoALimit : instructorAoALimit;
    let targetPitchRate = 0;
    if (pitchCommand > 0) {
      const aoaAuthority = clamp((positiveLimit - this.player.aoa) / 6.5, 0, 1);
      const gAuthority = clamp((9.15 - this.player.g) / 1.4, 0, 1);
      targetPitchRate = pitchCommand * maxPitchRate * Math.min(aoaAuthority, gAuthority);
      if (this.player.aoa > positiveLimit + .5) targetPitchRate = clamp((positiveLimit * Math.PI / 180 - aoaRadians) * 3.4, -maxPitchRate * .5, 0);
    } else if (pitchCommand < 0) {
      const negativeLimit = this.aeroState !== 'NORMAL' || this.spinRecoveryTimer > 0 ? -5 : -9;
      const aoaAuthority = clamp((this.player.aoa - negativeLimit) / 5.5, 0, 1);
      targetPitchRate = pitchCommand * maxPitchRate * aoaAuthority;
      if (this.player.aoa < negativeLimit - .5) targetPitchRate = clamp((negativeLimit * Math.PI / 180 - aoaRadians) * 3.8, 0, maxPitchRate * .5);
    } else if (Math.abs(this.player.aoa) > 22) {
      targetPitchRate = clamp((Math.sign(this.player.aoa) * 22 * Math.PI / 180 - aoaRadians) * 2.4, -maxPitchRate * .5, maxPitchRate * .5);
    }
    if (this.stallLatched && manualPitch < 0) targetPitchRate = Math.min(targetPitchRate, -maxPitchRate * (.58 + this.stallSeverity * .32));
    if (this.aeroState === 'SPIN') targetPitchRate -= .18 + this.spinSeverity * .34;
    if (this.flightState === 'UNCONTROLLED') targetPitchRate = this.tumble.pitch;
    this.pitchRate += (targetPitchRate - this.pitchRate) * (1 - Math.exp(-dt * (manualPitch < 0 && this.aeroState !== 'NORMAL' ? 8.8 : 5.4)));

    const damagedYaw = asymmetry * .035 + (this.aeroState === 'SPIN' ? this.spinDirection * (this.spinSeverity * 1.45) : 0);
    const targetYawRate = this.flightState === 'UNCONTROLLED'
      ? this.tumble.yaw
      : rudder * .17 * controlAuthority - this.sideslip * Math.PI / 180 * .018 + damagedYaw;
    this.yawRate += (targetYawRate - this.yawRate) * (1 - Math.exp(-dt * 5));

    // Integrate body-axis p/q/r into world Euler attitude. This is the key to
    // aircraft-relative mouse pitch: at 90 degrees of bank, pulling changes
    // heading instead of making the instructor first level the wings.
    const safeCosPitch = Math.sign(Math.cos(this.player.pitch) || 1) * Math.max(.12, Math.abs(Math.cos(this.player.pitch)));
    const tanPitch = Math.sin(this.player.pitch) / safeCosPitch;
    const rollDot = this.rollRate + this.pitchRate * Math.sin(this.player.roll) * tanPitch + this.yawRate * Math.cos(this.player.roll) * tanPitch;
    const pitchDot = this.pitchRate * Math.cos(this.player.roll) - this.yawRate * Math.sin(this.player.roll);
    const headingDot = -this.pitchRate * Math.sin(this.player.roll) / safeCosPitch + this.yawRate * Math.cos(this.player.roll) / safeCosPitch;
    this.player.roll = wrapAngle(this.player.roll + rollDot * dt);
    this.player.pitch = wrapAngle(this.player.pitch + pitchDot * dt);
    this.player.heading = wrapAngle(this.player.heading + headingDot * dt);

    const speedRatio = speed / config.maxSpeed;
    const engineHealth = Math.pow(Math.max(0, 1 - this.damage.engine), 1.35);
    const thrustLapse = Math.pow(densityRatio, .36) * clamp(1.08 - Math.max(0, mach - .72) * .22, .52, 1.08);
    const dryThrust = .5 + 8.55 * Math.pow(this.engineSpool, 1.85);
    const thrustAcceleration = (dryThrust * config.thrust + this.afterburnerSpool * 9.35 * config.thrust) * thrustLapse * Math.max(.27, 1 - speedRatio * .48) * engineHealth * (this.flightState === 'UNCONTROLLED' ? .12 : 1);

    const basis = bodyBasis(this.player.heading, this.player.pitch, this.player.roll);
    const nose = basis.nose;
    const aircraftUp = basis.up;
    const vhat = { x: this.player.velocity.x / speed, y: this.player.velocity.y / speed, z: this.player.velocity.z / speed };
    const upDotV = aircraftUp.x * vhat.x + aircraftUp.y * vhat.y + aircraftUp.z * vhat.z;
    const rawLift = { x: aircraftUp.x - vhat.x * upDotV, y: aircraftUp.y - vhat.y * upDotV, z: aircraftUp.z - vhat.z * upDotV };
    const liftLength = Math.max(.001, length3(rawLift.x, rawLift.y, rawLift.z));
    const liftDir = { x: rawLift.x / liftLength, y: rawLift.y / liftLength, z: rawLift.z / liftLength };
    let liftCoefficient = clamp(.3 + this.player.aoa * .105, -1.12, 2.25);
    const stallLiftFactor = (1 - this.stallSeverity * .56) * (1 - this.spinSeverity * .66) * (this.flightState === 'UNCONTROLLED' ? .18 : 1);
    liftCoefficient *= stallLiftFactor;
    const liftAcceleration = clamp(9.81 * dynamicPressure * wingLift * liftCoefficient * 3.45, -40, 90);
    this.player.g = clamp(Math.abs(liftAcceleration) / 9.81, .05, 9);
    // Keep the n²/q induced-drag relationship, but use a modern clean-fighter
    // efficiency factor. The previous value bled almost all usable energy in a
    // single 5-7 G turn and made MIL-power recovery feel piston-aircraft slow.
    const inducedDrag = liftAcceleration * liftAcceleration / (Math.max(.2, dynamicPressure) * 410)
      + (this.damage.leftWing + this.damage.rightWing) * 2.2 + this.damage.airframe * 1.35;
    const baseParasiteDrag = (2.0 + speedRatio * speedRatio * 11.0) * densityRatio;
    // A localized transonic wave-drag rise makes 100% dry thrust settle near
    // Mach .95 instead of running away to Mach 1.35+. Afterburner has enough
    // excess thrust to push through the drag rise, as on a modern fighter.
    const transonicDrag = Math.exp(-Math.pow((mach - .99) / .165, 2)) * 6.45 * Math.pow(densityRatio, .55);
    const supersonicDrag = Math.max(0, mach - 1.08) * 2.2 * densityRatio;
    const parasiteDrag = baseParasiteDrag + transonicDrag + supersonicDrag;
    const stallDrag = (this.stallSeverity * 7.5 + this.spinSeverity * 6.2) * clamp(dynamicPressure, .03, 1.5);
    const airbrakeDrag = this.keyState.has('KeyB') ? 24 : 0;
    const dragAcceleration = parasiteDrag + inducedDrag + stallDrag + airbrakeDrag;
    // Side-force stability damps sideslip by moving the flight path instead of
    // rotating the nose about body yaw. That prevents a banked yaw damper from
    // appearing as an unwanted world-space pitch-up.
    const sideAcceleration = clamp(lateralVelocity * dynamicPressure * .16, -11, 11);
    const ax = nose.x * thrustAcceleration + liftDir.x * liftAcceleration - vhat.x * dragAcceleration - basis.right.x * sideAcceleration;
    let ay = nose.y * thrustAcceleration + liftDir.y * liftAcceleration - vhat.y * dragAcceleration - basis.right.y * sideAcceleration - 9.81;
    const az = nose.z * thrustAcceleration + liftDir.z * liftAcceleration - vhat.z * dragAcceleration - basis.right.z * sideAcceleration;
    if (this.flightState === 'UNCONTROLLED') {
      ay -= 6.5;
      if (this.player.velocity.y > 0) this.player.velocity.y *= Math.exp(-dt * 1.15);
    }
    this.player.velocity.x += ax * dt; this.player.velocity.y += ay * dt; this.player.velocity.z += az * dt;
    this.player.speed = length3(this.player.velocity.x, this.player.velocity.y, this.player.velocity.z);

    this.player.position.x += this.player.velocity.x * dt;
    this.player.position.y += this.player.velocity.y * dt;
    this.player.position.z += this.player.velocity.z * dt;
    const floor = terrainHeight(this.player.position.x, this.player.position.z) + 14;
    const lookAhead = clamp(2.2 + Math.max(0, -this.player.velocity.y) / 45, 2.2, 5.2);
    const futureX = this.player.position.x + this.player.velocity.x * lookAhead;
    const futureZ = this.player.position.z + this.player.velocity.z * lookAhead;
    const futureY = this.player.position.y + this.player.velocity.y * lookAhead;
    this.clearance = this.player.position.y - terrainHeight(this.player.position.x, this.player.position.z);
    const futureClearance = futureY - terrainHeight(futureX, futureZ);
    const stallWarning = this.stallLatched || stallDemand > .055 || indicatedSpeed < 122 && Math.abs(this.player.aoa) > 8.5;
    this.warning = futureClearance < 130 || this.clearance < 115 ? 'PULL UP' : futureClearance < 420 || this.clearance < 360 ? 'TERRAIN' : stallWarning ? 'STALL' : null;
    const buildingHit = collidesBuilding(this.player.position, 14);
    if (this.player.position.y <= floor || buildingHit) this.crash(buildingHit ? 'STRUCTURE IMPACT' : 'GROUND IMPACT');
    this.player.energyRate = this.player.velocity.y + (ax * vhat.x + (ay + 9.81) * vhat.y + az * vhat.z) * this.player.speed / 9.81;
  }

  private updateEntities(dt: number) {
    for (const entity of this.entities) {
      if (!entity.active) continue;
      entity.life += dt;
      if (entity.kind === 'enemy') this.updateEnemyMotion(entity, dt);
      if (entity.kind === 'missile') this.updateMissile(entity, dt);
      if (entity.kind === 'tracer') this.updateTracer(entity, dt);
      if (entity.kind === 'smoke') this.updateSmoke(entity, dt);
      const maxLife = entity.kind === 'enemy' ? 500 : entity.kind === 'missile' ? 34 : entity.kind === 'smoke' ? entity.trailLife ?? 3.4 : entity.kind === 'blast' ? 1.1 : 3.2;
      if (entity.health <= 0 || entity.life > maxLife) {
        if (entity.kind === 'enemy' && entity.health <= 0) {
          this.kills += 1; this.score += 1000; this.message = `SPLASH ${String(entity.id).slice(-2)}`;
          this.spawnBlast(entity.position, 1);
        }
        entity.active = false;
      }
    }
  }

  private updateEnemyMotion(enemy: Entity, dt: number) {
    const damage = enemy.damage;
    if (enemy.fatal) {
      enemy.fatalTime = (enemy.fatalTime ?? 0) + dt;
      const asymmetry = (damage?.rightWing ?? 0) - (damage?.leftWing ?? 0);
      const tumbleDirection = Math.sign(asymmetry || (enemy.id % 2 ? 1 : -1));
      enemy.roll = wrapAngle(enemy.roll + tumbleDirection * dt * (1.3 + Math.abs(asymmetry) * 2.8));
      enemy.pitch = wrapAngle(enemy.pitch - dt * (.12 + (damage?.controls ?? 0) * .28));
      enemy.heading = wrapAngle(enemy.heading + tumbleDirection * dt * (.12 + (damage?.tail ?? 0) * .32));
      const drag = Math.exp(-dt * (.055 + (damage?.engine ?? 0) * .18 + (damage?.fuselage ?? 0) * .08));
      enemy.velocity.x *= drag; enemy.velocity.z *= drag;
      enemy.velocity.y = enemy.velocity.y * Math.exp(-dt * .08) - 9.81 * dt * (.48 + (damage?.leftWing ?? 0) * .22 + (damage?.rightWing ?? 0) * .22);
      if (Math.floor((enemy.fatalTime ?? 0) * 7) !== Math.floor(((enemy.fatalTime ?? 0) - dt) * 7)) this.spawnSmoke(enemy);
    }
    enemy.position.x += enemy.velocity.x * dt;
    enemy.position.y += enemy.velocity.y * dt;
    enemy.position.z += enemy.velocity.z * dt;
    const floor = terrainHeight(enemy.position.x, enemy.position.z) + 22;
    if (enemy.position.y < floor || collidesBuilding(enemy.position, 12)) { enemy.health = 0; return; }
    if (enemy.fatal && (enemy.fatalTime ?? 0) > 3.4) { enemy.health = 0; return; }
    if (enemy.fatal) return;
    if (Math.abs(enemy.position.x) > 58_000 || Math.abs(enemy.position.z) > 82_000) {
      const homeHeading = Math.atan2(-enemy.position.x, -enemy.position.z);
      enemy.heading += clamp(wrapAngle(homeHeading - enemy.heading), -dt * .5, dt * .5);
    }
    const dir = forward(enemy.heading, enemy.pitch);
    const speed = length3(enemy.velocity.x, enemy.velocity.y, enemy.velocity.z) || 260;
    enemy.velocity = { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed };
  }

  private updateMissile(missile: Entity, dt: number) {
    const previous = { ...missile.position };
    const weapon = missile.weapon ?? 'ST-1';
    const motorBurnTime = missile.motorBurnTime ?? (weapon === 'ST-1' ? 2.8 : weapon === 'ST-1X' ? 4.4 : 5.2);
    missile.motorBurnTime = motorBurnTime;
    missile.notchTime = Math.max(0, (missile.notchTime ?? 0) - dt * .35);
    missile.notched = (missile.notchTime ?? 0) > .12;
    if ((missile.irDecoyTime ?? 0) > 0 && missile.irDecoyPosition) {
      const decoyVelocity = missile.irDecoyVelocity ?? { x: 0, y: -8, z: 0 };
      missile.irDecoyTime = Math.max(0, (missile.irDecoyTime ?? 0) - dt);
      missile.irDecoyPosition.x += decoyVelocity.x * dt;
      missile.irDecoyPosition.y += decoyVelocity.y * dt;
      missile.irDecoyPosition.z += decoyVelocity.z * dt;
      decoyVelocity.y -= 5.2 * dt;
    }
    let aim: Vec3 | null = null;
    let targetVelocity: Vec3 = { x: 0, y: 0, z: 0 };
    let seekerGuided = false;
    let sarhSupported = false;
    let infraredContrast = 1;
    const coastInertial = () => {
      if (!missile.inertialAim) return;
      const velocity = missile.inertialVelocity ?? { x: 0, y: 0, z: 0 };
      missile.inertialAim.x += velocity.x * dt;
      missile.inertialAim.y += velocity.y * dt;
      missile.inertialAim.z += velocity.z * dt;
    };
    if (missile.team === 1 && missile.targetId !== null) {
      const track = this.tracks.find((item) => item.entityId === missile.targetId && item.state !== 'LOST');
      const target = this.entities.find((item) => item.id === missile.targetId && item.active);
      if (weapon === 'ST-1' && target) {
        const decoyActive = (missile.irDecoyTime ?? 0) > 0 && missile.irDecoyPosition;
        aim = decoyActive ? missile.irDecoyPosition! : target.position;
        targetVelocity = decoyActive ? missile.irDecoyVelocity ?? target.velocity : target.velocity;
        seekerGuided = true; missile.seekerActive = true; missile.guidancePhase = missile.life < motorBurnTime ? 'BOOST' : 'TERMINAL';
      } else if (weapon === 'ST-1X') {
        sarhSupported = this.radarMode === 'STT' && this.targetId === missile.targetId && Boolean(track && track.quality > .22);
        if (sarhSupported && track) {
          missile.inertialAim = { ...track.position }; missile.inertialVelocity = { ...track.velocity }; missile.datalinkAge = 0;
          aim = track.position; targetVelocity = track.velocity; seekerGuided = true; missile.guidancePhase = missile.life < motorBurnTime ? 'BOOST' : 'TERMINAL';
        } else {
          coastInertial(); missile.datalinkAge = (missile.datalinkAge ?? 0) + dt; aim = missile.inertialAim ?? null; targetVelocity = missile.inertialVelocity ?? targetVelocity; missile.guidancePhase = 'COAST';
        }
      } else if (weapon === 'ST-1AX') {
        if (!missile.seekerActive && track && track.quality > .12) {
          missile.inertialAim = { ...track.position }; missile.inertialVelocity = { ...track.velocity }; missile.datalinkAge = 0;
        } else if (!missile.seekerActive) {
          coastInertial(); missile.datalinkAge = (missile.datalinkAge ?? 0) + dt;
        }
        const predicted = missile.inertialAim ?? track?.position ?? target?.position;
        const terminalRange = predicted ? distance(missile.position, predicted) : Infinity;
        if (!missile.seekerActive && missile.life > 1.15 && terminalRange < 9_500) missile.seekerActive = true;
        if (missile.seekerActive && target) {
          aim = target.position; targetVelocity = target.velocity; seekerGuided = true; missile.guidancePhase = 'TERMINAL';
        } else {
          aim = predicted ?? null; targetVelocity = missile.inertialVelocity ?? track?.velocity ?? targetVelocity;
          missile.guidancePhase = missile.life < motorBurnTime ? 'BOOST' : (missile.datalinkAge ?? 0) > 1.2 ? 'COAST' : 'MIDCOURSE';
        }
      }
    } else if (missile.team === 2 && missile.targetId === PLAYER_ID) {
      if (weapon === 'ST-1') {
        const decoyActive = (missile.irDecoyTime ?? 0) > 0 && missile.irDecoyPosition;
        aim = decoyActive ? missile.irDecoyPosition! : this.player.position;
        targetVelocity = decoyActive ? missile.irDecoyVelocity ?? this.player.velocity : this.player.velocity;
        seekerGuided = true; missile.seekerActive = true; missile.guidancePhase = missile.life < motorBurnTime ? 'BOOST' : 'TERMINAL';
      } else {
        const launchPlatform = this.entities.find((entity) => entity.id === missile.launchPlatformId && entity.active && entity.kind === 'enemy');
        if (!missile.seekerActive && launchPlatform?.sensorContact) {
          missile.inertialAim = { ...this.player.position }; missile.inertialVelocity = { ...this.player.velocity }; missile.datalinkAge = 0;
        } else if (!missile.seekerActive) {
          coastInertial(); missile.datalinkAge = (missile.datalinkAge ?? 0) + dt;
        }
        const predicted = missile.inertialAim ?? this.player.position;
        if (!missile.seekerActive && missile.life > 1.15 && distance(missile.position, predicted) < 9_000) missile.seekerActive = true;
        if (missile.seekerActive) {
          aim = this.player.position; targetVelocity = this.player.velocity; seekerGuided = true; missile.guidancePhase = 'TERMINAL';
        } else {
          aim = predicted; targetVelocity = missile.inertialVelocity ?? this.player.velocity;
          missile.guidancePhase = missile.life < motorBurnTime ? 'BOOST' : (missile.datalinkAge ?? 0) > 1.2 ? 'COAST' : 'MIDCOURSE';
        }
      }
    }
    if (aim) {
      const dx = aim.x - missile.position.x;
      const dy = aim.y - missile.position.y;
      const dz = aim.z - missile.position.z;
      const range = Math.hypot(dx, dy, dz);
      const los = { x: dx / Math.max(1, range), y: dy / Math.max(1, range), z: dz / Math.max(1, range) };
      const targetSpeed = Math.max(1, length3(targetVelocity.x, targetVelocity.y, targetVelocity.z));
      const targetRadial = Math.abs(dot(targetVelocity, los));
      const beamAspect = targetRadial / targetSpeed;
      const relativeVelocity = {
        x: targetVelocity.x - missile.velocity.x,
        y: targetVelocity.y - missile.velocity.y,
        z: targetVelocity.z - missile.velocity.z,
      };
      const relativeRadial = dot(relativeVelocity, los);
      const transverseSpeed = Math.sqrt(Math.max(0, dot(relativeVelocity, relativeVelocity) - relativeRadial * relativeRadial));
      const lineOfSightRate = transverseSpeed / Math.max(180, range);
      const targetClearance = aim.y - terrainHeight(aim.x, aim.z);
      const lookDown = clamp((missile.position.y - aim.y + 350) / Math.max(900, range) * 3.2, 0, 1);
      const surfaceReturn = clamp((1350 - targetClearance) / 1350, 0, 1);
      const groundBackground = clamp(surfaceReturn * .72 + lookDown * .28, 0, 1);
      if (weapon === 'ST-1') {
        const decoyActive = (missile.irDecoyTime ?? 0) > 0 && missile.irDecoyPosition === aim;
        if (decoyActive) infraredContrast = .28 + clamp((missile.irDecoyTime ?? 0) / 1.75, 0, 1) * .96;
        else {
          const targetHeatBoost = missile.team === 2
            ? this.afterburnerSpool * .56 + this.damage.engine * .22
            : (() => {
                const target = this.entities.find((entity) => entity.id === missile.targetId && entity.active && entity.kind === 'enemy');
                const engineDamage = target?.damage?.engine ?? 0;
                return clamp((length3(targetVelocity.x, targetVelocity.y, targetVelocity.z) - 190) / 420, 0, .28) + engineDamage * .24;
              })();
          const infrared = this.evaluateInfrared(missile.position, missile.heading, missile.pitch, aim, targetVelocity, targetHeatBoost);
          infraredContrast = infrared.contrast;
        }
        missile.irSignal = clamp(infraredContrast, 0, 1.35);
      }
      const radarSeeker = weapon !== 'ST-1' && seekerGuided;
      const beamNotch = radarSeeker ? clamp((.34 - beamAspect) / .34, 0, 1) * (.34 + groundBackground * .86) : 0;
      const crossingStress = clamp((lineOfSightRate - .012) / .052, 0, 1);
      const clutterPenalty = radarSeeker ? groundBackground * (.38 + beamNotch * .62) : 0;
      const evasionStrength = clamp(beamNotch + crossingStress * (radarSeeker ? .52 : .34) + clutterPenalty * .46, 0, 1.6);
      if (beamNotch > .25 && crossingStress > .18 || clutterPenalty > .62) missile.notchTime = Math.min(2, (missile.notchTime ?? 0) + dt);
      missile.notched = (missile.notchTime ?? 0) > .12;
      const leadTime = clamp(range / Math.max(420, length3(missile.velocity.x, missile.velocity.y, missile.velocity.z)) * .72, 0, 3.2);
      const lead = { x: aim.x + targetVelocity.x * leadTime, y: aim.y + targetVelocity.y * leadTime, z: aim.z + targetVelocity.z * leadTime };
      const desiredHeading = Math.atan2(lead.x - missile.position.x, lead.z - missile.position.z);
      const desiredPitch = Math.atan2(lead.y - missile.position.y, Math.hypot(lead.x - missile.position.x, lead.z - missile.position.z));
      const angleError = Math.hypot(wrapAngle(desiredHeading - missile.heading), wrapAngle(desiredPitch - missile.pitch));
      const seekerFov = weapon === 'ST-1' ? 1.05 : weapon === 'ST-1X' ? .32 : .52;
      const clutterFlicker = Math.sin(missile.life * 18.7 + missile.id * .73) * .5 + .5;
      const clutterBlanked = radarSeeker && groundBackground > .58 && clutterFlicker > 1.04 - groundBackground * .46;
      const seekerContact = seekerGuided && angleError < seekerFov && hasTerrainLos(missile.position, aim) && !clutterBlanked && (weapon !== 'ST-1' || infraredContrast > .14);
      if (seekerGuided) {
        const seekerGain = weapon === 'ST-1' ? .1 + clamp(infraredContrast, 0, 1) * .46 : .32;
        const irPenalty = weapon === 'ST-1' ? clamp((.32 - infraredContrast) * 1.4, 0, .5) : 0;
        missile.lockQuality = clamp((missile.lockQuality ?? .72) + dt * (seekerContact ? seekerGain - evasionStrength * (weapon === 'ST-1' ? .38 : 1.08) - clutterPenalty * .58 - irPenalty : -.78 - clutterPenalty * .35), 0, 1);
        missile.lostTime = seekerContact
          ? Math.max(0, (missile.lostTime ?? 0) - dt * (.78 - evasionStrength * 1.16 - clutterPenalty * .72))
          : (missile.lostTime ?? 0) + dt * (1 + clutterPenalty * .55);
      } else if (weapon === 'ST-1X') {
        missile.lockQuality = clamp((missile.lockQuality ?? .72) - dt * 1.15, 0, 1);
        missile.lostTime = (missile.lostTime ?? 0) + dt * 1.45;
      } else {
        const stale = clamp(((missile.datalinkAge ?? 0) - 1.2) / 4.5, 0, 1);
        missile.lockQuality = clamp((missile.lockQuality ?? .72) - dt * stale * .18, 0, 1);
      }
      const lostLimit = weapon === 'ST-1AX' ? 1.65 : weapon === 'ST-1X' ? .72 : .9;
      const terminalLost = seekerGuided && ((missile.lostTime ?? 0) > lostLimit || (missile.lockQuality ?? 0) < .035);
      const supportLost = weapon === 'ST-1X' && !sarhSupported && (missile.lostTime ?? 0) > lostLimit;
      const inertialExpired = weapon === 'ST-1AX' && !missile.seekerActive && (missile.datalinkAge ?? 0) > 6.5;
      if (terminalLost || supportLost || inertialExpired) {
        missile.targetId = null;
        missile.guidancePhase = 'LOST';
        if (missile.team === 1) this.message = `${weapon} LOST LOCK`;
        else if ((missile.notchTime ?? 0) > .1) this.message = 'MISSILE NOTCHED // 3-9 LINE';
      } else {
        const baseAuthority = seekerGuided ? weapon === 'ST-1' ? 3.05 : weapon === 'ST-1AX' ? 1.72 : 1.38 : .82;
        const authority = baseAuthority * (.28 + (missile.lockQuality ?? .5) * .72) * (1 - clamp(evasionStrength * .42, 0, .58));
        missile.heading += clamp(wrapAngle(desiredHeading - missile.heading), -authority * dt, authority * dt);
        missile.pitch += clamp(wrapAngle(desiredPitch - missile.pitch), -authority * dt, authority * dt);
      }
    }
    const motorBurning = missile.life < motorBurnTime;
    const burnFraction = missile.life / motorBurnTime;
    const axialAcceleration = motorBurning ? burnFraction < .3 ? 155 : 72 : -14;
    const speed = clamp(length3(missile.velocity.x, missile.velocity.y, missile.velocity.z) + axialAcceleration * dt, 280, 980);
    const dir = forward(missile.heading, missile.pitch);
    missile.velocity = { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed };
    missile.position.x += missile.velocity.x * dt;
    missile.position.y += missile.velocity.y * dt;
    missile.position.z += missile.velocity.z * dt;
    if (motorBurning && Math.floor(missile.life * 7) !== Math.floor((missile.life - dt) * 7)) this.spawnSmoke(missile);
    if (missile.team === 1 && missile.targetId !== null) {
      const target = this.entities.find((item) => item.id === missile.targetId && item.active);
      if (target) {
        const miss = segmentDistance(target.position, previous, missile.position);
        const fuseRadius = missile.weapon === 'ST-1' ? 62 : missile.weapon === 'ST-1X' ? 92 : 118;
        const terminalFuse = weapon === 'ST-1' || weapon === 'ST-1X' && sarhSupported || weapon === 'ST-1AX' && missile.seekerActive;
        if (terminalFuse && miss < fuseRadius && (missile.lockQuality ?? 0) > .16) {
          this.applyEnemyDamage(target, missile.position, clamp(148 * (1 - miss / (fuseRadius * 1.18)), 28, 135), 'MISSILE');
          missile.active = false; this.spawnBlast(missile.position, .85);
        }
      }
    } else if (missile.team === 2 && missile.targetId === PLAYER_ID) {
      const miss = segmentDistance(this.player.position, previous, missile.position);
      const fuseRadius = 112;
      if (missile.seekerActive && miss < fuseRadius && (missile.lockQuality ?? 0) > .14) {
        const damage = miss < 24 ? 112 : clamp(92 * (1 - miss / (fuseRadius * 1.2)), 24, 84);
        this.applyPlayerDamage(damage);
        missile.active = false; this.spawnBlast(missile.position, .9); this.message = miss < 34 ? 'MISSILE IMPACT' : 'PROXIMITY HIT';
      }
    }
    if (missile.active && (missile.position.y < terrainHeight(missile.position.x, missile.position.z) + 5 || collidesBuilding(missile.position, 5))) {
      missile.active = false; this.spawnBlast(missile.position, .72);
    }
  }

  private updateTracer(tracer: Entity, dt: number) {
    const previous = { ...tracer.position };
    tracer.velocity.y -= 9.81 * dt;
    tracer.position.x += tracer.velocity.x * dt;
    tracer.position.y += tracer.velocity.y * dt;
    tracer.position.z += tracer.velocity.z * dt;
    for (const enemy of this.entities) {
      if (!enemy.active || enemy.kind !== 'enemy') continue;
      const d = distance(tracer.position, enemy.position);
      const prev = distance(previous, enemy.position);
      if (Math.min(d, prev) < 34) {
        this.applyEnemyDamage(enemy, d < prev ? tracer.position : previous, 100, 'GUN');
        tracer.active = false;
        break;
      }
    }
    if (tracer.position.y < terrainHeight(tracer.position.x, tracer.position.z) || collidesBuilding(tracer.position, 1)) tracer.active = false;
  }

  private updateSmoke(smoke: Entity, dt: number) {
    smoke.velocity.x *= Math.exp(-dt * 1.35); smoke.velocity.z *= Math.exp(-dt * 1.35);
    smoke.velocity.y += dt * 3.8;
    smoke.position.x += smoke.velocity.x * dt; smoke.position.y += smoke.velocity.y * dt; smoke.position.z += smoke.velocity.z * dt;
  }

  private updateSensors(dt: number) {
    const config = AIRCRAFT[this.aircraftId];
    const designatedTrack = this.tracks.find((track) => track.entityId === this.targetId && track.state !== 'LOST');
    const lockBearing = designatedTrack
      ? wrapAngle(Math.atan2(designatedTrack.position.x - this.player.position.x, designatedTrack.position.z - this.player.position.z) - this.player.heading)
      : 0;
    const lockElevation = designatedTrack
      ? wrapAngle(Math.atan2(designatedTrack.position.y - this.player.position.y, Math.hypot(designatedTrack.position.x - this.player.position.x, designatedTrack.position.z - this.player.position.z)) - this.player.pitch)
      : 0;
    const hmdBearing = this.commandX * .76;
    const hmdElevation = -this.commandY * .54;
    const sweepRate = this.radarMode === 'HMD' ? 5.2 : this.radarMode === 'ACM' ? 3.1 : this.radarMode === 'TWS' ? 1.65 : .82;
    const scanCenter = this.radarMode === 'HMD' ? hmdBearing : this.radarMode === 'STT' || this.radarMode === 'TWS' && designatedTrack ? clamp(lockBearing, -.7, .7) : 0;
    const scanHalfWidth = this.radarMode === 'STT' ? 0 : this.radarMode === 'HMD' ? .055 : this.radarMode === 'ACM' ? .13 : this.radarMode === 'TWS' && designatedTrack ? .35 : this.radarMode === 'TWS' ? .72 : 1.05;
    const antennaBearing = this.radarMode === 'STT' ? scanCenter : scanCenter + Math.sin(this.elapsed * sweepRate) * scanHalfWidth;
    this.radarSweep = clamp(antennaBearing / .7, -1, 1);
    let frameClutter = 0;
    for (const track of this.tracks) {
      track.age += dt;
      const maintained = this.radarMode === 'TWS' && this.twsTargetIds.includes(track.entityId) || this.radarMode === 'STT' && track.entityId === this.targetId;
      track.quality -= dt * (track.state === 'TRACK' ? maintained ? this.radarMode === 'STT' ? .012 : .035 : .08 : maintained ? .17 : .34);
    }
    for (const enemy of this.entities) {
      if (!enemy.active || enemy.kind !== 'enemy' || enemy.fatal) continue;
      const dx = enemy.position.x - this.player.position.x;
      const dy = enemy.position.y - this.player.position.y;
      const dz = enemy.position.z - this.player.position.z;
      const range = Math.hypot(dx, dy, dz);
      const bearing = wrapAngle(Math.atan2(dx, dz) - this.player.heading);
      const elevation = wrapAngle(Math.atan2(dy, Math.hypot(dx, dz)) - this.player.pitch);
      const inBeam = this.radarMode === 'STT'
        ? enemy.id === this.targetId && Math.abs(wrapAngle(bearing - lockBearing)) < .07 && Math.abs(wrapAngle(elevation - lockElevation)) < .065
        : Math.abs(wrapAngle(bearing - antennaBearing)) < (this.radarMode === 'HMD' ? .1 : this.radarMode === 'ACM' ? .085 : .13)
          && Math.abs(wrapAngle(elevation - (this.radarMode === 'HMD' ? hmdElevation : 0))) < (this.radarMode === 'HMD' ? .11 : this.radarMode === 'ACM' ? .2 : .48);
      const targetClearance = enemy.position.y - terrainHeight(enemy.position.x, enemy.position.z);
      const radialVelocity = ((enemy.velocity.x - this.player.velocity.x) * dx + (enemy.velocity.y - this.player.velocity.y) * dy + (enemy.velocity.z - this.player.velocity.z) * dz) / Math.max(1, range);
      const lookDown = clamp((this.player.position.y - enemy.position.y) / Math.max(600, range) * 2.4, 0, 1);
      const surfaceReturn = clamp((850 - targetClearance) / 850, 0, 1);
      const dopplerNotch = clamp(1 - Math.abs(radialVelocity) / 155, 0, 1);
      const clutter = clamp(lookDown * .56 + surfaceReturn * .28 + lookDown * dopplerNotch * .42, 0, 1);
      if (inBeam) frameClutter = Math.max(frameClutter, clutter);
      const effectiveRange = config.radarRange * (1 - clutter * .52) * (1 - this.damage.radar * .72);
      const detected = inBeam && range < effectiveRange && hasTerrainLos(this.player.position, enemy.position);
      let track = this.tracks.find((item) => item.entityId === enemy.id);
      if (detected) {
        const trackPrecision = this.radarMode === 'STT' ? .18 : this.radarMode === 'HMD' ? .28 : this.radarMode === 'ACM' ? .35 : this.radarMode === 'TWS' && designatedTrack ? .62 : 1;
        const noise = Math.max(18, range * 0.008) * trackPrecision * (1 + clutter * 3.4);
        const measured = {
          x: enemy.position.x + (this.random() - 0.5) * noise,
          y: enemy.position.y + (this.random() - 0.5) * noise * 0.5,
          z: enemy.position.z + (this.random() - 0.5) * noise,
        };
        if (!track) {
          track = { id: 20 + this.tracks.length, entityId: enemy.id, position: measured, velocity: { ...enemy.velocity }, quality: 0.26, uncertainty: noise, age: 0, state: 'TRACK', source: 'RADAR', designated: false };
          this.tracks.push(track);
        } else {
          track.position = measured; track.velocity = { ...enemy.velocity }; track.quality = clamp(track.quality + 0.12 * (1 - clutter * .72), 0, 1);
          track.uncertainty = noise * (1.2 - track.quality); track.age = 0; track.state = 'TRACK';
        }
      } else if (track) {
        track.position.x += track.velocity.x * dt;
        track.position.y += track.velocity.y * dt;
        track.position.z += track.velocity.z * dt;
        track.state = track.quality > 0.08 ? 'COAST' : 'LOST';
      }
    }
    this.radarClutter += (frameClutter - this.radarClutter) * clamp(dt * 6, 0, 1);
    for (let index = this.tracks.length - 1; index >= 0; index -= 1) {
      if (this.tracks[index].age > 8 || this.tracks[index].quality <= 0) {
        if (this.targetId === this.tracks[index].entityId) this.targetId = null;
        this.tracks.splice(index, 1);
      }
    }
    if (this.radarMode === 'STT' && (this.targetId === null || !this.tracks.some((track) => track.entityId === this.targetId && track.state !== 'LOST'))) {
      this.targetId = null;
      this.radarMode = this.acquisitionRadarMode;
      this.message = `STT BREAK LOCK // ${this.radarMode} SEARCH`;
    }
    if (this.radarMode === 'TWS') {
      const validTracks = this.tracks
        .filter((track) => track.state !== 'LOST' && track.source === 'RADAR' && track.quality > .08)
        .sort((a, b) => b.quality - a.quality);
      const validIds = new Set(validTracks.map((track) => track.entityId));
      this.twsTargetIds = this.twsTargetIds.filter((id) => validIds.has(id));
      for (const track of validTracks) {
        if (!this.twsTargetIds.includes(track.entityId)) this.twsTargetIds.push(track.entityId);
        if (this.twsTargetIds.length >= 4) break;
      }
      if (this.targetId !== null && !this.twsTargetIds.includes(this.targetId)) this.targetId = null;
      if (this.targetId === null && this.twsTargetIds.length) this.targetId = this.twsTargetIds[0];
      this.tracks.forEach((track) => { track.designated = track.entityId === this.targetId; });
    } else this.twsTargetIds = [];
    this.updateRwr(dt);
  }

  private updateRwr(dt: number) {
    for (const contact of this.rwr) contact.age += dt;
    for (const enemy of this.entities) {
      if (!enemy.active || enemy.kind !== 'enemy' || !enemy.sensorContact) continue;
      const range = distance(enemy.position, this.player.position);
      const los = hasTerrainLos(enemy.position, this.player.position);
      if (range > 42_000 || !los || Math.sin(this.elapsed * 1.8 + enemy.id) < 0.45) continue;
      const bearing = wrapAngle(Math.atan2(enemy.position.x - this.player.position.x, enemy.position.z - this.player.position.z) - this.player.heading);
      const enemyMissile = this.entities.some((item) => item.active && item.kind === 'missile' && item.team === 2);
      const threat: RwrContact['threat'] = enemyMissile ? 'MISSILE' : range < 11_000 ? 'LOCK' : range < 24_000 ? 'TRACK' : 'SEARCH';
      let contact = this.rwr.find((item) => item.entityId === enemy.id);
      if (!contact) { contact = { entityId: enemy.id, bearing, threat, age: 0 }; this.rwr.push(contact); }
      else { contact.bearing = bearing; contact.threat = threat; contact.age = 0; }
    }
    for (let index = this.rwr.length - 1; index >= 0; index -= 1) if (this.rwr[index].age > 2.5) this.rwr.splice(index, 1);
  }

  private updateAi(dt: number) {
    const reaction = this.difficulty === 'ACE' ? 0.95 : this.difficulty === 'ROOKIE' ? 0.42 : 0.7;
    for (const enemy of this.entities) {
      if (!enemy.active || enemy.kind !== 'enemy' || enemy.fatal) continue;
      const range = distance(enemy.position, this.player.position);
      const dxRaw = this.player.position.x - enemy.position.x;
      const dzRaw = this.player.position.z - enemy.position.z;
      const bearingError = wrapAngle(Math.atan2(dxRaw, dzRaw) - enemy.heading);
      const playerClearance = this.player.position.y - terrainHeight(this.player.position.x, this.player.position.z);
      const lookDown = clamp((enemy.position.y - this.player.position.y) / Math.max(800, range), 0, 1);
      const groundClutter = lookDown * clamp((900 - playerClearance) / 900, 0, 1);
      const radarReturn = this.flightState !== 'CRASHED'
        && Math.abs(bearingError) < .68
        && range < 34_000 * reaction * (1 - groundClutter * .5)
        && hasTerrainLos(enemy.position, this.player.position);
      enemy.sensorAge = radarReturn ? Math.min(8, (enemy.sensorAge ?? 0) + dt) : Math.max(0, (enemy.sensorAge ?? 0) - dt * 1.8);
      const sensorTrack = enemy.sensorAge > .65;
      enemy.sensorContact = sensorTrack;
      if (sensorTrack) {
        const dx = this.player.position.x - enemy.position.x + (this.random() - 0.5) * 180 * (1 - reaction);
        const dy = this.player.position.y - enemy.position.y;
        const dz = this.player.position.z - enemy.position.z + (this.random() - 0.5) * 180 * (1 - reaction);
        const desiredHeading = Math.atan2(dx, dz);
        const desiredPitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.35, 0.45);
        const headingError = wrapAngle(desiredHeading - enemy.heading);
        enemy.heading += clamp(headingError, -dt * reaction, dt * reaction);
        enemy.pitch += clamp(desiredPitch - enemy.pitch, -dt * 0.48, dt * 0.48);
        const desiredRoll = clamp(-headingError * 1.8, -1.18, 1.18);
        enemy.roll += wrapAngle(desiredRoll - enemy.roll) * clamp(dt * 3.2, 0, 1);
        if (enemy.sensorAge > 2.2 && range < 16_000 && this.missileClock > (this.difficulty === 'ACE' ? 9 : 14) && this.random() > 0.78) {
          this.spawnEnemyMissile(enemy, range); this.missileClock = 0;
        }
      } else {
        enemy.heading = wrapAngle(enemy.heading + Math.sin(this.elapsed * 0.12 + enemy.id) * dt * 0.04);
        enemy.pitch += (0 - enemy.pitch) * clamp(dt * .55, 0, 1);
        enemy.roll += (0 - enemy.roll) * clamp(dt * .9, 0, 1);
      }
    }
  }

  private fireGun() {
    if (this.ammo.GUN <= 0) { this.message = 'GUN EMPTY'; return; }
    const tracer = this.entities.find((entity) => entity.kind === 'tracer' && !entity.active);
    if (!tracer) return;
    const dir = forward(this.player.heading + (this.random() - 0.5) * 0.004, this.player.pitch + (this.random() - 0.5) * 0.004);
    Object.assign(tracer, { active: true, team: 1, health: 1, life: 0, targetId: null, position: { ...this.player.position }, heading: this.player.heading, pitch: this.player.pitch, roll: this.player.roll, velocity: { x: this.player.velocity.x + dir.x * 980, y: this.player.velocity.y + dir.y * 980, z: this.player.velocity.z + dir.z * 980 } });
    this.ammo.GUN -= 1;
  }

  private spawnInitial() { for (let index = 0; index < Math.min(this.enemyCount, 16); index += 1) this.spawnEnemy(index); }

  private spawnEnemy(slot = this.activeEnemies()) {
    const enemy = this.entities.find((entity) => entity.kind === 'enemy' && !entity.active);
    if (!enemy) return;
    const angle = slot === 0 ? 0 : (slot / Math.max(1, this.enemyCount - 1)) * Math.PI * 1.2 - 0.6;
    const range = 20_000 + (slot % 4) * 7500;
    const x = Math.sin(angle) * range;
    const z = this.player.position.z + Math.cos(angle) * range;
    const y = Math.max(terrainHeight(x, z) + 1100, 3600 + (slot % 3) * 1450);
    const enemySpeed = 205 + (slot % 3) * 18;
    Object.assign(enemy, {
      active: true, health: 100, life: 0, team: 2, targetId: null, sensorContact: false, sensorAge: 0,
      fatal: false, fatalTime: 0, lastHitPart: undefined,
      damage: { fuselage: 0, engine: 0, controls: 0, leftWing: 0, rightWing: 0, tail: 0 },
      position: { x, y, z }, heading: wrapAngle(angle + Math.PI), pitch: 0, roll: 0,
      velocity: { x: -Math.sin(angle) * enemySpeed, y: 0, z: -Math.cos(angle) * enemySpeed },
    });
  }

  private spawnEnemyMissile(enemy: Entity, range: number) {
    const missile = this.entities.find((entity) => entity.kind === 'missile' && !entity.active);
    if (!missile) return;
    const dir = forward(enemy.heading, enemy.pitch);
    const weapon: WeaponId = range < 7_200 ? 'ST-1' : 'ST-1AX';
    const motorBurnTime = weapon === 'ST-1' ? 2.8 : 5.2;
    Object.assign(missile, {
      active: true, team: 2, health: 1, life: 0, targetId: PLAYER_ID, weapon, lockQuality: .78, lostTime: 0,
      guidancePhase: 'BOOST', motorBurnTime, seekerActive: weapon === 'ST-1', datalinkAge: 0, launchPlatformId: enemy.id,
      irDecoyPosition: undefined, irDecoyVelocity: undefined, irDecoyTime: 0, irSignal: weapon === 'ST-1' ? .72 : undefined,
      inertialAim: { ...this.player.position }, inertialVelocity: { ...this.player.velocity },
      position: { ...enemy.position }, heading: enemy.heading, pitch: enemy.pitch, roll: enemy.roll,
      velocity: { x: dir.x * 560, y: dir.y * 560, z: dir.z * 560 },
    });
  }

  private activeEnemies() { return this.entities.filter((entity) => entity.active && entity.kind === 'enemy').length; }
  private applyEnemyDamage(enemy: Entity, hit: Vec3, amount: number, source: 'GUN' | 'MISSILE') {
    if (enemy.fatal) return;
    enemy.damage ??= { fuselage: 0, engine: 0, controls: 0, leftWing: 0, rightWing: 0, tail: 0 };
    const basis = bodyBasis(enemy.heading, enemy.pitch, enemy.roll);
    const relative = { x: hit.x - enemy.position.x, y: hit.y - enemy.position.y, z: hit.z - enemy.position.z };
    const lateral = dot(relative, basis.right);
    const longitudinal = dot(relative, basis.nose);
    let part: keyof EnemyDamageState;
    if (Math.abs(lateral) > 5) part = lateral < 0 ? 'leftWing' : 'rightWing';
    else if (longitudinal < -5) part = Math.abs(lateral) < 2.2 ? 'engine' : 'tail';
    else if (longitudinal > 5) part = this.random() > .5 ? 'controls' : 'fuselage';
    else part = this.random() > .42 ? 'fuselage' : 'engine';
    enemy.damage[part] = 1;
    enemy.damage.fuselage = clamp(enemy.damage.fuselage + amount / 155, 0, 1);
    if (source === 'MISSILE') {
      enemy.damage.engine = clamp(enemy.damage.engine + amount / 125, 0, 1);
      const secondary: (keyof EnemyDamageState)[] = ['leftWing', 'rightWing', 'tail', 'controls'];
      enemy.damage[secondary[Math.floor(this.random() * secondary.length)]] = clamp(amount / 100, .45, 1);
    }
    enemy.lastHitPart = part;
    enemy.fatal = true;
    enemy.fatalTime = 0;
    enemy.health = 8;
    enemy.sensorContact = false;
    this.message = `${source} CRITICAL HIT // ${part.toUpperCase()} DESTROYED`;
    this.score += source === 'GUN' ? 250 : 150;
  }
  private applyPlayerDamage(amount: number, preferred?: keyof typeof this.damage) {
    if (this.flightState === 'CRASHED') return;
    this.player.health = Math.max(0, this.player.health - amount * .72);
    this.damage.airframe = clamp(this.damage.airframe + amount / 245 + (amount > 82 ? amount / 205 : 0), 0, 1);
    const parts: (keyof typeof this.damage)[] = ['leftWing', 'rightWing', 'engine', 'controls', 'radar', 'tail'];
    const part = preferred ?? parts[Math.floor(this.random() * parts.length)];
    if (part !== 'airframe') this.damage[part] = clamp(this.damage[part] + amount / 92, 0, 1);
    if (amount > 82 && part !== 'airframe') this.damage[part] = 1;
    if (!preferred && amount > 30) {
      const secondary = parts[Math.floor(this.random() * parts.length)];
      this.damage[secondary] = clamp(this.damage[secondary] + amount / 170, 0, 1);
    }
    this.damage.airframe = Math.max(this.damage.airframe, clamp(1 - this.player.health / 100, 0, 1));
    this.impactSeverity = Math.max(this.impactSeverity, clamp(amount / 96, .32, 1.35));
    this.flightState = 'DAMAGED';
  }

  private spawnSmoke(source: Entity) {
    const smoke = this.entities.find((entity) => entity.kind === 'smoke' && !entity.active);
    if (!smoke) return;
    Object.assign(smoke, {
      active: true, team: source.team, health: 1, life: 0, targetId: null,
      trailLife: source.kind === 'missile' ? 5.2 : 3.4,
      position: { ...source.position }, heading: source.heading, pitch: source.pitch, roll: 0,
      velocity: { x: source.velocity.x * .035 + (this.random() - .5) * 5, y: source.velocity.y * .035 + (this.random() - .5) * 3, z: source.velocity.z * .035 + (this.random() - .5) * 5 },
    });
  }

  private spawnBlast(position: Vec3, scale: number) {
    const blast = this.entities.find((entity) => entity.kind === 'blast' && !entity.active);
    if (!blast) return;
    Object.assign(blast, { active: true, team: 2, health: Math.max(.2, scale), life: 0, targetId: null, position: { ...position }, heading: 0, pitch: 0, roll: 0, velocity: { x: 0, y: 0, z: 0 } });
  }

  private crash(reason: string) {
    if (this.flightState === 'CRASHED') return;
    this.flightState = 'CRASHED';
    this.player.health = 0;
    this.damage.airframe = 1;
    this.explosion = 2.4;
    this.message = `${reason} // AIRFRAME LOST`;
    this.spawnBlast(this.player.position, 1.35);
  }
  private random() { this.noiseSeed = (this.noiseSeed * 1664525 + 1013904223) >>> 0; return this.noiseSeed / 0xffffffff; }
}
