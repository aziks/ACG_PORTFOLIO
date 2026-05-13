(function () {
    /* ── DOM ── */
    const container = document.getElementById("images-cover");
    if (!container) return;

    const canvas = document.createElement("canvas");
    canvas.id = "cover-canvas";
    container.appendChild(canvas);

    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return;

    /* ════════════════════════════════════════════════
       SHADERS
    ════════════════════════════════════════════════ */

    const VS = `
        attribute vec2 a_pos;
        varying   vec2 v_uv;
        void main(){
            v_uv        = a_pos * 0.5 + 0.5;
            gl_Position = vec4(a_pos, 0.0, 1.0);
        }
    `;

    /* init blit: source image → FBO con cover-fit
     *
     *  Si cAR > iAR → canvas más ancho → imagen llena ancho, recortar alto:
     *    uv.y *= iAR / cAR   (contrae el rango, vemos la parte central)
     *  Si cAR < iAR → canvas más alto  → imagen llena alto,  recortar ancho:
     *    uv.x *= cAR / iAR
     */
    const FS_INIT = `
        precision highp float;
        uniform sampler2D u_img;
        uniform vec2      u_canvas;
        uniform vec2      u_img_size;
        varying vec2 v_uv;

        void main(){
            float cAR = u_canvas.x   / u_canvas.y;
            float iAR = u_img_size.x / u_img_size.y;

            vec2 uv = v_uv - 0.5;
            if(cAR > iAR){
                uv.y *= iAR / cAR;
            } else {
                uv.x *= cAR / iAR;
            }
            uv += 0.5;

            if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0){
                gl_FragColor = vec4(0.039, 0.039, 0.039, 1.0);
                return;
            }
            gl_FragColor = texture2D(u_img, uv);
        }
    `;

    /* pixel-sort: odd/even transposition sort vertical */
    const FS_SORT = `
        precision highp float;
        uniform sampler2D u_tex;
        uniform vec2      u_res;
        uniform float     u_stop;    /* umbral de luma 0..1   */
        uniform float     u_steps;   /* nº bloques verticales */
        uniform float     u_frame;   /* contador de frames    */
        varying vec2 v_uv;

        float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

        void main(){
            vec2  px     = floor(gl_FragCoord.xy);
            float blockH = max(2.0, floor(u_res.y / max(u_steps, 1.0)));
            float posInB = floor(mod(px.y, blockH));

            float parity  = mod(floor(u_frame), 2.0);
            bool  isLower = (mod(posInB - parity + 200.0, 2.0) < 0.5);

            float neiY = isLower ? px.y + 1.0 : px.y - 1.0;

            if(neiY < 0.0 || neiY >= u_res.y ||
               abs(floor(neiY / blockH) - floor(px.y / blockH)) > 0.5){
                gl_FragColor = texture2D(u_tex, (px + 0.5) / u_res);
                return;
            }

            vec4  myC  = texture2D(u_tex, (px                   + 0.5) / u_res);
            vec4  neiC = texture2D(u_tex, (vec2(px.x, neiY)     + 0.5) / u_res);
            float myL  = luma(myC.rgb);
            float neiL = luma(neiC.rgb);

            if(myL <= u_stop || neiL <= u_stop){
                gl_FragColor = myC;
                return;
            }

            if((isLower && myL > neiL) || (!isLower && myL < neiL)){
                gl_FragColor = neiC;
            } else {
                gl_FragColor = myC;
            }
        }
    `;

    const FS_BLIT = `
        precision mediump float;
        uniform sampler2D u_tex;
        varying vec2 v_uv;
        void main(){ gl_FragColor = texture2D(u_tex, v_uv); }
    `;

    /* ════════════════════════════════════════════════
       COMPILE / LINK
    ════════════════════════════════════════════════ */
    function mkShader(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
            console.error("[cover-shader]", gl.getShaderInfoLog(s));
        return s;
    }
    function mkProg(fsSrc) {
        const p = gl.createProgram();
        gl.attachShader(p, mkShader(gl.VERTEX_SHADER, VS));
        gl.attachShader(p, mkShader(gl.FRAGMENT_SHADER, fsSrc));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS))
            console.error("[cover-shader] link:", gl.getProgramInfoLog(p));
        return p;
    }

    const initProg = mkProg(FS_INIT);
    const sortProg = mkProg(FS_SORT);
    const blitProg = mkProg(FS_BLIT);

    /* ── fullscreen quad ── */
    const quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    function bindQuad(prog) {
        const loc = gl.getAttribLocation(prog, "a_pos");
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }

    /* ════════════════════════════════════════════════
       PING-PONG FBOs
    ════════════════════════════════════════════════ */
    let fboW = 0,
        fboH = 0;
    const fbos = [null, null];
    const texs = [null, null];
    let pingIdx = 0;
    let frameCount = 0;

    function createFBOs(w, h) {
        for (let i = 0; i < 2; i++) {
            if (texs[i]) gl.deleteTexture(texs[i]);
            if (fbos[i]) gl.deleteFramebuffer(fbos[i]);

            texs[i] = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texs[i]);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            fbos[i] = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[i]);
            gl.framebufferTexture2D(
                gl.FRAMEBUFFER,
                gl.COLOR_ATTACHMENT0,
                gl.TEXTURE_2D,
                texs[i],
                0,
            );
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        fboW = w;
        fboH = h;
    }

    function resetPingPong() {
        const w = canvas.width;
        const h = canvas.height;
        if (!w || !h || !imgLoaded) return;

        createFBOs(w, h);

        gl.useProgram(initProg);
        bindQuad(initProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, imgTex);
        gl.uniform1i(gl.getUniformLocation(initProg, "u_img"), 0);
        gl.uniform2f(gl.getUniformLocation(initProg, "u_canvas"), w, h);
        gl.uniform2f(gl.getUniformLocation(initProg, "u_img_size"), imgW, imgH);

        for (let i = 0; i < 2; i++) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[i]);
            gl.viewport(0, 0, w, h);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        pingIdx = 0;
        frameCount = 0;
    }

    /* ════════════════════════════════════════════════
       SOURCE IMAGE
    ════════════════════════════════════════════════ */
    const imgTex = gl.createTexture();
    let imgLoaded = false;
    let imgW = 1,
        imgH = 1;

    const img = new Image();
    img.src = "media/img/music/portrait.jpg";
    img.onload = function () {
        imgW = img.naturalWidth;
        imgH = img.naturalHeight;

        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.bindTexture(gl.TEXTURE_2D, imgTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

        imgLoaded = true;
        resetPingPong();
    };

    /* ════════════════════════════════════════════════
       CANVAS RESIZE
    ════════════════════════════════════════════════ */
    function resize() {
        const r = container.getBoundingClientRect();
        const w = Math.round(r.width);
        const h = Math.round(r.height);
        if (canvas.width === w && canvas.height === h) return;
        canvas.width = w;
        canvas.height = h;
        if (imgLoaded) resetPingPong();
    }
    new ResizeObserver(resize).observe(container);
    resize();

    /* ════════════════════════════════════════════════
       UNIFORM LOCATIONS
    ════════════════════════════════════════════════ */
    const uSort = {
        tex: gl.getUniformLocation(sortProg, "u_tex"),
        res: gl.getUniformLocation(sortProg, "u_res"),
        stop: gl.getUniformLocation(sortProg, "u_stop"),
        steps: gl.getUniformLocation(sortProg, "u_steps"),
        frame: gl.getUniformLocation(sortProg, "u_frame"),
    };
    const uBlit = { tex: gl.getUniformLocation(blitProg, "u_tex") };

    /* ════════════════════════════════════════════════
       RENDER LOOP
    ════════════════════════════════════════════════ */
    /* ── parámetros del efecto ──────────────────────────────────────── *
     *                                                                   *
     *  SORT_DURATION   segundos hasta alcanzar el umbral mínimo         *
     *  STOP_MIN        umbral final de luma: valores negativos fuerzan  *
     *                  que TODOS los píxeles participen (sin stops)     *
     *  PASSES_PER_FRAME iteraciones de burbuja por fotograma: más =     *
     *                  runs más largos, efecto más agresivo             */
    const SORT_DURATION = 20.0;
    const STOP_MIN = -0.3;
    const PASSES_PER_FRAME = 7.5;

    /* t0 fijado en el momento que ejecuta el script (carga de la página),
       no cuando termina de cargar la imagen, para que el efecto cuente
       desde el primer instante visible.                                  */
    const t0 = performance.now();

    function frame(ts) {
        requestAnimationFrame(frame);
        resize();
        if (!imgLoaded || !fboW || !fboH) return;

        const elapsed = (ts - t0) * 0.001;

        /* rampa suavizada (ease-in): el efecto arranca despacio
           y se acelera a medida que pasa el tiempo               */
        const t = Math.min(1.0, elapsed / SORT_DURATION);
        const ease = t * t;
        const stop = 1.0 - ease * (1.0 - STOP_MIN);

        /* ── N pases de sort por frame ── */
        gl.useProgram(sortProg);
        bindQuad(sortProg);
        gl.uniform2f(uSort.res, fboW, fboH);
        gl.uniform1f(uSort.stop, stop);
        gl.uniform1f(uSort.steps, 1.0);

        for (let p = 0; p < PASSES_PER_FRAME; p++) {
            const readIdx = pingIdx;
            const writeIdx = 1 - pingIdx;

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, texs[readIdx]);
            gl.uniform1i(uSort.tex, 0);
            gl.uniform1f(uSort.frame, frameCount);

            gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[writeIdx]);
            gl.viewport(0, 0, fboW, fboH);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            pingIdx = writeIdx;
            frameCount++;
        }

        /* ── blit to screen ── */
        gl.useProgram(blitProg);
        bindQuad(blitProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texs[pingIdx]);
        gl.uniform1i(uBlit.tex, 0);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    requestAnimationFrame(frame);
})();
