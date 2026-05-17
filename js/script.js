(function () {
    /* ════════════════════════════════════════════════
       LIGHTBOX
       Delegación de eventos sobre document → funciona
       con imágenes presentes y futuras sin re-inicializar.
    ════════════════════════════════════════════════ */

    /* ── crear estructura del lightbox en el DOM ── */
    const overlay = document.createElement('div');
    overlay.id = 'lightbox';
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Imagen ampliada');

    const imgEl = document.createElement('img');
    imgEl.id = 'lightbox-img';
    imgEl.alt = '';

    overlay.appendChild(imgEl);
    document.body.appendChild(overlay);

    /* ── abrir ── */
    function open(src, alt) {
        imgEl.src = src;
        imgEl.alt = alt || '';
        overlay.classList.add('is-open');
        document.documentElement.style.overflow = 'hidden';
    }

    /* ── cerrar ── */
    function close() {
        overlay.classList.remove('is-open');
        document.documentElement.style.overflow = '';
        overlay.addEventListener('transitionend', function clear() {
            imgEl.src = '';
            overlay.removeEventListener('transitionend', clear);
        });
    }

    /* ── delegación: cualquier <img> de la página abre el lightbox ── */
    document.addEventListener('click', function (e) {
        const target = e.target;

        if (target.tagName === 'IMG' && target.id !== 'lightbox-img') {
            open(target.currentSrc || target.src, target.alt);
            return;
        }

        if (overlay.classList.contains('is-open')) {
            close();
        }
    });

    /* ── cerrar con Escape ── */
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && overlay.classList.contains('is-open')) {
            close();
        }
    });
})();
