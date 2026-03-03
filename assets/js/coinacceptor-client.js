'use strict';

/* global config environment csrf photoboothTools io */

(function () {
    if (!config.coinacceptor || !config.coinacceptor.enabled) {
        return;
    }

    var currentCredits = 0;
    var pendingResolve = null;
    var pendingPrice = 0;
    var pendingMode = '';

    var serverBaseUrl =
        window.location.protocol + '//' + (config.coinacceptor.serverip || 'localhost') + ':' + (config.coinacceptor.port || 14712);

    /* ---- UI helpers ---- */
    function updateDisplay() {
        var el = document.getElementById('coin-credits-value');
        if (el) {
            el.textContent = currentCredits;
        }
        var display = document.getElementById('coin-credits-display');
        if (display && config.coinacceptor.show_credits) {
            display.style.display = 'flex';
        }
        if (pendingResolve && currentCredits >= pendingPrice) {
            closePendingOverlay(true);
        }
    }

    function showOverlay(mode, required) {
        var overlay = document.getElementById('coin-insert-overlay');
        var msgEl = document.getElementById('coin-overlay-msg');
        var creditsEl = document.getElementById('coin-overlay-credits');
        if (!overlay) return;

        var msgKey = mode === 'print' ? 'coin_insert_print' : 'coin_insert_picture';
        var msg = photoboothTools.getTranslation(msgKey);
        if (msgEl) msgEl.textContent = msg;
        if (creditsEl) creditsEl.textContent = currentCredits + ' / ' + required;

        overlay.style.display = 'flex';
        overlay.setAttribute('aria-hidden', 'false');
    }

    function updateOverlayCredits(required) {
        var creditsEl = document.getElementById('coin-overlay-credits');
        if (creditsEl) {
            creditsEl.textContent = currentCredits + ' / ' + required;
        }
    }

    function hideOverlay() {
        var overlay = document.getElementById('coin-insert-overlay');
        if (!overlay) return;
        overlay.style.display = 'none';
        overlay.setAttribute('aria-hidden', 'true');
    }

    function closePendingOverlay(ok) {
        if (!pendingResolve) return;
        var resolve = pendingResolve;
        pendingResolve = null;
        pendingPrice = 0;
        pendingMode = '';
        hideOverlay();
        resolve(ok);
    }

    /* ---- Credit consumption ---- */
    function consumeCredits(amount) {
        return fetch(environment.publicFolders.api + '/coinacceptor.php?action=consume&amount=' + amount + '&' + csrf.key + '=' + csrf.token)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    currentCredits = data.remaining;
                    updateDisplay();
                }
            })
            .catch(function (e) {
                photoboothTools.console.log('Coin acceptor consume error:', e);
            });
    }

    /* ---- Gate API exposed on window ---- */
    window.coinAcceptorGate = {
        checkPicture: function () {
            return this._check('picture', parseInt(config.coinacceptor.price_picture, 10) || 0);
        },
        checkPrint: function () {
            return this._check('print', parseInt(config.coinacceptor.price_print, 10) || 0);
        },
        _check: function (mode, price) {
            if (price <= 0) {
                return Promise.resolve(true);
            }
            if (currentCredits >= price) {
                return consumeCredits(price).then(function () { return true; });
            }
            // Not enough credits — show overlay, wait
            pendingPrice = price;
            pendingMode = mode;
            showOverlay(mode, price);
            return new Promise(function (resolve) {
                pendingResolve = resolve;
            });
        },
    };

    /* ---- Socket.IO connection ---- */
    function connectToServer() {
        if (typeof io === 'undefined') {
            photoboothTools.console.log('coinacceptor: socket.io not loaded');
            return;
        }

        var socket = io(serverBaseUrl, { transports: ['polling', 'websocket'] });

        socket.on('connect', function () {
            photoboothTools.console.log('coinacceptor: connected to server');
        });

        socket.on('coin-credits', function (data) {
            currentCredits = parseInt(data.credits, 10) || 0;
            updateDisplay();
        });

        socket.on('coin-inserted', function (data) {
            currentCredits = parseInt(data.total, 10) || 0;
            updateDisplay();
            if (pendingResolve) {
                updateOverlayCredits(pendingPrice);
            }
        });

        socket.on('coin-consumed', function (data) {
            currentCredits = parseInt(data.remaining, 10) || 0;
            updateDisplay();
        });

        socket.on('coin-reset', function () {
            currentCredits = 0;
            updateDisplay();
        });

        socket.on('connect_error', function () {
            photoboothTools.console.log('coinacceptor: server not reachable at ' + serverBaseUrl);
        });
    }

    /* ---- Initial credit fetch ---- */
    fetch(serverBaseUrl + '/credits')
        .then(function (r) { return r.json(); })
        .then(function (data) {
            currentCredits = parseInt(data.credits, 10) || 0;
            updateDisplay();
        })
        .catch(function () {
            photoboothTools.console.log('coinacceptor: could not reach server at ' + serverBaseUrl);
        });

    connectToServer();
})();
