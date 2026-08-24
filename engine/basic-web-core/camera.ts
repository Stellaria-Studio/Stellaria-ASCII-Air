import type { Vec3 } from '../../game/types';

// Portable web extraction of Basic's camera responsibilities: authored basis,
// perspective projection, Project/Unproject boundary. RHI and input stay out.
export type WebCamera = { position: Vec3; heading: number; pitch: number; roll: number; fovY: number };
export type WebViewport = { width: number; height: number };
export type ProjectedPoint = { x: number; y: number; depth: number; visible: boolean };

export class BasicWebCameraProjector {
  private position: Vec3 = { x: 0, y: 0, z: 0 };
  private sh = 0;
  private ch = 1;
  private sp = 0;
  private cp = 1;
  private sr = 0;
  private cr = 1;
  private focal = 1;
  private centerX = 0;
  private centerY = 0;

  update(camera: WebCamera, viewport: WebViewport) {
    this.position = camera.position;
    this.sh = Math.sin(camera.heading);
    this.ch = Math.cos(camera.heading);
    this.sp = Math.sin(camera.pitch);
    this.cp = Math.cos(camera.pitch);
    this.sr = Math.sin(-camera.roll);
    this.cr = Math.cos(-camera.roll);
    this.focal = viewport.height * 0.5 / Math.tan(camera.fovY * 0.5);
    this.centerX = viewport.width * 0.5;
    this.centerY = viewport.height * 0.5;
  }

  project(point: Vec3, out: ProjectedPoint = { x: 0, y: 0, depth: 0, visible: false }) {
    return this.projectXYZ(point.x, point.y, point.z, out);
  }

  projectXYZ(x: number, y: number, z: number, out: ProjectedPoint) {
    const dx = x - this.position.x;
    const dy = y - this.position.y;
    const dz = z - this.position.z;
    const xYaw = dx * this.ch - dz * this.sh;
    const zYaw = dx * this.sh + dz * this.ch;
    const yPitch = dy * this.cp - zYaw * this.sp;
    const zPitch = dy * this.sp + zYaw * this.cp;
    const xRoll = xYaw * this.cr - yPitch * this.sr;
    const yRoll = xYaw * this.sr + yPitch * this.cr;
    out.x = this.centerX + xRoll / Math.max(1, zPitch) * this.focal;
    out.y = this.centerY - yRoll / Math.max(1, zPitch) * this.focal;
    out.depth = zPitch;
    out.visible = zPitch > 40;
    return out;
  }

  depth(point: Vec3) {
    const dx = point.x - this.position.x;
    const dy = point.y - this.position.y;
    const dz = point.z - this.position.z;
    const zYaw = dx * this.sh + dz * this.ch;
    return dy * this.sp + zYaw * this.cp;
  }
}
