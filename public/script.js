const socket = io();

// State
let isHost = false;
let isSpy = false;
let currentRoom = null;
let timerInterval;
let myPlayerId = null; 
let toastTimeout;

const screens = {
    login: document.getElementById('screen-login'),
    lobby: document.getElementById('screen-lobby'),
    game: document.getElementById('screen-game'),
    results: document.getElementById('screen-results')
};

// --- INIT & RECONNECT ---
window.addEventListener('load', () => {
    const savedRoom = localStorage.getItem('spy_room');
    if (savedRoom) {
        socket.emit('rejoinGame', { roomCode: savedRoom, uid: getUid() });
    }
});

socket.on('sessionExpired', () => {
    localStorage.removeItem('spy_room');
    showScreen('login');
});

// --- UI HELPERS ---
function showToast(message, type = 'default') {
    const toast = document.getElementById('toast-notification');
    toast.textContent = message;
    toast.className = 'toast active';
    if (type === 'error') toast.classList.add('error');
    if (type === 'success') toast.classList.add('success');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => { toast.classList.remove('active'); }, 3000);
}

function showConfirm(title, message, onYes) {
    const popup = document.getElementById('confirm-popup');
    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-text').innerText = message;
    const btnYes = document.getElementById('confirm-yes-btn');
    const newBtn = btnYes.cloneNode(true);
    btnYes.parentNode.replaceChild(newBtn, btnYes);
    newBtn.onclick = () => { onYes(); closeConfirmPopup(); };
    popup.classList.add('active');
}

function closeConfirmPopup() {
    document.getElementById('confirm-popup').classList.remove('active');
}

// --- NAVIGATION ---
function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
}

// --- SETUP ---
function createGame() {
    const name = document.getElementById('username').value.trim();
    if (!name) return showToast('Введите имя', 'error');
    socket.emit('createGame', { playerName: name, uid: getUid() });
}

function joinGame() {
    const name = document.getElementById('username').value.trim();
    const code = document.getElementById('room-code-input').value.trim().toUpperCase();
    if (!name) return showToast('Введите имя', 'error');
    if (!code) return showToast('Введите код', 'error');
    socket.emit('joinGame', { roomCode: code, playerName: name, uid: getUid() });
}

function exitGame() {
    showConfirm('Выход', 'Вы точно хотите выйти из игры?', () => {
        socket.emit('leaveGame', { roomCode: currentRoom });
        localStorage.removeItem('spy_room');
        location.reload();
    });
}

function getUid() {
    let uid = localStorage.getItem('spy_uid');
    if (!uid) {
        uid = Math.random().toString(36).substr(2, 9);
        localStorage.setItem('spy_uid', uid);
    }
    return uid;
}

// --- CONTROLS ---
function changeSetting(key, delta) {
    if (!isHost) return;
    const el = document.getElementById(`val-${key}`);
    let val = parseInt(el.innerText) + delta;
    if (val < 1) val = 1;
    if (key === 'spies' && val > 3) val = 3;
    if (key === 'time' && val > 15) val = 15;
    socket.emit('updateSettings', { roomCode: currentRoom, key, value: val });
}

function toggleLocationFilter(loc) {
    if (!isHost) return;
    socket.emit('toggleLocation', { roomCode: currentRoom, location: loc });
}

function startGame() {
    if (isHost) socket.emit('startGame', currentRoom);
}

function restartGameReq() {
    if (isHost) {
        showConfirm('Завершение', 'Вернуть всех в лобби?', () => {
            socket.emit('returnToLobby', currentRoom);
        });
    }
}

function openSpyGuess() {
    document.getElementById('spy-guess-sheet').classList.add('active');
    document.getElementById('modal-backdrop').classList.add('active');
}
function submitSpyGuess(loc) {
    showConfirm('Угадать', `Ваш выбор: ${loc}?`, () => {
        socket.emit('spyGuess', { roomCode: currentRoom, location: loc });
        closeSheets();
    });
}
function openVoteMenu() {
    document.getElementById('vote-menu-sheet').classList.add('active');
    document.getElementById('modal-backdrop').classList.add('active');
}
function startVote(targetId) {
    closeSheets();
    socket.emit('startVote', { roomCode: currentRoom, targetId });
}
function sendVote(decision) {
    document.getElementById('vote-popup').classList.remove('active');
    socket.emit('submitVote', { roomCode: currentRoom, vote: decision });
}

// --- EVENTS ---
socket.on('joined', (data) => {
    isHost = data.isHost;
    currentRoom = data.roomCode;
    myPlayerId = socket.id;
    localStorage.setItem('spy_room', currentRoom);
    document.getElementById('display-code').innerText = data.roomCode;
    updateRoleControls();
    updateSettingsUI(data.settings);
    renderFilterList(data.allLocations, data.settings.activeLocations);
    showScreen('lobby');
});

socket.on('updatePlayers', (players) => {
    const list = document.getElementById('players-list');
    list.innerHTML = players.map(p => `
        <div class="player-chip ${p.isHost ? 'chip-host' : ''}">
            <div class="avatar" style="background: ${p.avatarColor}">${p.name[0]}</div>
            ${p.name}
        </div>
    `).join('');
});

socket.on('settingsChanged', (settings) => {
    updateSettingsUI(settings);
    const inputs = document.querySelectorAll('#filter-list input');
    inputs.forEach(input => { input.checked = settings.activeLocations.includes(input.value); });
});

socket.on('gameStarted', (data) => {
    showScreen('game');
    closeSheets();
    isSpy = data.isSpy;
    const card = document.getElementById('game-card');
    card.classList.remove('flipped'); card.classList.remove('is-spy');

    setTimeout(() => {
        document.getElementById('role-text').innerText = data.role;
        document.getElementById('location-text').innerText = data.location;
        document.getElementById('role-desc').innerText = isSpy ? "Угадайте локацию, чтобы победить." : "Вычислите шпиона голосованием.";
        if (isSpy) card.classList.add('is-spy');
    }, 200);

    document.getElementById('spy-guess-btn').classList.toggle('hidden', !isSpy);
    renderGameCheckList(data.activeLocations);
    renderSpyGuessList(data.activeLocations);
    renderVoteList(data.players);
    startTimer(data.timeLeft, data.timeLeft);
});

socket.on('voteStarted', (data) => {
    if (data.initiatorName !== myPlayerId && data.targetId !== socket.id) {
        document.getElementById('vote-target-name').innerText = data.targetName;
        document.getElementById('vote-popup').classList.add('active');
    }
});

socket.on('voteResult', (data) => { if(!data.success) showToast(data.msg, 'error'); });

socket.on('gameOver', (data) => {
    showScreen('results');
    const isWin = (data.winner === 'spies' && isSpy) || (data.winner === 'civilians' && !isSpy);
    const icon = document.getElementById('res-icon');
    const title = document.getElementById('res-title');
    if (isWin) { icon.innerText = '🏆'; title.innerText = 'Победа!'; title.style.color = '#4CD964'; } 
    else { icon.innerText = '💀'; title.innerText = 'Поражение'; title.style.color = '#FF3B30'; }
    document.getElementById('res-reason').innerText = data.reason;
    document.getElementById('res-loc').innerText = data.location;
    document.getElementById('res-spy').innerText = data.spiesNames;
    updateRoleControls();
});

socket.on('returnToLobby', () => {
    clearInterval(timerInterval);
    showScreen('lobby');
});

socket.on('error', (msg) => {
    showToast(msg, 'error');
    if (msg.includes('закрыта') || msg.includes('не найдена')) {
        localStorage.removeItem('spy_room');
        showScreen('login');
    }
});

// --- RENDER HELPERS ---
function updateSettingsUI(settings) {
    document.getElementById('val-time').innerText = settings.time;
    document.getElementById('val-spies').innerText = settings.spies;
    document.getElementById('guest-time').innerText = settings.time;
    document.getElementById('guest-spies').innerText = settings.spies;
    document.getElementById('active-loc-count').innerText = settings.activeLocations.length;
}

function updateRoleControls() {
    const hostControls = document.querySelectorAll('.host-only-control');
    const guestControls = document.querySelectorAll('.guest-only-control');
    hostControls.forEach(el => el.classList.toggle('hidden', !isHost));
    guestControls.forEach(el => el.classList.toggle('hidden', isHost));
}

function renderFilterList(allLocs, activeLocs) {
    const list = document.getElementById('filter-list');
    list.innerHTML = allLocs.map(loc => `
        <li><span>${loc}</span><label class="ios-switch"><input type="checkbox" value="${loc}" ${activeLocs.includes(loc) ? 'checked' : ''} ${!isHost ? 'disabled' : ''} onchange="toggleLocationFilter('${loc}')"><span class="slider"></span></label></li>
    `).join('');
}

function renderGameCheckList(locations) {
    const list = document.getElementById('game-check-list');
    list.innerHTML = locations.sort().map(loc => `<li onclick="this.classList.toggle('done')"><div class="check-circle"></div> ${loc}</li>`).join('');
}

function renderSpyGuessList(locations) {
    const list = document.getElementById('spy-guess-list');
    list.innerHTML = locations.sort().map(loc => `<li onclick="submitSpyGuess('${loc}')">${loc} <i class="ph-bold ph-caret-right"></i></li>`).join('');
}

function renderVoteList(players) {
    const list = document.getElementById('vote-list');
    list.innerHTML = players.map(p => {
        if (p.id === socket.id) return '';
        // Используем переданный avatarColor
        return `<li onclick="startVote('${p.id}')">
            <div style="display:flex; align-items:center; gap:10px">
                <div class="avatar" style="background: ${p.avatarColor}">${p.name[0]}</div> ${p.name}
            </div>
            <i class="ph-bold ph-gavel" style="color:var(--accent)"></i>
        </li>`;
    }).join('');
}

function openFilterModal() { document.getElementById('filter-sheet').classList.add('active'); document.getElementById('modal-backdrop').classList.add('active'); }
function openGameList() { document.getElementById('game-list-sheet').classList.add('active'); document.getElementById('modal-backdrop').classList.add('active'); }
function closeSheets() { document.querySelectorAll('.bottom-sheet').forEach(s => s.classList.remove('active')); document.getElementById('modal-backdrop').classList.remove('active'); }
function flipCard() { document.getElementById('game-card').classList.toggle('flipped'); }
function startTimer(duration, total) {
    let timer = duration;
    const display = document.getElementById('timer-display');
    const circle = document.querySelector('.progress-ring__circle');
    const radius = circle.r.baseVal.value;
    const circumference = radius * 2 * Math.PI;
    circle.style.strokeDasharray = `${circumference} ${circumference}`;
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const m = Math.floor(timer / 60).toString().padStart(2, '0');
        const s = (timer % 60).toString().padStart(2, '0');
        display.innerText = `${m}:${s}`;
        const offset = circumference - (timer / total) * circumference;
        circle.style.strokeDashoffset = -offset;
        if (--timer < 0) clearInterval(timerInterval);
    }, 1000);
}