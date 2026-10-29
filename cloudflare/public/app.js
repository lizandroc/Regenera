(() => {
  if (!document.documentElement.lang) document.documentElement.lang = 'en';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.getElementById('field');
  const ctx = canvas.getContext('2d');
  const scene = document.getElementById('scene');
  const brand = document.getElementById('brand');
  const tagline = document.getElementById('tagline');
  const hint = document.getElementById('hint');
  const inside = document.getElementById('inside');
  const back = document.getElementById('back');
  const mark = document.getElementById('mark');

  const INK = [31, 58, 47];   // brand green, so the field reads as living rather than industrial
  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  addEventListener('resize', resize);

  /* ---------- Intro: tagline first, logo fades in, tagline slides under ---------- */
  function intro() {
    // Park the tagline at the vertical centre of the screen, where the logo will sit.
    const t = tagline.getBoundingClientRect();
    const offset = (H / 2) - (t.top + t.height / 2);
    tagline.style.transition = 'none';
    tagline.style.transform = `translateY(${offset}px)`;
    void tagline.offsetWidth;
    tagline.style.transition = '';

    if (reduce) {
      tagline.style.transform = 'none';
      tagline.classList.add('shown'); brand.classList.add('shown'); hint.classList.add('shown');
      return;
    }
    setTimeout(() => tagline.classList.add('shown'), 250);
    setTimeout(() => {
      brand.classList.add('shown');
      tagline.style.transform = 'translateY(0)';
      pulse(W / 2, H / 2, 0.7);
    }, 1900);
    setTimeout(() => { if (!zoomed) hint.classList.add('shown'); }, 4200);
  }
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => requestAnimationFrame(intro));

  /* ---------- Field: a grid of dots that behaves like the GitNexus graph ----------
     Move the pointer and the dot under it becomes the "selected node": it grows 1.8x,
     its neighbours stay at full strength, and every other dot drops to 25% strength
     and 60% size. Release (or click) clears the selection: every dot snaps back to
     full in one frame, and a bright wave rolls outward from that point. */
  const BASE_A = 0.22, BASE_R = 0.85;     // resting dot: ink at 22%, 0.85px radius
  const NEAR = 90;                         // neighbour radius around the pointer
  const EDGE = 52;                         // links drawn from the selected dot
  const BUCKETS = 24;
  let xs, ys, ca, cr, n = 0;
  function buildGrid() {
    const gap = W < 640 ? 12 : 14;
    const cols = Math.ceil(W / gap) + 1, rows = Math.ceil(H / gap) + 1;
    const ox = (W - (cols - 1) * gap) / 2, oy = (H - (rows - 1) * gap) / 2;
    n = cols * rows;
    xs = new Float32Array(n); ys = new Float32Array(n);
    ca = new Float32Array(n).fill(BASE_A); cr = new Float32Array(n).fill(BASE_R);
    let i = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { xs[i] = ox + c * gap; ys[i] = oy + r * gap; i++; }
    kick();
  }

  let px = -1e4, py = -1e4, selecting = false, down = false, lastMove = 0, edgeAmt = 0;
  const waves = [];
  let running = false, last = 0;

  function pulse(x, y, strength = 1) {
    if (reduce) return;
    waves.push({ x, y, t0: performance.now(), dur: 1500, max: Math.hypot(W, H) * strength, kind: 'pulse' });
    kick();
  }
  function ripple(x, y) {
    if (reduce) return;
    if (waves.length > 14) waves.shift();
    waves.push({ x, y, t0: performance.now(), dur: 1100, max: 120, kind: 'ripple' });
    kick();
  }
  function kick() { if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); } }

  const easeOut = p => 1 - Math.pow(1 - p, 3);
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const ink = a => `rgba(${INK[0]},${INK[1]},${INK[2]},${a})`;

  function frame(now) {
    const dt = Math.min(64, now - last); last = now;
    if (selecting && !down && now - lastMove > 2600) selecting = false;   // idle: ease back
    const k = reduce ? 1 : 1 - Math.pow(1 - 0.14, dt / 16.7);

    // Live waves
    const live = [];
    for (let w = waves.length - 1; w >= 0; w--) {
      const p = (now - waves[w].t0) / waves[w].dur;
      if (p >= 1) { waves.splice(w, 1); continue; }
      live.push({ ...waves[w], rad: easeOut(Math.max(0, p)) * waves[w].max, fade: 1 - p });
    }

    let moving = live.length > 0;
    let sel = -1, selD = 1e9;
    const buckets = Array.from({ length: BUCKETS }, () => []);

    for (let i = 0; i < n; i++) {
      const dx = xs[i] - px, dy = ys[i] - py;
      const d = Math.sqrt(dx * dx + dy * dy);
      let ta = BASE_A, tr = BASE_R;
      if (selecting) {
        if (d < selD) { selD = d; sel = i; }
        const t = 1 - d / NEAR;                                   // 1 at pointer, 0 at NEAR
        const dimmed = smooth(NEAR * 0.85, NEAR * 1.45, d);         // 0 inside, 1 far away
        ta = t > 0 ? BASE_A + 0.5 * t * t : BASE_A;
        tr = t > 0 ? BASE_R * (1.3 + 0.5 * t * t * t) : BASE_R;
        ta = ta * (1 - dimmed) + BASE_A * 0.25 * dimmed;
        tr = tr * (1 - dimmed) + BASE_R * 0.6 * dimmed;
      }
      for (const w of live) {
        const off = Math.sqrt((xs[i] - w.x) ** 2 + (ys[i] - w.y) ** 2) - w.rad;
        if (w.kind === 'pulse') {
          if (off > 110 || off < -110) continue;
          const b = Math.exp(-((off / 36) ** 2)) * w.fade;
          ta += b * 0.55; tr += b * 1.1;
        } else {
          if (off > 0 || off < -60 || w.rad + off > w.max) continue;
          const b = Math.cos(off / 5.5) * Math.exp(-((off / 22) ** 2)) * w.fade;
          ta += b * 0.35; tr += b * 0.75;
        }
      }
      ca[i] += (ta - ca[i]) * k;
      cr[i] += (tr - cr[i]) * k;
      if (Math.abs(ta - ca[i]) > 0.002 || Math.abs(tr - cr[i]) > 0.01) moving = true;
      const a = Math.max(0, Math.min(0.95, ca[i]));
      buckets[Math.min(BUCKETS - 1, Math.round(a / 0.95 * (BUCKETS - 1)))].push(i);
    }

    ctx.clearRect(0, 0, W, H);

    // Links from the selected dot to its neighbours, like the brightened edges in GitNexus
    edgeAmt += ((selecting ? 1 : 0) - edgeAmt) * k;
    if (edgeAmt > 0.01 && sel >= 0) {
      const sx = xs[sel], sy = ys[sel];
      ctx.lineWidth = 0.5;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(xs[i] - sx, ys[i] - sy);
        if (d === 0 || d > EDGE) continue;
        ctx.strokeStyle = ink(0.16 * (1 - d / EDGE) * edgeAmt);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(xs[i], ys[i]); ctx.stroke();
      }
      moving = moving || Math.abs((selecting ? 1 : 0) - edgeAmt) > 0.01;
    }

    for (let b = 0; b < BUCKETS; b++) {
      const list = buckets[b];
      if (!list.length || b === 0) continue;
      ctx.fillStyle = ink(b / (BUCKETS - 1) * 0.95);
      ctx.beginPath();
      for (const i of list) {
        let r = Math.max(0.3, cr[i]);
        if (i === sel && selecting) r = Math.max(r, BASE_R * 1.8 * edgeAmt);
        ctx.moveTo(xs[i] + r, ys[i]); ctx.arc(xs[i], ys[i], r, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    if (moving || selecting) requestAnimationFrame(frame);
    else running = false;
  }

  // Clear the selection: every dot jumps back to full in a single frame, then the wave.
  function flash(x, y) {
    selecting = false;
    ca.fill(BASE_A); cr.fill(BASE_R); edgeAmt = 0;
    pulse(x, y);
    kick();
  }

  brand.addEventListener('animationend', e => {
    if (e.animationName === 'refocus') brand.classList.remove('refocus');
    if (e.animationName === 'fuzzOnce' && e.target.classList.contains('mark')) brand.classList.remove('fuzzing');
  });
  // One fuzz per visit: armed on enter, re-armed only after the pointer leaves.
  let fuzzArmed = true;
  brand.addEventListener('pointerenter', e => {
    if (e.pointerType !== 'mouse' || !fuzzArmed || zoomed || reduce) return;
    fuzzArmed = false;
    brand.classList.remove('fuzzing'); void brand.offsetWidth; brand.classList.add('fuzzing');
  });
  brand.addEventListener('pointerleave', () => { fuzzArmed = true; });
  function flare() {
    brand.classList.remove('flare'); void brand.offsetWidth; brand.classList.add('flare');
    brand.classList.add('shown');
  }

  let lastX = 0, lastY = 0;
  addEventListener('pointermove', e => {
    if (zoomed) return;
    px = e.clientX; py = e.clientY;
    if (e.pointerType === 'mouse' || down) { selecting = true; lastMove = performance.now(); kick(); }
    if (down) {
      const d = Math.hypot(px - lastX, py - lastY);
      if (d > 18) { ripple(px, py); lastX = px; lastY = py; }
    }
  });
  document.addEventListener('pointerout', e => { if (!e.relatedTarget) { selecting = false; kick(); } });
  canvas.addEventListener('pointerdown', e => {
    if (zoomed) return;
    down = true; px = lastX = e.clientX; py = lastY = e.clientY;
    selecting = true; lastMove = performance.now();
    canvas.setPointerCapture(e.pointerId);
    kick();
  });
  canvas.addEventListener('pointerup', e => {
    if (!down) return;
    down = false;
    if (zoomed) return;
    flash(e.clientX, e.clientY);
    flare();
  });
  canvas.addEventListener('pointercancel', () => { down = false; selecting = false; kick(); });

  buildGrid();
  addEventListener('resize', buildGrid);
  /* ---------- The site behind the arch ---------- */
  const site = (() => {
    const nav = document.getElementById('nav');
    const hero = inside.querySelector('.hero');

    // Film: four chapters, crossfading with a slow push-in on each.
    const slides = [...inside.querySelectorAll('.film figure')];
    const chaps = [...inside.querySelectorAll('.chapters a')];
    let fi = 0, ft = null;
    function setSlide(i) {
      fi = i;
      slides.forEach((s, k) => {
        s.classList.toggle('on', k === i);
        // Only the film on screen plays; it restarts each time it comes round.
        const v = s.querySelector('video');
        if (!v) return;
        if (k === i && moving()) { v.currentTime = 0; v.play().catch(() => {}); } else v.pause();
      });
    }
    // One switch stops all movement: the film, every video, and the wheel's rotation.
    const motionBtn = document.getElementById('motionBtn');
    let still = reduce;
    try { if (localStorage.getItem('regenera-still') === '1') still = true; } catch (_) {}
    const moving = () => !still;
    function setStill(on) {
      still = on;
      motionBtn.setAttribute('aria-pressed', String(on));
      motionBtn.setAttribute('aria-label', on ? 'Play background video and motion' : 'Pause background video and motion');
      inside.classList.toggle('still', on);
      try { localStorage.setItem('regenera-still', on ? '1' : '0'); } catch (_) {}
      if (on) { clearInterval(ft); inside.querySelectorAll('video').forEach(v => v.pause()); }
      else { setSlide(fi); play(); inside.querySelectorAll('video').forEach(v => { if (v.dataset.inView === '1') v.play().catch(() => {}); }); }
    }
    motionBtn.addEventListener('click', () => setStill(!still));
    if (still) {
      motionBtn.setAttribute('aria-pressed', 'true');
      motionBtn.setAttribute('aria-label', 'Play background video and motion');
      inside.classList.add('still');
    }
    function play() { clearInterval(ft); if (moving()) ft = setInterval(() => setSlide((fi + 1) % slides.length), 7000); }
    // The index navigates; pointing at an entry previews its picture in the film.
    chaps.forEach(a => {
      const preview = () => { clearInterval(ft); setSlide(+a.dataset.slide); };
      a.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') preview(); });
      a.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') play(); });
      a.addEventListener('focus', preview);
      a.addEventListener('blur', play);
    });

    // Floating mark and section rail. The mark tucks away while scrolling down and returns
    // on the way up; both switch ink to suit the section beneath them.
    const toned = [...inside.querySelectorAll('[data-tone]')];
    const rail = document.getElementById('rail');
    const railLinks = [...rail.querySelectorAll('a')];
    let lastTop = 0;
    // Sections pin as they stack, so positions are measured from the normal page flow.
    const tops = new Map();
    function refreshTops() {
      let y = 0;
      for (const c of inside.children) {
        const pos = getComputedStyle(c).position;
        if (pos === 'fixed' || pos === 'absolute') continue;
        tops.set(c, y);
        if (c.classList.contains('finale')) { let yy = y; for (const cc of c.children) { tops.set(cc, yy); yy += cc.offsetHeight; } }
        y += c.offsetHeight;
      }
    }
    const flowTop = el => tops.has(el) ? tops.get(el) : el.offsetTop;
    function toneAt(y, side) {
      for (const sec of toned) {
        const top = flowTop(sec);
        if (y >= top && y < top + sec.offsetHeight) {
          return (side === 'right' && sec.dataset.toneRight) || sec.dataset.tone;
        }
      }
      return 'light';
    }
    // ScrollFlow: each stacked band gets a dimming layer that deepens as the next band slides over it.
    const stack = [...inside.querySelectorAll('.inside > .stack')];
    stack.forEach((sec, k) => {
      sec.style.zIndex = String(k + 1);
      const c = document.createElement('div'); c.className = 'cover'; c.setAttribute('aria-hidden', 'true');
      sec.appendChild(c); sec._cover = c;
      let n = sec.nextElementSibling; sec._next = n;
    });
    const foot = inside.querySelector('.foot');
    const partners = [...inside.querySelectorAll('.card.partner')];
    partners.forEach((c, k) => { c.style.zIndex = String(k + 1); });
    function pinStack() {
      const vh = inside.clientHeight;
      stack.forEach(sec => { sec.style.top = Math.min(0, vh - sec.offsetHeight) + 'px'; });
      partners.forEach(c => { c.style.top = Math.min(0, vh - c.offsetHeight) + 'px'; });
    }
    function flow(t, vh) {
      stack.forEach(sec => {
        if (!sec._next || reduce) return;
        const p = Math.min(1, Math.max(0, (t + vh - flowTop(sec._next)) / vh));
        sec._cover.style.opacity = (p * 0.5).toFixed(3);
      });
      // Curtain: the footer is uncovered last and inverts from light to dark as it appears.
      const r = Math.min(1, Math.max(0, (t + vh - flowTop(foot)) / foot.offsetHeight));
      const x = Math.min(1, Math.max(0, (r - 0.4) / 0.45));
      foot.style.setProperty('--inv', reduce ? '1' : (x * x * (3 - 2 * x)).toFixed(3));   // eased so the in-between tone passes quickly
    }
    function onScroll() {
      const t = inside.scrollTop, vh = inside.clientHeight;
      if (t < 120 || t < lastTop - 2 || rail.classList.contains('open')) nav.classList.remove('tucked');
      else if (t > lastTop + 2) nav.classList.add('tucked');
      lastTop = t;
      nav.classList.toggle('filled', t > 80);
      const tone = toneAt(t + 34, 'left');
      nav.classList.toggle('on-dark', tone === 'dark');
      nav.classList.toggle('on-light', tone === 'light');
      const mid = t + vh / 2;
      let active = -1;
      railLinks.forEach((a, k) => { const sec = document.getElementById(a.dataset.sec); if (sec && mid >= flowTop(sec)) active = k; });
      railLinks.forEach((a, k) => a.classList.toggle('on', k === active));
      flow(t, vh);
    }
    inside.addEventListener('scroll', onScroll, { passive: true });
    // Phones: the Index button opens the list; choosing a section closes it.
    const indexToggle = document.getElementById('indexToggle');
    const setOpen = open => {
      rail.classList.toggle('open', open);
      indexToggle.setAttribute('aria-expanded', String(open));
      indexToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };
    indexToggle.addEventListener('click', () => setOpen(!rail.classList.contains('open')));
    railLinks.forEach(a => a.addEventListener('click', () => setOpen(false)));
    rail.addEventListener('keydown', e => {
      if (e.key === 'Escape' && rail.classList.contains('open')) { setOpen(false); indexToggle.focus(); }
    });
    rail.addEventListener('focusout', e => { if (!rail.contains(e.relatedTarget)) setOpen(false); });

    // In-page links scroll the site container.
    inside.addEventListener('click', e => {
      const a = e.target.closest('a[data-jump], a[data-engage]');
      if (!a) return;
      const target = inside.querySelector(a.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      if (a.dataset.engage) {
        const r = document.getElementById('e-' + a.dataset.engage);
        if (r) r.checked = true;
      }
      inside.scrollTo({ top: flowTop(target), behavior: reduce ? 'auto' : 'smooth' });
      if (a.dataset.engage) setTimeout(() => document.getElementById('f-name').focus({ preventScroll: true }), reduce ? 0 : 700);
    });

    // Reveal on scroll. Anything already on screen is marked seen at once.
    let io = null;
    if ('IntersectionObserver' in window && !reduce) {
      inside.classList.add('arm');
      io = new IntersectionObserver(entries => {
        entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('seen'); io.unobserve(en.target); } });
      }, { root: inside, threshold: 0.14 });
      inside.querySelectorAll('.rv').forEach(el => io.observe(el));
    } else {
      inside.querySelectorAll('.rv').forEach(el => el.classList.add('seen'));
    }

    // Platform: hovering a capability dims the rest, like selecting a node in the graph.
    const con = document.getElementById('constellation');
    const caps = [...con.querySelectorAll('.cap')];
    const linkSvg = con.querySelector('svg.links');
    let links = '';
    caps.forEach((c, i) => {
      const a = -Math.PI / 2 + i * 2 * Math.PI / caps.length;
      const cos = Math.cos(a), sin = Math.sin(a);
      c.style.left = (50 + 41 * cos) + '%';
      c.style.top = (50 + 41 * sin) + '%';
      links += `<line data-i="${i}" x1="${50 + 14 * cos}" y1="${50 + 14 * sin}" x2="${50 + 31 * cos}" y2="${50 + 31 * sin}"/>` +
               `<circle data-i="${i}" cx="${50 + 31 * cos}" cy="${50 + 31 * sin}" r=".8"/>`;
    });
    linkSvg.innerHTML = links;
    const focusCap = i => {
      con.classList.toggle('focus', i >= 0);
      caps.forEach((c, k) => c.classList.toggle('on', k === i));
      linkSvg.querySelectorAll('[data-i]').forEach(el => el.classList.toggle('on', +el.dataset.i === i));
    };
    caps.forEach((c, i) => {
      c.addEventListener('pointerenter', () => focusCap(i));
      c.addEventListener('focus', () => focusCap(i));
      c.addEventListener('pointerleave', () => focusCap(-1));
      c.addEventListener('blur', () => focusCap(-1));
    });

    // Wellness wheel: six dimensions around the Regenera sun.
    const DIMS = [
      ['Physical', 'Movement, nutrition, restorative sleep, preventive health, longevity, and connection with nature.'],
      ['Mental', 'Learning, curiosity, creativity, reflection, and cognitive well-being.'],
      ['Spiritual', 'Meaning, purpose, contemplation, and deeper connection with oneself and the world.'],
      ['Environmental', 'A healthy relationship with nature and positive stewardship of the ecosystems future generations will inherit.'],
      ['Social', 'Belonging, shared experiences, community participation, and connection across cultures and generations.'],
      ['Emotional', 'Space for expression, restoration, resilience, and personal growth.'],
    ];
    const wheel = document.getElementById('wheel');
    const NS = 'http://www.w3.org/2000/svg';
    const CX = 320, CY = 260, R0 = 112, R1 = 176;
    const pt = (r, deg) => [CX + r * Math.cos(deg * Math.PI / 180), CY + r * Math.sin(deg * Math.PI / 180)];
    const mk = (tag, attrs, parent = wheel) => { const el = document.createElementNS(NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); parent.appendChild(el); return el; };
    const segs = [], nums = [], lbls = [];
    DIMS.forEach(([name], i) => {
      const mid = -90 + i * 60, a0 = mid - 30 + 1.4, a1 = mid + 30 - 1.4;
      const [x0, y0] = pt(R1, a0), [x1, y1] = pt(R1, a1), [x2, y2] = pt(R0, a1), [x3, y3] = pt(R0, a0);
      const seg = mk('path', {
        d: `M${x0} ${y0} A${R1} ${R1} 0 0 1 ${x1} ${y1} L${x2} ${y2} A${R0} ${R0} 0 0 0 ${x3} ${y3} Z`,
        class: 'seg', tabindex: '0', role: 'button', 'aria-label': name,
      });
      const [nx, ny] = pt((R0 + R1) / 2, mid);
      const num = mk('text', { x: nx, y: ny + 6, 'text-anchor': 'middle', class: 'segn' }); num.textContent = String(i + 1).padStart(2, '0');
      const [lx, ly] = pt(R1 + 30, mid);
      const cos = Math.cos(mid * Math.PI / 180);
      const lbl = mk('text', {
        x: lx, y: ly + (Math.abs(cos) < .2 ? (ly < CY ? -2 : 12) : 5),
        'text-anchor': Math.abs(cos) < .2 ? 'middle' : (cos > 0 ? 'start' : 'end'), class: 'lbl',
      });
      lbl.textContent = name;
      segs.push(seg); nums.push(num); lbls.push(lbl);
      const pick = () => { auto = false; dimText.setAttribute('aria-live', 'polite'); setDim(i); };
      seg.addEventListener('click', pick); lbl.addEventListener('click', pick);
      seg.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
    mk('circle', { cx: CX, cy: CY, r: R0 - 14, class: 'hub' });
    const sun = mk('g', { class: 'sunlines', transform: `translate(${CX} ${CY - 16}) scale(.17) translate(-966 -790)` });
    mk('line', { x1: 966, y1: 790, x2: 966, y2: 632 }, sun);
    mk('line', { x1: 808, y1: 790, x2: 1124, y2: 790 }, sun);
    mk('polyline', { points: '858,673 966,790 1074,673' }, sun);
    mk('polyline', { points: '858,908 966,790 1074,908' }, sun);
    const hubT = mk('text', { x: CX, y: CY + 44, 'text-anchor': 'middle', class: 'hubtxt' }); hubT.textContent = 'WELL-BEING';

    const dimN = document.getElementById('dimN'), dimName = document.getElementById('dimName'), dimText = document.getElementById('dimText');
    let cur = 0, auto = true;
    function setDim(i) {
      cur = i;
      segs.forEach((s, k) => { s.classList.toggle('on', k === i); s.setAttribute('aria-pressed', String(k === i)); });
      nums.forEach((s, k) => s.classList.toggle('on', k === i));
      lbls.forEach((s, k) => s.classList.toggle('on', k === i));
      dimN.textContent = `${String(i + 1).padStart(2, '0')} / 06`;
      dimName.textContent = DIMS[i][0];
      dimText.textContent = DIMS[i][1];
      dimText.style.animation = 'none'; void dimText.offsetWidth; dimText.style.animation = '';
    }
    setDim(0);
    // Phones: widen the drawing area so the larger labels fit beside the ring.
    const fitWheel = () => wheel.setAttribute('viewBox', innerWidth <= 640 ? '-75 0 790 520' : '0 0 640 520');
    fitWheel(); addEventListener('resize', fitWheel);
    let wheelVisible = false;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(es => { wheelVisible = es[0].isIntersecting; }, { root: inside, threshold: .4 }).observe(wheel);
    }
    setInterval(() => { if (auto && wheelVisible && moving() && !inside.hidden && !wheel.contains(document.activeElement)) setDim((cur + 1) % DIMS.length); }, 4200);

    // Beliefs film: plays while on screen, rests on its first frame otherwise.
    const beliefsFilm = document.getElementById('beliefsFilm');
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(es => { beliefsFilm.dataset.inView = es[0].isIntersecting ? '1' : ''; if (es[0].isIntersecting && moving()) beliefsFilm.play().catch(() => {}); else beliefsFilm.pause(); },
        { root: inside, threshold: 0.25 }).observe(beliefsFilm);
    }

    // Card films play while they are in view.
    if ('IntersectionObserver' in window) {
      const cardIO = new IntersectionObserver(es => es.forEach(en => { en.target.dataset.inView = en.isIntersecting ? '1' : ''; if (en.isIntersecting && moving()) en.target.play().catch(() => {}); else en.target.pause(); }),
        { root: inside, threshold: 0.2 });
      inside.querySelectorAll('.card video').forEach(v => cardIO.observe(v));
    }

    // Inquiry form: checked here, checked again on the server, then sent by the
    // /api/inquiry function (Cloudflare Pages Function -> Resend). Nothing claims success
    // unless the server confirms it.
    const form = document.getElementById('inq');
    const err = document.getElementById('formErr');
    const done = document.getElementById('formDone');
    const sent = document.getElementById('formSent');
    const sendBtn = document.getElementById('sendBtn');
    const engageSet = document.getElementById('engageSet');
    let summary = '';
    const copy = (text, btn, label) => {
      const ok = () => { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = label; }, 1800); };
      try { navigator.clipboard.writeText(text).then(ok, () => { btn.textContent = 'Select and copy above'; }); }
      catch (_) { btn.textContent = 'Select and copy above'; }
    };
    // Cloudflare Turnstile loads only when a site key is configured in the page head.
    const tsKey = (document.querySelector('meta[name="turnstile-sitekey"]') || {}).content;
    if (tsKey) {
      const box = document.getElementById('turnstile');
      box.className = 'cf-turnstile'; box.dataset.sitekey = tsKey; box.dataset.theme = 'light';
      const sc = document.createElement('script');
      sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'; sc.async = true; sc.defer = true;
      document.head.appendChild(sc);
    }
    const showPanel = panel => {
      panel.hidden = false;
      panel.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
      panel.querySelector('h3').focus({ preventScroll: true });
    };
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (sendBtn.getAttribute('aria-busy') === 'true') return;
      const engage = form.querySelector('input[name="engage"]:checked');
      const name = document.getElementById('f-name'), email = document.getElementById('f-email'), link = document.getElementById('f-link');
      const problems = [], bad = [];
      [name, email, link].forEach(f => { f.removeAttribute('aria-invalid'); f.removeAttribute('aria-describedby'); });
      engageSet.removeAttribute('aria-describedby');
      if (!engage) { problems.push('choose how you would like to engage'); bad.push(form.querySelector('input[name="engage"]')); engageSet.setAttribute('aria-describedby', 'formErr'); }
      if (!name.value.trim()) { problems.push('add your name'); bad.push(name); }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { problems.push('add a valid email address'); bad.push(email); }
      if (link.value.trim() && !/^https?:\/\/\S+$/i.test(link.value.trim())) { problems.push('start the link with https://'); bad.push(link); }
      bad.forEach(f => { if (f.type !== 'radio') { f.setAttribute('aria-invalid', 'true'); f.setAttribute('aria-describedby', 'formErr'); } });
      if (problems.length) {
        err.textContent = 'Please ' + problems.join(', ') + '.';
        err.hidden = false;
        bad[0].focus();
        return;
      }
      err.hidden = true; done.hidden = true; sent.hidden = true;
      const v = id => document.getElementById(id).value.trim();
      const data = {
        engage: engage.value, name: v('f-name'), org: v('f-org'), email: v('f-email'),
        location: v('f-loc'), description: v('f-desc'), link: v('f-link'), website_hp: v('f-hp'),
        turnstile: (form.querySelector('[name="cf-turnstile-response"]') || {}).value || '',
      };
      summary = [
        `Engagement: ${data.engage}`, `Name: ${data.name}`, `Organization: ${data.org || '-'}`,
        `Email: ${data.email}`, `Location: ${data.location || '-'}`, `Link: ${data.link || '-'}`, '', data.description,
      ].join('\n');
      sendBtn.setAttribute('aria-busy', 'true');
      try {
        const r = await fetch('/api/inquiry', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), credentials: 'same-origin',
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.ok) { form.reset(); showPanel(sent); }
        else if (r.status === 400 || r.status === 429) { err.textContent = j.error || 'Please check the form and try again.'; err.hidden = false; }
        else showPanel(done);
      } catch (_) {
        showPanel(done);
      } finally {
        sendBtn.removeAttribute('aria-busy');
        if (window.turnstile) try { window.turnstile.reset(); } catch (_) {}
      }
    });
    document.getElementById('copyInq').addEventListener('click', e => copy(summary, e.currentTarget, 'Copy inquiry'));
    document.getElementById('editInq').addEventListener('click', () => { done.hidden = true; document.getElementById('f-desc').focus(); });
    document.getElementById('copyMail').addEventListener('click', e => copy('hello@weareregenera.com', e.currentTarget, 'Copy email'));

    // Sideways sections: scroll down, the section sticks, and the track slides right to left.
    const pad2 = n => String(n).padStart(2, '0');
    const hzs = [...inside.querySelectorAll('.hz')].map(sec => ({
      sec,
      pin: sec.querySelector('.hz-pin'),
      track: sec.querySelector('.hz-track'),
      bar: sec.querySelector('.hz-bar i'),
      count: sec.querySelector('.hz-count'),
      steps: [...sec.querySelectorAll('[data-step]')],
      imgs: [...sec.querySelectorAll('.hz-img img')],
      dist: 0, cur: 0, on: false,
    }));
    let hzRaf = 0;
    function measureHz() {
      if (inside.hidden) return;
      hzs.forEach(h => {
        h.sec.style.height = '';
        // Sideways travel follows the visitor's own scrolling, so it stays on with reduced motion;
        // only the easing and the picture drift are dropped for those visitors.
        const can = inside.clientHeight >= 560;
        h.sec.classList.toggle('hz-on', can);
        h.on = can;
        if (!can) { h.track.style.transform = ''; return; }
        // Cards must fit the pinned height; otherwise this section stacks normally.
        if ([...h.track.querySelectorAll('.card')].some(c => c.scrollHeight > c.clientHeight + 2) ||
            [...h.track.querySelectorAll('.hz-intro')].some(p => p.offsetHeight > h.pin.clientHeight - 56)) {
          h.on = false; h.sec.classList.remove('hz-on'); h.track.style.transform = ''; return;
        }
        h.steps.forEach(s => { const n = s.querySelector('.node'); if (n) s.style.setProperty('--line-y', (n.offsetTop + n.offsetHeight / 2) + 'px'); });
        h.dist = Math.max(0, h.track.scrollWidth - h.pin.clientWidth);
        h.sec.style.height = (h.pin.clientHeight + h.dist) + 'px';
      });
      pinStack(); refreshTops();
      tickHz(true);
      onScroll();
    }
    function tickHz(snap) {
      cancelAnimationFrame(hzRaf);
      let moving = false;
      hzs.forEach(h => {
        if (!h.on) return;
        const target = Math.min(1, Math.max(0, (inside.scrollTop - flowTop(h.sec)) / (h.dist || 1))) * h.dist;
        h.cur = snap || reduce ? target : h.cur + (target - h.cur) * 0.14;
        if (Math.abs(target - h.cur) > 0.4) moving = true; else h.cur = target;
        h.track.style.transform = `translate3d(${-h.cur}px,0,0)`;
        h.bar.style.transform = `scaleX(${h.dist ? h.cur / h.dist : 0})`;
        const mid = h.cur + h.pin.clientWidth * 0.55;
        let idx = 0;
        h.steps.forEach((s, k) => { if (s.offsetLeft <= mid) idx = k; });
        h.count.textContent = `${pad2(idx + 1)} / ${pad2(h.steps.length)}`;
        const vw = h.pin.clientWidth;
        if (!reduce) h.imgs.forEach(img => {
          const pnl = img.parentElement;
          const off = pnl.offsetLeft + pnl.offsetWidth / 2 - h.cur - vw / 2;
          img.style.transform = `translate3d(${off * -0.09}px,0,0) scale(1.18)`;
        });
      });
      if (moving) hzRaf = requestAnimationFrame(() => tickHz(false));
    }
    inside.addEventListener('scroll', () => tickHz(false), { passive: true });
    addEventListener('resize', measureHz);
    inside.querySelectorAll('.hz img').forEach(img => { if (!img.complete) img.addEventListener('load', measureHz, { once: true }); });
    if (document.fonts) document.fonts.ready.then(measureHz);

    return {
      enter() {
        inside.scrollTop = 0;
        nav.classList.remove('tucked'); lastTop = 0; onScroll();
        setSlide(0); play();
        requestAnimationFrame(measureHz);
        setTimeout(measureHz, 400);
        requestAnimationFrame(() => requestAnimationFrame(() => inside.classList.add('entered')));
      },
      leave() { clearInterval(ft); inside.querySelectorAll('video').forEach(v => v.pause()); inside.classList.remove('entered'); },
    };
  })();

  // Move focus for keyboard users only; a click should never leave a focus frame on screen.
  const stage = document.getElementById('stage');
  let usedKeys = false;
  addEventListener('keydown', e => { if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ') usedKeys = true; }, true);
  addEventListener('pointerdown', () => { usedKeys = false; }, true);
  /* ---------- Press the arch: zoom through the doorway ---------- */
  let zoomed = false;
  brand.addEventListener('click', () => {
    if (zoomed) return;
    zoomed = true;
    hint.classList.remove('shown');
    const m = mark.getBoundingClientRect();
    const s = scene.getBoundingClientRect();
    // A clear spot inside the arch, below the sun: (966, 950) in mark units.
    const ox = m.left + m.width * ((966 - 700) / 532) - s.left;
    const oy = m.top + m.height * ((950 - 505) / 530) - s.top;
    scene.style.transformOrigin = `${ox}px ${oy}px`;
    pulse(m.left + m.width / 2, m.top + m.height * 0.54, 1.2);

    const show = () => {
      stage.inert = true; stage.setAttribute('aria-hidden', 'true');
      inside.hidden = false;
      requestAnimationFrame(() => inside.classList.add('shown'));
      site.enter();
      if (usedKeys) back.focus({ preventScroll: true });
    };
    if (reduce) { scene.style.opacity = 0; show(); return; }
    scene.classList.add('zooming');
    scene.style.transform = 'scale(70)';
    setTimeout(show, 1350);
  });

  back.addEventListener('click', () => {
    // From anywhere down the page the mark returns to the top; from the top it goes back to the arch.
    if (inside.scrollTop > 40) { inside.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); return; }
    site.leave();
    inside.classList.remove('shown');
    setTimeout(() => {
      inside.hidden = true;
      stage.inert = false; stage.removeAttribute('aria-hidden');
      scene.classList.remove('zooming');
      scene.style.transition = 'none';
      scene.style.transform = 'scale(1.06)';
      scene.style.opacity = '0';
      void scene.offsetWidth;
      scene.style.transition = 'transform 1.1s cubic-bezier(.2,.8,.2,1), opacity .9s ease';
      scene.style.transform = 'scale(1)';
      scene.style.opacity = '1';
      zoomed = false;
      setTimeout(() => { scene.style.transition = ''; if (usedKeys) brand.focus({ preventScroll: true }); }, 1100);
    }, reduce ? 0 : 600);
  });
})();
