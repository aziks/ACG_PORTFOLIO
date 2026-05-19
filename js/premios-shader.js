(function () {
    /* ── DOM ── */
    const container = document.getElementById("images-premios");
    if (!container) return;

    const canvas = document.createElement("canvas");
    canvas.id = "premios-canvas";
    container.appendChild(canvas);

    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return;

    /* ════════════════════════════════════════════════
       SHADERS
    ════════════════════════════════════════════════ */
    const VS = `
        attribute vec2 a_pos;
        void main(){
            gl_Position = vec4(a_pos, 0.0, 1.0);
        }
    `;

    /* Shader original (formato twigl) traducido a GLSL ES 1.00.
       Mantiene los coeficientes vec4(-1.2, 2., -1.5, 0) para reproducir
       la paleta de la web: morado arriba, verde abajo.
       tanh no existe en GLSL ES 1.00 → implementación manual.        */
    const FS = `
        precision highp float;
        uniform vec2  r;
        uniform float t;

        vec4 tanh4(vec4 x){
            vec4 e = exp(2.0 * x);
            return (e - 1.0) / (e + 1.0);
        }

        void main(){
            vec2 FC = gl_FragCoord.xy;
            vec4 o  = vec4(0.0);

            /* el factor 1.6 amplía el rango de p → zoom out: la
               "esfera" pasa a ocupar la zona central con margen alrededor */
            vec2 p  = (FC * 2.0 - r) / r.y * 2.5;
            vec2 l  = vec2(0.0);
            vec2 i  = vec2(0.0);

            l += 4.0 - 4.0 * abs(0.7 - dot(p, p));
            vec2 v = p * l;

            for(int idx = 0; idx < 8; idx++){
                i.y = float(idx) + 1.0;
                v  += cos(v.yx * i.y + i + t) / i.y + 0.7;
                o  += (sin(v.xyyx) + 1.0) * abs(v.x - v.y);
            }

            o = tanh4(5.0 * exp(l.x - 4.0 - p.y * vec4(-1.2, 2.0, -1.5, 0.0)) / o);
            gl_FragColor = o;
        }
    `;

    /* ════════════════════════════════════════════════
       COMPILE / LINK
    ════════════════════════════════════════════════ */
    function mkShader(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
            console.error("[premios-shader]", gl.getShaderInfoLog(s));
        return s;
    }

    const prog = gl.createProgram();
    gl.attachShader(prog, mkShader(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, mkShader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
        console.error("[premios-shader] link:", gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    /* ── fullscreen quad ── */
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uR = gl.getUniformLocation(prog, "r");
    const uT = gl.getUniformLocation(prog, "t");

    /* ════════════════════════════════════════════════
       RESIZE
    ════════════════════════════════════════════════ */
    function resize() {
        const rect = container.getBoundingClientRect();
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);
        if (canvas.width === w && canvas.height === h) return;
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
    }
    new ResizeObserver(resize).observe(container);
    resize();

    /* ════════════════════════════════════════════════
       RENDER LOOP
    ════════════════════════════════════════════════ */
    const t0 = performance.now();
    function frame(ts) {
        requestAnimationFrame(frame);
        resize();
        if (!canvas.width || !canvas.height) return;

        gl.uniform2f(uR, canvas.width, canvas.height);
        gl.uniform1f(uT, (ts - t0) * 0.001);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    requestAnimationFrame(frame);
})();
