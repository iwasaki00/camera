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
uniform vec2 u_center;
uniform float u_width;
uniform float u_angle;
uniform float u_blur;
uniform float u_aspect;
uniform float u_zoom;
uniform float u_compare;
uniform int u_shape;
uniform vec3 u_color;
uniform vec3 u_tone;
uniform float u_enhance;
varying vec2 v_uv;

vec3 sampleBlur(vec2 uv, float radius) {
  vec2 d = u_texel * radius / u_zoom;
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
  vec2 uv = (v_uv - 0.5) / u_zoom + 0.5;
  vec2 p = uv - u_center;
  p.x *= u_aspect;
  float cs = cos(u_angle);
  float sn = sin(u_angle);
  float distanceFromFocus;
  if (u_shape == 1) {
    distanceFromFocus = abs(p.x * cs + p.y * sn);
  } else if (u_shape == 2) {
    distanceFromFocus = length(p);
  } else if (u_shape == 3) {
    distanceFromFocus = length(vec2(p.x * 0.72, p.y * 1.28));
  } else {
    distanceFromFocus = abs(p.y * cs - p.x * sn);
  }
  float blurMix = smoothstep(u_width * 0.5, u_width * 0.5 + 0.22, distanceFromFocus);
  vec3 base = texture2D(u_image, uv).rgb;
  if (u_compare > 0.5) {
    gl_FragColor = vec4(base, 1.0);
    return;
  }
  float radius = max(0.01, u_blur * blurMix);
  vec3 color = mix(base, sampleBlur(uv, radius), blurMix);
  float brightness = u_color.x + u_enhance * 0.015;
  float contrast = u_color.y + u_enhance * 0.07;
  float saturation = u_color.z + u_enhance * 0.10;
  color *= brightness;
  color = (color - 0.5) * contrast + 0.5;
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(vec3(luma), color, saturation);
  color.r += u_tone.x * 0.06;
  color.b -= u_tone.x * 0.06;
  color += u_tone.y * (1.0 - smoothstep(0.05, 0.55, luma)) * 0.18;
  color += u_tone.z * smoothstep(0.48, 0.95, luma) * 0.16;
  if (u_enhance > 0.5) color = smoothstep(vec3(-0.04), vec3(1.03), color);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

const SHAPES = { horizontal: 0, vertical: 1, circle: 2, ellipse: 3 };

function shader(gl, type, source) {
  const item = gl.createShader(type);
  gl.shaderSource(item, source);
  gl.compileShader(item);
  if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(item));
  return item;
}

function sourceSize(source) {
  return {
    width: source?.videoWidth || source?.naturalWidth || source?.width || 1280,
    height: source?.videoHeight || source?.naturalHeight || source?.height || 720,
  };
}

function sourceReady(source) {
  if (!source) return false;
  if ("readyState" in source) return source.readyState >= 2;
  if ("complete" in source) return source.complete && sourceSize(source).width > 0;
  return true;
}

export class MiniatureRenderer {
  constructor(source, canvas, onStats) {
    this.source = source;
    this.canvas = canvas;
    this.onStats = onStats;
    this.params = {};
    this.enhance = true;
    this.compare = false;
    this.running = false;
    this.targetFps = 30;
    this.resolutionScale = 1;
    this.frames = 0;
    this.lastDrawAt = 0;
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
    const names = ["u_texel","u_center","u_width","u_angle","u_blur","u_aspect","u_zoom","u_compare","u_shape","u_color","u_tone","u_enhance"];
    this.uniforms = Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)]));
  }

  init2D() { this.gl = null; this.ctx = this.canvas.getContext("2d", { alpha: false }); }
  setSource(source) { this.source = source; this.lastDrawAt = 0; }
  setParams(params, enhance = this.enhance) { this.params = { ...params }; this.enhance = enhance; }
  setCompare(value) { this.compare = value; }
  setTargetFps(value) { this.targetFps = Math.max(1, Number(value) || 30); }
  setResolutionScale(value) { this.resolutionScale = Math.max(0.5, Math.min(1, value)); }

  resize() {
    const size = sourceSize(this.source);
    const maxWidth = Math.min(size.width, 1280) * this.resolutionScale;
    const width = Math.max(2, Math.round(maxWidth));
    const height = Math.max(2, Math.round(width * size.height / size.width));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width; this.canvas.height = height;
      this.gl?.viewport(0, 0, width, height);
    }
  }

  drawWebGL() {
    const gl = this.gl, p = this.params;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.source);
    gl.uniform2f(this.uniforms.u_texel, 1 / this.canvas.width, 1 / this.canvas.height);
    gl.uniform2f(this.uniforms.u_center, (p.centerX ?? 50) / 100, (p.centerY ?? p.position ?? 50) / 100);
    gl.uniform1f(this.uniforms.u_width, p.width / 100);
    gl.uniform1f(this.uniforms.u_angle, p.angle * Math.PI / 180);
    gl.uniform1f(this.uniforms.u_blur, p.blur);
    gl.uniform1f(this.uniforms.u_aspect, this.canvas.width / this.canvas.height);
    gl.uniform1f(this.uniforms.u_zoom, p.zoom || 1);
    gl.uniform1f(this.uniforms.u_compare, this.compare ? 1 : 0);
    gl.uniform1i(this.uniforms.u_shape, SHAPES[p.shape] ?? 0);
    gl.uniform3f(this.uniforms.u_color, p.brightness / 100, p.contrast / 100, p.saturation / 100);
    gl.uniform3f(this.uniforms.u_tone, (p.temperature || 0) / 20, (p.shadows || 0) / 20, (p.highlights || 0) / 20);
    gl.uniform1f(this.uniforms.u_enhance, this.enhance ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  draw2D() {
    const c = this.canvas, ctx = this.ctx, p = this.params, zoom = p.zoom || 1;
    const sw = c.width / zoom, sh = c.height / zoom, sx = (c.width - sw) / 2, sy = (c.height - sh) / 2;
    if (this.compare) { ctx.filter = "none"; ctx.drawImage(this.source, sx, sy, sw, sh, 0, 0, c.width, c.height); return; }
    const filter = `saturate(${p.saturation + (this.enhance ? 10 : 0)}%) contrast(${p.contrast + (this.enhance ? 7 : 0)}%) brightness(${p.brightness}%)`;
    ctx.save(); ctx.filter = `blur(${Math.min(18, p.blur)}px) ${filter}`;
    ctx.drawImage(this.source, sx, sy, sw, sh, -20, -20, c.width + 40, c.height + 40); ctx.restore();
    ctx.save();
    const x = c.width * (p.centerX ?? 50) / 100, y = c.height * (p.centerY ?? p.position ?? 50) / 100;
    ctx.translate(x, y); ctx.rotate(p.angle * Math.PI / 180); ctx.beginPath();
    const band = c.height * p.width / 100;
    if (p.shape === "vertical") ctx.rect(-band / 2, -c.height, band, c.height * 2);
    else if (p.shape === "circle") ctx.arc(0, 0, band / 2, 0, Math.PI * 2);
    else if (p.shape === "ellipse") ctx.ellipse(0, 0, band * .85, band / 2, 0, 0, Math.PI * 2);
    else ctx.rect(-c.width, -band / 2, c.width * 2, band);
    ctx.clip(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = filter;
    ctx.drawImage(this.source, sx, sy, sw, sh, 0, 0, c.width, c.height); ctx.restore();
  }

  draw() {
    if (!sourceReady(this.source)) return false;
    this.resize();
    this.gl ? this.drawWebGL() : this.draw2D();
    return true;
  }

  frame = (timestamp) => {
    if (!this.running) return;
    const interval = 1000 / this.targetFps;
    if (!this.lastDrawAt || timestamp - this.lastDrawAt >= interval) {
      try {
        if (this.draw()) { this.frames++; this.lastDrawAt = timestamp; }
      } catch (error) { console.warn(error); }
    }
    if (timestamp - this.lastFpsAt >= 1000) {
      const fps = Math.round(this.frames * 1000 / (timestamp - this.lastFpsAt));
      this.frames = 0; this.lastFpsAt = timestamp; this.onStats?.(fps);
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  start() { if (!this.running) { this.running = true; this.lastFpsAt = performance.now(); this.lastDrawAt = 0; this.frame(performance.now()); } }
  pause() { this.running = false; cancelAnimationFrame(this.raf); }
  destroy() { this.pause(); if (this.gl) { this.gl.deleteTexture(this.texture); this.gl.deleteBuffer(this.buffer); this.gl.deleteProgram(this.program); } }
  get mode() { return this.gl ? "WebGL" : "Canvas 2D"; }
}
