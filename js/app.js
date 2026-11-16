'use strict';

/* =====================================================================
   MoodTunes - Login MySQL, Perfil y Biblioteca PERSONAL por cuenta
   ===================================================================== */

const CANTIDAD = 5;
const TIEMPO_MAX = 12000;
const $ = (sel) => document.querySelector(sel);
/* Seguridad: escapar texto para innerHTML y armar url() de CSS sin que se pueda "escapar" de las comillas */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cssUrl = (u) => 'url("' + String(u || '').replace(/["'()\\\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')) + '")';

const ICONO = {
    play:  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>'
};

const MOODS = {
    feliz:     { nombre: 'Feliz',     color: '#e8a43a', consultas: ['happy pop', 'dance hits', 'good vibes', 'summer pop'] },
    triste:    { nombre: 'Triste',    color: '#5b84c4', consultas: ['sad acoustic', 'sad ballad', 'heartbreak songs', 'piano ballad'] },
    relajado:  { nombre: 'Relajado',  color: '#46a89b', consultas: ['chill', 'lo-fi', 'chill vibes', 'acoustic chill'] },
    motivado:  { nombre: 'Motivado',  color: '#d4553f', consultas: ['workout', 'rock', 'gym motivation', 'power rock'] },
    romantico: { nombre: 'Romántico', color: '#c9588a', consultas: ['romantic', 'love songs', 'love ballad', 'romantic pop'] }
};
const ES = {
    feliz: ['pop latino', 'reggaeton', 'cumbia', 'salsa'],
    triste: ['baladas tristes', 'balada romántica', 'bachata triste'],
    relajado: ['chill latino', 'acústico en español', 'bossa nova'],
    motivado: ['reggaeton entrenamiento', 'rock en español', 'trap latino'],
    romantico: ['baladas románticas', 'bachata', 'boleros']
};
const EMOJI = { feliz: '😊', triste: '😢', relajado: '😌', motivado: '💪', romantico: '💕' };
const FRASES = {
    feliz: ['Que nada te baje el ritmo hoy.', 'Sube el volumen y deja que el día te siga.'],
    triste: ['Está bien sentirlo: la música lo entiende.', 'Hay canciones que abrazan.'],
    relajado: ['Respira hondo y deja que el sonido haga el resto.', 'Baja el ritmo. Nadie te apura.'],
    motivado: ['Hoy es un buen día para romper tus marcas.', 'Ponte los audífonos y ve por todo.'],
    romantico: ['Para quien ya está en tu cabeza.', 'Hay canciones que se sienten a dos voces.']
};

const estado = {
    clima: null, mood: null, idioma: 'todo', aleatorio: false, repetir: false,
    cola: null, canciones: [], actual: null, cacheLetras: new Map(), pedidoLetra: 0
};
const audio = new Audio(); audio.preload = 'none';

async function pedirJSON(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIEMPO_MAX);
    try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
    } finally { clearTimeout(t); }
}

function pedirJSONP(url) {
    return new Promise((resolve, reject) => {
        const nombre = 'itunesCb_' + Date.now() + Math.floor(Math.random() * 1e6);
        const script = document.createElement('script');
        const limpiar = () => { delete window[nombre]; script.remove(); clearTimeout(t); };
        const t = setTimeout(() => { limpiar(); reject(new Error('Tiempo agotado')); }, TIEMPO_MAX);
        window[nombre] = (data) => { limpiar(); resolve(data); };
        script.onerror = () => { limpiar(); reject(new Error('Error de red')); };
        script.src = url + '&callback=' + nombre;
        document.head.appendChild(script);
    });
}

const elegir = (arr) => arr[Math.floor(Math.random() * arr.length)];
function mezclar(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
function formatoTiempo(s) {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const seg = Math.floor(s % 60);
    return m + ':' + String(seg).padStart(2, '0');
}
function aplicarTema(clave) {
    const m = MOODS[clave];
    document.documentElement.style.setProperty('--mood', m ? m.color : '#c9a27a');
}
function crearEspectro(sel, cantidad, alto) {
    const sp = $(sel);
    for (let i = 0; i < cantidad; i++) {
        const b = document.createElement('span');
        const base = 0.3 + 0.7 * Math.abs(Math.sin(i * 0.37) * Math.cos(i * 0.11));
        b.style.setProperty('--h', Math.round(alto * 0.15 + base * alto) + 'px');
        b.style.setProperty('--d', (-Math.random() * 1.5).toFixed(2) + 's');
        b.style.setProperty('--s', (0.6 + Math.random() * 0.9).toFixed(2) + 's');
        sp.appendChild(b);
    }
}
function crearNotas() {
    const cont = $('#lv-notes');
    const notas = ['♪', '♫', '♩', '♬'];
    for (let i = 0; i < 16; i++) {
        const n = document.createElement('span');
        n.textContent = notas[i % notas.length];
        n.style.left = (Math.random() * 96).toFixed(1) + '%';
        n.style.setProperty('--size', (1.1 + Math.random() * 1.8).toFixed(2) + 'rem');
        n.style.setProperty('--dur', (9 + Math.random() * 9).toFixed(1) + 's');
        n.style.setProperty('--delay', (-Math.random() * 14).toFixed(1) + 's');
        cont.appendChild(n);
    }
}

function describirClima(code, esDia) {
    if (code === 0) return { desc: 'Despejado', icon: esDia ? '☀️' : '🌙', grupo: 'despejado' };
    if (code === 1) return { desc: 'Casi despejado', icon: esDia ? '🌤️' : '🌙', grupo: 'despejado' };
    if (code === 2) return { desc: 'Algo nublado', icon: esDia ? '⛅' : '☁️', grupo: 'nublado' };
    if (code === 3) return { desc: 'Nublado', icon: '☁️', grupo: 'nublado' };
    if (code === 45 || code === 48) return { desc: 'Niebla', icon: '🌫️', grupo: 'nublado' };
    if ([51, 53, 55, 56, 57].includes(code)) return { desc: 'Llovizna', icon: '🌦️', grupo: 'lluvia' };
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { desc: 'Lluvia', icon: '🌧️', grupo: 'lluvia' };
    if ([71, 73, 75, 77, 85, 86].includes(code)) return { desc: 'Nieve', icon: '❄️', grupo: 'frio' };
    if ([95, 96, 99].includes(code)) return { desc: 'Tormenta', icon: '⛈️', grupo: 'lluvia' };
    return { desc: 'Variable', icon: '🌡️', grupo: 'nublado' };
}

async function cargarClima() {
    const input = $('#city-input'), btn = $('#city-btn'), errorEl = $('#city-error');
    const nombre = input.value.trim();
    errorEl.textContent = '';
    if (!nombre) { errorEl.textContent = 'Escribe el nombre de una ciudad.'; return; }
    btn.disabled = true; btn.textContent = 'Buscando…'; $('#weather-desc').textContent = 'Buscando…';
    try {
        const geo = await pedirJSON('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(nombre) + '&count=1&language=es&format=json');
        if (!geo.results || !geo.results.length) throw new Error('No encontramos "' + nombre + '".');
        const lugar = geo.results[0];
        const data = await pedirJSON('https://api.open-meteo.com/v1/forecast?latitude=' + lugar.latitude + '&longitude=' + lugar.longitude + '&current=temperature_2m,weather_code,is_day&timezone=auto');
        const c = data.current, esDia = c.is_day === 1, info = describirClima(c.weather_code, esDia);
        estado.clima = { ciudad: lugar.name, temp: Math.round(c.temperature_2m), desc: info.desc, icon: info.icon, grupo: info.grupo, tormenta: c.weather_code >= 95, esDia };
        $('#weather-icon').textContent = info.icon; $('#weather-temp').textContent = estado.clima.temp + '°C';
        $('#weather-desc').textContent = info.desc; $('#weather-city').textContent = lugar.name;
        fxModo(estado.clima); actualizarFrase(); sugerirAnimo();
        if (estado.mood) buscarCanciones(estado.mood, false);
    } catch (e) {
        estado.clima = null; fxModo(null);
        $('#weather-icon').textContent = '🌡️'; $('#weather-temp').textContent = '--°C';
        $('#weather-desc').textContent = 'Sin datos'; $('#weather-city').textContent = '—';
        errorEl.textContent = e.message;
    } finally { btn.disabled = false; btn.textContent = 'Ver clima'; }
}

function armarBusqueda(clave) {
    const m = MOODS[clave], w = estado.clima;
    let termino = elegir(m.consultas), hint = 'Elegimos estas canciones para tu ánimo.';
    if (w) {
        if (clave === 'triste' && w.grupo === 'lluvia') { termino = 'melancholic rainy day'; hint = 'Está lloviendo en ' + w.ciudad + ': algo melancólico.'; }
        else if (clave === 'feliz' && w.grupo === 'despejado' && w.esDia) { termino = 'sunny day pop'; hint = 'Hay sol en ' + w.ciudad + ': música alegre.'; }
        else if (clave === 'feliz' && w.grupo === 'lluvia') { hint = 'Llueve en ' + w.ciudad + ': pop con ritmo.'; }
        else if (clave === 'motivado' && w.temp <= 16) { termino = 'high energy workout rock'; hint = 'Hacen ' + w.temp + '°C: energía para entrar en calor.'; }
        else if (clave === 'romantico' && !w.esDia) { termino = 'romantic night slow'; hint = 'Es de noche en ' + w.ciudad + ': ambiente romántico.'; }
        else if (clave === 'relajado') { hint = 'Música suave para un día ' + w.desc.toLowerCase() + '.'; }
        else { hint = w.desc + ' y ' + w.temp + '°C en ' + w.ciudad + '.'; }
    }
    if (estado.idioma === 'es' || estado.idioma === 'latino') termino = elegir(ES[clave]);
    return { termino, hint };
}

async function consultarItunes(termino) {
    const url = 'https://itunes.apple.com/search?term=' + encodeURIComponent(termino) + '&media=music&entity=song&limit=40&country=' + ({ es: 'ES', latino: 'MX' }[estado.idioma] || 'US');
    try { return await pedirJSON(url); } catch (e) { return await pedirJSONP(url); }
}

async function buscarCanciones(clave, desplazar = true) {
    estado.mood = clave; aplicarTema(clave); actualizarFrase();
    if (desplazar) registrarAnimo(clave);
    document.querySelectorAll('.mood-btn').forEach((b) => b.classList.toggle('active', b.dataset.mood === clave));
    $('#mood-error').textContent = '';
    const { termino, hint } = armarBusqueda(clave);
    const seccion = $('#canciones');
    seccion.hidden = false; $('#refresh-btn').hidden = false; $('#head-actions').innerHTML = '';
    $('#songs-title').textContent = 'Canciones para sentirte ' + MOODS[clave].nombre.toLowerCase();
    $('#songs-hint').textContent = hint;
    if (desplazar) seccion.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const cont = $('#songs-container'); cont.innerHTML = '';
    for (let i = 0; i < CANTIDAD; i++) { const s = document.createElement('div'); s.className = 'skeleton'; cont.appendChild(s); }
    try {
        const data = await consultarItunes(termino);
        if (estado.mood !== clave) return;
        const vistos = new Set();
        const lista = (data.results || []).filter((r) => {
            if (!r.previewUrl || !r.trackName) return false;
            const k = (r.trackName + '|' + r.artistName).toLowerCase();
            if (vistos.has(k)) return false; vistos.add(k); return true;
        });
        if (!lista.length) throw new Error('No encontramos canciones para este ánimo.');
        estado.canciones = mezclar(lista).slice(0, CANTIDAD).map((r) => ({
            id: String(r.trackId), titulo: r.trackName, artista: r.artistName,
            portada: (r.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
            preview: r.previewUrl, enlace: r.trackViewUrl || ''
        }));
        renderCanciones(); habilitarReproductor();
        if (!estado.actual) mostrarPortada(estado.canciones[0]);
    } catch (e) {
        if (estado.mood !== clave) return;
        cont.innerHTML = ''; $('#mood-error').textContent = e.message;
    }
}

function renderCanciones() { renderLista($('#songs-container'), estado.canciones); }

function renderLista(cont, lista) {
    cont.innerHTML = '';
    lista.forEach((c) => {
        const card = document.createElement('article'); card.className = 'song-card'; card.dataset.id = c.id;
        const wrap = document.createElement('div'); wrap.className = 'cover-wrap';
        const cover = document.createElement('button'); cover.type = 'button'; cover.className = 'cover-btn';
        cover.setAttribute('aria-label', 'Reproducir ' + c.titulo);
        const img = document.createElement('img'); img.src = c.portada; img.alt = c.titulo; img.loading = 'lazy';
        const badge = document.createElement('span'); badge.className = 'play-badge'; badge.innerHTML = ICONO.play;
        cover.append(img, badge);
        cover.addEventListener('click', () => reproducir(c, lista));
        cover.addEventListener('pointermove', (e) => {
            const r = cover.getBoundingClientRect();
            const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
            card.style.setProperty('--rx', ((0.5 - y) * 14).toFixed(1) + 'deg');
            card.style.setProperty('--ry', ((x - 0.5) * 14).toFixed(1) + 'deg');
            card.style.setProperty('--gx', (x * 100).toFixed(0) + '%');
            card.style.setProperty('--gy', (y * 100).toFixed(0) + '%');
        });
        cover.addEventListener('pointerleave', () => { ['--rx', '--ry', '--gx', '--gy'].forEach((p) => card.style.removeProperty(p)); });
        const fav = document.createElement('button'); fav.type = 'button'; fav.className = 'fav-btn';
        fav.addEventListener('click', () => alternarFav(c));
        const add = document.createElement('button'); add.type = 'button'; add.className = 'fav-btn add-btn'; add.textContent = '＋';
        add.addEventListener('click', () => abrirDialogo(c));
        wrap.append(cover, fav, add);
        const info = document.createElement('div'); info.className = 'song-info';
        const t = document.createElement('div'); t.className = 'song-title'; t.textContent = c.titulo;
        const a = document.createElement('div'); a.className = 'song-artist'; a.textContent = c.artista;
        const acciones = document.createElement('div'); acciones.className = 'song-actions';
        const letra = document.createElement('button'); letra.type = 'button'; letra.className = 'lyrics-btn'; letra.textContent = 'Ver letra';
        letra.addEventListener('click', () => verLetra(c)); acciones.appendChild(letra);
        if (c.enlace) {
            const full = document.createElement('a'); full.className = 'lyrics-btn'; full.href = c.enlace; full.target = '_blank'; full.rel = 'noopener'; full.textContent = 'Completa';
            acciones.appendChild(full);
        }
        const eq = document.createElement('div'); eq.className = 'eq'; eq.innerHTML = '<span></span><span></span><span></span>'; acciones.appendChild(eq);
        info.append(t, a, acciones); card.append(wrap, info); cont.appendChild(card);
    });
    marcarFavs(); actualizarUIReproduccion();
}

/* =====================================================================
   FAVORITOS Y BIBLIOTECA PERSONALES (MySQL + sesión del servidor)
   ===================================================================== */
let favsCache = [];
let libCache = [];

async function llamarMusica(datos) {
    try {
        const res = await fetch('/api/musica', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datos)
        });
        const data = await res.json();
        if (data && data.sin_sesion) { sesionExpirada(); return null; }
        return data;
    } catch (e) { return null; }
}

async function cargarDatosDeBD() {
    if (!leerSesion()) return;
    const [f, l] = await Promise.all([llamarMusica({ accion: 'cargar_favs' }), llamarMusica({ accion: 'cargar_lib' })]);
    if (Array.isArray(f)) favsCache = f;
    if (Array.isArray(l)) libCache = l;
    renderFavs();
    renderBiblioteca();
}

function limpiarDatosPersonales() {
    favsCache = []; libCache = [];
    estado.actual = null; estado.cola = null;
}

function leerFavs() { return favsCache; }
function esFav(id) { return favsCache.some((f) => f.id === id); }
function leerLib() { return { playlists: libCache, albumes: [], artistas: [] }; }

async function alternarFav(c) {
    if (!c) return;
    if (!leerSesion()) { toast('Inicia sesión para guardar favoritas'); return; }
    const data = await llamarMusica({ accion: 'toggle_fav', cancion: c });
    if (!data) { toast('Error de conexión'); return; }
    if (data.success) {
        toast(data.estado === 'guardado' ? 'Añadida a favoritas ♥' : 'Quitada de favoritas');
        await cargarDatosDeBD();
    } else { toast(data.error || 'No se pudo guardar'); }
}

function marcarFavs() {
    document.querySelectorAll('.song-card').forEach((card) => {
        const on = esFav(card.dataset.id), b = card.querySelector('.fav-btn');
        b.textContent = on ? '♥' : '♡'; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    });
}

function renderFavs() {
    const f = leerFavs(); $('#favoritas').hidden = !f.length;
    renderLista($('#favs-container'), f); marcarFavs();
}

function renderBiblioteca() {
    const cont = $('#lib-list'); cont.innerHTML = '';
    if (tabLib === 'playlists') {
        const favs = leerFavs(); cont.append(filaLib('♥', 'Tus me gusta', 'Playlist · ' + favs.length + ' canciones', () => mostrarCanciones('Tus me gusta', 'Playlist', favs), null, true));
        libCache.forEach((p) => cont.append(filaLib(p.canciones[0] ? p.canciones[0].portada : '♪', p.nombre, 'Playlist · ' + p.canciones.length + ' canciones',
            () => mostrarCanciones(p.nombre, 'Playlist', p.canciones), () => eliminarPlaylist(p))));
    } else if (tabLib === 'albumes') {
        cont.innerHTML = '<p class="vacio">Aún no guardas álbumes.</p>';
    } else {
        cont.innerHTML = '<p class="vacio">Aún no sigues artistas.</p>';
    }
}

async function crearPlaylist(nombre) { return llamarMusica({ accion: 'crear_playlist', nombre }); }
async function añadirAPlaylist(plId, cancion) {
    if (!leerSesion()) return;
    const data = await llamarMusica({ accion: 'add_a_playlist', playlist_id: plId, cancion });
    if (!data) { toast('Error al añadir'); return; }
    if (data.success) { toast('Añadida a la playlist'); await cargarDatosDeBD(); }
    else { toast(data.error || 'No se pudo añadir'); }
}
async function eliminarPlaylist(p) {
    if (!confirm('¿Eliminar la playlist "' + p.nombre + '"?')) return;
    const data = await llamarMusica({ accion: 'eliminar_playlist', playlist_id: p.id });
    if (data && data.success) { toast('Playlist eliminada'); await cargarDatosDeBD(); }
    else { toast((data && data.error) || 'No se pudo eliminar'); }
}

$('#dlg-nueva').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = $('#dlg-nombre').value.trim(); if (!nombre) return;
    if (!leerSesion()) { toast('Inicia sesión para crear playlists'); return; }
    const data = await crearPlaylist(nombre);
    if (data && data.success) {
        toast('Playlist "' + nombre + '" creada');
        $('#dlg-nombre').value = ''; $('#dlg-pl').close();
        if (dlgCancion) await añadirAPlaylist(data.id, dlgCancion); else await cargarDatosDeBD();
    } else { toast((data && data.error) || 'Error al crear'); }
});

/* =====================================================================
   REPRODUCTOR
   ===================================================================== */
function mostrarPortada(c) {
    const url = cssUrl(c.portada);
    $('#vinyl').style.setProperty('--label', url); $('#player').style.setProperty('--cover-mini', url);
    $('.hero-bg').style.setProperty('--cover', url);
}
function habilitarReproductor() {
    ['#player-prev', '#player-toggle', '#player-next', '#seek', '#player-lyrics'].forEach((s) => { $(s).disabled = false; });
}
function reproducir(c, lista) {
    if (lista) estado.cola = lista;
    if (estado.actual && estado.actual.id === c.id) { alternar(); return; }
    estado.actual = c;
    contarPlay();
    audio.src = c.preview; audio.play().catch(() => { $('#mood-error').textContent = 'No se pudo reproducir.'; });
    mostrarPortada(c); $('#player-title').textContent = c.titulo; $('#player-artist').textContent = c.artista;
    $('#time-now').textContent = '0:00'; $('#seek').value = 0; $('#seek').style.setProperty('--p', '0%');
    habilitarReproductor(); actualizarUIReproduccion();
    if (visor.abierta && (!visor.cancion || visor.cancion.id !== c.id)) verLetra(c);
}
function alternar() {
    if (!estado.actual) { if (estado.canciones.length) reproducir(estado.canciones[0]); return; }
    if (audio.paused) audio.play(); else audio.pause();
}
function saltar(dir) {
    const cola = estado.cola || estado.canciones; if (!cola.length) return;
    if (estado.aleatorio && dir > 0 && cola.length > 1) {
        let k; do { k = Math.floor(Math.random() * cola.length); } while (estado.actual && cola[k].id === estado.actual.id);
        reproducir(cola[k], cola); return;
    }
    let i = estado.actual ? cola.findIndex((c) => c.id === estado.actual.id) : -1;
    i = (i + dir + cola.length) % cola.length; reproducir(cola[i], cola);
}
function actualizarUIReproduccion() {
    const suena = !audio.paused && !audio.ended && !!estado.actual;
    document.body.classList.toggle('sonando', suena); $('#vinyl').classList.toggle('playing', suena);
    document.querySelectorAll('.song-card').forEach((card) => {
        const activa = estado.actual && card.dataset.id === estado.actual.id;
        card.classList.toggle('is-playing', !!(activa && suena));
        const badge = card.querySelector('.play-badge'); if (badge) badge.innerHTML = activa && suena ? ICONO.pause : ICONO.play;
    });
    $('#player-toggle').innerHTML = suena ? ICONO.pause : ICONO.play;
    $('#lv-toggle').innerHTML = suena ? ICONO.pause : ICONO.play;
    programarAvance();
}
audio.addEventListener('play', actualizarUIReproduccion);
audio.addEventListener('pause', actualizarUIReproduccion);
audio.addEventListener('loadedmetadata', () => { $('#time-total').textContent = formatoTiempo(audio.duration); });
audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    const p = audio.currentTime / audio.duration * 100;
    $('#seek').value = p; $('#seek').style.setProperty('--p', p + '%'); $('#time-now').textContent = formatoTiempo(audio.currentTime);
});
audio.addEventListener('ended', () => {
    actualizarUIReproduccion(); const cola = estado.cola || estado.canciones;
    if (estado.aleatorio && cola.length > 1) { saltar(1); return; }
    const i = cola.findIndex((c) => estado.actual && c.id === estado.actual.id);
    if (i >= 0 && i < cola.length - 1) reproducir(cola[i + 1], cola);
});
$('#seek').addEventListener('input', (e) => { if (audio.duration) audio.currentTime = e.target.value / 100 * audio.duration; e.target.style.setProperty('--p', e.target.value + '%'); });

/* =====================================================================
   LETRAS
   ===================================================================== */
function limpiarTitulo(t) { return t.replace(/\s*[\(\[].*?[\)\]]/g, '').replace(/\s+-\s+.*$/, '').trim(); }
function limpiarArtista(a) { return a.split(/\s*(?:&|,| feat\.?| ft\.?| and | x | con )\s*/i)[0].trim(); }
async function pedirLetra(artista, titulo) {
    const data = await pedirJSON('https://api.lyrics.ovh/v1/' + encodeURIComponent(artista) + '/' + encodeURIComponent(titulo));
    if (!data.lyrics || !data.lyrics.trim()) throw new Error('vacía');
    return data.lyrics.trim();
}
async function obtenerLetra(c) {
    if (estado.cacheLetras.has(c.id)) return estado.cacheLetras.get(c.id);
    const intentos = [[limpiarArtista(c.artista), limpiarTitulo(c.titulo)], [c.artista, c.titulo], [limpiarArtista(c.artista), c.titulo]];
    const probados = new Set();
    for (const [art, tit] of intentos) {
        const k = art + '|' + tit; if (probados.has(k) || !art || !tit) continue; probados.add(k);
        try { const letra = await pedirLetra(art, tit); estado.cacheLetras.set(c.id, letra); return letra; } catch (e) { }
    }
    return null;
}
const visor = { lineas: [], activa: 0, timer: null, ritmo: 1, abierta: false, cancion: null, ultimoScroll: 0 };
function parsearLetra(txt) {
    const out = []; let nueva = true;
    txt.replace(/\r/g, '').split('\n').forEach((l) => {
        const t = l.trim(); if (!t) { nueva = true; return; }
        if (/^paroles de la chanson/i.test(t)) return;
        out.push({ texto: t, estrofa: nueva && out.length > 0 }); nueva = false;
    });
    const marcadas = out.filter((l) => l.estrofa).length;
    if (out.length && marcadas / out.length > 0.6) out.forEach((l) => { l.estrofa = false; });
    return out;
}
function mostrarMensaje(texto) {
    clearTimeout(visor.timer); visor.lineas = [];
    const track = $('#lyrics-text'); track.className = 'lv-track msg'; track.style.transform = ''; track.textContent = texto;
}
function renderLineas() {
    const track = $('#lyrics-text'); track.className = 'lv-track'; track.innerHTML = '';
    visor.lineas.forEach((l, i) => {
        const p = document.createElement('p'); p.className = 'ly-line' + (l.estrofa ? ' gap' : '');
        l.texto.split(/\s+/).forEach((palabra, k) => {
            const s = document.createElement('span'); s.className = 'w'; s.style.setProperty('--k', Math.min(k, 14)); s.textContent = palabra + ' '; p.appendChild(s);
        });
        p.addEventListener('click', () => irALinea(i)); track.appendChild(p);
    });
    irALinea(0);
}
function irALinea(i) {
    const n = visor.lineas.length; if (!n) return; i = Math.max(0, Math.min(n - 1, i)); visor.activa = i;
    const items = $('#lyrics-text').children;
    for (let k = 0; k < items.length; k++) { items[k].style.setProperty('--d', Math.abs(k - i)); items[k].classList.toggle('is-active', k === i); }
    centrarLinea(); programarAvance();
}
function centrarLinea() {
    const stage = $('#lv-stage'), track = $('#lyrics-text'), el = track.children[visor.activa];
    if (!el || track.classList.contains('msg')) return;
    const y = stage.clientHeight * 0.42 - (el.offsetTop + el.offsetHeight / 2); track.style.transform = 'translateY(' + y + 'px)';
}
function programarAvance() {
    clearTimeout(visor.timer); if (!visor.abierta || audio.paused || !visor.lineas.length) return;
    if (visor.activa >= visor.lineas.length - 1) return;
    const largo = visor.lineas[visor.activa].texto.length;
    const ms = Math.min(6500, Math.max(1900, 800 + largo * 60)) * visor.ritmo;
    visor.timer = setTimeout(() => irALinea(visor.activa + 1), ms);
}
async function verLetra(c) {
    const pedido = ++estado.pedidoLetra; visor.cancion = c; const url = cssUrl(c.portada);
    $('#lyrics-song-title').textContent = c.titulo; $('#lyrics-song-artist').textContent = c.artista;
    $('#lv-cover').style.setProperty('--cover', url); $('#lv-bg').style.setProperty('--cover', url);
    mostrarMensaje('Buscando la letra…'); abrirLetra();
    if (!estado.actual || estado.actual.id !== c.id) reproducir(c); else if (audio.paused) audio.play().catch(() => { });
    const txt = await obtenerLetra(c); if (pedido !== estado.pedidoLetra) return;
    if (!txt) { mostrarMensaje('No encontramos la letra.'); return; }
    visor.lineas = parsearLetra(txt); renderLineas();
}
function abrirLetra() {
    visor.abierta = true; audio.loop = true; const v = $('#lyrics-container');
    v.classList.add('open'); v.setAttribute('aria-hidden', 'false'); $('#close-lyrics').focus({ preventScroll: true });
}
function cerrarLetra() {
    estado.pedidoLetra++; visor.abierta = false; visor.cancion = null; audio.loop = estado.repetir; clearTimeout(visor.timer);
    const v = $('#lyrics-container'); v.classList.remove('open'); v.setAttribute('aria-hidden', 'true');
}
function actualizarFrase() {
    const w = estado.clima; let t;
    if (estado.mood) {
        t = elegir(FRASES[estado.mood]);
        if (w && w.grupo === 'lluvia') t = 'Llueve en ' + w.ciudad + '. ' + t;
        else if (w && !w.esDia) t = 'Es de noche en ' + w.ciudad + '. ' + t;
    } else { t = w ? w.desc + ' en ' + w.ciudad + ': ¿cómo suena tu ánimo?' : 'Cuéntanos cómo te sientes.'; }
    $('#frase').textContent = t;
}

/* =====================================================================
   SUGERENCIA INTELIGENTE (CLIMA + ÁNIMO)
   ===================================================================== */
function sugerirAnimo() {
    const w = estado.clima, banner = $('#banner-recomendacion'); 
    if (!w) { banner.hidden = true; return; }

    let claveRecomendada, razon;
    
    // Lógica que conecta el Clima con el Estado de Ánimo
    if (w.grupo === 'lluvia') { 
        claveRecomendada = w.esDia ? 'triste' : 'relajado'; 
        razon = `Está lloviendo en ${w.ciudad} (${w.temp}°C). Es el clima perfecto para escuchar algo melancólico o chill.`; 
    }
    else if (w.temp <= 14) { 
        claveRecomendada = 'motivado'; 
        razon = `Hace frío en ${w.ciudad} (${w.temp}°C). Te recomendamos música con energía para entrar en calor.`; 
    }
    else if (w.grupo === 'despejado') { 
        claveRecomendada = w.esDia ? 'feliz' : 'romantico'; 
        razon = `${w.esDia ? 'Hay un día despejado' : 'Es una noche despejada'} en ${w.ciudad}. El ambiente es perfecto para música ${w.esDia ? 'alegre' : 'romántica'}.`; 
    }
    else { 
        claveRecomendada = 'relajado'; 
        razon = `El clima en ${w.ciudad} está ${w.desc.toLowerCase()} (${w.temp}°C). Te sugerimos algo tranquilo.`; 
    }

    // Llenamos el banner
    $('#banner-mensaje').textContent = razon;
    $('#banner-titulo').textContent = `Clima detectado: ${w.icon} ${w.desc}`;
    
    // Configuramos el botón
    const btn = $('#banner-btn');
    btn.textContent = `Escuchar ${MOODS[claveRecomendada].nombre} ${EMOJI[claveRecomendada]}`;
    
    // Al hacer clic, buscar canciones de ese ánimo
    btn.onclick = () => buscarCanciones(claveRecomendada);
    
    // Mostrar el banner
    banner.hidden = false;
}

/* =====================================================================
   CLIMA ANIMADO
   ===================================================================== */
const fx = { sinMov: matchMedia('(prefers-reduced-motion: reduce)').matches, cv: null, ctx: null, modo: 'nada', p: [], w: 0, h: 0, raf: 0, flash: 0, visible: true, t: 0, tormenta: false };
function fxIniciar() {
    fx.cv = $('#fx'); fx.ctx = fx.cv.getContext('2d'); fxTamano(); window.addEventListener('resize', fxTamano);
    new IntersectionObserver((es) => { fx.visible = es[0].isIntersecting; if (fx.visible && !fx.raf) fx.raf = requestAnimationFrame(fxFrame); }).observe($('.hero'));
    fx.raf = requestAnimationFrame(fxFrame);
}
function fxTamano() {
    const r = $('.hero').getBoundingClientRect(); fx.w = fx.cv.width = Math.round(r.width); fx.h = fx.cv.height = Math.round(r.height); fxModo(estado.clima);
}
function fxModo(w) {
    fx.p = []; if (!w) { fx.modo = 'nada'; return; }
    fx.modo = w.grupo === 'lluvia' ? 'lluvia' : w.grupo === 'frio' ? 'nieve' : w.grupo === 'despejado' ? (w.esDia ? 'sol' : 'noche') : 'nubes';
    fx.tormenta = !!w.tormenta; const n = { lluvia: 170, nieve: 100, noche: 120, sol: 45, nubes: 7 }[fx.modo];
    for (let i = 0; i < n; i++) { fx.p.push({ x: Math.random() * fx.w, y: Math.random() * fx.h, v: 0.6 + Math.random() * 1.4, r: 0.6 + Math.random() * 2.2, f: Math.random() * 6.28 }); }
}
function fxFrame() {
    fx.raf = 0; if (!fx.visible || document.hidden || fx.sinMov) return;
    const { ctx, w, h } = fx; fx.t += 0.016; ctx.clearRect(0, 0, w, h);
    if (fx.modo === 'lluvia') {
        ctx.strokeStyle = 'rgba(190, 205, 240, 0.35)'; ctx.lineWidth = 1.2; ctx.beginPath();
        fx.p.forEach((p) => { ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 3, p.y + 12 + p.r * 5); p.y += 9 + p.v * 8; p.x -= 0.8; if (p.y > h) { p.y = -20; p.x = Math.random() * w; } });
        ctx.stroke(); if (fx.tormenta && Math.random() < 0.004) fx.flash = 1;
    } else if (fx.modo === 'nieve') {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        fx.p.forEach((p) => { ctx.beginPath(); ctx.arc(p.x + Math.sin(fx.t + p.f) * 14, p.y, p.r + 0.6, 0, 6.28); ctx.fill(); p.y += p.v * 0.9; if (p.y > h) { p.y = -5; p.x = Math.random() * w; } });
    } else if (fx.modo === 'noche') {
        fx.p.forEach((p) => { ctx.fillStyle = 'rgba(255, 240, 220, ' + (0.25 + 0.75 * Math.abs(Math.sin(fx.t * p.v + p.f))).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(p.x, p.y * 0.8, p.r * 0.7, 0, 6.28); ctx.fill(); });
    } else if (fx.modo === 'sol') {
        const g = ctx.createRadialGradient(w * 0.82, h * 0.18, 0, w * 0.82, h * 0.18, 380 + Math.sin(fx.t) * 30);
        g.addColorStop(0, 'rgba(255, 205, 120, 0.28)'); g.addColorStop(1, 'rgba(255, 205, 120, 0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        fx.p.forEach((p) => { ctx.fillStyle = 'rgba(255, 215, 150, 0.35)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill(); p.y -= p.v * 0.3; p.x += Math.sin(fx.t + p.f) * 0.3; if (p.y < -5) { p.y = h + 5; p.x = Math.random() * w; } });
    } else if (fx.modo === 'nubes') {
        fx.p.forEach((p, i) => {
            const rad = 160 + p.r * 70, y = (i + 1) / (fx.p.length + 1) * h, g = ctx.createRadialGradient(p.x, y, 0, p.x, y, rad);
            g.addColorStop(0, 'rgba(200, 205, 220, 0.10)'); g.addColorStop(1, 'rgba(200, 205, 220, 0)'); ctx.fillStyle = g; ctx.fillRect(p.x - rad, y - rad, rad * 2, rad * 2);
            p.x += p.v * 0.25; if (p.x - rad > w) p.x = -rad;
        });
    }
    if (fx.flash > 0.02) { ctx.fillStyle = 'rgba(255, 255, 255, ' + (fx.flash * 0.14) + ')'; ctx.fillRect(0, 0, w, h); fx.flash *= 0.88; }
    fx.raf = requestAnimationFrame(fxFrame);
}

/* =====================================================================
   EXPLORAR
   ===================================================================== */
let GENEROS = [
    ['Pop', 'pop hits', '#c2308a', '🎤', ['Taylor Swift', 'Dua Lipa', 'Ariana Grande'], []],
    ['Rock', 'rock classics', '#b5382e', '🎸', ['Queen', 'Foo Fighters', 'AC/DC'], []],
    ['Reggaetón', 'reggaeton', '#2f7d4f', '🔥', ['Bad Bunny', 'Daddy Yankee', 'Karol G'], []],
    ['Hip hop', 'hip hop', '#8a5a1e', '🎧', ['Kendrick Lamar', 'Drake', 'Eminem'], []],
    ['Electrónica', 'electronic dance', '#4b3bd1', '⚡', ['Daft Punk', 'Calvin Harris', 'Martin Garrix'], []],
    ['Jazz', 'jazz', '#1f6f8b', '🎷', ['Miles Davis', 'John Coltrane', 'Ella Fitzgerald'], []],
    ['Clásica', 'classical piano', '#6b4a7a', '🎻', ['Ludovico Einaudi', 'Mozart', 'Beethoven'], []],
    ['Salsa', 'salsa', '#c4571a', '🥁', ['Marc Anthony', 'Celia Cruz', 'Héctor Lavoe'], []],
    ['Indie', 'indie', '#2f6b5e', '🌿', ['Arctic Monkeys', 'Tame Impala', 'Mac DeMarco'], []],
    ['K-pop', 'k-pop', '#d1417a', '✨', ['BTS', 'BLACKPINK', 'Stray Kids'], []],
    ['Lo-fi', 'lo-fi', '#3d5a99', '☕', ['Nujabes', 'Jinsang', 'Idealism'], []],
    ['Baladas', 'baladas romanticas', '#a33a4f', '💔', ['Luis Miguel', 'Ricardo Arjona', 'Camila'], []]
];
const CAT_KEY = 'moodtunes_cats_v1';
let tipoBusqueda = 'cancion', tabLib = 'playlists', dlgCancion = null;
const aCancion = (r) => ({ id: String(r.trackId), titulo: r.trackName, artista: r.artistName, portada: (r.artworkUrl100 || '').replace('100x100bb', '600x600bb'), preview: r.previewUrl, enlace: r.trackViewUrl || '' });
const soloConPreview = (res) => res.filter((r) => r.wrapperType === 'track' && r.previewUrl && r.trackName).map(aCancion);

async function pedirItunes(qs) {
    const url = 'https://itunes.apple.com/' + qs;
    try { return await pedirJSON(url); } catch (e) { return await pedirJSONP(url); }
}

function btnAccion(texto, fn) { const b = document.createElement('button'); b.type = 'button'; b.textContent = texto; b.addEventListener('click', () => fn(b)); return b; }
function fijarAleatorio(v) { estado.aleatorio = v; $('#player-shuffle').classList.toggle('on', v); $('#player-shuffle').setAttribute('aria-pressed', v); }
function mostrarCanciones(titulo, hint, lista, extra) {
    estado.canciones = lista; $('#canciones').hidden = false; $('#songs-title').textContent = titulo; $('#songs-hint').textContent = hint; $('#refresh-btn').hidden = true;
    const ha = $('#head-actions'); ha.innerHTML = '';
    if (lista.length) { ha.append(btnAccion('▶ Reproducir', () => { fijarAleatorio(false); reproducir(lista[0], lista); }), btnAccion('🔀 Aleatorio', () => { fijarAleatorio(true); reproducir(elegir(lista), lista); })); habilitarReproductor(); }
    (extra || []).forEach((b) => ha.append(b)); renderLista($('#songs-container'), lista); $('#canciones').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function errorBusqueda(e) { return e.name === 'AbortError' || /HTTP|fetch|red|Tiempo/i.test(e.message) ? 'No pudimos buscar. Revisa tu conexión.' : e.message; }
async function buscarMusica(term, tipo) {
    term = term.trim(); if (!term) return;
    const err = $('#search-error'), grid = $('#res-grid'); err.textContent = ''; const q = encodeURIComponent(term);
    try {
        if (tipo === 'cancion') {
            grid.hidden = true; const d = await pedirItunes('search?term=' + q + '&media=music&entity=song&limit=40');
            const l = soloConPreview(d.results || []).slice(0, 10); if (!l.length) throw new Error('No encontramos canciones para "' + term + '".');
            mostrarCanciones('Resultados para "' + term + '"', l.length + ' canciones con preview', l);
        } else if (tipo === 'album') {
            const d = await pedirItunes('search?term=' + q + '&media=music&entity=album&limit=15');
            const items = (d.results || []).filter((r) => r.collectionId).map((r) => ({ id: String(r.collectionId), nombre: r.collectionName, artista: r.artistName, portada: (r.artworkUrl100 || '').replace('100x100bb', '400x400bb') }));
            if (!items.length) throw new Error('No encontramos álbumes para "' + term + '".'); crearColeccion(grid, items, 'album');
        } else {
            const [da, dal] = await Promise.all([pedirItunes('search?term=' + q + '&media=music&entity=musicArtist&limit=15'), pedirItunes('search?term=' + q + '&media=music&entity=album&limit=50')]);
            const fotos = {}; (dal.results || []).forEach((r) => { if (r.artistId && !fotos[r.artistId]) fotos[r.artistId] = (r.artworkUrl100 || '').replace('100x100bb', '400x400bb'); });
            let items = (da.results || []).filter((r) => r.artistId).map((r) => ({ id: String(r.artistId), nombre: r.artistName, portada: fotos[r.artistId] || '' }));
            if (!items.length) throw new Error('No encontramos artistas para "' + term + '".');
            await Promise.all(items.filter((i) => !i.portada).slice(0, 4).map(async (it) => { try { const d = await pedirItunes('lookup?id=' + it.id + '&entity=album&limit=2'); const a = (d.results || []).find((r) => r.collectionId); if (a) it.portada = (a.artworkUrl100 || '').replace('100x100bb', '400x400bb'); } catch (e) { } }));
            items = [...items.filter((i) => i.portada), ...items.filter((i) => !i.portada)].slice(0, 10); crearColeccion(grid, items, 'artista');
        }
    } catch (e) { err.textContent = errorBusqueda(e); }
}
function crearColeccion(grid, items, tipo) {
    grid.innerHTML = '';
    items.forEach((it) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'col-card';
        const art = document.createElement('div'); art.className = 'col-art' + (tipo === 'artista' ? ' redondo' : '');
        if (it.portada) { art.style.backgroundImage = cssUrl(it.portada); art.style.backgroundSize = 'cover'; art.style.backgroundPosition = 'center'; } else art.textContent = it.nombre.charAt(0).toUpperCase();
        const n = document.createElement('div'); n.className = 'col-name'; n.textContent = it.nombre; n.title = it.nombre;
        const s = document.createElement('div'); s.className = 'col-sub'; s.textContent = tipo === 'album' ? 'Álbum · ' + it.artista : 'Artista';
        b.append(art, n, s); b.addEventListener('click', () => (tipo === 'album' ? abrirAlbum(it) : abrirArtista(it))); grid.appendChild(b);
    });
    grid.hidden = false;
}
async function abrirAlbum(it) {
    try { const d = await pedirItunes('lookup?id=' + it.id + '&entity=song'); mostrarCanciones(it.nombre, it.artista + ' · álbum', soloConPreview(d.results || []), []); } catch (e) { toast(errorBusqueda(e)); }
}
async function abrirArtista(it) {
    try { const d = await pedirItunes('search?term=' + encodeURIComponent(it.nombre) + '&media=music&entity=song&attribute=artistTerm&limit=40'); const l = soloConPreview(d.results || []).slice(0, 10); mostrarCanciones(it.nombre, 'Artista · ' + l.length + ' canciones', l, []); } catch (e) { toast(errorBusqueda(e)); }
}
async function abrirArtistaPorNombre(nombre) {
    try { const d = await pedirItunes('search?term=' + encodeURIComponent(nombre) + '&media=music&entity=musicArtist&limit=1'); const a = (d.results || [])[0]; abrirArtista({ id: a ? String(a.artistId) : 'n_' + nombre, nombre: a ? a.artistName : nombre }); } catch (e) { toast(errorBusqueda(e)); }
}

/* =====================================================================
   LÓGICA CLAVE: GÉNEROS MANUALES VS ITUNES
   ===================================================================== */
async function buscarGenero(g, auto) {
    try {
        if (g[5] && Array.isArray(g[5]) && g[5].length > 0) {
            mostrarCanciones(g[0], 'Selección exclusiva de ' + g[0].toLowerCase(), g[5], g[4].map((n) => btnAccion('👤 ' + n, () => abrirArtistaPorNombre(n))));
            if (auto) reproducir(g[5][0], g[5]);
            return;
        }
        const d = await pedirItunes('search?term=' + encodeURIComponent(g[1]) + '&media=music&entity=song&limit=40'); 
        const l = mezclar(soloConPreview(d.results || [])).slice(0, 10);
        if (!l.length) throw new Error('Sin resultados');
        mostrarCanciones(g[0], 'Selección de ' + g[0].toLowerCase() + ' · Artista de referencia: ' + g[4][0], l, g[4].map((n) => btnAccion('👤 ' + n, () => abrirArtistaPorNombre(n))));
        if (auto) reproducir(l[0], l);
    } catch (e) { toast(errorBusqueda(e)); }
}

function crearExplorar() {
    const cont = $('#cat-grid');
    GENEROS.forEach((g) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'cat'; b.dataset.g = g[0]; b.style.setProperty('--c', g[2]);
        b.innerHTML = '<b class="cat-name">' + esc(g[0]) + '</b><small class="cat-top">Top: ' + esc(g[4][0]) + '</small><span>' + esc(g[3]) + '</span>';
        b.addEventListener('click', () => buscarGenero(g, false)); cont.appendChild(b);
    });
    const s = document.createElement('button'); s.type = 'button'; s.className = 'cat'; s.style.setProperty('--c', '#5b4a2e');
    s.innerHTML = '<b class="cat-name">Sorpréndeme</b><small class="cat-top">Un género al azar</small><span>🎲</span>';
    s.addEventListener('click', () => { fijarAleatorio(true); buscarGenero(elegir(GENEROS), true); }); cont.appendChild(s);
    if ('IntersectionObserver' in window) { new IntersectionObserver((es, ob) => { if (es[0].isIntersecting) { ob.disconnect(); cargarPortadasGeneros(); } }).observe(cont); } else { cargarPortadasGeneros(); }
}
async function cargarPortadasGeneros() {
    let cache = {}; try { cache = JSON.parse(localStorage.getItem(CAT_KEY)) || {}; } catch (e) { }
    for (const g of GENEROS) {
        const tile = document.querySelector('.cat[data-g="' + g[0] + '"]'); if (!tile) continue; let url = cache[g[0]];
        if (!url) {
            try {
                const d = await pedirItunes('search?term=' + encodeURIComponent(g[4][0]) + '&media=music&entity=album&limit=8');
                const clave = g[4][0].toLowerCase().split(' ')[0]; const al = (d.results || []).find((r) => r.collectionId && (r.artistName || '').toLowerCase().includes(clave));
                if (al) { url = (al.artworkUrl100 || '').replace('100x100bb', '400x400bb'); cache[g[0]] = url; }
            } catch (e) { continue; }
        }
        if (url) { const img = document.createElement('img'); img.alt = ''; img.src = url; img.loading = 'lazy'; tile.appendChild(img); tile.classList.add('con-foto'); }
    }
    try { localStorage.setItem(CAT_KEY, JSON.stringify(cache)); } catch (e) { }
}
function filaLib(thumb, titulo, sub, abrir, quitar, like) {
    const row = document.createElement('div'); row.className = 'lib-row';
    const main = document.createElement('button'); main.type = 'button'; main.className = 'lib-main';
    const th = document.createElement('div'); th.className = 'lib-thumb' + (like ? ' like' : '');
    if (/^http/.test(thumb)) th.style.backgroundImage = cssUrl(thumb); else th.textContent = thumb;
    const tx = document.createElement('div'); const n = document.createElement('div'); n.className = 'lib-name'; n.textContent = titulo;
    const s = document.createElement('div'); s.className = 'lib-sub'; s.textContent = sub; tx.append(n, s); main.append(th, tx);
    main.addEventListener('click', abrir); row.appendChild(main);
    if (quitar) { const x = document.createElement('button'); x.type = 'button'; x.className = 'lib-x'; x.textContent = '✕'; x.setAttribute('aria-label', 'Eliminar'); x.addEventListener('click', quitar); row.appendChild(x); }
    return row;
}
function abrirDialogo(c) {
    if (!leerSesion()) { toast('Inicia sesión para usar playlists'); return; }
    dlgCancion = c; $('#dlg-titulo').textContent = c ? 'Añadir a playlist' : 'Crear playlist'; renderDialogo(); $('#dlg-pl').showModal();
}
function renderDialogo() {
    const cont = $('#dlg-list'); cont.innerHTML = ''; if (!dlgCancion) return;
    libCache.forEach((p) => {
        const esta = p.canciones.some((x) => x.id === dlgCancion.id);
        const b = document.createElement('button'); b.type = 'button'; b.className = 'dlg-item'; b.textContent = (esta ? '✓ ' : '＋ ') + p.nombre;
        b.addEventListener('click', () => {
            if (esta) { toast('Ya está en la playlist'); return; }
            añadirAPlaylist(p.id, dlgCancion);
            $('#dlg-pl').close();
        });
        cont.appendChild(b);
    });
}

/* =====================================================================
   EVENTOS GENERALES
   ===================================================================== */
$('#city-form').addEventListener('submit', (e) => { e.preventDefault(); cargarClima(); });
document.querySelectorAll('.mood-btn').forEach((btn) => btn.addEventListener('click', () => buscarCanciones(btn.dataset.mood)));
$('#refresh-btn').addEventListener('click', () => { if (estado.mood) buscarCanciones(estado.mood, false); });
$('#player-toggle').addEventListener('click', alternar);
$('#player-prev').addEventListener('click', () => saltar(-1));
$('#player-next').addEventListener('click', () => saltar(1));
$('#player-lyrics').addEventListener('click', () => { if (estado.actual) verLetra(estado.actual); });
$('#close-lyrics').addEventListener('click', cerrarLetra);
$('#lv-toggle').addEventListener('click', alternar);
$('#lv-up').addEventListener('click', () => irALinea(visor.activa - 1));
$('#lv-down').addEventListener('click', () => irALinea(visor.activa + 1));
document.querySelectorAll('.speed button').forEach((b) => b.addEventListener('click', () => { visor.ritmo = parseFloat(b.dataset.ritmo); document.querySelectorAll('.speed button').forEach((x) => x.classList.toggle('on', x === b)); programarAvance(); }));
$('#lv-stage').addEventListener('wheel', (e) => {
    e.preventDefault(); const ahora = Date.now(); if (ahora - visor.ultimoScroll < 350) return; visor.ultimoScroll = ahora; irALinea(visor.activa + (e.deltaY > 0 ? 1 : -1));
}, { passive: false });
let toqueY = null;
$('#lv-stage').addEventListener('touchstart', (e) => { toqueY = e.touches[0].clientY; }, { passive: true });
$('#lv-stage').addEventListener('touchend', (e) => {
    if (toqueY === null) return; const dy = toqueY - e.changedTouches[0].clientY; if (Math.abs(dy) > 40) irALinea(visor.activa + (dy > 0 ? 1 : -1)); toqueY = null;
}, { passive: true });
document.addEventListener('keydown', (e) => {
    if (!visor.abierta) return; if (e.key === 'Escape') cerrarLetra();
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); irALinea(visor.activa + 1); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); irALinea(visor.activa - 1); }
    else if (e.key === ' ' && e.target.tagName !== 'BUTTON') { e.preventDefault(); alternar(); }
});
window.addEventListener('resize', centrarLinea);
document.querySelectorAll('#idioma button').forEach((b) => b.addEventListener('click', () => { estado.idioma = b.dataset.idioma; document.querySelectorAll('#idioma button').forEach((x) => x.classList.toggle('on', x === b)); if (estado.mood) buscarCanciones(estado.mood, false); }));
audio.volume = 0.8; $('#volume').style.setProperty('--p', '80%');
$('#volume').addEventListener('input', (e) => { audio.volume = parseFloat(e.target.value); e.target.style.setProperty('--p', (audio.volume * 100) + '%'); });
document.addEventListener('keydown', (e) => {
    if (visor.abierta || e.ctrlKey || e.metaKey || e.altKey) return; if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === ' ' && e.target.tagName !== 'BUTTON') { e.preventDefault(); alternar(); }
    else if (e.key === 'ArrowRight') saltar(1); else if (e.key === 'ArrowLeft') saltar(-1);
    else if (e.key === 'l' || e.key === 'L') { if (estado.actual) verLetra(estado.actual); }
    else if (e.key === 'f' || e.key === 'F') alternarFav(estado.actual);
});
(function () {
    const hero = $('.hero'), vinilo = $('#vinyl'); if (!matchMedia('(pointer: fine)').matches) return; let pend = null;
    hero.addEventListener('pointermove', (e) => {
        pend = e; if (hero._raf) return;
        hero._raf = requestAnimationFrame(() => {
            hero._raf = 0; const r = hero.getBoundingClientRect(); const x = (pend.clientX - r.left) / r.width, y = (pend.clientY - r.top) / r.height;
            hero.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); hero.style.setProperty('--my', (y * 100).toFixed(1) + '%');
            vinilo.style.setProperty('--ry', ((x - 0.5) * 14).toFixed(1) + 'deg'); vinilo.style.setProperty('--rx', ((0.5 - y) * 10).toFixed(1) + 'deg');
        });
    });
    hero.addEventListener('pointerleave', () => { vinilo.style.setProperty('--rx', '0deg'); vinilo.style.setProperty('--ry', '0deg'); });
})();
$('#search-form').addEventListener('submit', (e) => { e.preventDefault(); buscarMusica($('#search-input').value, tipoBusqueda); });
document.querySelectorAll('#tipos button').forEach((b) => b.addEventListener('click', () => { tipoBusqueda = b.dataset.tipo; document.querySelectorAll('#tipos button').forEach((x) => x.classList.toggle('on', x === b)); if ($('#search-input').value.trim()) buscarMusica($('#search-input').value, tipoBusqueda); }));
document.querySelectorAll('#lib-tabs button').forEach((b) => b.addEventListener('click', () => { tabLib = b.dataset.tab; document.querySelectorAll('#lib-tabs button').forEach((x) => x.classList.toggle('on', x === b)); renderBiblioteca(); }));
$('#lib-crear').addEventListener('click', () => abrirDialogo(null));
$('#dlg-cerrar').addEventListener('click', () => $('#dlg-pl').close());
$('#player-shuffle').addEventListener('click', () => { fijarAleatorio(!estado.aleatorio); toast(estado.aleatorio ? 'Aleatorio activado' : 'Aleatorio desactivado'); });
$('#player-repeat').addEventListener('click', () => {
    estado.repetir = !estado.repetir; audio.loop = estado.repetir || visor.abierta;
    $('#player-repeat').classList.toggle('on', estado.repetir); $('#player-repeat').setAttribute('aria-pressed', estado.repetir);
    toast(estado.repetir ? 'Repetir canción activado' : 'Repetir desactivado');
});
window.addEventListener('load', () => setTimeout(() => $('#preloader').classList.add('hide'), 800));
setTimeout(() => $('#preloader').classList.add('hide'), 4000);

let toastT;
function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800);
}

/* =====================================================================
   SISTEMA DE LOGIN (Conectado a Node.js + MySQL)
   ===================================================================== */
const vistas = {
    login: $('#view-login'), register: $('#view-register'), forgot: $('#view-forgot'), reset: $('#view-reset')
};
const AV_INFO = {
    feliz:     { titulo: 'Sube el ritmo',   texto: 'Pop, baile y buena vibra para empezar el día.', tag: 'Pop y baile' },
    triste:    { titulo: 'Déjalo salir',    texto: 'Baladas que abrazan cuando más lo necesitas.', tag: 'Baladas y acústico' },
    relajado:  { titulo: 'Respira hondo',   texto: 'Chill y lo-fi para bajar las revoluciones.', tag: 'Chill y lo-fi' },
    motivado:  { titulo: 'A romper marcas', texto: 'Rock y energía para entrenar sin parar.', tag: 'Rock y entreno' },
    romantico: { titulo: 'Para dos voces',  texto: 'Canciones de amor para quien ya está en tu mente.', tag: 'Canciones de amor' }
};
const SIN_MOVIMIENTO = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ULTIMO_KEY = 'moodtunes_ultimo';
let avIdx = -1, avTimer = null, usuarioRecuperacion = null, reenvioT = null;

/* ---------- Avisos y estado de botones ---------- */
function setAviso(msg, tipo) {
    const el = $('#auth-error');
    if (!msg) { el.hidden = true; $('#auth-error-txt').textContent = ''; return; }
    el.dataset.tipo = tipo || 'error';
    $('#auth-error-txt').textContent = msg;
    el.hidden = false;
    el.scrollIntoView({ block: 'nearest', behavior: SIN_MOVIMIENTO ? 'auto' : 'smooth' });
}
function sacudir() {
    const card = $('#auth-card'); card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
}
function mostrarError(msg, input) {
    setAviso(msg, 'error'); sacudir();
    if (input) { input.focus({ preventScroll: true }); if (input.select && input.type !== 'checkbox') input.select(); }
}
function ocupado(btn, on, texto) { btn.disabled = on; btn.classList.toggle('loading', on); btn.textContent = texto; }

/* ---------- Validación en vivo, campo por campo ---------- */
const USUARIO_OK = /^[\p{L}\p{N}._-]+$/u;
const VALIDAR = {
    'login-user':  (v) => v.trim() ? '' : 'Escribe tu usuario o correo.',
    'login-pass':  (v) => v ? '' : 'Escribe tu contraseña.',
    'reg-name':    (v) => { v = v.trim(); return v.length < 3 ? 'Usa al menos 3 caracteres.' : v.length > 30 ? 'Máximo 30 caracteres.' : !USUARIO_OK.test(v) ? 'Solo letras, números, punto, guion y guion bajo.' : ''; },
    'reg-email':   (v) => /^\S+@\S+\.\S+$/.test(v.trim()) ? '' : 'Escribe un correo válido, como nombre@correo.com.',
    'reg-pass':    (v) => v.length < 6 ? 'Usa al menos 6 caracteres.' : '',
    'reg-pass2':   (v) => v !== $('#reg-pass').value ? 'Las contraseñas no coinciden.' : '',
    'forgot-user': (v) => v.trim() ? '' : 'Escribe tu usuario o correo.',
    'reset-code':  (v) => /^\d{6}$/.test(v.trim()) ? '' : 'El código tiene 6 dígitos.',
    'reset-pass1': (v) => v.length < 6 ? 'Usa al menos 6 caracteres.' : '',
    'reset-pass2': (v) => v !== $('#reset-pass1').value ? 'Las contraseñas no coinciden.' : ''
};
function marcarCampo(input, msg) {
    const f = input.closest('.field'), m = f.querySelector('.field-msg');
    f.classList.toggle('invalid', !!msg);
    f.classList.toggle('valid', !msg && !!input.value);
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (m) m.textContent = msg || '';
}
function validarCampo(input) {
    const fn = VALIDAR[input.id]; if (!fn) return true;
    const msg = fn(input.value); marcarCampo(input, msg); return !msg;
}
function validarForm(form) {
    let primero = null;
    form.querySelectorAll('input').forEach((i) => { i.dataset.tocado = '1'; if (VALIDAR[i.id] && !validarCampo(i) && !primero) primero = i; });
    if (primero) { sacudir(); primero.focus({ preventScroll: true }); setAviso(''); }
    return !primero;
}
Object.keys(VALIDAR).forEach((id) => {
    const i = $('#' + id); if (!i) return;
    i.addEventListener('blur', () => { if (i.value || i.dataset.tocado) { i.dataset.tocado = '1'; validarCampo(i); } });
    i.addEventListener('input', () => {
        if (i.dataset.tocado) validarCampo(i);
        setAviso('');
        const par = { 'reg-pass': 'reg-pass2', 'reset-pass1': 'reset-pass2' }[id];
        if (par && $('#' + par).dataset.tocado) validarCampo($('#' + par));
    });
});
$('#reset-code').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });

/* ---------- Navegación entre vistas ---------- */
function mostrarVista(vista) {
    Object.entries(vistas).forEach(([k, v]) => { v.hidden = k !== vista; });
    const conTabs = vista === 'login' || vista === 'register', tabs = $('#auth-tabs');
    tabs.hidden = !conTabs;
    if (conTabs) {
        tabs.dataset.on = vista;
        $('#tab-login').setAttribute('aria-selected', vista === 'login');
        $('#tab-register').setAttribute('aria-selected', vista === 'register');
    }
    setAviso('');
    const primero = vistas[vista].querySelector('input');
    setTimeout(() => { if (primero) primero.focus({ preventScroll: true }); }, 80);
}
$('#tab-login').onclick = () => mostrarVista('login');
$('#tab-register').onclick = () => mostrarVista('register');
$('#btn-to-forgot').onclick = () => { mostrarVista('forgot'); const u = $('#login-user').value.trim(); if (u) $('#forgot-user').value = u; };
$('#btn-back-login-from-forgot').onclick = () => mostrarVista('login');
$('#btn-back-login-from-reset').onclick = () => mostrarVista('login');

async function llamarAPI(datos) {
    try {
        const res = await fetch('/api/auth', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos)
        });
        const txt = await res.text();
        try { return JSON.parse(txt); }
        catch (e) { return { error: 'El servidor respondió algo inesperado. Revisa la consola donde corre node server.js.' }; }
    } catch (error) { return { error: 'No hay conexión con el servidor. Abre el sitio en http://localhost:3000 y enciende el servidor con: node server.js' }; }
}

/* ---------- Mostrar/ocultar contraseña y aviso de Bloq Mayús ---------- */
document.querySelectorAll('.pw-toggle').forEach((b) => b.addEventListener('click', () => {
    const i = $('#' + b.dataset.for), ver = i.type === 'password';
    i.type = ver ? 'text' : 'password'; b.classList.toggle('on', ver);
    b.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña'); i.focus();
}));
['#login-pass', '#reg-pass', '#reset-pass1'].forEach((sel) => {
    const input = $(sel), aviso = input.closest('.auth-view').querySelector('.caps');
    ['keydown', 'keyup'].forEach((ev) => input.addEventListener(ev, (e) => { if (e.getModifierState) aviso.hidden = !e.getModifierState('CapsLock'); }));
    input.addEventListener('blur', () => { aviso.hidden = true; });
});

/* ---------- Medidor de fuerza de la contraseña ---------- */
function fuerza(p) {
    if (!p) return 0;
    let n = 0;
    if (p.length >= 6) n++;
    if (p.length >= 10) n++;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) n++;
    if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) n++;
    else if (/\d/.test(p) || /[^A-Za-z0-9]/.test(p)) n += 0.5;
    return Math.max(1, Math.min(4, Math.floor(n)));
}
function reglas(p) { return { len: p.length >= 6, case: /[a-z]/.test(p) && /[A-Z]/.test(p), num: /\d/.test(p) }; }
function pintarFuerza(p) {
    const nivel = fuerza(p), r = reglas(p);
    $('#strength').dataset.level = nivel;
    $('#strength-txt').textContent = ['Escribe una contraseña', 'Débil', 'Regular', 'Buena', 'Muy fuerte'][nivel];
    document.querySelectorAll('#rules li').forEach((li) => li.classList.toggle('ok', !!r[li.dataset.r]));
}
$('#reg-pass').addEventListener('input', (e) => pintarFuerza(e.target.value));

/* ---------- Recordar el último usuario ---------- */
try { const u = localStorage.getItem(ULTIMO_KEY); if (u) $('#login-user').value = u; } catch (e) { }

/* ---------- Entrar ---------- */
function entrarOK(res, recordar) {
    limpiarDatosPersonales();
    try {
        localStorage.removeItem(SESION_KEY); sessionStorage.removeItem(SESION_KEY);
        (recordar ? localStorage : sessionStorage).setItem(SESION_KEY, JSON.stringify(res));
        localStorage.setItem(ULTIMO_KEY, res.usuario);
    } catch (err) { }
    $('#login-pass').value = ''; setAviso('');
    clearInterval(avTimer);
    $('#auth-done-txt').textContent = 'Hola, ' + res.usuario;
    $('#auth-done').hidden = false;
    setTimeout(() => $('#auth-screen').classList.add('leaving'), 900);
    setTimeout(() => { location.reload(); }, 1350);
}
$('#form-login').onsubmit = async (e) => {
    e.preventDefault(); setAviso('');
    if (!validarForm(e.target)) return;
    const btn = e.target.querySelector('[type=submit]');
    const usuario = $('#login-user').value.trim(), pass = $('#login-pass').value, recordar = $('#login-remember').checked;
    ocupado(btn, true, 'Iniciando sesión…');
    const res = await llamarAPI({ accion: 'login', usuario, password: pass, recordar });
    ocupado(btn, false, 'Iniciar sesión');
    if (res.success) entrarOK(res, recordar);
    else mostrarError(res.error || 'No se pudo iniciar sesión.', $('#login-pass'));
};

/* ---------- Crear cuenta ---------- */
$('#form-register').onsubmit = async (e) => {
    e.preventDefault(); setAviso('');
    if (!validarForm(e.target)) return;
    const btn = e.target.querySelector('[type=submit]');
    const usuario = $('#reg-name').value.trim(), email = $('#reg-email').value.trim(), pass = $('#reg-pass').value;
    ocupado(btn, true, 'Suscribiéndote…');
    const res = await llamarAPI({ accion: 'registro', usuario, email, password: pass });
    ocupado(btn, false, 'Suscríbete');
    if (res.success) {
        e.target.reset(); pintarFuerza('');
        e.target.querySelectorAll('.field').forEach((f) => f.classList.remove('valid', 'invalid'));
        e.target.querySelectorAll('input').forEach((i) => { delete i.dataset.tocado; });
        mostrarVista('login'); $('#login-user').value = usuario; $('#login-user').dispatchEvent(new Event('input'));
        setTimeout(() => $('#login-pass').focus({ preventScroll: true }), 120);
        toast('¡Cuenta creada! Ahora inicia sesión.');
    } else { mostrarError(res.error || 'No se pudo crear la cuenta.', null); }
};

/* ---------- Recuperar cuenta (código de 6 dígitos) ---------- */
function mostrarPistaCodigo(res) {
    const h = $('#reset-hint');
    h.textContent = res.mensaje || 'Si la cuenta existe, enviamos un código de 6 dígitos al correo registrado.';
    h.hidden = false;
}
function iniciarReenvio() {
    const b = $('#btn-resend'); let s = 120; clearInterval(reenvioT); b.disabled = true;
    const paso = () => {
        const tiempo = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
        b.textContent = s > 0 ? 'Reenviar código (' + tiempo + ')' : 'Reenviar código';
        if (s <= 0) { b.disabled = false; clearInterval(reenvioT); }
        s--;
    };
    paso(); reenvioT = setInterval(paso, 1000);
}
$('#form-forgot').onsubmit = async (e) => {
    e.preventDefault(); setAviso('');
    if (!validarForm(e.target)) return;
    const btn = e.target.querySelector('[type=submit]'), userIn = $('#forgot-user').value.trim();
    ocupado(btn, true, 'Enviando…');
    const res = await llamarAPI({ accion: 'recuperar', usuario: userIn });
    ocupado(btn, false, 'Enviar código');
    if (res.success) {
        usuarioRecuperacion = userIn; mostrarPistaCodigo(res); mostrarVista('reset'); iniciarReenvio();
    } else { mostrarError(res.error || 'No pudimos enviar el código.', $('#forgot-user')); }
};
$('#btn-resend').onclick = async () => {
    if (!usuarioRecuperacion) return;
    const res = await llamarAPI({ accion: 'recuperar', usuario: usuarioRecuperacion });
    if (res.success) { mostrarPistaCodigo(res); iniciarReenvio(); toast('Te enviamos un código nuevo'); }
    else setAviso(res.error || 'No pudimos reenviar el código.', 'error');
};
$('#form-reset').onsubmit = async (e) => {
    e.preventDefault(); setAviso('');
    if (!validarForm(e.target)) return;
    const btn = e.target.querySelector('[type=submit]');
    ocupado(btn, true, 'Guardando…');
    const res = await llamarAPI({ accion: 'reset', usuario: usuarioRecuperacion, codigo: $('#reset-code').value.trim(), password: $('#reset-pass1').value });
    ocupado(btn, false, 'Cambiar contraseña');
    if (res.success) {
        const u = usuarioRecuperacion; usuarioRecuperacion = null; clearInterval(reenvioT);
        e.target.reset(); $('#reset-hint').hidden = true;
        e.target.querySelectorAll('.field').forEach((f) => f.classList.remove('valid', 'invalid'));
        e.target.querySelectorAll('input').forEach((i) => { delete i.dataset.tocado; });
        mostrarVista('login'); if (u && !u.includes('@')) $('#login-user').value = u;
        toast('Contraseña actualizada. ¡Inicia sesión!');
    } else { mostrarError(res.error || 'No se pudo actualizar.', $('#reset-code')); }
};

/* ---------- Panel visual: el ánimo cambia solo, o lo eliges tú ---------- */
function avAplicar(k) {
    const info = AV_INFO[k]; if (!info) return;
    const claves = Object.keys(MOODS); avIdx = claves.indexOf(k);
    aplicarTema(k);
    const txt = $('#av-text'); txt.classList.add('swap');
    setTimeout(() => { $('#av-title').textContent = info.titulo; $('#av-sub').textContent = info.texto; txt.classList.remove('swap'); }, 280);
    $('#av-emoji').textContent = EMOJI[k]; $('#av-name').textContent = MOODS[k].nombre; $('#av-tag').textContent = info.tag;
    const funda = $('#av-sleeve'); funda.classList.remove('pop'); void funda.offsetWidth; funda.classList.add('pop');
    const botones = document.querySelectorAll('.av-mood');
    botones.forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); });
    void $('#av-moods').offsetWidth;
    botones.forEach((b) => { if (b.dataset.mood === k) { b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); } });
}
function avCiclo() {
    clearInterval(avTimer); if (SIN_MOVIMIENTO) return;
    avTimer = setInterval(() => {
        if ($('#auth-screen').classList.contains('hide') || document.hidden) return;
        const claves = Object.keys(MOODS); avAplicar(claves[(avIdx + 1) % claves.length]);
    }, 5200);
}
function crearNotasAuth() {
    const c = $('#av-notes'); if (!c || SIN_MOVIMIENTO) return;
    const notas = ['♪', '♫', '♩', '♬'];
    for (let i = 0; i < 12; i++) {
        const n = document.createElement('span'); n.textContent = notas[i % notas.length];
        n.style.left = (Math.random() * 92).toFixed(1) + '%';
        n.style.setProperty('--size', (0.9 + Math.random() * 1.4).toFixed(2) + 'rem');
        n.style.setProperty('--dur', (9 + Math.random() * 10).toFixed(1) + 's');
        n.style.setProperty('--delay', (-Math.random() * 16).toFixed(1) + 's');
        c.appendChild(n);
    }
}
function iniciarAuth() {
    crearEspectro('#av-eq', 34, 40); crearNotasAuth();
    if (!leerSesion()) { avAplicar('feliz'); avCiclo(); }
    try {
        const aviso = sessionStorage.getItem('moodtunes_aviso');
        if (aviso) { sessionStorage.removeItem('moodtunes_aviso'); setAviso(aviso, 'info'); }
    } catch (e) { }
    document.querySelectorAll('.av-mood').forEach((b) => b.addEventListener('click', () => { avAplicar(b.dataset.mood); avCiclo(); }));
    if (matchMedia('(pointer: fine)').matches && !SIN_MOVIMIENTO) {
        const stage = $('#av-stage'), card = $('#auth-card');
        $('#auth-screen').addEventListener('pointermove', (e) => {
            const nx = (e.clientX / innerWidth - 0.5) * 2, ny = (e.clientY / innerHeight - 0.5) * 2;
            stage.style.setProperty('--px', nx.toFixed(2)); stage.style.setProperty('--py', ny.toFixed(2));
            const r = card.getBoundingClientRect();
            card.style.setProperty('--sx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
            card.style.setProperty('--sy', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
            card.style.setProperty('--ry', (nx * 2.2).toFixed(2) + 'deg'); card.style.setProperty('--rx', (-ny * 1.6).toFixed(2) + 'deg');
        });
        $('#auth-screen').addEventListener('pointerleave', () => { card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); });
    }
}

/* =====================================================================
   PERFIL DE USUARIO Y ESTADÍSTICAS PERSONALIZADAS
   ===================================================================== */
const SESION_KEY = 'moodtunes_sesion', MOOD_KEY = 'moodtunes_moods', PLAY_KEY = 'moodtunes_plays';
const AVATARES = {
    bronce: ['#e2c29b', '#8a6a45'], coral: ['#ff8a6b', '#d4553f'], mar: ['#5fd0c0', '#1f6f8b'],
    noche: ['#9a8cff', '#4b3bd1'], rosa: ['#ff8fb8', '#c9588a'], oro: ['#ffd36b', '#e8a43a']
};
let avatarElegido = 'bronce';

function leerSesion() { try { return JSON.parse(sessionStorage.getItem(SESION_KEY) || localStorage.getItem(SESION_KEY)); } catch (e) { return null; } }
function guardarSesion(s) { try { (sessionStorage.getItem(SESION_KEY) ? sessionStorage : localStorage).setItem(SESION_KEY, JSON.stringify(s)); } catch (e) { } }
function limpiarSesionLocal() { try { localStorage.removeItem(SESION_KEY); sessionStorage.removeItem(SESION_KEY); } catch (e) { } }

function sesionExpirada() {
    limpiarSesionLocal(); limpiarDatosPersonales();
    try { sessionStorage.setItem('moodtunes_aviso', 'Tu sesión expiró. Inicia sesión de nuevo.'); } catch (e) { }
    location.reload();
}

function leerMoods() {
    const s = leerSesion();
    const key = s ? `${MOOD_KEY}_${s.id}` : MOOD_KEY;
    try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; }
}
function registrarAnimo(k) {
    const s = leerSesion();
    const key = s ? `${MOOD_KEY}_${s.id}` : MOOD_KEY;
    const m = leerMoods(); m[k] = (m[k] || 0) + 1;
    try { localStorage.setItem(key, JSON.stringify(m)); } catch (e) { }
}
function contarPlay() {
    const s = leerSesion();
    const key = s ? `${PLAY_KEY}_${s.id}` : PLAY_KEY;
    try { localStorage.setItem(key, String((parseInt(localStorage.getItem(key)) || 0) + 1)); } catch (e) { }
}

function pintarAvatar(el, s) {
    if (!el) return;
    const par = AVATARES[s.avatar] || AVATARES.bronce;
    el.textContent = s.usuario.charAt(0).toUpperCase();
    el.style.setProperty('--av1', par[0]); el.style.setProperty('--av2', par[1]);
}
function textoDesde(d) {
    if (!d) return 'Miembro de MoodTunes';
    const f = new Date(String(d).replace(' ', 'T'));
    return isNaN(f) ? 'Miembro de MoodTunes' : 'Miembro desde ' + f.toLocaleDateString('es', { month: 'long', year: 'numeric' });
}
function animarNumero(el, fin) {
    const ini = parseInt(el.textContent) || 0, t0 = performance.now();
    (function paso(t) {
        const p = Math.min(1, (t - t0) / 700);
        el.textContent = Math.round(ini + (fin - ini) * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(paso);
    })(t0);
}

function renderPerfil() {
    const s = leerSesion(); if (!s) return;
    ['#user-avatar', '#panel-avatar', '#dd-avatar'].forEach((id) => pintarAvatar($(id), s));
    $('#user-name').textContent = s.usuario; $('#dd-name').textContent = s.usuario; $('#panel-name').textContent = s.usuario;
    const mail = s.email || 'Sin correo';
    $('#dd-email').textContent = mail; $('#panel-email').textContent = mail;
    $('#panel-since').textContent = textoDesde(s.desde);
    $('#info-user').textContent = s.usuario; $('#info-email').textContent = mail; $('#info-id').textContent = '#' + String(s.id).padStart(4, '0');

    const lib = leerLib();
    animarNumero($('#st-favs'), leerFavs().length);
    animarNumero($('#st-pl'), lib.playlists.length);
    animarNumero($('#st-art'), 0);

    const playKey = `${PLAY_KEY}_${s.id}`;
    animarNumero($('#st-plays'), parseInt(localStorage.getItem(playKey)) || 0);

    const moods = leerMoods(), total = Object.values(moods).reduce((a, b) => a + b, 0), max = Math.max(1, ...Object.values(moods));
    const cont = $('#mood-bars'); cont.innerHTML = '';
    Object.keys(MOODS).forEach((k) => {
        const n = moods[k] || 0, row = document.createElement('div'); row.className = 'mb-row';
        row.innerHTML = '<span>' + EMOJI[k] + ' ' + MOODS[k].nombre + '</span><div class="mb-bar"><span style="--c:' + MOODS[k].color + '"></span></div><b>' + n + '</b>';
        cont.appendChild(row);
        setTimeout(() => row.querySelector('.mb-bar span').style.setProperty('--w', (n / max * 100) + '%'), 120);
    });
    const top = Object.keys(moods).sort((a, b) => moods[b] - moods[a])[0];
    $('#mood-top').textContent = total && top ? 'Favorito: ' + EMOJI[top] + ' ' + MOODS[top].nombre : 'Aún sin datos';
}

function verPanel(vista) {
    $('#pp-view').hidden = vista !== 'view'; $('#form-edit').hidden = vista !== 'edit';
    if (vista === 'edit') {
        const s = leerSesion(); avatarElegido = s.avatar || 'bronce';
        $('#ed-user').value = s.usuario; $('#ed-email').value = s.email || ''; $('#ed-pass').value = ''; $('#ed-error').textContent = '';
        pintarSwatches();
    }
}
function pintarSwatches() {
    const c = $('#swatches'); c.innerHTML = '';
    Object.entries(AVATARES).forEach(([k, [a, b]]) => {
        const s = document.createElement('button'); s.type = 'button'; s.className = 'swatch' + (k === avatarElegido ? ' on' : '');
        s.style.setProperty('--a', a); s.style.setProperty('--b', b); s.setAttribute('aria-label', 'Color ' + k);
        s.addEventListener('click', () => { avatarElegido = k; pintarSwatches(); pintarAvatar($('#panel-avatar'), { usuario: $('#ed-user').value || 'U', avatar: k }); });
        c.appendChild(s);
    });
}
function abrirPanel() {
    renderPerfil(); verPanel('view');
    $('#profile-panel').classList.add('open'); $('#profile-panel').setAttribute('aria-hidden', 'false'); $('#panel-overlay').classList.add('show');
}
function cerrarPanel() {
    $('#profile-panel').classList.remove('open'); $('#profile-panel').setAttribute('aria-hidden', 'true'); $('#panel-overlay').classList.remove('show');
}
function menuUsuario(abrir) {
    const dd = $('#user-dropdown'); dd.hidden = !abrir; $('#user-profile-btn').setAttribute('aria-expanded', abrir);
}

async function cerrarSesion() {
    try { await llamarAPI({ accion: 'logout' }); } catch (e) { }
    limpiarSesionLocal(); limpiarDatosPersonales();
    location.reload();
}

function iniciarPerfil() {
    const btn = $('#user-profile-btn'), dd = $('#user-dropdown');
    btn.addEventListener('click', (e) => { e.stopPropagation(); menuUsuario(dd.hidden); });
    document.addEventListener('click', (e) => { if (!dd.hidden && !dd.contains(e.target)) menuUsuario(false); });
    $('#dd-profile').addEventListener('click', () => { menuUsuario(false); abrirPanel(); });
    $('#dd-favs').addEventListener('click', () => menuUsuario(false));
    $('#dd-logout').addEventListener('click', cerrarSesion);
    $('#btn-logout-panel').addEventListener('click', cerrarSesion);
    $('#close-profile').addEventListener('click', cerrarPanel);
    $('#panel-overlay').addEventListener('click', cerrarPanel);
    $('#btn-edit').addEventListener('click', () => verPanel('edit'));
    $('#btn-edit-cancel').addEventListener('click', () => { verPanel('view'); renderPerfil(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { cerrarPanel(); menuUsuario(false); } });

    $('#form-edit').addEventListener('submit', async (e) => {
        e.preventDefault(); const s = leerSesion(), b = e.target.querySelector('[type=submit]');
        b.disabled = true; b.textContent = 'Guardando…';
        const res = await llamarAPI({ accion: 'actualizar', usuario: $('#ed-user').value.trim(), email: $('#ed-email').value.trim(), avatar: avatarElegido, password: $('#ed-pass').value });
        b.disabled = false; b.textContent = 'Guardar cambios';
        if (res.sin_sesion) { sesionExpirada(); return; }
        if (res.success) {
            guardarSesion({ ...s, usuario: res.usuario, email: res.email, avatar: res.avatar });
            verPanel('view'); renderPerfil(); toast('Perfil actualizado ✓');
        } else { $('#ed-error').textContent = res.error; }
    });
}

/* =====================================================================
   VERIFICACIÓN DE SESIÓN
   ===================================================================== */
async function validarSesionServidor() {
    const r = await llamarAPI({ accion: 'sesion' });
    if (r && r.success) {
        guardarSesion({ ...r });
        renderPerfil();
    } else if (r && r.sin_sesion) {
        sesionExpirada();
    }
}

function verificarSesion() {
    const s = leerSesion(), btn = $('#user-profile-btn');
    if (s) {
        $('#auth-screen').classList.add('hide');
        btn.style.display = 'flex';
        renderPerfil();
        validarSesionServidor();
        cargarDatosDeBD();
    } else {
        $('#auth-screen').classList.remove('hide');
        btn.style.display = 'none';
        menuUsuario(false);
        cerrarPanel();
        limpiarDatosPersonales();
        renderFavs();
        renderBiblioteca();
    }
}

/* ---------- Efectos: barra de progreso y aparición al hacer scroll ---------- */
function iniciarEfectos() {
    const barra = $('#scroll-progress');
    window.addEventListener('scroll', () => {
        const h = document.documentElement.scrollHeight - innerHeight;
        barra.style.transform = 'scaleX(' + (h > 0 ? scrollY / h : 0) + ')';
    }, { passive: true });
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.08 });
    document.querySelectorAll('.section').forEach((s) => { s.classList.add('reveal'); io.observe(s); });
}

/* =====================================================================
   CARGAR AJUSTES DEL SITIO (FONDO Y FRASE)
   ===================================================================== */
async function cargarAjustesSitio() {
    try {
        const res = await fetch('/api/auth', {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accion: 'ajustes' })
        });
        const data = await res.json();
        
        if (data) {
            if (data.frase_principal) {
                const elFrase = document.getElementById('frase');
                if (elFrase) elFrase.textContent = data.frase_principal;
            }
            
            if (data.fondo_portada) {
                const url = cssUrl(data.fondo_portada);
                const vinylLabel = document.getElementById('vinyl');
                const heroBg = document.querySelector('.hero-bg');
                if (vinylLabel) vinylLabel.style.setProperty('--label', url);
                if (heroBg) heroBg.style.setProperty('--cover', url);
            }

            if (data.lista_generos) {
                try {
                    const generosCustom = JSON.parse(data.lista_generos);
                    if (Array.isArray(generosCustom) && generosCustom.length > 0) {
                        GENEROS.length = 0;
                        generosCustom.forEach(g => GENEROS.push(g));
                        document.getElementById('cat-grid').innerHTML = '';
                        crearExplorar(); 
                    }
                } catch(e) { console.error("Error al leer los géneros personalizados", e); }
            }
        }
    } catch (e) { console.log("Ajustes no cargados", e); }
}

crearEspectro('#spectrum', 80, 120); crearEspectro('#lv-eq', 70, 90); crearNotas(); crearExplorar(); fxIniciar(); renderFavs(); aplicarTema(null); actualizarFrase(); cargarClima();
iniciarPerfil(); iniciarEfectos(); iniciarAuth(); verificarSesion();
cargarAjustesSitio();