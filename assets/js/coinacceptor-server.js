'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const { pid: PID, platform: PLATFORM } = process;

/* LOGGING */
const log = function (...args) {
    const ts = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
    console.log(`[${ts}][coinacceptor][DEBUG] ${PID}:`, ...args);
};

/* LOAD PHOTOBOOTH CONFIG */
const cmdConfig = 'bin/photobooth photobooth:config:list json';
const config = JSON.parse(execSync(cmdConfig).toString());

const cmdEnvironment = 'bin/photobooth photobooth:environment:list json';
const environment = JSON.parse(execSync(cmdEnvironment).toString());

/* PID FILE */
const pidFilename = path.join(environment.absoluteFolders.var, 'run/coinacceptor.pid');
fs.writeFileSync(pidFilename, String(PID), { flag: 'w' });
log(`PID file created [${pidFilename}]`);

/* CREDIT PERSISTENCE */
const creditFile = path.join(environment.absoluteFolders.data, 'coin.credits');
let currentCredits = 0;
if (fs.existsSync(creditFile)) {
    try {
        currentCredits = parseInt(fs.readFileSync(creditFile, 'utf8').trim(), 10) || 0;
        log(`Loaded saved credits: ${currentCredits}`);
    } catch (e) {
        log('Could not read credit file, starting at 0');
    }
}

function saveCredits() {
    try {
        fs.writeFileSync(creditFile, String(currentCredits), { flag: 'w' });
    } catch (e) {
        log('Could not save credits:', e.message);
    }
}

/* UNCAUGHT EXCEPTION HANDLER */
process.on('uncaughtException', function (err) {
    log('Error:', err.message);
    fs.unlink(pidFilename, () => {});
    log('Exiting');
    process.exit();
});

/* SOCKET.IO SERVER */
const ioPort = config.coinacceptor.port || 14712;
const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${ioPort}`);

    if (req.method === 'GET' && url.pathname === '/credits') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ credits: currentCredits }));
        return;
    }

    if (req.method === 'POST' && url.pathname === '/consume') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
            let amount = 0;
            try {
                amount = parseInt(JSON.parse(body).amount, 10) || 0;
            } catch (e) {
                amount = parseInt(new URLSearchParams(body).get('amount'), 10) || 0;
            }
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            if (amount > 0 && currentCredits >= amount) {
                currentCredits -= amount;
                saveCredits();
                ioServer.emit('coin-consumed', { amount, remaining: currentCredits });
                log(`Consumed ${amount} credits, remaining: ${currentCredits}`);
                res.end(JSON.stringify({ success: true, remaining: currentCredits }));
            } else if (amount <= 0) {
                res.end(JSON.stringify({ success: false, reason: 'invalid amount' }));
            } else {
                res.end(JSON.stringify({ success: false, reason: 'insufficient credits', credits: currentCredits }));
            }
        });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/reset') {
        currentCredits = 0;
        saveCredits();
        ioServer.emit('coin-reset', { credits: 0 });
        log('Credits reset to 0');
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, credits: 0 }));
        return;
    }

    // Fallback for socket.io polling
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
});

const { Server } = require('socket.io');
const ioServer = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
});

ioServer.on('connection', (client) => {
    log(`Client connected: ${client.id}`);
    client.emit('coin-credits', { credits: currentCredits });
});

httpServer.listen(ioPort, () => {
    log(`Coin acceptor server listening on port ${ioPort}`);
});

/* SERIAL PORT */
const serialPortPath = config.coinacceptor.serial_port;
const baudRate = parseInt(config.coinacceptor.baud_rate, 10) || 9600;
const protocol = config.coinacceptor.protocol || 'pulse';
const pulseValue = parseInt(config.coinacceptor.pulse_value, 10) || 10;

/* Parse ascii_coin_map: "COIN1:10,COIN2:50,COIN3:100" → { COIN1: 10, COIN2: 50, COIN3: 100 } */
const asciiCoinMap = {};
const rawMap = (config.coinacceptor.ascii_coin_map || '').trim();
if (rawMap.length > 0) {
    for (const pair of rawMap.split(',')) {
        const sep = pair.lastIndexOf(':');
        if (sep > 0) {
            const key = pair.slice(0, sep).trim();
            const val = parseInt(pair.slice(sep + 1).trim(), 10);
            if (key.length > 0 && !isNaN(val) && val > 0) {
                asciiCoinMap[key] = val;
            }
        }
    }
    log(`ASCII coin map loaded: ${JSON.stringify(asciiCoinMap)}`);
}

log(`Opening serial port ${serialPortPath} at ${baudRate} baud (protocol: ${protocol})`);

let asciiBuffer = '';

function addCredits(amount) {
    if (amount <= 0) return;
    currentCredits += amount;
    saveCredits();
    log(`Coin inserted: +${amount} credits, total: ${currentCredits}`);
    ioServer.emit('coin-inserted', { amount, total: currentCredits });
}

function handleSerialData(data) {
    switch (protocol) {
        case 'pulse':
            // Each byte received counts as one pulse
            addCredits(data.length * pulseValue);
            break;

        case 'byte_value':
            // Numeric value of each byte = amount
            for (const byte of data) {
                if (byte > 0) {
                    addCredits(byte);
                }
            }
            break;

        case 'ascii':
            // Accumulate until newline, then match against coin map or parse as integer
            asciiBuffer += data.toString('ascii');
            {
                const lines = asciiBuffer.split('\n');
                asciiBuffer = lines.pop(); // keep incomplete line
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.length === 0) continue;
                    if (asciiCoinMap[trimmed] !== undefined) {
                        // Named coin string matched
                        log(`ASCII match: "${trimmed}" → ${asciiCoinMap[trimmed]} credits`);
                        addCredits(asciiCoinMap[trimmed]);
                    } else {
                        // Fallback: parse raw number
                        const val = parseInt(trimmed, 10);
                        if (!isNaN(val) && val > 0) {
                            addCredits(val);
                        } else {
                            log(`ASCII: unrecognised string "${trimmed}" (not in map, not a number)`);
                        }
                    }
                }
            }
            break;

        default:
            log(`Unknown protocol: ${protocol}`);
    }
}

try {
    const { SerialPort } = require('serialport');
    const port = new SerialPort({ path: serialPortPath, baudRate, autoOpen: false });

    port.on('data', handleSerialData);
    port.on('error', (err) => log('Serial port error:', err.message));
    port.on('close', () => log('Serial port closed'));

    port.open((err) => {
        if (err) {
            log(`Failed to open serial port ${serialPortPath}:`, err.message);
            log('Running without serial input — use HTTP API to add credits manually');
        } else {
            log(`Serial port ${serialPortPath} opened`);
        }
    });
} catch (e) {
    log('serialport module not available:', e.message);
    log('Running without serial input — install serialport via npm and rebuild');
}

log('Coin acceptor server started');
