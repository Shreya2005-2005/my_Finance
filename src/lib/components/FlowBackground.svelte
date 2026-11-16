<script lang="ts">
  /**
   * A FLOWING BACKGROUND, drawn by a small WebGL shader (a program that runs on the graphics chip).
   *
   * It paints slow, organic green currents: layers of smooth noise that bend each other, so the colour drifts like liquid.
   * It costs very little:
   *   - it is drawn at half size and stretched, since the picture is soft anyway;
   *   - it draws about 30 pictures a second, not 60;
   *   - it stops when it is off screen or the tab is hidden;
   *   - with "reduce motion" switched on in the system, it draws one still picture and never moves.
   * If WebGL is not available, a still green gradient is shown instead, so the page always has a background.
   */
  import { onMount } from "svelte";

  let canvas = $state<HTMLCanvasElement>();
  let still = $state(false);

  const VERTEX = `
    attribute vec2 a;
    void main() { gl_Position = vec4(a, 0.0, 1.0); }
  `;

  const FRAGMENT = `
    precision mediump float;
    uniform vec2 uRes;
    uniform float uTime;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    // smooth random value at a point
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
    }
    // several layers of noise, each finer than the last
    float fbm(vec2 p) {
      float v = 0.0;
      float amp = 0.5;
      for (int i = 0; i < 3; i++) {
        v += amp * noise(p);
        p *= 2.0;
        amp *= 0.5;
      }
      return v;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / uRes;
      vec2 p = uv * vec2(uRes.x / uRes.y, 1.0) * 0.95;
      float t = uTime * 0.055;

      // noise that bends noise that bends noise: this is what makes it look like flowing liquid
      vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
      vec2 r = vec2(fbm(p + 2.2 * q + vec2(1.7, 9.2) + 0.5 * t), fbm(p + 2.2 * q + vec2(8.3, 2.8) - 0.4 * t));
      // smooth noise stays near the middle of its range, so stretch it to use the full range of colour
      float f = clamp((fbm(p + 2.2 * r) - 0.20) / 0.55, 0.0, 1.0);
      float g = clamp((r.x - 0.20) / 0.55, 0.0, 1.0);

      vec3 deep   = vec3(0.040, 0.170, 0.115);
      vec3 mid    = vec3(0.090, 0.480, 0.330);
      vec3 bright = vec3(0.360, 0.840, 0.620);

      vec3 col = mix(deep, mid, smoothstep(0.05, 0.62, f));
      // brighter glow in the lower half, like the reference
      float low = 1.0 - uv.y;
      col = mix(col, bright, smoothstep(0.50, 1.00, f) * (0.40 + 0.60 * low));
      // a faint lime streak where the currents cross
      col += vec3(0.26, 0.38, 0.08) * smoothstep(0.55, 1.0, g) * 0.28 * low;
      // darker at the top so the page header and the headline stay easy to read
      col *= 0.74 + 0.26 * low;
      // a bright green glow rising from the bottom, as in the reference
      float glow = smoothstep(0.95, 0.0, distance(uv * vec2(1.0, 1.25), vec2(0.45, -0.08)));
      col += vec3(0.10, 0.36, 0.23) * glow * 0.95;
      // soft edges
      vec2 e = uv - 0.5;
      col *= 1.0 - 0.25 * dot(e, e) * 2.2;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  }

  onMount(() => {
    const el = canvas;
    if (!el) return;
    const gl = el.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!gl) {
      still = true;
      return;
    }
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vs || !fs || !program) {
      still = true;
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      still = true;
      return;
    }
    gl.useProgram(program);

    // one big triangle that covers the whole picture
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(program, "uRes");
    const uTime = gl.getUniformLocation(program, "uTime");

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const origin = performance.now();
    let raf = 0;
    let last = 0;
    let frames = 0;
    let onScreen = true;

    function resize() {
      const box = el!.getBoundingClientRect();
      // half size: the picture is soft, so nobody can tell, and the graphics chip does a quarter of the work
      const w = Math.max(2, Math.min(960, Math.round(box.width * 0.5)));
      const h = Math.max(2, Math.min(720, Math.round(box.height * 0.5)));
      if (el!.width !== w || el!.height !== h) {
        el!.width = w;
        el!.height = h;
        gl!.viewport(0, 0, w, h);
        gl!.uniform2f(uRes, w, h);
      }
    }
    function draw(seconds: number) {
      gl!.uniform1f(uTime, seconds);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      el!.dataset.frames = String(++frames);
    }
    function loop(now: number) {
      raf = requestAnimationFrame(loop);
      if (now - last < 33) return; // about 30 pictures a second
      last = now;
      draw((now - origin) / 1000 + 30);
    }
    function play() {
      if (!raf && !reduce && onScreen && !document.hidden) raf = requestAnimationFrame(loop);
    }
    function pause() {
      cancelAnimationFrame(raf);
      raf = 0;
    }

    resize();
    draw(30); // one picture right away, so there is never an empty background
    const ro = new ResizeObserver(() => {
      resize();
      draw(((performance.now() - origin) / 1000) + 30);
    });
    ro.observe(el);
    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
      onScreen ? play() : pause();
    });
    io.observe(el);
    const onVisibility = () => (document.hidden ? pause() : play());
    document.addEventListener("visibilitychange", onVisibility);
    const onLost = (e: Event) => {
      e.preventDefault();
      pause();
      still = true;
    };
    el.addEventListener("webglcontextlost", onLost);
    play();

    return () => {
      pause();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      el.removeEventListener("webglcontextlost", onLost);
    };
  });
</script>

<div class="flow" class:still aria-hidden="true">
  <canvas bind:this={canvas}></canvas>
  <div class="dots"></div>
  <div class="fade"></div>
</div>

<style>
  .flow {
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    pointer-events: none;
    background: #07140f;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  /* if WebGL is missing or was lost: a still gradient in the same colours */
  .still canvas {
    display: none;
  }
  .still {
    background:
      radial-gradient(60% 55% at 28% 78%, rgb(63 178 128 / 55%), transparent 70%),
      radial-gradient(55% 50% at 78% 62%, rgb(18 112 78 / 60%), transparent 72%),
      radial-gradient(70% 60% at 50% 100%, rgb(86 205 150 / 35%), transparent 70%),
      #07140f;
  }
  /* a fine dotted grid, as in the reference */
  .dots {
    position: absolute;
    inset: 0;
    background: radial-gradient(circle, rgb(255 255 255 / 14%) 1px, transparent 1.5px) 0 0 / 24px 24px;
    -webkit-mask-image: radial-gradient(ellipse at 50% 55%, #000 25%, transparent 80%);
    mask-image: radial-gradient(ellipse at 50% 55%, #000 25%, transparent 80%);
  }
  /* blends the bottom edge into the page */
  .fade {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 140px;
    background: linear-gradient(to bottom, transparent, var(--bg));
  }
</style>
