const VERTEX = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = vec2((a_position.x + 1.0) * 0.5, 1.0 - (a_position.y + 1.0) * 0.5);
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT = `
precision mediump float;
uniform sampler2D u_image;
uniform vec2 u_texel;
uniform float u_position;
uniform float u_width;
uniform float u_angle;
uniform float u_blur;
uniform vec3 u_color;
uniform float u_enhance;
varying vec2 v_uv;

vec3 sampleBlur(vec2 uv, float radius) {
  vec2 d = u_texel * radius;
  vec3 c = texture2D(u_image, uv).rgb * 0.24;
  c += texture2D(u_image, uv + vec2(d.x, 0.0)).rgb * 0.13;
  c += texture2D(u_image, uv - vec2(d.x, 0.0)).rgb * 0.13;
  c += texture2D(u_image, uv + vec2(0.0, d.y)).rgb * 0.13;
  c += texture2D(u_image, uv - vec2(0.0, d.y)).rgb * 0.13;
  c += texture2D(u_image, uv + d).rgb * 0.06;
  c += texture2D(u_image, uv - d).rgb * 0.06;
  c += texture2D(u_image, uv + vec2(d.x, -d.y)).rgb * 0.06;
  c += texture2D(u_image, uv + vec2(-d.x, d.y)).rgb * 0.06;
  return c;
}

void main() {
  vec2 p = v_uv - vec2(0.5, u_position);
  float axis = p.y * cos(u_angle) - p.x * sin(u_angle);
  float blurMix = smoothstep(u_width * 0.5, u_width * 0.5 + 0.23, abs(axis));
  float radius = max(0.01, u_blur * blurMix);
  vec3 base = texture2D(u_image, v_uv).rgb;
  vec3 color = mix(base, sampleBlur(v_uv, radius), blurMix);
  float brightness = u_color.x + u_enhance * 0.015;
  float contrast = u_color.y + u_enhance * 0.07;
  float saturation = u_color.z + u_enhance * 0.10;
  color *= brightness;
  color = (color - 0.5) * contrast + 0.5;
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(vec3(luma), color, saturation);
  if (u_enhance > 0.5) color = smoothstep(vec3(-0.04), vec3(1.03), color);
  gl_FragColor = vec4(color, 1.0);
}`;

function shader(gl, type, source) {
  const item = gl.createShader(type);
  gl.shaderSource(item, source);
  gl.compileShader(item);
  if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(item));
  return item;
}

export class MiniatureRenderer {
  constructor(video, canvas, onStats) {
    this.video = video;
    this.canvas = canvas;
    this.onStats = onStats;
    this.params = {};
    this.enhance = true;
    this.running = false;
    this.fps = 0;
    this.frames = 0;
    this.lastFpsAt = performance.now();
    this.gl = null;
    this.ctx = null;
    try { this.initWebGL(); } catch (error) { console.warn("WebGL fallback", error); this.init2D(); }
  }

  initWebGL() {
    const gl = this.canvas.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL unavailable");
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    this.gl = gl; this.program = program; this.texture = texture; this.buffer = buffer;
    this.uniforms = Object.fromEntries(["u_texel","u_position","u_width","u_angle","u_blur","u_color","u_enhance"].map((name) => [name, gl.getUniformLocation(program, name)]));
  }

  init2D() { this.gl = null; this.ctx = this.canvas.getContext("2d", { alpha: false }); }
  setParams(params, enhance = this.enhance) { this.params = { ...params }; this.enhance = enhance; }

  resize() {
    const vw = this.video.videoWidth || 1280, vh = this.video.videoHeight || 720;
    const maxWidth = Math.min(vw, 1280);
    const width = Math.max(2, Math.round(maxWidth));
    const height = Math.max(2, Math.round(width * vh / vw));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width; this.canvas.height = height;
      this.gl?.viewport(0, 0, width, height);
    }
  }

  drawWebGL() {
    const gl = this.gl, p = this.params;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, this.video);
    gl.uniform2f(this.uniforms.u_texel, 1 / this.canvas.width, 1 / this.canvas.height);
    gl.uniform1f(this.uniforms.u_position, p.position / 100);
    gl.uniform1f(this.uniforms.u_width, p.width / 100);
    gl.uniform1f(this.uniforms.u_angle, p.angle * Math.PI / 180);
    gl.uniform1f(this.uniforms.u_blur, p.blur);
    gl.uniform3f(this.uniforms.u_color, p.brightness / 100, p.contrast / 100, p.saturation / 100);
    gl.uniform1f(this.uniforms.u_enhance, this.enhance ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  draw2D() {
    const c = this.canvas, ctx = this.ctx, p = this.params;
    ctx.save();
    ctx.filter = `blur(${Math.min(18, p.blur)}px) saturate(${p.saturation + (this.enhance ? 10 : 0)}%) contrast(${p.contrast + (this.enhance ? 7 : 0)}%) brightness(${p.brightness}%)`;
    ctx.drawImage(this.video, -20, -20, c.width + 40, c.height + 40);
    ctx.restore();
    ctx.save();
    ctx.translate(c.width / 2, c.height * p.position / 100);
    ctx.rotate(p.angle * Math.PI / 180);
    const band = c.height * p.width / 100;
    ctx.beginPath(); ctx.rect(-c.width, -band / 2, c.width * 2, band); ctx.clip();
    ctx.translate(-c.width / 2, -c.height * p.position / 100);
    ctx.filter = `saturate(${p.saturation + (this.enhance ? 10 : 0)}%) contrast(${p.contrast + (this.enhance ? 7 : 0)}%) brightness(${p.brightness}%)`;
    ctx.drawImage(this.video, 0, 0, c.width, c.height);
    ctx.restore();
  }

  frame = () => {
    if (!this.running) return;
    if (this.video.readyState >= 2) {
      this.resize();
      try { this.gl ? this.drawWebGL() : this.draw2D(); } catch (error) { console.warn(error); }
      this.frames++;
      const now = performance.now();
      if (now - this.lastFpsAt >= 1000) {
        this.fps = Math.round(this.frames * 1000 / (now - this.lastFpsAt));
        this.frames = 0; this.lastFpsAt = now; this.onStats?.(this.fps);
      }
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  start() { if (!this.running) { this.running = true; this.lastFpsAt = performance.now(); this.frame(); } }
  pause() { this.running = false; cancelAnimationFrame(this.raf); }
  destroy() { this.pause(); if (this.gl) { this.gl.deleteTexture(this.texture); this.gl.deleteBuffer(this.buffer); this.gl.deleteProgram(this.program); } }
  get mode() { return this.gl ? "WebGL" : "Canvas 2D"; }
}
