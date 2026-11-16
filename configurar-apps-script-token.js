'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

const archivoEnv = path.join(__dirname, '.env');

function escribirSiFalta(lineas, clave, valor) {
    const patron = new RegExp('^\\s*' + clave + '\\s*=');
    if (!lineas.some((linea) => patron.test(linea))) lineas.push(clave + '=' + valor);
}

function main() {
    const contenido = fs.existsSync(archivoEnv) ? fs.readFileSync(archivoEnv, 'utf8') : '';
    const lineas = contenido.split(/\r?\n/);
    const rotar = process.argv.includes('--rotate');
    const tokenPatron = /^\s*APPS_SCRIPT_TOKEN\s*=/;
    const indiceToken = lineas.findIndex((linea) => tokenPatron.test(linea));
    if (rotar || indiceToken < 0 || !lineas[indiceToken].split('=').slice(1).join('=').trim()) {
        if (indiceToken >= 0) lineas.splice(indiceToken, 1);
        lineas.push('APPS_SCRIPT_TOKEN=' + crypto.randomBytes(32).toString('base64url'));
    }
    escribirSiFalta(lineas, 'APPS_SCRIPT_WEBHOOK_URL', '');
    fs.writeFileSync(archivoEnv, lineas.join('\n').replace(/\n+$/, '') + '\n', { mode: 0o600 });
    if (process.argv.includes('--copy')) {
        if (process.platform !== 'win32') throw new Error('La copia directa al portapapeles requiere Windows.');
        const token = dotenv.parse(fs.readFileSync(archivoEnv, 'utf8')).APPS_SCRIPT_TOKEN;
        const copia = spawnSync('clip.exe', [], { input: token, encoding: 'utf8', windowsHide: true });
        if (copia.error || copia.status !== 0) throw new Error('No se pudo copiar el token al portapapeles.');
        console.log('Token copiado al portapapeles sin mostrarlo.');
        return;
    }
    console.log(rotar
        ? 'Token rotado en .env (valor oculto). Reemplazalo en la propiedad de script MOODTUNES_TOKEN.'
        : 'Token creado o conservado en .env (valor oculto). Copialo a la propiedad de script MOODTUNES_TOKEN.');
}

try {
    main();
} catch (e) {
    console.error('No se pudo preparar el token de Apps Script: ' + e.message);
    process.exitCode = 1;
}
