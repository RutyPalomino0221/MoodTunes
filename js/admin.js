'use strict';
/* =====================================================================
   MoodTunes — panel de administración (login + dashboard + gestión)
   Todo el texto que viene de la base de datos se inserta con textContent,
   nunca con innerHTML, para que nadie pueda colar código.
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);

/* Crea elementos de forma segura */
function el(tag, props, ...hijos) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'value') e.value = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
    }
    hijos.flat().forEach((h) => { if (h != null && h !== false) e.append(h.nodeType ? h : document.createTextNode(String(h))); });
    return e;
}
const vaciar = (n) => n.replaceChildren();
const fecha = (s) => { const d = new Date(String(s).replace(' ', 'T')); return isNaN(d) ? '—' : d.toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric' }); };
const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);

/* ---------- API ---------- */
async function api(accion, datos) {
    try {
        const r = await fetch('/api/admin', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion, ...(datos || {}) })
        });
        const d = await r.json();
        if (d && d.sin_sesion && accion !== 'verificar') { mostrarLogin('Tu sesión venció. Entra de nuevo.'); }
        return d;
    } catch (e) { return { error: 'No hay conexión con el servidor. ¿Está encendido node server.js?' }; }
}

/* ---------- Avisos ---------- */
let flashT;
function avisar(msg, tipo) {
    const f = $('#flash'); f.textContent = msg; f.className = 'flash flash-' + (tipo === 'err' ? 'err' : 'ok'); f.hidden = false;
    clearTimeout(flashT); flashT = setTimeout(() => { f.hidden = true; }, 4500);
}

/* =====================================================================
   LOGIN
   ===================================================================== */
function mostrarLogin(msg) {
    $('#app').hidden = true; $('#login-screen').hidden = false;
    $('#owner-login-view').hidden = false; $('#admin-recovery-view').hidden = true;
    $('#form-recovery-request').hidden = false; $('#form-recovery').hidden = true; $('#recovery-status').hidden = true;
    $('#login-error').textContent = msg || '';
    $('#login-success').hidden = true;
    $('#a-pass').value = '';
    setTimeout(() => $('#a-user').focus(), 50);
}
function mostrarPanel(nombre) {
    $('#login-screen').hidden = true; $('#app').hidden = false;
    $('#admin-nombre').textContent = nombre;
    ir(location.hash.slice(1));
}
$('#pw-ver').addEventListener('click', function () {
    const i = $('#a-pass'), ver = i.type === 'password';
    i.type = ver ? 'text' : 'password'; this.textContent = ver ? 'Ocultar' : 'Ver';
    this.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña'); i.focus();
});
$('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = $('#a-user').value.trim(), p = $('#a-pass').value, btn = $('#btn-entrar');
    if (!u || !p) { $('#login-error').textContent = 'Completa usuario y contraseña.'; return; }
    btn.disabled = true; btn.textContent = 'Entrando…'; $('#login-error').textContent = '';
    const r = await api('login', { usuario: u, password: p });
    btn.disabled = false; btn.textContent = 'Entrar al panel';
    if (r.success) mostrarPanel(r.usuario);
    else { $('#login-error').textContent = r.error || 'No se pudo entrar.'; $('#a-pass').select(); }
});
$('#btn-show-recovery').addEventListener('click', () => {
    $('#owner-login-view').hidden = true;
    $('#admin-recovery-view').hidden = false;
    $('#recovery-error').textContent = '';
    $('#form-recovery-request').hidden = false;
    $('#form-recovery').hidden = true;
    $('#recovery-status').hidden = true;
    $('#recovery-user').value = $('#a-user').value.trim();
    $('#recovery-code').value = '';
    $('#recovery-pass').value = '';
    $('#recovery-pass-confirm').value = '';
    $('#recovery-user').focus();
});
$('#btn-back-login').addEventListener('click', () => {
    $('#admin-recovery-view').hidden = true;
    $('#owner-login-view').hidden = false;
    $('#recovery-error').textContent = '';
    $('#a-user').focus();
});
$('#form-recovery-request').addEventListener('submit', async (e) => {
    e.preventDefault();
    const usuario = $('#recovery-user').value.trim();
    const btn = $('#btn-solicitar-codigo');
    if (!usuario) {
        $('#recovery-error').textContent = 'Escribe tu usuario propietario.';
        return;
    }

    btn.disabled = true; btn.textContent = 'Enviando…'; $('#recovery-error').textContent = '';
    const r = await api('solicitar_recuperacion', { usuario });
    btn.disabled = false; btn.textContent = 'Enviar código al correo';
    if (!r.success) {
        $('#recovery-error').textContent = r.error || 'No se pudo enviar el código.';
        return;
    }
    $('#form-recovery-request').hidden = true;
    $('#form-recovery').hidden = false;
    $('#recovery-status').textContent = r.mensaje;
    $('#recovery-status').hidden = false;
    $('#recovery-code').focus();
});
$('#recovery-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
});
$('#form-recovery').addEventListener('submit', async (e) => {
    e.preventDefault();
    const usuario = $('#recovery-user').value.trim();
    const codigo = $('#recovery-code').value.trim();
    const password = $('#recovery-pass').value;
    const confirmar = $('#recovery-pass-confirm').value;
    const btn = $('#btn-recuperar');
    if (!usuario || !/^\d{6}$/.test(codigo) || !password || !confirmar) {
        $('#recovery-error').textContent = 'Completa todos los campos.';
        return;
    }
    if (password !== confirmar) {
        $('#recovery-error').textContent = 'Las contraseñas no coinciden.';
        return;
    }
    const bytes = new TextEncoder().encode(password).length;
    if (bytes < 14 || bytes > 72) {
        $('#recovery-error').textContent = 'La contraseña debe tener entre 14 y 72 bytes.';
        return;
    }

    btn.disabled = true; btn.textContent = 'Restableciendo…'; $('#recovery-error').textContent = '';
    const r = await api('recuperar', { usuario, codigo, password });
    btn.disabled = false; btn.textContent = 'Restablecer contraseña';
    if (!r.success) {
        $('#recovery-error').textContent = r.error || 'No se pudo recuperar el acceso.';
        return;
    }
    $('#admin-recovery-view').hidden = true;
    $('#owner-login-view').hidden = false;
    $('#form-recovery').hidden = true;
    $('#form-recovery-request').hidden = false;
    $('#recovery-status').hidden = true;
    $('#a-user').value = usuario;
    $('#a-pass').value = '';
    $('#login-error').textContent = '';
    $('#login-success').textContent = r.mensaje;
    $('#login-success').hidden = false;
    $('#a-pass').focus();
});
$('#btn-logout').addEventListener('click', async () => { await api('logout'); location.hash = ''; mostrarLogin(); });

/* =====================================================================
   NAVEGACIÓN
   ===================================================================== */
const VISTAS = {
    dashboard: ['Resumen', 'Un vistazo rápido a cómo va MoodTunes.', cargarDashboard],
    usuarios:  ['Usuarios', 'Edita roles, cambia contraseñas o elimina cuentas.', cargarUsuarios],
    canciones: ['Canciones', 'Favoritas y canciones de playlists, por usuario.', cargarCanciones],
    playlists: ['Playlists', 'Todas las playlists que han creado tus usuarios.', cargarPlaylists],
    ajustes:   ['Ajustes del sitio', 'Fondo, frase principal y géneros de la web.', cargarAjustes]
};
function ir(v) {
    if (!VISTAS[v]) v = 'dashboard';
    if (location.hash.slice(1) !== v) history.replaceState(null, '', '#' + v);
    document.querySelectorAll('.vista').forEach((s) => { s.hidden = s.id !== 'v-' + v; });
    document.querySelectorAll('.sidebar nav a[data-vista]').forEach((a) => a.classList.toggle('active', a.dataset.vista === v));
    $('#vista-titulo').textContent = VISTAS[v][0]; $('#vista-sub').textContent = VISTAS[v][1];
    VISTAS[v][2]();
}
document.querySelectorAll('.sidebar nav a[data-vista]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); ir(a.dataset.vista); }));
window.addEventListener('hashchange', () => { if (!$('#app').hidden) ir(location.hash.slice(1)); });

/* =====================================================================
   DASHBOARD
   ===================================================================== */
async function cargarDashboard() {
    const r = await api('stats'); if (!r.success) { if (r.error) avisar(r.error, 'err'); return; }
    const s = r.stats, max = Math.max(1, s.usuarios, s.canciones, s.playlists);
    const tarjeta = (icono, n, nombre, pie, valor) => el('div', { class: 'stat-card' },
        el('div', { class: 'icon-box', text: icono }),
        el('div', { class: 'stat-body' }, el('h3', { text: n }), el('p', { text: nombre }),
            el('div', { class: 'progress-bar' }, el('span', { style: 'width:' + Math.round(valor / max * 100) + '%' })),
            el('span', { class: 'trend', text: pie })));
    const grid = $('#stats-grid'); vaciar(grid);
    grid.append(
        tarjeta('👥', s.usuarios, 'Usuarios', '+' + s.nuevos + ' esta semana', s.usuarios),
        tarjeta('🎵', s.canciones, 'Canciones guardadas', 'Favoritas y playlists', s.canciones),
        tarjeta('🎶', s.playlists, 'Playlists', (s.usuarios ? (s.playlists / s.usuarios).toFixed(1) : 0) + ' por usuario', s.playlists));

    // Gráfico de barras con datos reales
    const bc = $('#bar-chart'); vaciar(bc);
    if (!r.grafico.length) bc.append(el('p', { class: 'empty-msg', text: 'Aún no hay registros para graficar.' }));
    const mx = Math.max(1, ...r.grafico.map((g) => g.total));
    r.grafico.forEach((g) => bc.append(el('div', { class: 'bar-wrapper' },
        el('span', { class: 'bar-value', text: g.total }),
        el('div', { class: 'bar', style: 'height:' + Math.max(6, g.total / mx * 130) + 'px' }),
        el('span', { class: 'bar-label', text: g.dia.slice(8, 10) + '/' + g.dia.slice(5, 7) }))));

    // Dona con porcentajes reales
    const total = Math.max(1, s.usuarios + s.canciones + s.playlists);
    const pu = s.usuarios / total * 100, pc = s.canciones / total * 100;
    const dn = $('#donut'); vaciar(dn);
    dn.append(
        el('div', { class: 'donut-chart', style: 'background:conic-gradient(var(--blue) 0 ' + pu + '%, var(--neon) ' + pu + '% ' + (pu + pc) + '%, var(--purple) ' + (pu + pc) + '% 100%)' },
            el('div', { class: 'donut-inner' }, el('span', { text: s.usuarios + s.canciones + s.playlists }), el('small', { text: 'Registros' }))),
        el('div', { class: 'donut-legend' },
            ...[['user-dot', 'Usuarios', s.usuarios], ['song-dot', 'Canciones', s.canciones], ['list-dot', 'Playlists', s.playlists]].map(([c, n, v]) =>
                el('div', { class: 'legend-item' }, el('span', null, el('i', { class: 'dot ' + c }), n), el('b', { text: v })))));

    const tb = $('#tb-ultimos'); vaciar(tb);
    if (!r.ultimos.length) tb.append(el('tr', null, el('td', { colspan: 3, class: 'empty-msg', text: 'Todavía no hay usuarios.' })));
    r.ultimos.forEach((u) => tb.append(el('tr', null, el('td', null, el('strong', { text: u.usuario })), el('td', { text: u.email }), el('td', { text: fecha(u.created_at) }))));
}

/* =====================================================================
   USUARIOS
   ===================================================================== */
let usuarios = [];
async function cargarUsuarios() {
    const r = await api('usuarios'); if (!r.success) { if (r.error) avisar(r.error, 'err'); return; }
    usuarios = r.usuarios; pintarUsuarios();
}
function pintarUsuarios() {
    const q = $('#buscador').value.trim().toLowerCase(), tb = $('#tb-usuarios'); vaciar(tb);
    const lista = usuarios.filter((u) => !q || u.usuario.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    $('#contador-usuarios').textContent = plural(lista.length, 'usuario', 'usuarios');
    if (!lista.length) tb.append(el('tr', null, el('td', { colspan: 8, class: 'empty-msg', text: 'No hay usuarios que coincidan.' })));
    lista.forEach((u) => tb.append(el('tr', null,
        el('td', { text: '#' + u.id }),
        el('td', null, el('strong', { text: u.usuario })),
        el('td', { text: u.email }),
        el('td', null, el('span', { class: 'badge-user', text: 'Cliente' })),
        el('td', { text: u.canciones }), el('td', { text: u.playlists }),
        el('td', { text: fecha(u.created_at) }),
        el('td', { class: 'acciones' },
            el('button', { type: 'button', class: 'btn-action btn-edit', text: 'Editar', onclick: () => abrirEditar(u) }),
            el('button', { type: 'button', class: 'btn-action btn-delete', text: 'Eliminar', onclick: () => eliminarUsuario(u) })))));
}
$('#buscador').addEventListener('input', pintarUsuarios);

function abrirEditar(u) {
    $('#ed-id').value = u.id; $('#ed-usuario').value = u.usuario; $('#ed-email').value = u.email;
    $('#ed-pass').value = ''; $('#ed-error').textContent = '';
    $('#dlg-edit').showModal();
}
$('#ed-cancelar').addEventListener('click', () => $('#dlg-edit').close());
$('#form-edit').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await api('editar_usuario', { id: $('#ed-id').value, usuario: $('#ed-usuario').value, email: $('#ed-email').value, password: $('#ed-pass').value });
    if (r.success) { $('#dlg-edit').close(); avisar(r.mensaje); cargarUsuarios(); }
    else $('#ed-error').textContent = r.error || 'No se pudo guardar.';
});
async function eliminarUsuario(u) {
    if (!confirm('¿Eliminar a "' + u.usuario + '" y todas sus canciones y playlists? Esta acción no se puede deshacer.')) return;
    const r = await api('eliminar_usuario', { id: u.id });
    if (r.success) { avisar(r.mensaje); cargarUsuarios(); } else avisar(r.error || 'No se pudo eliminar.', 'err');
}

/* =====================================================================
   CANCIONES Y PLAYLISTS
   ===================================================================== */
const listaCanciones = (arr) => el('ul', { class: 'song-list' }, arr.map((c) => el('li', null, el('strong', { text: c.titulo }), c.artista ? ' — ' : '', el('span', { text: c.artista || '' }))));

async function cargarCanciones() {
    const r = await api('canciones'), cont = $('#lista-canciones'); vaciar(cont);
    if (!r.success) { if (r.error) avisar(r.error, 'err'); return; }
    if (!r.usuarios.length) cont.append(el('p', { class: 'empty-msg', text: 'Nadie ha guardado canciones todavía.' }));
    r.usuarios.forEach((u) => {
        const enPl = u.playlists.reduce((a, p) => a + p.canciones.length, 0);
        cont.append(el('details', { class: 'acc' },
            el('summary', null, el('span', { text: u.usuario }), el('span', { class: 'badge-song', text: plural(u.favoritas.length, 'favorita', 'favoritas') + ' · ' + plural(enPl, 'en playlists', 'en playlists') })),
            el('div', { class: 'acc-cuerpo' },
                u.favoritas.length && el('div', null, el('h4', { text: '♥ Favoritas' }), listaCanciones(u.favoritas)),
                ...u.playlists.map((p) => el('div', null, el('h4', { text: '🎶 ' + p.nombre }), p.canciones.length ? listaCanciones(p.canciones) : el('p', { class: 'empty-msg', text: 'Playlist vacía.' }))))));
    });
}
async function cargarPlaylists() {
    const r = await api('playlists'), cont = $('#lista-playlists'); vaciar(cont);
    if (!r.success) { if (r.error) avisar(r.error, 'err'); return; }
    if (!r.usuarios.length) cont.append(el('p', { class: 'empty-msg', text: 'Nadie ha creado playlists todavía.' }));
    r.usuarios.forEach((u) => cont.append(el('details', { class: 'acc', open: true },
        el('summary', null, el('span', { text: u.usuario }), el('span', { class: 'badge-song', text: plural(u.playlists.length, 'playlist', 'playlists') })),
        el('div', { class: 'acc-cuerpo' }, u.playlists.map((p) => el('details', { class: 'sub-acc' },
            el('summary', null, el('span', { text: p.nombre + ' · ' + plural(p.canciones.length, 'canción', 'canciones') }),
                el('button', { type: 'button', class: 'btn-action btn-delete btn-sm', text: 'Borrar', onclick: (ev) => { ev.preventDefault(); eliminarPlaylist(p); } })),
            p.canciones.length ? listaCanciones(p.canciones) : el('p', { class: 'empty-msg', text: 'Playlist vacía.' })))))));
}
async function eliminarPlaylist(p) {
    if (!confirm('¿Eliminar la playlist "' + p.nombre + '" y sus canciones?')) return;
    const r = await api('eliminar_playlist', { id: p.id });
    if (r.success) { avisar(r.mensaje); cargarPlaylists(); } else avisar(r.error || 'No se pudo eliminar.', 'err');
}

/* =====================================================================
   AJUSTES DEL SITIO + EDITOR DE GÉNEROS
   ===================================================================== */
let generos = [];
async function cargarAjustes() {
    const r = await api('ajustes_leer'); if (!r.success) { if (r.error) avisar(r.error, 'err'); return; }
    $('#f-fondo').value = r.fondo_portada || ''; $('#f-frase').value = r.frase_principal || '';
    generos = Array.isArray(r.lista_generos) ? r.lista_generos : []; pintarGeneros();
}
const campo = (rotulo, input) => el('label', null, rotulo, input);
function pintarGeneros() {
    const cont = $('#gen-list'); vaciar(cont);
    if (!generos.length) cont.append(el('p', { class: 'empty-msg', text: 'No hay géneros personalizados: la web usa los de siempre.' }));
    generos.forEach((g, i) => {
        g[4] = Array.isArray(g[4]) ? g[4] : []; g[5] = Array.isArray(g[5]) ? g[5] : [];
        const songs = el('div', { style: 'display:grid;gap:8px' });
        const pintarSongs = () => {
            vaciar(songs);
            g[5].forEach((c, k) => songs.append(el('div', { class: 'song-fila' },
                ...[['titulo', 'Título'], ['artista', 'Artista'], ['portada', 'URL portada'], ['preview', 'URL audio']].map(([campoN, ph]) =>
                    el('input', { type: 'text', placeholder: ph, 'aria-label': ph, value: c[campoN] || '', oninput: (e) => { c[campoN] = e.target.value; } })),
                el('button', { type: 'button', class: 'btn-action btn-delete btn-sm', text: '✕', 'aria-label': 'Quitar canción', onclick: () => { g[5].splice(k, 1); pintarSongs(); } }))));
        };
        pintarSongs();
        cont.append(el('div', { class: 'gen-card' },
            el('div', { class: 'gen-fila' },
                campo('Nombre', el('input', { type: 'text', maxlength: 40, value: g[0], oninput: (e) => { g[0] = e.target.value; } })),
                campo('Búsqueda en iTunes', el('input', { type: 'text', maxlength: 80, value: g[1], oninput: (e) => { g[1] = e.target.value; } })),
                campo('Color', el('input', { type: 'color', value: /^#[0-9a-fA-F]{6}$/.test(g[2]) ? g[2] : '#888888', oninput: (e) => { g[2] = e.target.value; } })),
                campo('Emoji', el('input', { type: 'text', maxlength: 8, value: g[3], oninput: (e) => { g[3] = e.target.value; } })),
                el('button', { type: 'button', class: 'btn-action btn-delete', text: 'Quitar género', onclick: () => { if (confirm('¿Quitar el género "' + g[0] + '"?')) { generos.splice(i, 1); pintarGeneros(); } } })),
            campo('Artistas (separados por comas)', el('input', { type: 'text', value: g[4].join(', '), oninput: (e) => { g[4] = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); } })),
            el('div', { class: 'gen-songs-t' }, 'Canciones propias (opcional)',
                el('button', { type: 'button', class: 'btn-action btn-edit btn-sm', text: '＋ Canción', onclick: () => { g[5].push({ id: 'manual_' + Date.now(), titulo: '', artista: '', portada: '', preview: '' }); pintarSongs(); } })),
            songs));
    });
}
$('#gen-add').addEventListener('click', () => { generos.push(['Nuevo género', 'music', '#8a5a1e', '🎵', ['Artista'], []]); pintarGeneros(); });
$('#form-ajustes').addEventListener('submit', async (e) => {
    e.preventDefault(); const b = $('#btn-guardar'); b.disabled = true; b.textContent = 'Guardando…';
    const r = await api('guardar_ajustes', { fondo_portada: $('#f-fondo').value, frase_principal: $('#f-frase').value, lista_generos: generos });
    b.disabled = false; b.textContent = 'Guardar ajustes';
    if (r.success) { avisar(r.mensaje); cargarAjustes(); } else avisar(r.error || 'No se pudieron guardar los ajustes.', 'err');
});

/* =====================================================================
   ARRANQUE: ¿ya hay sesión de administrador?
   ===================================================================== */
(async function () {
    const r = await api('verificar');
    if (r.success) mostrarPanel(r.usuario); else mostrarLogin();
})();