/// <reference types="@webgpu/types" />

import shaderCode from '../public/shaders/ascii_post.wgsl?raw';

export class StslWebGpuPresenter {
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private pipeline!: GPURenderPipeline;
  private sampler!: GPUSampler;
  private texture?: GPUTexture;
  private bindGroup!: GPUBindGroup;
  private format: GPUTextureFormat = 'bgra8unorm';
  private sourceWidth = 0;
  private sourceHeight = 0;

  static async create(canvas: HTMLCanvasElement) {
    const instance = new StslWebGpuPresenter(canvas);
    return (await instance.initialize()) ? instance : null;
  }

  private constructor(private canvas: HTMLCanvasElement) {}

  private async initialize() {
    const gpu = navigator.gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return false;
    this.device = await adapter.requestDevice();
    const context = this.canvas.getContext('webgpu');
    if (!context) return false;
    this.context = context;
    this.format = gpu.getPreferredCanvasFormat();
    this.configure();
    const shaderModule = this.device.createShaderModule({ label: 'StSL ASCII post', code: shaderCode });
    const compilation = await shaderModule.getCompilationInfo();
    const errors = compilation.messages.filter((message) => message.type === 'error');
    if (errors.length) throw new Error(errors.map((message) => message.message).join('\n'));
    this.pipeline = this.device.createRenderPipeline({
      label: 'ASCII SKY StSL terminal presenter', layout: 'auto',
      vertex: { module: shaderModule, entryPoint: 'vertexMain' },
      fragment: { module: shaderModule, entryPoint: 'fragmentMain', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    return true;
  }

  private configure() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
    }
  }

  present(source: HTMLCanvasElement) {
    this.configure();
    if (!this.texture || this.sourceWidth !== source.width || this.sourceHeight !== source.height) {
      this.texture?.destroy();
      this.sourceWidth = source.width;
      this.sourceHeight = source.height;
      this.texture = this.device.createTexture({
        size: [source.width, source.height], format: 'rgba8unorm',
        // copyExternalImageToTexture requires COPY_DST and RENDER_ATTACHMENT;
        // the terminal pass also samples this texture.
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.bindGroup = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: this.texture.createView() }, { binding: 1, resource: this.sampler }],
      });
    }
    this.device.queue.copyExternalImageToTexture({ source }, { texture: this.texture }, [source.width, source.height]);
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(), clearValue: { r: 0, g: 0.02, b: 0.01, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(this.pipeline); pass.setBindGroup(0, this.bindGroup); pass.draw(3); pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  async validateAndPresent(source: HTMLCanvasElement) {
    this.device.pushErrorScope('validation');
    this.present(source);
    await this.device.queue.onSubmittedWorkDone();
    const error = await this.device.popErrorScope();
    if (error) throw new Error(error.message);
  }
}
