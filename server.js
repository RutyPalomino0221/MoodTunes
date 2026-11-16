'use strict';
require('dotenv').config();
/* =====================================================================
   MoodTunes — servidor Node.js (Express 5 + MySQL)
   Cuentas con contraseñas cifradas (bcrypt), sesión firmada en cookie,
   recuperación por código, límite de intentos y biblioteca personal.
   ===================================================================== */
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const correo = require('./apps-script-mailer');

/* ---------- Configuración (cámbiala con variables de entorno si quieres) ---------- */
const PORT = Number(process.env.PORT) || 3000;
const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mood_tunez',
    charset: 'utf8mb4',
    dateStrings: true,
    waitForConnections: true,
    connectionLimit: 10
};
const COOKIE = 'mt_session';
const DIA = 24 * 60 * 60 * 1000;
const MAX_INTENTOS = 5;          // intentos fallidos permitidos...
const VENTANA_SEG = 600;         // ...dentro de 10 minutos
const MAX_FAVS = 2000, MAX_PLAYLISTS = 100, MAX_CANCIONES_PL = 500;
const AVATARES = ['bronce', 'coral', 'mar', 'noche', 'rosa', 'oro'];
const RE_USUARIO = /^[\p{L}\p{N}._-]+$/u;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const pool = mysql.createPool(DB_CONFIG);

async function enviarCodigoCorreo(destino, codigo, tipo) {
    await correo.enviarCodigo(destino, codigo, tipo);
}

/* ---------- Secreto para firmar las sesiones (se crea solo la primera vez) ---------- */
function cargarSecreto() {
    if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
    const archivo = path.join(__dirname, '.session-secret');
    try { const s = fs.readFileSync(archivo, 'utf8').trim(); if (s.length >= 32) return s; } catch (e) { }
    const nuevo = crypto.randomBytes(48).toString('hex');
    try { fs.writeFileSync(archivo, nuevo, { mode: 0o600 }); }
    catch (e) { console.warn('No pude guardar .session-secret: las sesiones se cerrarán al reiniciar el servidor.'); }
    return nuevo;
}
const SECRETO = cargarSecreto();
const HASH_FALSO = bcrypt.hashSync('relleno-para-igualar-tiempos', 10);

/* ---------- Sesión: cookie firmada con HMAC, sin guardar nada en memoria ---------- */
const firma = (b) => crypto.createHmac('sha256', SECRETO).update(b).digest();
function firmar(obj) {
    const b = Buffer.from(JSON.stringify(obj)).toString('base64url');
    return b + '.' + firma(b).toString('base64url');
}
function verificarToken(t) {
    if (typeof t !== 'string') return null;
    const [b, s] = t.split('.');
    if (!b || !s) return null;
    const esperado = firma(b), dado = Buffer.from(s, 'base64url');
    if (dado.length !== esperado.length || !crypto.timingSafeEqual(dado, esperado)) return null;
    try {
        const p = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
        return p && p.uid && p.exp > Date.now() ? p : null;
    } catch (e) { return null; }
}
function leerCookies(req) {
    const salida = {};
    (req.headers.cookie || '').split(';').forEach((par) => {
        const i = par.indexOf('='); if (i < 0) return;
        try { salida[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim()); } catch (e) { }
    });
    return salida;
}
function abrirSesion(req, res, uid, recordar, version) {
    const dur = recordar ? 30 * DIA : DIA;
    res.cookie(COOKIE, firmar({ uid, exp: Date.now() + dur, v: version }), {
        httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/',
        ...(recordar ? { maxAge: dur } : {})       // sin maxAge = se cierra al cerrar el navegador
    });
}
function cerrarSesion(res) { res.clearCookie(COOKIE, { path: '/' }); }

/* ---------- Utilidades ---------- */
const err = (res, codigo, mensaje, extra) => res.status(codigo).json({ error: mensaje, ...(extra || {}) });
const texto = (v, max = 255) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const urlHttp = (u, max = 500) => { u = texto(u, max + 1); return u && u.length <= max && /^https?:\/\//i.test(u) ? u : ''; };
const ipCliente = (req) => String(req.ip || '0.0.0.0').replace(/^::ffff:/, '').slice(0, 45);
const msgEspera = (seg) => { const m = Math.ceil(seg / 60); return 'Demasiados intentos. Prueba de nuevo en ' + m + (m === 1 ? ' minuto.' : ' minutos.'); };
const perfil = (r) => ({ success: true, id: r.id, usuario: r.usuario, email: r.email, avatar: r.avatar || 'bronce', desde: r.created_at });

/* Compara la contraseña con lo guardado. Acepta bcrypt (también los hashes de PHP, $2y$)
   y cuentas viejas guardadas en texto plano, que se cifran en el primer ingreso. */
async function verificarClave(pass, guardado) {
    if (!guardado) { await bcrypt.compare(pass, HASH_FALSO); return { ok: false }; }
    if (/^\$2[aby]\$/.test(guardado)) return { ok: await bcrypt.compare(pass, guardado), reHash: false };
    const a = Buffer.from(pass), b = Buffer.from(guardado);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    return { ok, reHash: ok };
}

/* ---------- Límite de intentos (se guarda en MySQL, sobrevive a reinicios) ---------- */
async function bloqueado(clave, ip) {
    const [f] = await pool.execute(
        `SELECT COUNT(*) AS n, GREATEST(0, ${VENTANA_SEG} - TIMESTAMPDIFF(SECOND, MIN(creado), NOW())) AS espera
           FROM intentos_login WHERE ip = ? AND clave = ? AND creado > (NOW() - INTERVAL ${VENTANA_SEG} SECOND)`,
        [ip, clave.slice(0, 255)]);
    return Number(f[0].n) >= MAX_INTENTOS ? Math.max(1, Number(f[0].espera)) : 0;
}
async function registrarFallo(clave, ip) {
    await pool.execute('INSERT INTO intentos_login (ip, clave) VALUES (?, ?)', [ip, clave.slice(0, 255)]);
    if (Math.random() < 0.05) await pool.query('DELETE FROM intentos_login WHERE creado < (NOW() - INTERVAL 1 DAY)');
}
const limpiarFallos = (clave, ip) => pool.execute('DELETE FROM intentos_login WHERE ip = ? AND clave = ?', [ip, clave.slice(0, 255)]);

async function prepararTablas() {
    await pool.query('SELECT 1');
    await pool.query(`CREATE TABLE IF NOT EXISTS intentos_login (
        id INT AUTO_INCREMENT PRIMARY KEY, ip VARCHAR(45) NOT NULL, clave VARCHAR(255) NOT NULL,
        creado TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_ip_clave (ip, clave)
    ) CHARACTER SET utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS recuperaciones (
        id INT AUTO_INCREMENT PRIMARY KEY, usuario_id INT NOT NULL, codigo_hash VARCHAR(255) NOT NULL,
        intentos TINYINT NOT NULL DEFAULT 0, expira DATETIME NOT NULL, usado TINYINT(1) NOT NULL DEFAULT 0,
        creado TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_usuario (usuario_id)
    ) CHARACTER SET utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ajustes_sitio (
        clave VARCHAR(100) PRIMARY KEY, valor TEXT
    ) CHARACTER SET utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS administradores (
        id INT AUTO_INCREMENT PRIMARY KEY, usuario VARCHAR(30) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        email VARCHAR(120) NULL,
        recovery_hash VARCHAR(255) NULL,
        recovery_expires DATETIME NULL,
        recovery_attempts TINYINT NOT NULL DEFAULT 0,
        session_version INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4`);
    const [userColumns] = await pool.query("SHOW COLUMNS FROM usuarios LIKE 'session_version'");
    if (!userColumns.length) await pool.query('ALTER TABLE usuarios ADD COLUMN session_version INT NOT NULL DEFAULT 0');
    const adminColumns = [
        ['email', 'ALTER TABLE administradores ADD COLUMN email VARCHAR(120) NULL'],
        ['recovery_hash', 'ALTER TABLE administradores ADD COLUMN recovery_hash VARCHAR(255) NULL'],
        ['recovery_expires', 'ALTER TABLE administradores ADD COLUMN recovery_expires DATETIME NULL'],
        ['recovery_attempts', 'ALTER TABLE administradores ADD COLUMN recovery_attempts TINYINT NOT NULL DEFAULT 0'],
        ['session_version', 'ALTER TABLE administradores ADD COLUMN session_version INT NOT NULL DEFAULT 0']
    ];
    for (const [columna, sql] of adminColumns) {
        const [existente] = await pool.query('SHOW COLUMNS FROM administradores LIKE ?', [columna]);
        if (!existente.length) await pool.query(sql);
    }
    await pool.query("UPDATE usuarios SET rol = 'user' WHERE rol = 'admin'");
}

/* =====================================================================
   APP
   ===================================================================== */
const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'same-origin' });
    next();
});

/* Solo se publican la página y sus carpetas: NUNCA server.js, package.json ni .session-secret */
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/img', express.static(path.join(__dirname, 'img')));
const pagina = (req, res) => res.sendFile(path.join(__dirname, 'index.html'));
app.get('/', pagina);
app.get('/index.html', pagina);

/* ---------- Protección de la API ---------- */
app.use('/api', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'POST') return err(res, 405, 'Método no permitido.');
    const origen = req.headers.origin;                       // frena peticiones desde otros sitios (CSRF)
    if (origen) {
        let host = ''; try { host = new URL(origen).host; } catch (e) { }
        if (host !== req.headers.host) return err(res, 403, 'Origen no permitido.');
    }
    if (!req.is('application/json')) return err(res, 415, 'Petición no válida.');
    const t = verificarToken(leerCookies(req)[COOKIE]);
    const uid = t && !t.t ? Number(t.uid) : 0;      // los tokens de admin (t:'a') no valen como sesión de usuario
    req.uid = Number.isSafeInteger(uid) && uid > 0 ? uid : 0;
    if (req.uid) {
        const [f] = await pool.execute('SELECT session_version FROM usuarios WHERE id = ? LIMIT 1', [req.uid]);
        if (!f[0] || Number(t.v) !== Number(f[0].session_version)) {
            req.uid = 0;
            cerrarSesion(res);
        }
    }
    next();
});
app.use('/api', express.json({ limit: '100kb' }));

/* =====================================================================
   /api/auth — cuentas
   ===================================================================== */
const auth = {};

auth.login = async (req, res, d) => {
    const user = texto(d.usuario), pass = typeof d.password === 'string' ? d.password : '';
    if (!user || !pass) return err(res, 400, 'Completa todos los campos.');
    const clave = 'login:' + user.toLowerCase(), ip = ipCliente(req);
    const espera = await bloqueado(clave, ip);
    if (espera) return err(res, 429, msgEspera(espera));

    const [f] = await pool.execute('SELECT id, usuario, email, password, avatar, created_at, session_version FROM usuarios WHERE usuario = ? OR email = ? LIMIT 1', [user, user]);
    const row = f[0], v = await verificarClave(pass, row && row.password);
    if (!row || !v.ok) { await registrarFallo(clave, ip); return err(res, 401, 'Usuario o contraseña incorrectos.'); }
    await limpiarFallos(clave, ip);
    if (v.reHash) await pool.execute('UPDATE usuarios SET password = ? WHERE id = ?', [await bcrypt.hash(pass, 10), row.id]);

    abrirSesion(req, res, row.id, !!d.recordar, row.session_version);
    res.json(perfil(row));
};

auth.sesion = async (req, res) => {
    if (!req.uid) return res.json({ sin_sesion: true, error: 'Sin sesión.' });
    const [f] = await pool.execute('SELECT id, usuario, email, avatar, created_at FROM usuarios WHERE id = ? LIMIT 1', [req.uid]);
    if (!f[0]) { cerrarSesion(res); return res.json({ sin_sesion: true, error: 'Sin sesión.' }); }
    res.json(perfil(f[0]));
};

auth.logout = async (req, res) => { cerrarSesion(res); res.json({ success: true }); };

auth.registro = async (req, res, d) => {
    const user = texto(d.usuario), email = texto(d.email, 120), pass = typeof d.password === 'string' ? d.password : '';
    if (user.length < 3 || user.length > 30) return err(res, 400, 'El usuario debe tener entre 3 y 30 caracteres.');
    if (!RE_USUARIO.test(user)) return err(res, 400, 'El usuario solo puede tener letras, números, punto, guion y guion bajo.');
    if (!RE_EMAIL.test(email)) return err(res, 400, 'Escribe un correo válido.');
    if (pass.length < 6) return err(res, 400, 'La contraseña debe tener al menos 6 caracteres.');
    if (Buffer.byteLength(pass) > 72) return err(res, 400, 'La contraseña no puede pasar de 72 caracteres.');

    const [adminMatch] = await pool.execute('SELECT id FROM administradores WHERE usuario = ? OR usuario = ? LIMIT 1', [user, email]);
    if (adminMatch[0]) return err(res, 409, 'Ese nombre está reservado para una cuenta administrativa.');
    const [dup] = await pool.execute('SELECT usuario, email FROM usuarios WHERE usuario = ? OR email = ? LIMIT 1', [user, email]);
    if (dup[0]) return err(res, 409, dup[0].usuario.toLowerCase() === user.toLowerCase() ? 'Ese nombre de usuario ya está en uso.' : 'Ese correo ya tiene una cuenta.');
    try {
        await pool.execute('INSERT INTO usuarios (usuario, email, password) VALUES (?, ?, ?)', [user, email, await bcrypt.hash(pass, 10)]);
    } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') return err(res, 409, 'Ese usuario o correo ya está registrado.');
        throw e;
    }
    res.json({ success: true, mensaje: 'Cuenta creada con éxito.' });
};

/* Recuperar: genera un código de 6 dígitos que vence en 15 minutos */
auth.recuperar = async (req, res, d) => {
    const user = texto(d.usuario);
    if (!user) return err(res, 400, 'Escribe tu usuario o correo.');
    if (!correo.disponible) return err(res, 503, 'El correo saliente no está configurado. Despliega Google Apps Script y configura sus valores en .env.');
    const clave = 'rec:' + user.toLowerCase(), ip = ipCliente(req);
    const espera = await bloqueado(clave, ip);
    if (espera) return err(res, 429, msgEspera(espera));
    await registrarFallo(clave, ip);                       // cada solicitud cuenta: evita spam de códigos

    // La respuesta es igual exista o no la cuenta, para no revelar qué usuarios están registrados
    const resp = { success: true, mensaje: 'Si la cuenta existe, te enviamos un código de 6 dígitos. Vence en 15 minutos.' };
    const [f] = await pool.execute('SELECT id, usuario, email FROM usuarios WHERE usuario = ? OR email = ? LIMIT 1', [user, user]);
    if (f[0]) {
        const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        await pool.execute('UPDATE recuperaciones SET usado = 1 WHERE usuario_id = ? AND usado = 0', [f[0].id]);
        const [creada] = await pool.execute('INSERT INTO recuperaciones (usuario_id, codigo_hash, expira) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))', [f[0].id, await bcrypt.hash(codigo, 10)]);
        try {
            await enviarCodigoCorreo(f[0].email, codigo, 'cliente');
        } catch (e) {
            await pool.execute('UPDATE recuperaciones SET usado = 1 WHERE id = ?', [creada.insertId]);
            console.error('[MoodTunes] No se pudo enviar correo de recuperación (' + (e.code || e.message) + ').');
            return err(res, 503, 'No se pudo enviar el correo. Revisa la configuración Gmail e inténtalo más tarde.');
        }
    }
    res.json(resp);
};

auth.reset = async (req, res, d) => {
    const user = texto(d.usuario), codigo = texto(d.codigo, 10), pass = typeof d.password === 'string' ? d.password : '';
    if (!user || !/^\d{6}$/.test(codigo)) return err(res, 400, 'El código debe tener 6 dígitos.');
    if (pass.length < 6) return err(res, 400, 'La contraseña debe tener al menos 6 caracteres.');
    if (Buffer.byteLength(pass) > 72) return err(res, 400, 'La contraseña no puede pasar de 72 caracteres.');
    const clave = 'reset:' + user.toLowerCase(), ip = ipCliente(req);
    const espera = await bloqueado(clave, ip);
    if (espera) return err(res, 429, msgEspera(espera));

    const [u] = await pool.execute('SELECT id FROM usuarios WHERE usuario = ? OR email = ? LIMIT 1', [user, user]);
    let rec = null;
    if (u[0]) {
        const [r] = await pool.execute('SELECT id, codigo_hash, intentos FROM recuperaciones WHERE usuario_id = ? AND usado = 0 AND expira > NOW() ORDER BY id DESC LIMIT 1', [u[0].id]);
        rec = r[0] || null;
    }
    if (!rec) { await registrarFallo(clave, ip); return err(res, 400, 'El código es incorrecto o ya venció.'); }
    if (rec.intentos >= 5) { await pool.execute('UPDATE recuperaciones SET usado = 1 WHERE id = ?', [rec.id]); return err(res, 400, 'Ese código ya no sirve. Pide uno nuevo.'); }
    if (!(await bcrypt.compare(codigo, rec.codigo_hash))) {
        await pool.execute('UPDATE recuperaciones SET intentos = intentos + 1 WHERE id = ?', [rec.id]);
        await registrarFallo(clave, ip);
        return err(res, 400, 'El código es incorrecto o ya venció.');
    }
    await pool.execute('UPDATE usuarios SET password = ?, session_version = session_version + 1 WHERE id = ?', [await bcrypt.hash(pass, 10), u[0].id]);
    await pool.execute('UPDATE recuperaciones SET usado = 1 WHERE usuario_id = ?', [u[0].id]);
    await limpiarFallos(clave, ip);
    res.json({ success: true, mensaje: 'Contraseña actualizada.' });
};

auth.actualizar = async (req, res, d) => {
    if (!req.uid) return err(res, 401, 'Inicia sesión para continuar.', { sin_sesion: true });
    const user = texto(d.usuario), email = texto(d.email, 120), pass = typeof d.password === 'string' ? d.password : '';
    const avatar = AVATARES.includes(d.avatar) ? d.avatar : 'bronce';
    if (user.length < 3 || user.length > 30) return err(res, 400, 'El usuario debe tener entre 3 y 30 caracteres.');
    if (!RE_USUARIO.test(user)) return err(res, 400, 'El usuario solo puede tener letras, números, punto, guion y guion bajo.');
    if (!RE_EMAIL.test(email)) return err(res, 400, 'Escribe un correo válido.');

    const clave = 'upd:' + req.uid, ip = ipCliente(req);
    const espera = await bloqueado(clave, ip);
    if (espera) return err(res, 429, msgEspera(espera));

    const [f] = await pool.execute('SELECT password FROM usuarios WHERE id = ?', [req.uid]);
    const v = await verificarClave(pass, f[0] && f[0].password);
    if (!f[0] || !v.ok) { await registrarFallo(clave, ip); return err(res, 401, 'La contraseña actual es incorrecta.'); }
    await limpiarFallos(clave, ip);

    const [dup] = await pool.execute('SELECT id FROM usuarios WHERE (usuario = ? OR email = ?) AND id <> ? LIMIT 1', [user, email, req.uid]);
    if (dup[0]) return err(res, 409, 'Ese usuario o correo ya está en uso.');
    await pool.execute('UPDATE usuarios SET usuario = ?, email = ?, avatar = ? WHERE id = ?', [user, email, avatar, req.uid]);
    res.json({ success: true, usuario: user, email, avatar });
};

/* Ajustes públicos del sitio (frase, fondo, géneros): solo estas claves */
auth.ajustes = async (req, res) => {
    const permitidas = ['frase_principal', 'fondo_portada', 'lista_generos'], salida = {};
    try {
        const [f] = await pool.query('SELECT clave, valor FROM ajustes_sitio');
        f.forEach((r) => { if (permitidas.includes(r.clave)) salida[r.clave] = r.valor; });
    } catch (e) { }
    res.json(salida);
};

app.post('/api/auth', async (req, res) => {
    const d = req.body || {}, fn = Object.prototype.hasOwnProperty.call(auth, d.accion) ? auth[d.accion] : null;
    if (!fn) return err(res, 400, 'Acción no válida.');
    await fn(req, res, d);
});

/* =====================================================================
   /api/musica — favoritos y playlists PERSONALES
   El dueño sale SIEMPRE de la cookie de sesión, nunca de lo que mande el navegador.
   ===================================================================== */
const musica = {};

function leerCancion(c) {
    if (!c || typeof c !== 'object') return null;
    const id = texto(String(c.id == null ? '' : c.id), 101), titulo = texto(c.titulo);
    if (!id || id.length > 100 || !titulo) return null;
    return { id, titulo, artista: texto(c.artista), portada: urlHttp(c.portada), preview: urlHttp(c.preview) };
}
const contar = async (sql, params) => Number((await pool.execute(sql, params))[0][0].n);
const esMia = async (pl, uid) => (await pool.execute('SELECT id FROM playlists WHERE id = ? AND usuario_id = ? LIMIT 1', [pl, uid]))[0].length > 0;

musica.toggle_fav = async (req, res, d) => {
    const c = leerCancion(d.cancion), uid = req.uid;
    if (!c) return err(res, 400, 'Canción no válida.');
    const [ya] = await pool.execute('SELECT id FROM canciones_guardadas WHERE usuario_id = ? AND cancion_id = ? AND playlist_id IS NULL LIMIT 1', [uid, c.id]);
    if (ya[0]) {
        await pool.execute('DELETE FROM canciones_guardadas WHERE usuario_id = ? AND cancion_id = ? AND playlist_id IS NULL', [uid, c.id]);
        return res.json({ success: true, estado: 'eliminado' });
    }
    if (await contar('SELECT COUNT(*) AS n FROM canciones_guardadas WHERE usuario_id = ? AND playlist_id IS NULL', [uid]) >= MAX_FAVS) return err(res, 400, 'Llegaste al máximo de favoritas.');
    await pool.execute('INSERT INTO canciones_guardadas (usuario_id, cancion_id, titulo, artista, portada, preview) VALUES (?, ?, ?, ?, ?, ?)', [uid, c.id, c.titulo, c.artista, c.portada, c.preview]);
    res.json({ success: true, estado: 'guardado' });
};

musica.cargar_favs = async (req, res) => {
    const [f] = await pool.execute('SELECT cancion_id AS id, titulo, artista, portada, preview FROM canciones_guardadas WHERE usuario_id = ? AND playlist_id IS NULL ORDER BY id DESC', [req.uid]);
    res.json(f);
};

musica.crear_playlist = async (req, res, d) => {
    const nombre = texto(d.nombre, 40) || 'Nueva playlist';
    if (await contar('SELECT COUNT(*) AS n FROM playlists WHERE usuario_id = ?', [req.uid]) >= MAX_PLAYLISTS) return err(res, 400, 'Llegaste al máximo de playlists.');
    const [r] = await pool.execute('INSERT INTO playlists (usuario_id, nombre) VALUES (?, ?)', [req.uid, nombre]);
    res.json({ success: true, id: r.insertId });
};

musica.add_a_playlist = async (req, res, d) => {
    const pl = parseInt(d.playlist_id, 10) || 0, c = leerCancion(d.cancion), uid = req.uid;
    if (!c) return err(res, 400, 'Canción no válida.');
    if (!(await esMia(pl, uid))) return err(res, 404, 'Esa playlist no existe.', { success: false });
    const [dup] = await pool.execute('SELECT id FROM canciones_guardadas WHERE usuario_id = ? AND playlist_id = ? AND cancion_id = ? LIMIT 1', [uid, pl, c.id]);
    if (dup[0]) return res.json({ success: false, error: 'Esa canción ya está en la playlist.' });
    if (await contar('SELECT COUNT(*) AS n FROM canciones_guardadas WHERE usuario_id = ? AND playlist_id = ?', [uid, pl]) >= MAX_CANCIONES_PL) return err(res, 400, 'Esa playlist está llena.', { success: false });
    await pool.execute('INSERT INTO canciones_guardadas (usuario_id, playlist_id, cancion_id, titulo, artista, portada, preview) VALUES (?, ?, ?, ?, ?, ?, ?)', [uid, pl, c.id, c.titulo, c.artista, c.portada, c.preview]);
    res.json({ success: true });
};

musica.cargar_lib = async (req, res) => {
    const [f] = await pool.execute(
        `SELECT p.id, p.nombre, c.cancion_id, c.titulo, c.artista, c.portada, c.preview
           FROM playlists p LEFT JOIN canciones_guardadas c ON c.playlist_id = p.id AND c.usuario_id = p.usuario_id
          WHERE p.usuario_id = ? ORDER BY p.id DESC, c.id DESC`, [req.uid]);
    const lista = new Map();
    f.forEach((r) => {
        if (!lista.has(r.id)) lista.set(r.id, { id: r.id, nombre: r.nombre, canciones: [] });
        if (r.cancion_id !== null) lista.get(r.id).canciones.push({ id: r.cancion_id, titulo: r.titulo, artista: r.artista, portada: r.portada, preview: r.preview });
    });
    res.json([...lista.values()]);
};

musica.eliminar_playlist = async (req, res, d) => {
    const pl = parseInt(d.playlist_id, 10) || 0, uid = req.uid;
    if (!(await esMia(pl, uid))) return err(res, 404, 'Esa playlist no existe.', { success: false });
    const cx = await pool.getConnection();
    try {
        await cx.beginTransaction();
        await cx.execute('DELETE FROM canciones_guardadas WHERE playlist_id = ? AND usuario_id = ?', [pl, uid]);
        await cx.execute('DELETE FROM playlists WHERE id = ? AND usuario_id = ?', [pl, uid]);
        await cx.commit();
    } catch (e) { await cx.rollback(); throw e; } finally { cx.release(); }
    res.json({ success: true });
};

app.post('/api/musica', async (req, res) => {
    if (!req.uid) return err(res, 401, 'Inicia sesión para continuar.', { sin_sesion: true });
    const d = req.body || {}, fn = Object.prototype.hasOwnProperty.call(musica, d.accion) ? musica[d.accion] : null;
    if (!fn) return err(res, 400, 'Acción no válida.');
    await fn(req, res, d);
});

/* =====================================================================
   PANEL DE ADMINISTRACIÓN  ->  http://localhost:3000/admin
   Página: admin.html + css/admin.css + js/admin.js
   Acceso: cuentas independientes en administradores, cookie propia (mt_admin), 8 horas.
   ===================================================================== */
const COOKIE_ADMIN = 'mt_admin';
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const adminPagina = (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    res.sendFile(path.join(__dirname, 'admin.html'));
};
app.get('/admin', adminPagina);
app.get('/admin.html', adminPagina);

/* Devuelve al admin de la cookie (y comprueba en MySQL que SIGUE siendo admin) */
async function adminActual(req) {
    const t = verificarToken(leerCookies(req)[COOKIE_ADMIN]);
    if (!t || t.t !== 'a') return null;
    const [f] = await pool.execute('SELECT id, usuario, session_version FROM administradores WHERE id = ? LIMIT 1', [t.uid]);
    return f[0] && Number(t.v) === Number(f[0].session_version) ? f[0] : null;
}

/* Limpia la lista de géneros que llega del editor: estructura y tipos conocidos, nada más */
function limpiarGeneros(entrada) {
    let a = entrada;
    if (typeof a === 'string') { try { a = JSON.parse(a); } catch (e) { return []; } }
    if (!Array.isArray(a)) return [];
    return a.slice(0, 30).filter((g) => Array.isArray(g) && g.length >= 5).map((g) => {
        const color = typeof g[2] === 'string' && /^#[0-9a-fA-F]{6}$/.test(g[2]) ? g[2] : '#888888';
        let artistas = (Array.isArray(g[4]) ? g[4] : []).slice(0, 10).map((x) => texto(String(x), 60)).filter(Boolean);
        if (!artistas.length) artistas = ['Artista'];
        const canciones = (Array.isArray(g[5]) ? g[5] : []).slice(0, 50).filter((c) => c && texto(c.titulo)).map((c, i) => ({
            id: texto(String(c.id == null ? 'manual_' + i : c.id), 60).replace(/[^\w.:-]/g, '') || 'manual_' + i,
            titulo: texto(c.titulo), artista: texto(c.artista), portada: urlHttp(c.portada), preview: urlHttp(c.preview)
        }));
        return [texto(g[0], 40) || 'Género', texto(g[1], 80) || 'music', color, texto(g[3], 8) || '🎵', artistas, canciones];
    });
}

const admin = {};

admin.login = async (req, res, d) => {
    const user = texto(d.usuario), pass = typeof d.password === 'string' ? d.password : '';
    if (!user || !pass) return err(res, 400, 'Completa todos los campos.');
    const clave = 'admin:' + user.toLowerCase(), ip = ipCliente(req);
    const espera = await bloqueado(clave, ip);
    if (espera) return err(res, 429, msgEspera(espera));

    const [f] = await pool.execute('SELECT id, usuario, password, session_version FROM administradores WHERE usuario = ? LIMIT 1', [user]);
    const row = f[0], v = await verificarClave(pass, row && row.password);
    if (!row || !v.ok) {
        await registrarFallo(clave, ip);
        return err(res, 401, 'Usuario o contraseña de administrador incorrectos.');
    }
    await limpiarFallos(clave, ip);
    if (v.reHash) await pool.execute('UPDATE administradores SET password = ? WHERE id = ?', [await bcrypt.hash(pass, 12), row.id]);
    res.cookie(COOKIE_ADMIN, firmar({ uid: row.id, exp: Date.now() + 8 * 3600 * 1000, t: 'a', v: row.session_version }), {
        httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/'
    });
    res.json({ success: true, usuario: row.usuario });
};

admin.solicitar_recuperacion = async (req, res, d) => {
    const user = texto(d.usuario, 30);
    if (!user) return err(res, 400, 'Escribe tu usuario propietario.');
    if (!correo.disponible) return err(res, 503, 'El correo saliente no está configurado. Despliega Google Apps Script y configura sus valores en .env.');

    const clave = 'admin-recovery-request:' + user.toLowerCase(), ip = ipCliente(req);
    const espera = await bloqueado(clave, ip);
    if (espera) return err(res, 429, msgEspera(espera));
    await registrarFallo(clave, ip);

    const [f] = await pool.execute('SELECT id, email FROM administradores WHERE usuario = ? LIMIT 1', [user]);
    if (f[0] && f[0].email) {
        const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        const hash = await bcrypt.hash(codigo, 10);
        await pool.execute(
            'UPDATE administradores SET recovery_hash = ?, recovery_expires = DATE_ADD(NOW(), INTERVAL 15 MINUTE), recovery_attempts = 0 WHERE id = ?',
            [hash, f[0].id]);
        try {
            await enviarCodigoCorreo(f[0].email, codigo, 'admin');
        } catch (e) {
            await pool.execute(
                'UPDATE administradores SET recovery_hash = NULL, recovery_expires = NULL WHERE id = ? AND recovery_hash = ?',
                [f[0].id, hash]);
            console.error('[MoodTunes] No se pudo enviar correo de recuperación administrativa (' + (e.code || e.message) + ').');
            return err(res, 503, 'No se pudo enviar el correo. Revisa la configuración Gmail e inténtalo más tarde.');
        }
    }
    res.json({ success: true, mensaje: 'Si la cuenta y el correo están configurados, enviaremos un código de 6 dígitos. Vence en 15 minutos.' });
};

admin.recuperar = async (req, res, d) => {
    const user = texto(d.usuario, 30), codigo = typeof d.codigo === 'string' ? d.codigo.trim() : '';
    const pass = typeof d.password === 'string' ? d.password : '';
    if (!user || !codigo || !pass) return err(res, 400, 'Completa todos los campos.');
    if (!/^\d{6}$/.test(codigo)) return err(res, 400, 'El código debe tener 6 dígitos.');
    if (Buffer.byteLength(pass) < 14 || Buffer.byteLength(pass) > 72) {
        return err(res, 400, 'La contraseña debe tener entre 14 y 72 bytes.');
    }

    const clave = 'admin-recovery:' + user.toLowerCase(), ip = ipCliente(req);
    const espera = await bloqueado(clave, ip);
    if (espera) return err(res, 429, msgEspera(espera));

    const [f] = await pool.execute('SELECT id, recovery_hash, recovery_expires, recovery_attempts, (recovery_expires > NOW()) AS recovery_valid FROM administradores WHERE usuario = ? LIMIT 1', [user]);
    const row = f[0], valido = row && row.recovery_hash
        ? await bcrypt.compare(codigo, row.recovery_hash)
        : await bcrypt.compare(codigo, HASH_FALSO);
    if (!row || !row.recovery_hash || !Number(row.recovery_valid) || row.recovery_attempts >= 5 || !valido) {
        if (row && row.recovery_hash && row.recovery_attempts < 5) {
            await pool.execute(
                'UPDATE administradores SET recovery_attempts = recovery_attempts + 1 WHERE id = ? AND recovery_hash = ?',
                [row.id, row.recovery_hash]);
            if (row.recovery_attempts + 1 >= 5) {
                await pool.execute(
                    'UPDATE administradores SET recovery_hash = NULL, recovery_expires = NULL WHERE id = ? AND recovery_hash = ?',
                    [row.id, row.recovery_hash]);
            }
        }
        await registrarFallo(clave, ip);
        return err(res, 400, 'No se pudo recuperar la cuenta. Revisa el usuario y el código.');
    }

    const hash = await bcrypt.hash(pass, 12);
    const [actualizado] = await pool.execute(
        'UPDATE administradores SET password = ?, recovery_hash = NULL, recovery_expires = NULL, recovery_attempts = 0, session_version = session_version + 1 WHERE id = ? AND recovery_hash = ? AND recovery_expires > NOW() AND recovery_attempts < 5',
        [hash, row.id, row.recovery_hash]);
    if (!actualizado.affectedRows) {
        await registrarFallo(clave, ip);
        return err(res, 400, 'No se pudo recuperar la cuenta. Revisa el usuario y el código.');
    }
    await limpiarFallos(clave, ip);
    res.json({ success: true, mensaje: 'Contraseña restablecida. El código de recuperación ya fue utilizado.' });
};

admin.verificar = async (req, res) => {
    const a = await adminActual(req);
    res.json(a ? { success: true, usuario: a.usuario, id: a.id } : { success: false });
};

admin.logout = async (req, res) => { res.clearCookie(COOKIE_ADMIN, { path: '/' }); res.json({ success: true }); };

admin.stats = async (req, res) => {
    const n = async (sql) => Number((await pool.query(sql))[0][0].n);
    const [usuarios, nuevos, canciones, playlists] = await Promise.all([
        n('SELECT COUNT(*) AS n FROM usuarios'),
        n('SELECT COUNT(*) AS n FROM usuarios WHERE created_at >= (NOW() - INTERVAL 7 DAY)'),
        n('SELECT COUNT(*) AS n FROM canciones_guardadas'),
        n('SELECT COUNT(*) AS n FROM playlists')
    ]);
    const [ultimos] = await pool.query('SELECT usuario, email, created_at FROM usuarios ORDER BY id DESC LIMIT 5');
    const [graf] = await pool.query('SELECT DATE(created_at) AS dia, COUNT(*) AS total FROM usuarios GROUP BY DATE(created_at) ORDER BY dia DESC LIMIT 7');
    res.json({
        success: true, stats: { usuarios, nuevos, canciones, playlists }, ultimos,
        grafico: graf.reverse().map((r) => ({ dia: String(r.dia).slice(0, 10), total: Number(r.total) }))
    });
};

admin.usuarios = async (req, res) => {
    const [f] = await pool.query(`SELECT u.id, u.usuario, u.email, 'user' AS rol, u.created_at,
        (SELECT COUNT(*) FROM canciones_guardadas c WHERE c.usuario_id = u.id) AS canciones,
        (SELECT COUNT(*) FROM playlists p WHERE p.usuario_id = u.id) AS playlists
        FROM usuarios u ORDER BY u.id DESC`);
    res.json({ success: true, usuarios: f });
};

admin.editar_usuario = async (req, res, d) => {
    const id = parseInt(d.id, 10) || 0, user = texto(d.usuario, 40), email = texto(d.email, 120);
    const nueva = typeof d.password === 'string' ? d.password : '';
    if (user.length < 3 || user.length > 30 || !RE_USUARIO.test(user)) return err(res, 400, 'Usuario no válido (3-30 caracteres: letras, números, . _ -).');
    if (!RE_EMAIL.test(email)) return err(res, 400, 'Correo no válido.');
    if (nueva && (nueva.length < 6 || Buffer.byteLength(nueva) > 72)) return err(res, 400, 'La nueva contraseña debe tener entre 6 y 72 caracteres.');
    const [dup] = await pool.execute('SELECT id FROM usuarios WHERE (usuario = ? OR email = ?) AND id <> ? LIMIT 1', [user, email, id]);
    if (dup[0]) return err(res, 409, 'Ese usuario o correo ya está en uso.');
    const [r] = await pool.execute('UPDATE usuarios SET usuario = ?, email = ? WHERE id = ?', [user, email, id]);
    if (!r.affectedRows) return err(res, 404, 'Ese usuario no existe.');
    if (nueva) await pool.execute('UPDATE usuarios SET password = ? WHERE id = ?', [await bcrypt.hash(nueva, 10), id]);
    res.json({ success: true, mensaje: 'Usuario actualizado correctamente.' });
};

admin.eliminar_usuario = async (req, res, d) => {
    const id = parseInt(d.id, 10) || 0;
    const cx = await pool.getConnection();
    try {
        await cx.beginTransaction();
        await cx.execute('DELETE FROM canciones_guardadas WHERE usuario_id = ?', [id]);
        await cx.execute('DELETE FROM playlists WHERE usuario_id = ?', [id]);
        await cx.execute('DELETE FROM recuperaciones WHERE usuario_id = ?', [id]);
        await cx.execute('DELETE FROM usuarios WHERE id = ?', [id]);
        await cx.commit();
    } catch (e) { await cx.rollback(); throw e; } finally { cx.release(); }
    res.json({ success: true, mensaje: 'Usuario eliminado junto con sus canciones y playlists.' });
};

/* Canciones y playlists agrupadas por usuario (pocas consultas en total) */
async function bibliotecas() {
    const [favs] = await pool.query('SELECT usuario_id, titulo, artista FROM canciones_guardadas WHERE playlist_id IS NULL ORDER BY id DESC');
    const [songs] = await pool.query('SELECT playlist_id, titulo, artista FROM canciones_guardadas WHERE playlist_id IS NOT NULL ORDER BY id ASC');
    const [pls] = await pool.query('SELECT id, usuario_id, nombre FROM playlists ORDER BY id DESC');
    const [users] = await pool.query('SELECT id, usuario FROM usuarios ORDER BY usuario ASC');
    const porPl = {}; songs.forEach((c) => { (porPl[c.playlist_id] = porPl[c.playlist_id] || []).push({ titulo: c.titulo, artista: c.artista }); });
    const porUser = {}; pls.forEach((p) => { (porUser[p.usuario_id] = porUser[p.usuario_id] || []).push({ id: p.id, nombre: p.nombre, canciones: porPl[p.id] || [] }); });
    const favsUser = {}; favs.forEach((c) => { (favsUser[c.usuario_id] = favsUser[c.usuario_id] || []).push({ titulo: c.titulo, artista: c.artista }); });
    return users.map((u) => ({ usuario: u.usuario, favoritas: favsUser[u.id] || [], playlists: porUser[u.id] || [] }))
        .filter((u) => u.favoritas.length || u.playlists.length);
}
admin.canciones = async (req, res) => res.json({ success: true, usuarios: await bibliotecas() });
admin.playlists = async (req, res) => res.json({ success: true, usuarios: (await bibliotecas()).filter((u) => u.playlists.length) });

admin.eliminar_playlist = async (req, res, d) => {
    const id = parseInt(d.id, 10) || 0, cx = await pool.getConnection();
    try {
        await cx.beginTransaction();
        await cx.execute('DELETE FROM canciones_guardadas WHERE playlist_id = ?', [id]);
        await cx.execute('DELETE FROM playlists WHERE id = ?', [id]);
        await cx.commit();
    } catch (e) { await cx.rollback(); throw e; } finally { cx.release(); }
    res.json({ success: true, mensaje: 'Playlist eliminada correctamente.' });
};

admin.ajustes_leer = async (req, res) => {
    const salida = { fondo_portada: '', frase_principal: '', lista_generos: [] };
    const [f] = await pool.query('SELECT clave, valor FROM ajustes_sitio');
    f.forEach((r) => {
        if (r.clave === 'lista_generos') { try { salida.lista_generos = limpiarGeneros(r.valor); } catch (e) { } }
        else if (r.clave in salida) salida[r.clave] = r.valor || '';
    });
    res.json({ success: true, ...salida });
};

admin.guardar_ajustes = async (req, res, d) => {
    const fondoCrudo = texto(d.fondo_portada, 1000), fondo = fondoCrudo ? urlHttp(fondoCrudo, 1000) : '';
    if (fondoCrudo && !fondo) return err(res, 400, 'El enlace del fondo debe empezar por http:// o https://');
    const frase = texto(d.frase_principal, 200), generos = JSON.stringify(limpiarGeneros(d.lista_generos));
    for (const [k, v] of [['fondo_portada', fondo], ['frase_principal', frase], ['lista_generos', generos]]) {
        await pool.execute('REPLACE INTO ajustes_sitio (clave, valor) VALUES (?, ?)', [k, v]);
    }
    res.json({ success: true, mensaje: '¡Ajustes guardados correctamente!' });
};

app.post('/api/admin', async (req, res) => {
    const d = req.body || {}, fn = hasOwn(admin, d.accion) ? admin[d.accion] : null;
    if (!fn) return err(res, 400, 'Acción no válida.');
    if (!['login', 'verificar', 'logout', 'solicitar_recuperacion', 'recuperar'].includes(d.accion)) {
        req.admin = await adminActual(req);
        if (!req.admin) return err(res, 401, 'Tu sesión de administrador venció.', { sin_sesion: true });
    }
    await fn(req, res, d);
});

/* ---------- Errores ---------- */
app.use((req, res) => res.status(404).type('text').send('No encontrado'));
app.use((e, req, res, next) => {
    if (e.type === 'entity.parse.failed') return err(res, 400, 'Petición no válida.');
    if (e.type === 'entity.too.large') return err(res, 413, 'Petición demasiado grande.');
    console.error(e);
    if (res.headersSent) return next(e);
    err(res, 500, 'Error interno del servidor.');
});

/* ---------- Arranque ---------- */
prepararTablas().then(() => {
    app.listen(PORT, () => {
        console.log('MoodTunes listo en http://localhost:' + PORT);
        if (!correo.disponible) console.warn('Recuperación por correo desactivada: configura Google Apps Script y ejecuta npm run apps-script:token.');
    });
}).catch((e) => {
    console.error('\nNo se pudo conectar con MySQL (' + (e.code || e.message) + ').');
    console.error('Enciende MySQL en XAMPP y revisa que exista la base "' + DB_CONFIG.database + '".\n');
    process.exit(1);
});
process.on('SIGINT', () => { pool.end().finally(() => process.exit(0)); });