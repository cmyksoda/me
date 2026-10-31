// ?debug's graphics checks: each draws one green square the way some part of the menu draws, then reads it back.

const VERTEX = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const fragment = (body: string, declarations = '') => `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${declarations}
void main() {
  ${body}
}`;

export async function testGraphics(): Promise<string[]> {
  const canvas = Object.assign(document.createElement('canvas'), { width: 8, height: 8 });
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, premultipliedAlpha: false });
  if (!gl) return ['test: no webgl2'];

  const program = (source: string) => {
    const made = gl.createProgram()!;
    for (const [type, text] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, source]] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      gl.attachShader(made, shader);
    }
    gl.bindAttribLocation(made, 0, 'aPosition');
    gl.linkProgram(made);
    return made;
  };
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const solid = (channel: number) => new Uint8Array(16).map((_, i) => (i % 4 === channel || i % 4 === 3 ? 255 : 0));
  const texture = (setParameters: boolean, source?: ImageBitmap, pixels = solid(1)) => {
    const made = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, made);
    if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    if (setParameters) gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    return made;
  };
  const sampler = gl.createSampler()!;
  gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const read = (name: string, draw: () => void) => {
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    draw();
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const pixel = new Uint8Array(4);
    gl.readPixels(4, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return `test ${name}: ${[...pixel].join(',')}  error 0x${gl.getError().toString(16)}`;
  };

  const canvas2d = Object.assign(document.createElement('canvas'), { width: 2, height: 2 });
  const context = canvas2d.getContext('2d')!;
  context.fillStyle = '#00ff00';
  context.fillRect(0, 0, 2, 2);
  const bitmap = await createImageBitmap(canvas2d, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });

  const plain = program(fragment('fragColor = texture(uTexture, vUv);', 'uniform sampler2D uTexture;'));
  const array = program(fragment('fragColor = texture(uTexture[1], vUv);', 'uniform sampler2D uTexture[2];'));
  return [
    read('color', () => gl.useProgram(program(fragment('fragColor = vec4(0.0, 1.0, 0.0, 1.0);')))),
    read('texture', () => {
      gl.useProgram(plain);
      texture(true);
    }),
    read('sampler', () => {
      gl.useProgram(plain);
      texture(false);
      gl.bindSampler(0, sampler);
    }),
    // Unit 0 holds red, so reading the wrong element of the array shows.
    read('array', () => {
      gl.useProgram(array);
      texture(false, undefined, solid(0));
      gl.activeTexture(gl.TEXTURE1);
      texture(false);
      gl.bindSampler(0, sampler);
      gl.bindSampler(1, sampler);
      gl.uniform1iv(gl.getUniformLocation(array, 'uTexture'), [0, 1]);
      gl.activeTexture(gl.TEXTURE0);
    }),
    read('bitmap', () => {
      gl.useProgram(plain);
      gl.uniform1i(gl.getUniformLocation(plain, 'uTexture'), 0);
      texture(false, bitmap);
      gl.bindSampler(0, sampler);
    }),
  ];
}
