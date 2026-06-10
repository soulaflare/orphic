/* ORPHIC — WebGL2 micro-framework
 * Shader compilation, fullscreen-triangle draws, ping-pong float framebuffers
 * for GPGPU simulations, and a tiny uniform-setting API.
 */
(function () {
  'use strict';

  const VERT = `#version 300 es
  precision highp float;
  out vec2 vUV;
  void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    vUV = p;
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  }`;

  class GL {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl2', {
        antialias: false, alpha: false, depth: false, stencil: false,
        powerPreference: 'high-performance', preserveDrawingBuffer: false,
      });
      if (!gl) throw new Error('WebGL2 not supported');
      this.gl = gl;
      this.floatOK = !!gl.getExtension('EXT_color_buffer_float');
      gl.getExtension('OES_texture_float_linear');
      this._vao = gl.createVertexArray();
      this.width = 0; this.height = 0;
    }

    resize(w, h) {
      if (w === this.width && h === this.height) return false;
      this.width = w; this.height = h;
      this.canvas.width = w; this.canvas.height = h;
      return true;
    }

    program(fragSrc, vertSrc) {
      const gl = this.gl;
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          const log = gl.getShaderInfoLog(s);
          console.error(src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
          throw new Error('Shader compile error: ' + log);
        }
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vertSrc || VERT));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragSrc));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error('Program link error: ' + gl.getProgramInfoLog(p));
      }
      return new Program(this, p);
    }

    /** RGBA16F render target (falls back to RGBA8 without float support). */
    target(w, h, opts) {
      return new Target(this, w, h, opts || {});
    }

    /** Ping-pong pair of float targets for simulations. */
    pingpong(w, h, opts) {
      return {
        a: this.target(w, h, opts),
        b: this.target(w, h, opts),
        swap() { const t = this.a; this.a = this.b; this.b = t; },
        get read() { return this.a; },
        get write() { return this.b; },
        resize(gl2, nw, nh) { this.a.resize(nw, nh); this.b.resize(nw, nh); },
        dispose() { this.a.dispose(); this.b.dispose(); },
      };
    }

    /** Draw fullscreen with `prog` into `target` (null = screen). */
    draw(prog, target) {
      const gl = this.gl;
      if (target) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        gl.viewport(0, 0, target.w, target.h);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.width, this.height);
      }
      gl.useProgram(prog.handle);
      prog._bindPending();
      gl.bindVertexArray(this._vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  class Program {
    constructor(glc, handle) {
      this.glc = glc;
      this.handle = handle;
      this._uniforms = {};
      this._pendingTex = [];
    }
    _loc(name) {
      if (!(name in this._uniforms)) {
        this._uniforms[name] = this.glc.gl.getUniformLocation(this.handle, name);
      }
      return this._uniforms[name];
    }
    use() { this.glc.gl.useProgram(this.handle); this._pendingTex.length = 0; return this; }
    f(name, x) { const l = this._loc(name); if (l) this.glc.gl.uniform1f(l, x); return this; }
    fv(name, arr) {
      const l = this._loc(name) || this._loc(name + '[0]');
      if (l) this.glc.gl.uniform1fv(l, arr);
      return this;
    }
    i(name, x) { const l = this._loc(name); if (l) this.glc.gl.uniform1i(l, x); return this; }
    v2(name, x, y) { const l = this._loc(name); if (l) this.glc.gl.uniform2f(l, x, y); return this; }
    v3(name, x, y, z) { const l = this._loc(name); if (l) this.glc.gl.uniform3f(l, x, y, z); return this; }
    v4(name, x, y, z, w) { const l = this._loc(name); if (l) this.glc.gl.uniform4f(l, x, y, z, w); return this; }
    tex(name, texture, unit) {
      this._pendingTex.push([name, texture, unit]);
      return this;
    }
    _bindPending() {
      const gl = this.glc.gl;
      for (const [name, texture, unit] of this._pendingTex) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        const l = this._loc(name);
        if (l) gl.uniform1i(l, unit);
      }
    }
  }

  class Target {
    constructor(glc, w, h, opts) {
      this.glc = glc;
      this.opts = opts;
      this.w = 0; this.h = 0;
      this.tex = null; this.fbo = null;
      this.resize(w, h);
    }
    resize(w, h) {
      if (w === this.w && h === this.h) return;
      const gl = this.glc.gl;
      this.dispose();
      this.w = w; this.h = h;
      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      const filter = this.opts.nearest ? gl.NEAREST : gl.LINEAR;
      const wrap = this.opts.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      if (this.glc.floatOK && !this.opts.byte) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      this.fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    clear(r, g, b, a) {
      const gl = this.glc.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, this.w, this.h);
      gl.clearColor(r || 0, g || 0, b || 0, a || 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    dispose() {
      const gl = this.glc.gl;
      if (this.tex) gl.deleteTexture(this.tex);
      if (this.fbo) gl.deleteFramebuffer(this.fbo);
      this.tex = null; this.fbo = null;
    }
  }

  window.ORPHIC = window.ORPHIC || {};
  window.ORPHIC.GL = GL;
})();
