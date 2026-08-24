'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AIRCRAFT, WEAPON_COPY } from './data';
import { AsciiWorldRenderer } from './renderer';
import { SimulationCore } from './simulation';
import { StslWebGpuPresenter } from './webgpu';
import type { AircraftId, GamePhase, RadarDisplay, SimulationSnapshot, WeaponId } from './types';

type Difficulty = 'ROOKIE' | 'NORMAL' | 'ACE';

const WEAPON_KEYS: Record<string, WeaponId> = { Digit1: 'GUN', Digit2: 'ST-1', Digit3: 'ST-1X', Digit4: 'ST-1AX' };

export default function AsciiSky() {
  const sourceRef = useRef<HTMLCanvasElement>(null);
  const gpuRef = useRef<HTMLCanvasElement>(null);
  const presenterRef = useRef<StslWebGpuPresenter | null>(null);
  const gpuProbeRef = useRef(false);
  const gpuOperationalRef = useRef(false);
  const rendererRef = useRef<AsciiWorldRenderer | null>(null);
  const simulationRef = useRef<SimulationCore | null>(null);
  const phaseRef = useRef<GamePhase>('menu');
  const commandRef = useRef({ x: 0, y: 0 });
  const freeLookRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  const engineAudioRef = useRef<{ low: OscillatorNode; high: OscillatorNode; filter: BiquadFilterNode; gain: GainNode } | null>(null);
  const lastThreatToneRef = useRef(0);
  const lastWarningToneRef = useRef(0);
  const lastMessageRef = useRef('');
  const lastGunAmmoRef = useRef(0);
  const [phase, setPhaseState] = useState<GamePhase>('menu');
  const [aircraft, setAircraft] = useState<AircraftId>('aethra');
  const [enemyCount, setEnemyCount] = useState(4);
  const [difficulty, setDifficulty] = useState<Difficulty>('NORMAL');
  const [radarDisplay, setRadarDisplay] = useState<RadarDisplay>('B-SCOPE');
  const [infinite, setInfinite] = useState(false);
  const [gpuReady, setGpuReady] = useState(false);
  const [score, setScore] = useState({ kills: 0, points: 0, time: 0 });
  const [weapon, setWeapon] = useState<WeaponId>('GUN');
  const [options, setOptions] = useState({ instructor: true, masking: true, clutter: true, countermeasures: true, damage: true, rwr: true });

  const setPhase = useCallback((next: GamePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
    if (next !== 'playing' && document.pointerLockElement) document.exitPointerLock();
  }, []);

  const tone = useCallback((frequency: number, duration = 0.08, type: OscillatorType = 'square') => {
    try {
      const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;
      const context = audioRef.current ?? new AudioCtor();
      audioRef.current = context;
      if (context.state === 'suspended') void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.055, context.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
      oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + duration + 0.02);
    } catch { /* Audio remains optional until a user gesture unlocks it. */ }
  }, []);

  const updateEngineAudio = useCallback((snapshot: SimulationSnapshot, playing: boolean) => {
    const context = audioRef.current;
    if (!context) return;
    if (!engineAudioRef.current) {
      const low = context.createOscillator(); const high = context.createOscillator(); const filter = context.createBiquadFilter(); const gain = context.createGain();
      low.type = 'triangle'; high.type = 'sine'; filter.type = 'lowpass'; low.connect(filter); high.connect(filter); filter.connect(gain); gain.connect(context.destination);
      gain.gain.value = .0001; low.start(); high.start(); engineAudioRef.current = { low, high, filter, gain };
    }
    const engine = engineAudioRef.current; const now = context.currentTime;
    const health = 1 - snapshot.damage.engine;
    const base = 54 + snapshot.player.throttle * 40 + snapshot.player.speed * .022;
    engine.low.frequency.setTargetAtTime(base * (.84 + health * .16), now, .08);
    engine.high.frequency.setTargetAtTime(base * 1.98, now, .08);
    engine.filter.frequency.setTargetAtTime(360 + snapshot.player.throttle * 530, now, .12);
    const sputter = snapshot.damage.engine > .38 ? .72 + Math.sin(snapshot.elapsed * 31) * .22 : 1;
    engine.gain.gain.setTargetAtTime(playing ? (.004 + snapshot.player.throttle * .008) * Math.max(.18, health) * sputter : .0001, now, .08);
  }, []);

  const lockTone = useCallback((locked: boolean, cycling = false) => {
    if (!locked) { tone(190, .09, 'square'); return; }
    if (cycling) {
      tone(680, .045, 'square');
      window.setTimeout(() => tone(820, .055, 'sine'), 58);
      return;
    }
    tone(520, .045, 'square');
    window.setTimeout(() => tone(760, .055, 'sine'), 62);
    window.setTimeout(() => tone(1040, .08, 'sine'), 132);
  }, [tone]);

  const requestPlay = useCallback(() => {
    const canvas = gpuReady ? gpuRef.current : sourceRef.current;
    if (!canvas) return;
    const pointerLock = canvas.requestPointerLock?.();
    if (pointerLock && typeof pointerLock.catch === 'function') pointerLock.catch(() => { /* Browser QA and embedded views may deny pointer lock. */ });
    setPhaseState('playing');
    phaseRef.current = 'playing';
    tone(720, 0.07);
  }, [gpuReady, tone]);

  const startMission = useCallback(() => {
    simulationRef.current = new SimulationCore(aircraft, enemyCount, difficulty, infinite, radarDisplay);
    setWeapon('GUN');
    commandRef.current = { x: 0, y: 0 };
    requestPlay();
  }, [aircraft, difficulty, enemyCount, infinite, radarDisplay, requestPlay]);

  const restart = useCallback(() => {
    simulationRef.current = new SimulationCore(aircraft, enemyCount, difficulty, infinite, radarDisplay);
    setWeapon('GUN');
    commandRef.current = { x: 0, y: 0 };
    requestPlay();
  }, [aircraft, difficulty, enemyCount, infinite, radarDisplay, requestPlay]);

  useEffect(() => {
    const source = sourceRef.current;
    const gpu = gpuRef.current;
    if (!source || !gpu) return;
    simulationRef.current ??= new SimulationCore('aethra', 4, 'NORMAL');
    rendererRef.current = new AsciiWorldRenderer(source);
    let cancelled = false;
    StslWebGpuPresenter.create(gpu).then((presenter) => {
      if (cancelled || !presenter) return;
      presenterRef.current = presenter;
    }).catch(() => {
      presenterRef.current = null;
      gpuOperationalRef.current = false;
      setGpuReady(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let raf = 0;
    let previous = performance.now();
    let uiClock = 0;
    const frame = (now: number) => {
      const dt = Math.min((now - previous) / 1000, 0.1);
      previous = now;
      const simulation = simulationRef.current;
      if (simulation && phaseRef.current === 'playing') simulation.stepFrame(dt);
      if (simulation && rendererRef.current && sourceRef.current) {
        const snapshot = simulation.getSnapshot();
        if (phaseRef.current === 'playing' && snapshot.rwr.some((contact) => contact.threat === 'MISSILE') && now - lastThreatToneRef.current > 720) {
          tone(1480, .07, 'square');
          window.setTimeout(() => tone(740, .09, 'square'), 90);
          lastThreatToneRef.current = now;
        }
        if (phaseRef.current === 'playing' && snapshot.aeroState !== 'NORMAL' && now - lastWarningToneRef.current > (snapshot.aeroState === 'SPIN' ? 420 : 650)) {
          tone(snapshot.aeroState === 'SPIN' ? 330 : 210, snapshot.aeroState === 'SPIN' ? .16 : .1, 'sawtooth');
          lastWarningToneRef.current = now;
        } else if (phaseRef.current === 'playing' && snapshot.warning && now - lastWarningToneRef.current > 850) {
          tone(snapshot.warning === 'PULL UP' ? 980 : 610, .1, 'square'); lastWarningToneRef.current = now;
        } else if (phaseRef.current === 'playing' && snapshot.afterburnerThermalLimited && now - lastWarningToneRef.current > 1100) {
          tone(snapshot.afterburnerOverride ? 1180 : 470, .12, snapshot.afterburnerOverride ? 'square' : 'sawtooth'); lastWarningToneRef.current = now;
        }
        if (snapshot.message !== lastMessageRef.current && /IMPACT|HIT|LOST LOCK|OVERHEAT/.test(snapshot.message)) {
          tone(/IMPACT|HIT/.test(snapshot.message) ? 82 : /OVERHEAT/.test(snapshot.message) ? 1140 : 240, /IMPACT|HIT/.test(snapshot.message) ? .28 : .12, 'sawtooth');
          if (/MISSILE IMPACT|PROXIMITY HIT/.test(snapshot.message)) {
            window.setTimeout(() => tone(46, .42, 'triangle'), 36);
            window.setTimeout(() => tone(128, .18, 'square'), 92);
          }
        }
        lastMessageRef.current = snapshot.message;
        if (snapshot.ammo.GUN < lastGunAmmoRef.current && snapshot.ammo.GUN % 3 === 0) tone(72 + (snapshot.ammo.GUN % 4) * 9, .045, 'square');
        lastGunAmmoRef.current = snapshot.ammo.GUN;
        updateEngineAudio(snapshot, phaseRef.current === 'playing');
        rendererRef.current.render(snapshot);
        const presenter = presenterRef.current;
        if (presenter && gpuOperationalRef.current) {
          try {
            presenter.present(sourceRef.current);
          } catch {
            presenterRef.current = null;
            gpuOperationalRef.current = false;
            setGpuReady(false);
          }
        } else if (presenter && !gpuProbeRef.current) {
          gpuProbeRef.current = true;
          presenter.validateAndPresent(sourceRef.current).then(() => {
            gpuOperationalRef.current = true;
            setGpuReady(true);
          }).catch(() => {
            presenterRef.current = null;
            gpuOperationalRef.current = false;
            setGpuReady(false);
          });
        }
        uiClock += dt;
        if (uiClock > 0.25) {
          setScore({ kills: snapshot.kills, points: snapshot.score, time: snapshot.elapsed });
          if (snapshot.flightState === 'CRASHED' && snapshot.explosion < .22 && phaseRef.current === 'playing') setPhase('dead');
          const enemies = snapshot.entities.filter((entity) => entity.kind === 'enemy').length;
          if (!infinite && enemies === 0 && snapshot.elapsed > 2 && phaseRef.current === 'playing') setPhase('result');
          uiClock = 0;
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [infinite, setPhase, tone, updateEngineAudio]);

  useEffect(() => () => {
    const engine = engineAudioRef.current;
    if (engine) { engine.gain.disconnect(); engine.low.stop(); engine.high.stop(); engineAudioRef.current = null; }
    void audioRef.current?.close();
  }, []);

  useEffect(() => {
    const pointerChange = () => {
      const locked = document.pointerLockElement === sourceRef.current || document.pointerLockElement === gpuRef.current;
      if (locked) { phaseRef.current = 'playing'; setPhaseState('playing'); }
      else if (phaseRef.current === 'playing') { phaseRef.current = 'paused'; setPhaseState('paused'); }
    };
    const keyDown = (event: KeyboardEvent) => {
      if (phaseRef.current !== 'playing') return;
      const simulation = simulationRef.current;
      if (!simulation) return;
      if (event.code in WEAPON_KEYS) { simulation.selectWeapon(WEAPON_KEYS[event.code]); setWeapon(WEAPON_KEYS[event.code]); tone(540 + Number(event.code.slice(-1)) * 80, 0.045); }
      else if (event.code === 'KeyV') {
        const order: WeaponId[] = ['GUN', 'ST-1', 'ST-1X', 'ST-1AX'];
        const next = order[(order.indexOf(simulation.selectedWeapon) + 1) % order.length];
        simulation.selectWeapon(next); setWeapon(next); tone(620, 0.045);
      }
      else if (event.code === 'KeyR') { simulation.cycleRadar(); tone(880, 0.04); }
      else if (event.code === 'KeyT') { const cycling = simulation.radarMode === 'TWS' && simulation.targetId !== null; lockTone(simulation.designate(), cycling); }
      else if (event.code === 'KeyX') { simulation.undesignate(); tone(310, .06); }
      else if (event.code === 'KeyZ') { commandRef.current = { x: 0, y: 0 }; simulation.setCommand(0, 0); tone(760, .04); }
      else if (event.code === 'Space') { event.preventDefault(); if (simulation.releaseMissile()) tone(95, 0.34, 'sawtooth'); else tone(180, 0.08, 'square'); }
      else if (event.code === 'KeyF') { simulation.countermeasure('FLARE'); tone(1240, 0.05); }
      else if (event.code === 'KeyG') { simulation.countermeasure('CHAFF'); tone(920, 0.05); }
      else if (event.code === 'KeyC') freeLookRef.current = true;
      else if (event.code === 'KeyH') { lockTone(simulation.cueHmd()); }
      simulation.key(event.code, true);
    };
    const keyUp = (event: KeyboardEvent) => { if (event.code === 'KeyC') freeLookRef.current = false; simulationRef.current?.key(event.code, false); };
    const mouseMove = (event: MouseEvent) => {
      if (phaseRef.current !== 'playing' || !document.pointerLockElement || event.buttons === 2 || freeLookRef.current) return;
      const next = commandRef.current;
      next.x += event.movementX / Math.max(240, window.innerWidth * 0.34);
      next.y += event.movementY / Math.max(190, window.innerHeight * 0.29);
      const length = Math.hypot(next.x, next.y);
      if (length > 1) { next.x /= length; next.y /= length; }
      simulationRef.current?.setCommand(next.x, next.y);
    };
    const mouseDown = (event: MouseEvent) => {
      if (event.button === 0 && phaseRef.current === 'playing') { simulationRef.current?.setTrigger(true); tone(66, 0.12, 'sawtooth'); }
      if (event.button === 2 && phaseRef.current === 'playing') {
        const simulation = simulationRef.current;
        if (simulation) { const cycling = simulation.radarMode === 'TWS' && simulation.targetId !== null; lockTone(simulation.designate(), cycling); }
      }
      if (event.button === 1 && phaseRef.current === 'playing') {
        const simulation = simulationRef.current;
        if (simulation) {
          const order: WeaponId[] = ['GUN', 'ST-1', 'ST-1X', 'ST-1AX'];
          const next = order[(order.indexOf(simulation.selectedWeapon) + 1) % order.length];
          simulation.selectWeapon(next); setWeapon(next);
        }
      }
    };
    const mouseUp = (event: MouseEvent) => { if (event.button === 0) simulationRef.current?.setTrigger(false); };
    const context = (event: MouseEvent) => event.preventDefault();
    document.addEventListener('pointerlockchange', pointerChange);
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp);
    window.addEventListener('mousemove', mouseMove); window.addEventListener('mousedown', mouseDown); window.addEventListener('mouseup', mouseUp); window.addEventListener('contextmenu', context);
    return () => {
      document.removeEventListener('pointerlockchange', pointerChange);
      window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp);
      window.removeEventListener('mousemove', mouseMove); window.removeEventListener('mousedown', mouseDown); window.removeEventListener('mouseup', mouseUp); window.removeEventListener('contextmenu', context);
    };
  }, [lockTone, tone]);

  const activeAircraft = AIRCRAFT[aircraft];

  return (
    <main className="game-shell">
      <canvas ref={sourceRef} className={`game-canvas source ${gpuReady ? 'gpu-active' : ''}`} aria-label="ASCII SKY 3D combat view" />
      <canvas ref={gpuRef} className={`game-canvas gpu ${gpuReady ? 'ready' : ''}`} aria-label="StSL WebGPU terminal presentation" onClick={() => phase === 'playing' && requestPlay()} />
      <div className="crt-overlay" aria-hidden="true" />

      {phase === 'menu' && (
        <section className="landing panel-screen">
          <header className="landing-header">
            <div><span className="micro">ST COMBAT SYSTEM // BUILD 0.1</span><h1>ASCII SKY</h1></div>
            <span className="ready"><i /> SYSTEM READY</span>
          </header>
          <div className="landing-copy">
            <span className="micro">RIDGE CITY / LOCAL SIMULATION</span>
            <h2>LOCK THE SIGNAL.<br /><em>OWN THE SKY.</em></h2>
            <p>Every glyph is a contact. Every decision rewrites the sky. Fight through energy, sensors, terrain, and damage in a living tactical display.</p>
            <button className="primary-action" onClick={() => setPhase('loadout')}>ENTER LOADOUT <b>→</b></button>
            <a className="guide-link" href="./USER_GUIDE_CN.md" target="_blank" rel="noreferrer">OPEN OPERATION GUIDE ↗</a>
          </div>
          <footer className="landing-footer"><span>AETHRA // SR-20</span><span>MOUSE AIM · 6DOF · FCR · RWR · ST-LINK</span><span>{gpuReady ? 'StSL / WebGPU' : 'CPU FALLBACK'}</span></footer>
        </section>
      )}

      {phase === 'loadout' && (
        <section className="loadout panel-screen">
          <header className="loadout-header"><div><span className="micro">MISSION CONFIGURATION</span><h1>SELECT AIRFRAME</h1></div><button className="text-button" onClick={() => setPhase('menu')}>← RETURN</button></header>
          <div className="loadout-grid">
            <nav className="aircraft-tabs" aria-label="Aircraft">
              {(Object.keys(AIRCRAFT) as AircraftId[]).map((id) => <button key={id} className={id === aircraft ? 'active' : ''} onClick={() => setAircraft(id)}><span>{AIRCRAFT[id].name}</span><small>{AIRCRAFT[id].role}</small></button>)}
            </nav>
            <div className="aircraft-preview">
              <div className="preview-brackets" aria-hidden="true" />
              <pre>{activeAircraft.silhouette.join('\n')}</pre>
              <span className="micro">PARAMETRIC AIRFRAME // LIVE SILHOUETTE</span>
              <div className="stats"><span>SPD <b>{Math.round(activeAircraft.maxSpeed * 1.94)}</b></span><span>TURN <b>{Math.round(activeAircraft.turnRate * 72)}</b></span><span>RCS <b>{Math.round((1 - activeAircraft.stealth) * 100)}</b></span><span>FCR <b>{activeAircraft.radar}</b></span></div>
            </div>
            <div className="config-column">
              <div className="config-block"><span className="micro">MISSION</span><label>MODE <select defaultValue="QUICK FIGHT"><option>QUICK FIGHT</option><option>DOGFIGHT</option><option>BVR</option><option>INTERCEPT</option><option>SENSOR LAB</option></select></label><label>ENEMY <input type="range" min="1" max="16" value={enemyCount} onChange={(event) => setEnemyCount(Number(event.target.value))} /><b>{enemyCount}</b></label><label>SKILL <select value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)}><option>ROOKIE</option><option>NORMAL</option><option>ACE</option></select></label><label>FCR DISPLAY <select value={radarDisplay} onChange={(event) => setRadarDisplay(event.target.value as RadarDisplay)}><option value="B-SCOPE">B-SCOPE / ATTACK</option><option value="PPI">PPI / SITUATIONAL</option></select></label><label className="check"><input type="checkbox" checked={infinite} onChange={(event) => setInfinite(event.target.checked)} /> SURVIVAL / INFINITE</label></div>
              <div className="config-block"><span className="micro">SIMULATION</span>{Object.entries(options).map(([key, enabled]) => <label className="check" key={key}><input type="checkbox" checked={enabled} onChange={() => setOptions((current) => ({ ...current, [key]: !enabled }))} /> {key.toUpperCase()}</label>)}</div>
            </div>
          </div>
          <div className="loadout-bar"><div><span className="micro">LOADOUT</span><p>GUN SG-25 / {activeAircraft.gunAmmo} · ST-1 ×{activeAircraft.missiles['ST-1']} · ST-1X ×{activeAircraft.missiles['ST-1X']} · ST-1AX ×{activeAircraft.missiles['ST-1AX']}</p></div><button className="primary-action" onClick={startMission}>START MISSION <b>→</b></button></div>
        </section>
      )}

      {phase === 'playing' && (
        <>
          <div className="play-meta"><span>ASCII SKY // {activeAircraft.name}</span><span className="gpu-badge"><i /> {gpuReady ? 'StSL WEBGPU' : 'BASIC CPU FALLBACK'}</span></div>
          <div className="controls-hint">MOUSE INSTRUCTOR · A/D ROLL · W/S PUSH/PULL · H HMD ACQ · R FCR MODE · RMB/T LOCK · LMB GUN · SPACE MISSILE</div>
          <div className="mobile-controls"><button onPointerDown={() => simulationRef.current?.setTrigger(true)} onPointerUp={() => simulationRef.current?.setTrigger(false)}>GUN</button><button onClick={() => simulationRef.current?.releaseMissile()}>MISSILE</button></div>
        </>
      )}

      {phase === 'paused' && <Overlay title="SIMULATION PAUSED" detail="Pointer lock released. Flight physics are frozen." primary="RESUME" onPrimary={requestPlay} secondary="RETURN TO LOADOUT" onSecondary={() => setPhase('loadout')} extra={<button className="text-button" onClick={restart}>RESTART MISSION</button>} />}
      {phase === 'dead' && <Overlay title="AIRFRAME LOST" detail={`Combat time ${formatTime(score.time)} · ${score.kills} confirmed kills`} primary="RETRY" onPrimary={restart} secondary="RETURN TO LOADOUT" onSecondary={() => setPhase('loadout')} />}
      {phase === 'result' && <Overlay title="AIRSPACE SECURED" detail={`Score ${score.points.toLocaleString()} · ${score.kills} confirmed kills · ${formatTime(score.time)}`} primary="FLY AGAIN" onPrimary={restart} secondary="RETURN TO LOADOUT" onSecondary={() => setPhase('loadout')} />}

      {phase === 'playing' && <div className="weapon-descriptor">{WEAPON_COPY[weapon]}</div>}
    </main>
  );
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function Overlay({ title, detail, primary, secondary, onPrimary, onSecondary, extra }: { title: string; detail: string; primary: string; secondary: string; onPrimary: () => void; onSecondary: () => void; extra?: React.ReactNode }) {
  return <section className="modal-backdrop"><div className="modal"><span className="micro">ST COMBAT SYSTEM</span><h2>{title}</h2><p>{detail}</p><button className="primary-action" onClick={onPrimary}>{primary} <b>→</b></button><button className="secondary-action" onClick={onSecondary}>{secondary}</button>{extra}</div></section>;
}
