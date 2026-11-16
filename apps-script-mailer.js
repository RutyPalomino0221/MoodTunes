'use strict';

const APPS_SCRIPT_URL = String(process.env.APPS_SCRIPT_WEBHOOK_URL || '').trim();
const APPS_SCRIPT_TOKEN = String(process.env.APPS_SCRIPT_TOKEN || '').trim();

function urlValida() {
    try {
        const url = new URL(APPS_SCRIPT_URL);
        return url.protocol === 'https:' && url.hostname === 'script.google.com' &&
            /^\/macros\/s\/[^/]+\/exec$/.test(url.pathname);
    } catch (e) {
        return false;
    }
}

const disponible = urlValida() && APPS_SCRIPT_TOKEN.length >= 32;

async function enviarCodigo(destino, codigo, tipo) {
    if (!disponible) throw new Error('Configura el despliegue de Google Apps Script y su token en .env.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(destino || '')) || !/^\d{6}$/.test(String(codigo || ''))) {
        throw new Error('Destinatario o código de recuperación no válido.');
    }

    const respuesta = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: APPS_SCRIPT_TOKEN, destino, codigo, tipo }),
        signal: AbortSignal.timeout(20000)
    });
    let datos;
    try {
        datos = await respuesta.json();
    } catch (e) {
        throw new Error('Google Apps Script no devolvió una respuesta válida.');
    }
    if (!respuesta.ok || !datos || datos.success !== true) {
        throw new Error('Google Apps Script rechazó el envío (HTTP ' + respuesta.status + ').');
    }
}

module.exports = { disponible, enviarCodigo };
