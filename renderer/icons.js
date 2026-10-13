// Iconos de trazo (24×24), el loto y el logotipo de Octos.
(function () {
  const P = {
    home: '<path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".6" fill="currentColor"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    box: '<path d="M21 8l-9-5-9 5 9 5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
    type: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    text: '<path d="M4 6h16M4 10h16M4 14h10M4 18h7"/>',
    heading: '<path d="M6 4v16M18 4v16M6 12h12"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    redirect: '<path d="M4 17V9a4 4 0 0 1 4-4h11"/><path d="M15 1l4 4-4 4"/><path d="M4 21h8"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    code: '<path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 4l-4 16"/>',
    cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.3a2 2 0 0 0 2 1.7h8.3a2 2 0 0 0 2-1.6L21 8H6"/>',
    zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2"/>',
    play: '<path d="M7 4.5v15l12-7.5z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
    command: '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
    sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    save: '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h9M7 21v-7h10v7"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
    gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/>',
    sitemap: '<rect x="9" y="3" width="6" height="5" rx="1.5"/><rect x="3" y="16" width="6" height="5" rx="1.5"/><rect x="15" y="16" width="6" height="5" rx="1.5"/><path d="M12 8v4M6 16v-4h12v4"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  };

  function icon(name, cls = '') {
    if (name === 'logo') return lotus(26);
    if (name === 'logotipo') return logotipo(32);
    const body = P[name] || P.info;
    return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  }

  // Loto oficial (assets/brand/octos-loto.svg): ocho cápsulas de 20 × 46
  // giradas 45° alrededor de (100, 100) y un punto central de r = 6.
  // Orden fijo desde la cima, en sentido horario.
  const PETALS = ['#7FD0FF', '#4FB0FF', '#2E8CFF', '#5E80F8', '#8E7BFF', '#B79CFA', '#9ADFD0', '#7BE0B0'];
  const CENTER = '#2E8CFF';
  const INK = {
    azul: 'var(--octos-blue, #0B6BFF)',
    blanco: '#FFFFFF',
  };
  const MIN_COLOR = 24; // el loto a color no baja de 24 px de ancho

  function lotusShapes(variant) {
    const one = INK[variant];
    let out = '';
    for (let i = 0; i < 8; i++) {
      const fill = one ? `style="fill:${one}"` : `fill="${PETALS[i]}"`;
      const rot = i ? ` transform="rotate(${i * 45} 100 100)"` : '';
      out += `<rect x="90" y="30" width="20" height="46" rx="10" ${fill}${rot}/>`;
    }
    out += `<circle cx="100" cy="100" r="6" ${one ? `style="fill:${one}"` : `fill="${CENTER}"`}/>`;
    return out;
  }

  // lotus(size, 'color' | 'azul' | 'blanco'). Bajo 24 px la versión a color
  // pasa a la azul, como pide el manual.
  function lotus(size = 32, variant = 'color') {
    const v = variant === 'color' && size < MIN_COLOR ? 'azul' : variant;
    return `<svg class="loto loto-${v}" width="${size}" height="${size}" viewBox="20 20 160 160" role="img" aria-label="Octos">${lotusShapes(v)}</svg>`;
  }

  // Logotipo: loto de alto H y «Octos» en Manrope 800 a 0,7 H, tracking
  // −0,02em, separado 0,25 H y centrado en vertical. Mínimo 32 px de alto.
  function logotipo(h = 32, variant = 'color') {
    const H = Math.max(32, h);
    const r = (n) => Math.round(n * 100) / 100;
    const textColor = variant === 'blanco' ? '#FFFFFF' : 'var(--ink, #12141C)';
    return `<span class="logotipo" style="display:inline-flex;align-items:center;gap:${r(H * 0.25)}px;height:${H}px">${lotus(H, variant).replace('role="img" aria-label="Octos"', 'aria-hidden="true"')}<span class="logotipo-texto" style="font-family:Manrope,'IBM Plex Sans',system-ui,sans-serif;font-weight:800;font-size:${r(H * 0.7)}px;line-height:1;letter-spacing:-0.02em;color:${textColor}">Octos</span></span>`;
  }

  // Ícono claro de app: squircle con el loto al 80 % de la escala del lienzo oficial
  // (los pétalos ocupan el 56 % del lado, igual que octos-icono-claro.svg). El contenedor (.tile-app)
  // pone el radio de 23 %, el borde hairline y shadow-icon.
  function appTile(size = 84) {
    return `<span class="tile tile-app" style="width:${size}px;height:${size}px">${lotus(Math.round(size * 0.64))}</span>`;
  }

  // Compatibilidad con el código anterior
  const logo = (size = 26) => lotus(size);

  function hydrate(root = document) {
    root.querySelectorAll('[data-icon]').forEach((el) => {
      if (el.dataset.hydrated) return;
      el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
      el.dataset.hydrated = '1';
    });
  }

  window.OctosIcons = { icon, logo, lotus, logotipo, appTile, hydrate, PETALS };
})();
