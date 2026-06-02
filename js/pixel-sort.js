/* ════════════════════════════════════════════════════════════════════
   PIXEL-SORT — Shader unificado
   ════════════════════════════════════════════════════════════════════
   Configurar abajo el array INSTANCES. Cada entrada:
     - containerId: id del <div> donde se inserta el canvas
     - canvasId:    id que se le pone al canvas creado
     - imageSrc:    ruta de la imagen fuente
     - gated:       true  → arranca cuando la sección entra al viewport
                    false → arranca al cargar la página
     - infinite:    true  → el sort no converge nunca. Usa un shader
                            con re-inyección de ruido desde la imagen
                            original y desviaciones de umbral por
                            columna para que algunas columnas se
                            ordenen rápido y otras lento. Parámetros
                            aleatorizados por sesión.
   ════════════════════════════════════════════════════════════════════ */

(function () {
    const INSTANCES = [
        {
            containerId: 'images-cover',
            canvasId:    'cover-canvas',
            imageSrc:    'media/img/music/portrait.jpg',
            gated:       false,
            infinite:    true,
        },
        {
            containerId: 'images-livecoding',
            canvasId:    'livecoding-canvas',
            imageSrc:    'media/img/livecoding/reina.jpeg',
            gated:       true,
            infinite:    true,
        },
        {
            containerId: 'images-t37',
            canvasId:    't37-canvas',
            imageSrc:    'media/img/t37/wordart.png',
            gated:       true,
            infinite:    true,
        },
    ];

    /* ── parámetros globales del efecto ── */
    const SORT_DURATION    = 10.0;
    const STOP_MIN         = -0.25;
    const PASSES_PER_FRAME = 1;

    /* ════════════════════════════════════════════════
       SHADERS (compartidos entre instancias)
    ════════════════════════════════════════════════ */
    const VS = `
        attribute vec2 a_pos;
        varying   vec2 v_uv;
        void main(){
            v_uv        = a_pos * 0.5 + 0.5;
            gl_Position = vec4(a_pos, 0.0, 1.0);
        }
    `;

    /* init blit: source image → FBO con cover-fit */
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

    /* pixel-sort estándar: brillantes ascienden */
    const FS_SORT = `
        precision highp float;
        uniform sampler2D u_tex;
        uniform vec2      u_res;
        uniform float     u_stop;
        uniform float     u_steps;
        uniform float     u_frame;
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

            vec4  myC  = texture2D(u_tex, (px               + 0.5) / u_res);
            vec4  neiC = texture2D(u_tex, (vec2(px.x, neiY) + 0.5) / u_res);
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

    /* pixel-sort INFINITO: igual que el estándar pero
         a) cada columna tiene un offset de umbral propio (hash de x +
            seed). Algunas columnas usan un umbral más alto y se sortean
            menos; otras más bajo y se sortean más. Resultado: ritmos
            visuales diferentes por columna.
         b) tras la decisión del sort, un pequeño porcentaje de píxeles
            se re-inyecta desde la imagen original cada frame. Esto
            mantiene "trabajo" indefinidamente: los píxeles re-inyectados
            son material fresco que el sort vuelve a ordenar.            */
    const FS_SORT_INFINITE = `
        precision highp float;
        uniform sampler2D u_tex;
        uniform sampler2D u_orig;
        uniform vec2      u_res;
        uniform float     u_stop;
        uniform float     u_steps;
        uniform float     u_frame;
        uniform float     u_noiseRate;
        uniform float     u_colOffsetMax;
        uniform float     u_seed;
        varying vec2 v_uv;

        float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
        float hash11(float n){ return fract(sin(n) * 43758.5453); }
        float hash21(vec2 p){
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main(){
            vec2  px     = floor(gl_FragCoord.xy);
            float blockH = max(2.0, floor(u_res.y / max(u_steps, 1.0)));
            float posInB = floor(mod(px.y, blockH));

            float parity  = mod(floor(u_frame), 2.0);
            bool  isLower = (mod(posInB - parity + 200.0, 2.0) < 0.5);

            float neiY = isLower ? px.y + 1.0 : px.y - 1.0;

            /* desviación del umbral propia de la columna (constante por
               sesión, hash de x). Ambos píxeles del par usan la misma
               para no romper la coherencia del sort.                    */
            float colOffset = (hash11(px.x * 0.137 + u_seed) - 0.5)
                              * 2.0 * u_colOffsetMax;
            float effStop = u_stop + colOffset;

            vec4 outColor;

            if(neiY < 0.0 || neiY >= u_res.y ||
               abs(floor(neiY / blockH) - floor(px.y / blockH)) > 0.5){
                outColor = texture2D(u_tex, (px + 0.5) / u_res);
            } else {
                vec4  myC  = texture2D(u_tex, (px               + 0.5) / u_res);
                vec4  neiC = texture2D(u_tex, (vec2(px.x, neiY) + 0.5) / u_res);
                float myL  = luma(myC.rgb);
                float neiL = luma(neiC.rgb);

                if(myL <= effStop || neiL <= effStop){
                    outColor = myC;
                } else if((isLower && myL > neiL) || (!isLower && myL < neiL)){
                    outColor = neiC;
                } else {
                    outColor = myC;
                }
            }

            /* re-inyección de ruido: una pequeña fracción de píxeles
               vuelve al color original cada frame. Mantiene el sort
               siempre con material que reordenar.                       */
            float h = hash21(px + vec2(u_frame * 0.017, u_seed));
            if(h < u_noiseRate){
                outColor = texture2D(u_orig, (px + 0.5) / u_res);
            }

            gl_FragColor = outColor;
        }
    `;

    const FS_BLIT = `
        precision mediump float;
        uniform sampler2D u_tex;
        varying vec2 v_uv;
        void main(){ gl_FragColor = texture2D(u_tex, v_uv); }
    `;

    /* ════════════════════════════════════════════════
       FACTORY: una instancia por config
    ════════════════════════════════════════════════ */
    function createInstance(cfg){
        const container = document.getElementById(cfg.containerId);
        if(!container) return;

        const isInfinite = !!cfg.infinite;

        const canvas = document.createElement('canvas');
        canvas.id = cfg.canvasId;
        container.appendChild(canvas);

        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if(!gl) return;

        /* ── compile / link ── */
        function mkShader(type, src){
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if(!gl.getShaderParameter(s, gl.COMPILE_STATUS))
                console.error('[pixel-sort:'+cfg.containerId+']', gl.getShaderInfoLog(s));
            return s;
        }
        function mkProg(fsSrc){
            const p = gl.createProgram();
            gl.attachShader(p, mkShader(gl.VERTEX_SHADER, VS));
            gl.attachShader(p, mkShader(gl.FRAGMENT_SHADER, fsSrc));
            gl.linkProgram(p);
            if(!gl.getProgramParameter(p, gl.LINK_STATUS))
                console.error('[pixel-sort:'+cfg.containerId+'] link:', gl.getProgramInfoLog(p));
            return p;
        }

        const initProg = mkProg(FS_INIT);
        const sortProg = mkProg(isInfinite ? FS_SORT_INFINITE : FS_SORT);
        const blitProg = mkProg(FS_BLIT);

        /* ── fullscreen quad ── */
        const quadBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.bufferData(gl.ARRAY_BUFFER,
            new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

        function bindQuad(prog){
            const loc = gl.getAttribLocation(prog, 'a_pos');
            gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        }

        /* ── ping-pong FBOs ── */
        let fboW = 0, fboH = 0;
        const fbos = [null, null];
        const texs = [null, null];
        let pingIdx    = 0;
        let frameCount = 0;

        /* FBO/textura extra para el original cover-fit (sólo infinito) */
        let origTex = null;
        let origFBO = null;

        function makeRGBATex(w, h){
            const t = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0,
                          gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            return t;
        }
        function makeFBO(tex){
            const f = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, f);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                                    gl.TEXTURE_2D, tex, 0);
            return f;
        }

        function createFBOs(w, h){
            for(let i = 0; i < 2; i++){
                if(texs[i]) gl.deleteTexture(texs[i]);
                if(fbos[i]) gl.deleteFramebuffer(fbos[i]);
                texs[i] = makeRGBATex(w, h);
                fbos[i] = makeFBO(texs[i]);
            }
            if(isInfinite){
                if(origTex) gl.deleteTexture(origTex);
                if(origFBO) gl.deleteFramebuffer(origFBO);
                origTex = makeRGBATex(w, h);
                origFBO = makeFBO(origTex);
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            fboW = w;
            fboH = h;
        }

        function resetPingPong(){
            const w = canvas.width;
            const h = canvas.height;
            if(!w || !h || !imgLoaded) return;

            createFBOs(w, h);

            gl.useProgram(initProg);
            bindQuad(initProg);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, imgTex);
            gl.uniform1i(gl.getUniformLocation(initProg, 'u_img'),      0);
            gl.uniform2f(gl.getUniformLocation(initProg, 'u_canvas'),   w, h);
            gl.uniform2f(gl.getUniformLocation(initProg, 'u_img_size'), imgW, imgH);

            for(let i = 0; i < 2; i++){
                gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[i]);
                gl.viewport(0, 0, w, h);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            }
            if(isInfinite){
                gl.bindFramebuffer(gl.FRAMEBUFFER, origFBO);
                gl.viewport(0, 0, w, h);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);

            pingIdx    = 0;
            frameCount = 0;
        }

        /* ── source image ── */
        const imgTex  = gl.createTexture();
        let imgLoaded = false;
        let imgW = 1, imgH = 1;

        const img = new Image();
        img.src = cfg.imageSrc;
        img.onload = function(){
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

        /* ── resize ── */
        function resize(){
            const r = canvas.getBoundingClientRect();
            const w = Math.round(r.width);
            const h = Math.round(r.height);
            if(canvas.width === w && canvas.height === h) return;
            canvas.width  = w;
            canvas.height = h;
            if(imgLoaded) resetPingPong();
        }
        new ResizeObserver(resize).observe(container);
        resize();

        /* ── uniform locations ── */
        const uSort = {
            tex:   gl.getUniformLocation(sortProg, 'u_tex'),
            res:   gl.getUniformLocation(sortProg, 'u_res'),
            stop:  gl.getUniformLocation(sortProg, 'u_stop'),
            steps: gl.getUniformLocation(sortProg, 'u_steps'),
            frame: gl.getUniformLocation(sortProg, 'u_frame'),
        };
        if(isInfinite){
            uSort.orig         = gl.getUniformLocation(sortProg, 'u_orig');
            uSort.noiseRate    = gl.getUniformLocation(sortProg, 'u_noiseRate');
            uSort.colOffsetMax = gl.getUniformLocation(sortProg, 'u_colOffsetMax');
            uSort.seed         = gl.getUniformLocation(sortProg, 'u_seed');
        }
        const uBlit = { tex: gl.getUniformLocation(blitProg, 'u_tex') };

        /* ── parámetros aleatorizados por sesión (sólo infinito) ── */
        const SEED          = Math.random() * 100.0;
        const NOISE_RATE    = 0.006 + Math.random() * 0.016;  /* 0.006 – 0.022 */
        const COL_OFFSET_MAX= 0.15  + Math.random() * 0.25;   /* 0.15 – 0.40   */

        /* ── activación ── */
        let t0     = cfg.gated ? null : performance.now();
        let active = !cfg.gated;

        if(cfg.gated){
            const observer = new IntersectionObserver(function(entries){
                for(const e of entries){
                    if(e.isIntersecting && !active){
                        active = true;
                        t0 = performance.now();
                        observer.disconnect();
                    }
                }
            }, { threshold: 0.1 });
            observer.observe(container);
        }

        /* ── render loop ── */
        function frame(ts){
            requestAnimationFrame(frame);
            resize();
            if(!imgLoaded || !fboW || !fboH) return;

            if(active){
                const elapsed = (ts - t0) * 0.001;
                const t    = Math.min(1.0, elapsed / SORT_DURATION);
                const stop = 1.0 - t * (1.0 - STOP_MIN);

                gl.useProgram(sortProg);
                bindQuad(sortProg);
                gl.uniform2f(uSort.res,   fboW, fboH);
                gl.uniform1f(uSort.stop,  stop);
                gl.uniform1f(uSort.steps, 1.0);
                if(isInfinite){
                    gl.uniform1f(uSort.noiseRate,    NOISE_RATE);
                    gl.uniform1f(uSort.colOffsetMax, COL_OFFSET_MAX);
                    gl.uniform1f(uSort.seed,         SEED);
                }

                for(let p = 0; p < PASSES_PER_FRAME; p++){
                    const readIdx  = pingIdx;
                    const writeIdx = 1 - pingIdx;

                    gl.activeTexture(gl.TEXTURE0);
                    gl.bindTexture(gl.TEXTURE_2D, texs[readIdx]);
                    gl.uniform1i(uSort.tex,   0);
                    gl.uniform1f(uSort.frame, frameCount);

                    if(isInfinite){
                        gl.activeTexture(gl.TEXTURE1);
                        gl.bindTexture(gl.TEXTURE_2D, origTex);
                        gl.uniform1i(uSort.orig, 1);
                    }

                    gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[writeIdx]);
                    gl.viewport(0, 0, fboW, fboH);
                    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

                    pingIdx = writeIdx;
                    frameCount++;
                }
            }

            /* blit always */
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
    }

    /* ── lanzar todas las instancias ── */
    INSTANCES.forEach(createInstance);
})();
