'use strict';

require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const readline = require('readline');

const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mood_tunez',
    charset: 'utf8mb4'
};

function preguntar(rl, mensaje) {
    return new Promise((resolve) => rl.question(mensaje, resolve));
}

function preguntarSecreto(mensaje) {
    return new Promise((resolve, reject) => {
        const entrada = process.stdin, salida = process.stdout;
        if (!entrada.isTTY || typeof entrada.setRawMode !== 'function') {
            reject(new Error('Ejecuta este comando en una terminal interactiva o define ADMIN_BOOTSTRAP_USER y ADMIN_BOOTSTRAP_PASS.'));
            return;
        }
        let valor = '';
        salida.write(mensaje);
        entrada.setRawMode(true);
        entrada.resume();
        const alDato = (dato) => {
            for (const caracter of dato.toString('utf8')) {
                if (caracter === '\u0003') {
                    entrada.setRawMode(false);
                    entrada.removeListener('data', alDato);
                    salida.write('\n');
                    reject(new Error('Configuracion cancelada.'));
                    return;
                }
                if (caracter === '\r' || caracter === '\n') {
                    entrada.setRawMode(false);
                    entrada.removeListener('data', alDato);
                    salida.write('\n');
                    resolve(valor);
                    return;
                }
                if (caracter === '\u0008' || caracter === '\u007f') {
                    if (valor.length) {
                        valor = valor.slice(0, -1);
                        salida.write('\b \b');
                    }
                } else if (caracter >= ' ') {
                    valor += caracter;
                    salida.write('*');
                }
            }
        };
        entrada.on('data', alDato);
    });
}

async function main() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const usuario = (process.env.ADMIN_BOOTSTRAP_USER || await preguntar(rl, 'Usuario propietario (3-30 caracteres): ')).trim();
    const email = (process.env.ADMIN_BOOTSTRAP_EMAIL || await preguntar(rl, 'Correo de recuperacion: ')).trim();
    rl.close();
    const password = process.env.ADMIN_BOOTSTRAP_PASS || await preguntarSecreto('Contrasena administrativa (no se mostrara): ');
    const confirmacion = process.env.ADMIN_BOOTSTRAP_PASS ? password : await preguntarSecreto('Repite la contrasena: ');

    if (!/^[A-Za-z0-9._-]{3,30}$/.test(usuario)) throw new Error('El usuario debe tener 3-30 caracteres: letras, numeros, punto, guion o guion bajo.');
    if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Escribe un correo de recuperacion valido (maximo 120 caracteres).');
    if (Buffer.byteLength(password) < 14 || Buffer.byteLength(password) > 72) throw new Error('La contrasena debe tener entre 14 y 72 bytes.');
    if (password !== confirmacion) throw new Error('Las contrasenas no coinciden.');

    const pool = mysql.createPool(DB_CONFIG);
    try {
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
        const columnasAdmin = [
            ['email', 'ALTER TABLE administradores ADD COLUMN email VARCHAR(120) NULL'],
            ['recovery_hash', 'ALTER TABLE administradores ADD COLUMN recovery_hash VARCHAR(255) NULL'],
            ['recovery_expires', 'ALTER TABLE administradores ADD COLUMN recovery_expires DATETIME NULL'],
            ['recovery_attempts', 'ALTER TABLE administradores ADD COLUMN recovery_attempts TINYINT NOT NULL DEFAULT 0'],
            ['session_version', 'ALTER TABLE administradores ADD COLUMN session_version INT NOT NULL DEFAULT 0']
        ];
        for (const [columna, sql] of columnasAdmin) {
            const [existente] = await pool.query('SHOW COLUMNS FROM administradores LIKE ?', [columna]);
            if (!existente.length) await pool.query(sql);
        }

        const [cliente] = await pool.execute(
            'SELECT id FROM usuarios WHERE usuario = ? OR email = ? LIMIT 1',
            [usuario, usuario]);
        if (cliente[0]) throw new Error('Ese nombre ya pertenece a una cuenta de cliente. Elige un usuario administrativo distinto.');

        const hash = await bcrypt.hash(password, 12);
        const [existente] = await pool.execute('SELECT id FROM administradores WHERE usuario = ? LIMIT 1', [usuario]);
        if (existente[0]) {
            await pool.execute('UPDATE administradores SET password = ?, email = ?, recovery_hash = NULL, recovery_expires = NULL, recovery_attempts = 0, session_version = session_version + 1 WHERE id = ?', [hash, email, existente[0].id]);
        } else {
            await pool.execute('INSERT INTO administradores (usuario, password, email) VALUES (?, ?, ?)', [usuario, hash, email]);
        }
        console.log('Cuenta administrativa configurada para: ' + usuario);
        console.log('Correo de recuperacion actualizado.');
    } finally {
        await pool.end();
    }
}

main().catch((e) => {
    console.error('No se pudo configurar la cuenta administrativa: ' + e.message);
    process.exitCode = 1;
});
