export type Vec3 = { x: number; y: number; z: number };
export type AircraftId = 'aethra' | 'amoria' | 'cecilia';
export type RadarMode = 'SRC' | 'TWS' | 'ACM' | 'HMD' | 'STT';
export type RadarDisplay = 'B-SCOPE' | 'PPI';
export type WeaponId = 'GUN' | 'ST-1' | 'ST-1X' | 'ST-1AX';
export type GuidancePhase = 'BOOST' | 'MIDCOURSE' | 'TERMINAL' | 'COAST' | 'LOST';
export type GamePhase = 'menu' | 'loadout' | 'playing' | 'paused' | 'dead' | 'result';

export type AircraftConfig = {
  id: AircraftId;
  name: string;
  role: string;
  radar: string;
  maxSpeed: number;
  turnRate: number;
  rollRate: number;
  thrust: number;
  radarRange: number;
  stealth: number;
  gunAmmo: number;
  missiles: Record<Exclude<WeaponId, 'GUN'>, number>;
  silhouette: string[];
};

export type EnemyDamageState = {
  fuselage: number;
  engine: number;
  controls: number;
  leftWing: number;
  rightWing: number;
  tail: number;
};

export type Entity = {
  id: number;
  kind: 'enemy' | 'missile' | 'tracer' | 'smoke' | 'blast';
  position: Vec3;
  velocity: Vec3;
  heading: number;
  pitch: number;
  roll: number;
  health: number;
  team: 1 | 2;
  active: boolean;
  life: number;
  targetId: number | null;
  weapon?: WeaponId;
  sensorContact?: boolean;
  sensorAge?: number;
  lockQuality?: number;
  lostTime?: number;
  notched?: boolean;
  notchTime?: number;
  damage?: EnemyDamageState;
  fatal?: boolean;
  fatalTime?: number;
  lastHitPart?: keyof EnemyDamageState;
  guidancePhase?: GuidancePhase;
  motorBurnTime?: number;
  inertialAim?: Vec3;
  inertialVelocity?: Vec3;
  datalinkAge?: number;
  seekerActive?: boolean;
  launchPlatformId?: number;
  trailLife?: number;
  irDecoyPosition?: Vec3;
  irDecoyVelocity?: Vec3;
  irDecoyTime?: number;
  irSignal?: number;
};

export type Track = {
  id: number;
  entityId: number;
  position: Vec3;
  velocity: Vec3;
  quality: number;
  uncertainty: number;
  age: number;
  state: 'TRACK' | 'COAST' | 'LOST';
  source: 'RADAR' | 'DL' | 'FUSED';
  designated: boolean;
};

export type RwrContact = {
  entityId: number;
  bearing: number;
  threat: 'SEARCH' | 'TRACK' | 'LOCK' | 'MISSILE';
  age: number;
};

export type PlayerState = {
  position: Vec3;
  velocity: Vec3;
  heading: number;
  pitch: number;
  roll: number;
  speed: number;
  throttle: number;
  health: number;
  g: number;
  aoa: number;
  energyRate: number;
};

export type DamageState = {
  airframe: number;
  engine: number;
  controls: number;
  radar: number;
  leftWing: number;
  rightWing: number;
  tail: number;
};

export type FlightState = 'FLYING' | 'DAMAGED' | 'UNCONTROLLED' | 'CRASHED';
export type AeroState = 'NORMAL' | 'STALL' | 'SPIN';

export type SimulationSnapshot = {
  player: PlayerState;
  entities: Entity[];
  tracks: Track[];
  rwr: RwrContact[];
  radarMode: RadarMode;
  radarDisplay: RadarDisplay;
  radarSweep: number;
  selectedWeapon: WeaponId;
  ammo: Record<WeaponId, number>;
  score: number;
  kills: number;
  elapsed: number;
  message: string;
  commandX: number;
  commandY: number;
  targetId: number | null;
  twsTargetIds: number[];
  afterburnerActive: boolean;
  afterburnerHeat: number;
  afterburnerThermalLimited: boolean;
  afterburnerOverride: boolean;
  irSeekerQuality: number;
  irSeekerStatus: 'NO TARGET' | 'TRACK' | 'GIMBAL' | 'SUN' | 'BACKGROUND' | 'LOW SIGNAL';
  countermeasures: { flare: number; chaff: number };
  warning: 'PULL UP' | 'TERRAIN' | 'STALL' | null;
  clearance: number;
  damage: DamageState;
  flightState: FlightState;
  explosion: number;
  impactSeverity: number;
  radarClutter: number;
  aeroState: AeroState;
  spinDirection: -1 | 0 | 1;
  spinSeverity: number;
  stallSeverity: number;
  recoveryProgress: number;
  sideslip: number;
};
