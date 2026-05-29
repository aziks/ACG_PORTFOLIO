(function () {
    if (typeof gsap === 'undefined' || typeof ScrollSmoother === 'undefined') {
        console.warn('[smooth-scroll] GSAP/ScrollSmoother no disponible');
        return;
    }

    gsap.registerPlugin(ScrollTrigger, ScrollSmoother);

    const smoother = ScrollSmoother.create({
        wrapper:         '#smooth-wrapper',
        content:         '#smooth-content',
        smooth:          1.2,    /* segundos de "lag" del scroll          */
        effects:         true,   /* habilita data-speed / data-lag         */
        normalizeScroll: true,   /* corrige diferencias entre navegadores  */
        smoothTouch:     0.1,    /* casi nativo en móvil (heavy = molesto) */
    });

    /* anchor links (href="#X") → scroll suave a la sección.
       ScrollSmoother no siempre intercepta el click nativo, así que
       lo manejamos manualmente con su API.                           */
    document.addEventListener('click', function (e) {
        const link = e.target.closest('a[href^="#"]');
        if (!link) return;
        const id = link.getAttribute('href');
        if (id.length <= 1) return;
        const target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        smoother.scrollTo(target, true, 'top top');
    });
})();
