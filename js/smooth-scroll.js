(function () {
    if (typeof gsap === 'undefined' || typeof ScrollSmoother === 'undefined') {
        console.warn('[smooth-scroll] GSAP/ScrollSmoother no disponible');
        return;
    }

    gsap.registerPlugin(ScrollTrigger, ScrollSmoother);

    ScrollSmoother.create({
        wrapper:         '#smooth-wrapper',
        content:         '#smooth-content',
        smooth:          1.2,    /* segundos de "lag" del scroll          */
        effects:         true,   /* habilita data-speed / data-lag         */
        normalizeScroll: true,   /* corrige diferencias entre navegadores  */
        smoothTouch:     0.1,    /* casi nativo en móvil (heavy = molesto) */
    });
})();
