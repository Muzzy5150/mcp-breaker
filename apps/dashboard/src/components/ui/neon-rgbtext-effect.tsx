"use client";

import { useEffect, useRef } from "react";

import { cn } from "../../lib/utils";

type NeonRGBTextEffectProps = {
  text: string;
  className?: string;
};

const VERTEX_SHADER = `
  attribute vec2 a_position;
  attribute vec2 a_uv;
  varying vec2 v_uv;

  void main() {
    v_uv = a_uv;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;
  uniform sampler2D u_texture;
  uniform float u_shift;
  varying vec2 v_uv;

  void main() {
    float red = texture2D(u_texture, v_uv + vec2(u_shift, 0.0)).a;
    float green = texture2D(u_texture, v_uv).a;
    float blue = texture2D(u_texture, v_uv - vec2(u_shift, 0.0)).a;
    float alpha = max(red, max(green, blue));
    gl_FragColor = vec4(red, green, blue, alpha);
  }
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function NeonRGBTextEffect({ text, className }: NeonRGBTextEffectProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) return;

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vertexShader || !fragmentShader) {
      if (vertexShader) gl.deleteShader(vertexShader);
      if (fragmentShader) gl.deleteShader(fragmentShader);
      return;
    }

    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return;
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return;
    }

    const buffer = gl.createBuffer();
    const texture = gl.createTexture();
    const positionLocation = gl.getAttribLocation(program, "a_position");
    const uvLocation = gl.getAttribLocation(program, "a_uv");
    const shiftLocation = gl.getUniformLocation(program, "u_shift");
    if (!buffer || !texture || positionLocation < 0 || uvLocation < 0 || !shiftLocation) {
      if (buffer) gl.deleteBuffer(buffer);
      if (texture) gl.deleteTexture(texture);
      gl.deleteProgram(program);
      return;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1, 0, 1,
        1, -1, 1, 1,
        -1, 1, 0, 0,
        -1, 1, 0, 0,
        1, -1, 1, 1,
        1, 1, 1, 0,
      ]),
      gl.STATIC_DRAW,
    );

    const textureCanvas = document.createElement("canvas");
    const textureContext = textureCanvas.getContext("2d");
    let frame = 0;

    const render = () => {
      const { width, height } = root.getBoundingClientRect();
      if (!textureContext || width <= 0 || height <= 0) return;

      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const renderWidth = Math.max(1, Math.round(width * pixelRatio));
      const renderHeight = Math.max(1, Math.round(height * pixelRatio));
      canvas.width = renderWidth;
      canvas.height = renderHeight;
      textureCanvas.width = renderWidth;
      textureCanvas.height = renderHeight;

      const styles = window.getComputedStyle(root);
      const fontSize = Number.parseFloat(styles.fontSize) * pixelRatio;
      textureContext.clearRect(0, 0, renderWidth, renderHeight);
      textureContext.fillStyle = "#ffffff";
      textureContext.font = `${styles.fontWeight} ${fontSize}px ${styles.fontFamily}`;
      textureContext.textAlign = "center";
      textureContext.textBaseline = "middle";
      textureContext.fillText(text, renderWidth / 2, renderHeight / 2);

      gl.viewport(0, 0, renderWidth, renderHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(uvLocation);
      gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 16, 8);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textureCanvas);
      gl.uniform1f(shiftLocation, 1.5 / renderWidth);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      root.dataset.webgl = "true";
    };

    const scheduleRender = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(render);
    };
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      delete root.dataset.webgl;
    };

    const observer = new ResizeObserver(scheduleRender);
    observer.observe(root);
    canvas.addEventListener("webglcontextlost", handleContextLost);
    scheduleRender();

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      delete root.dataset.webgl;
      gl.deleteBuffer(buffer);
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
    };
  }, [text]);

  return (
    <span ref={rootRef} className={cn("neon-rgb-text", className)}>
      <canvas ref={canvasRef} aria-hidden="true" />
      <span className="neon-rgb-text-fallback">{text}</span>
    </span>
  );
}
