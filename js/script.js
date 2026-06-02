(function () {
    /* ════════════════════════════════════════════════
       LIGHTBOX
       Delegación de eventos sobre document → funciona
       con imágenes presentes y futuras sin re-inicializar.
    ════════════════════════════════════════════════ */

    /* ── crear estructura del lightbox en el DOM ── */
    const overlay = document.createElement("div");
    overlay.id = "lightbox";
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Imagen ampliada");

    const imgEl = document.createElement("img");
    imgEl.id = "lightbox-img";
    imgEl.alt = "";

    overlay.appendChild(imgEl);
    document.body.appendChild(overlay);

    /* ── abrir ── */
    function open(src, alt) {
        imgEl.src = src;
        imgEl.alt = alt || "";
        overlay.classList.add("is-open");
        document.documentElement.style.overflow = "hidden";
    }

    /* ── cerrar ── */
    function close() {
        overlay.classList.remove("is-open");
        document.documentElement.style.overflow = "";
        overlay.addEventListener("transitionend", function clear() {
            imgEl.src = "";
            overlay.removeEventListener("transitionend", clear);
        });
    }

    /* ── delegación: cualquier <img> de la página abre el lightbox ── */
    document.addEventListener("click", function (e) {
        const target = e.target;

        if (target.tagName === "IMG" && target.id !== "lightbox-img") {
            open(target.currentSrc || target.src, target.alt);
            return;
        }

        if (overlay.classList.contains("is-open")) {
            close();
        }
    });

    /* ── cerrar con Escape ── */
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && overlay.classList.contains("is-open")) {
            close();
        }
    });

    /* ════════════════════════════════════════════════
       PROJECT-CARD LINE REVEAL
       Marca cada .project-card como visible al entrar
       en el viewport. El CSS se encarga de animar la
       línea lateral (::before) desde arriba con scaleY.
    ════════════════════════════════════════════════ */
    function initCardLineReveal() {
        const cards = document.querySelectorAll(".project-card");
        if (!cards.length || !("IntersectionObserver" in window)) {
            /* fallback: mostrar todas si IO no está disponible */
            cards.forEach((c) => c.classList.add("is-visible"));
            return;
        }
        const io = new IntersectionObserver(
            function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        entry.target.classList.add("is-visible");
                        io.unobserve(entry.target);
                    }
                });
            },
            { threshold: 0.35 },
        );
        cards.forEach((c) => io.observe(c));
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initCardLineReveal);
    } else {
        initCardLineReveal();
    }
})();
