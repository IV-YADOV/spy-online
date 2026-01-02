const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const ALL_LOCATIONS = [
    "Пляж", "Школа", "Самолет", "Казино", "Церковь", "Банк", 
    "Ресторан", "Цирк", "Больница", "Отель", "Поезд", "Театр", 
    "Полиция", "Супермаркет", "Университет", "Военная база", 
    "Космическая станция", "Океанский лайнер", "Подводная лодка", "Стройка"
];

const AVATAR_COLORS = [
    'linear-gradient(135deg, #FF9A9E 0%, #FECFEF 100%)',
    'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
    'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)',
    'linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)',
    'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)',
    'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
    'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
];

const rooms = {};
const generateRoomCode = () => Math.random().toString(36).substring(2, 6).toUpperCase();

io.on('connection', (socket) => {

    // --- RECONNECT ---
    socket.on('rejoinGame', ({ roomCode, uid }) => {
        const room = rooms[roomCode];
        if (room) {
            const player = room.players.find(p => p.uid === uid);
            if (player) {
                player.id = socket.id;
                if (player.isHost) room.hostId = socket.id;
                socket.join(roomCode);

                socket.emit('joined', { 
                    roomCode, 
                    isHost: player.isHost, 
                    settings: room.settings, 
                    allLocations: ALL_LOCATIONS 
                });

                if (room.status === 'playing' && room.gameData) {
                    const isSpy = room.gameData.spiesIds.includes(socket.id) || room.gameData.spiesUids.includes(uid);
                    if (isSpy && !room.gameData.spiesIds.includes(socket.id)) room.gameData.spiesIds.push(socket.id);

                    socket.emit('gameStarted', {
                        role: isSpy ? "Шпион" : "Мирный житель",
                        location: isSpy ? "???" : room.gameData.location,
                        isSpy: isSpy,
                        timeLeft: room.gameData.duration,
                        activeLocations: room.settings.activeLocations,
                        players: room.players.map(pl => ({ id: pl.id, name: pl.name, avatarColor: pl.avatarColor }))
                    });

                    if (room.vote) {
                        const target = room.players.find(p => p.id === room.vote.targetId);
                        const initiator = room.players.find(p => p.id === room.vote.initiatorId);
                        if (target && initiator) {
                            socket.emit('voteStarted', {
                                targetName: target.name,
                                initiatorName: initiator.name,
                                targetId: room.vote.targetId
                            });
                        }
                    }
                }
                io.to(roomCode).emit('updatePlayers', room.players);
                return;
            }
        }
        socket.emit('sessionExpired');
    });

    // --- CREATE ---
    socket.on('createGame', ({ playerName, uid }) => {
        const roomCode = generateRoomCode();
        const color = AVATAR_COLORS[0];
        rooms[roomCode] = {
            hostId: socket.id,
            players: [{ id: socket.id, uid, name: playerName, isHost: true, avatarColor: color }],
            status: 'lobby',
            settings: { time: 5, spies: 1, activeLocations: [...ALL_LOCATIONS] },
            vote: null,
            gameData: null,
            timerInterval: null
        };
        socket.join(roomCode);
        socket.emit('joined', { roomCode, isHost: true, settings: rooms[roomCode].settings, allLocations: ALL_LOCATIONS });
        io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
    });

    // --- JOIN ---
    socket.on('joinGame', ({ roomCode, playerName, uid }) => {
        const room = rooms[roomCode];
        if (room && room.status === 'lobby') {
            const existing = room.players.find(p => p.uid === uid);
            if (existing) {
                existing.id = socket.id;
                existing.name = playerName;
                socket.join(roomCode);
            } else {
                const colorIndex = room.players.length % AVATAR_COLORS.length;
                const color = AVATAR_COLORS[colorIndex];
                room.players.push({ id: socket.id, uid, name: playerName, isHost: false, avatarColor: color });
                socket.join(roomCode);
            }
            socket.emit('joined', { roomCode, isHost: false, settings: room.settings, allLocations: ALL_LOCATIONS });
            io.to(roomCode).emit('updatePlayers', room.players);
        } else {
            socket.emit('error', 'Ошибка: комната не найдена или игра идет');
        }
    });

    // --- LEAVE ---
    socket.on('leaveGame', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (room) {
            const idx = room.players.findIndex(p => p.id === socket.id);
            if (idx !== -1) {
                room.players.splice(idx, 1);
                io.to(roomCode).emit('updatePlayers', room.players);
                socket.leave(roomCode);
                
                if (room.players.length === 0) {
                    clearInterval(room.timerInterval);
                    delete rooms[roomCode];
                } else if (room.hostId === socket.id) {
                     clearInterval(room.timerInterval);
                     io.to(roomCode).emit('error', 'Хост покинул игру. Комната закрыта.');
                     delete rooms[roomCode];
                }
            }
        }
    });

    // --- SETTINGS ---
    socket.on('updateSettings', ({ roomCode, key, value }) => {
        const room = rooms[roomCode];
        if (room && room.hostId === socket.id) {
            if (key === 'time') room.settings.time = value;
            if (key === 'spies') room.settings.spies = value;
            io.to(roomCode).emit('settingsChanged', room.settings);
        }
    });

    socket.on('toggleLocation', ({ roomCode, location }) => {
        const room = rooms[roomCode];
        if (room && room.hostId === socket.id) {
            const idx = room.settings.activeLocations.indexOf(location);
            if (idx > -1) {
                if (room.settings.activeLocations.length > 2) room.settings.activeLocations.splice(idx, 1);
            } else {
                room.settings.activeLocations.push(location);
            }
            io.to(roomCode).emit('settingsChanged', room.settings);
        }
    });

    // --- START ---
    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;
        // Защита от повторного старта
        if (room.status === 'playing') return;

        const location = room.settings.activeLocations[Math.floor(Math.random() * room.settings.activeLocations.length)];
        const playersCount = room.players.length;
        const spiesCount = Math.min(room.settings.spies, playersCount - 1);
        
        let roles = Array(playersCount).fill('civilian');
        let spiesIndices = [];
        while(spiesIndices.length < spiesCount) {
            let r = Math.floor(Math.random() * playersCount);
            if(!spiesIndices.includes(r)) spiesIndices.push(r);
        }
        spiesIndices.forEach(i => roles[i] = 'spy');

        room.status = 'playing';
        room.gameData = {
            location: location,
            spiesIds: spiesIndices.map(i => room.players[i].id),
            spiesUids: spiesIndices.map(i => room.players[i].uid),
            startTime: Date.now(),
            duration: room.settings.time * 60
        };

        room.players.forEach((p, index) => {
            const isSpy = roles[index] === 'spy';
            io.to(p.id).emit('gameStarted', {
                role: isSpy ? "Шпион" : "Мирный житель",
                location: isSpy ? "???" : location,
                isSpy: isSpy,
                timeLeft: room.gameData.duration,
                activeLocations: room.settings.activeLocations,
                players: room.players.map(pl => ({ id: pl.id, name: pl.name, avatarColor: pl.avatarColor }))
            });
        });

        clearInterval(room.timerInterval);
        room.timerInterval = setInterval(() => {
            if (!room.gameData) {
                clearInterval(room.timerInterval);
                return;
            }
            room.gameData.duration--;
            if (room.gameData.duration <= 0) {
                finishGame(roomCode, 'spies', 'Время истекло! Шпион победил.');
            }
        }, 1000);
    });

    // --- GUESS ---
    socket.on('spyGuess', ({ roomCode, location }) => {
        const room = rooms[roomCode];
        // ВАЖНАЯ ПРОВЕРКА: Если игра уже не идет, ничего не делаем
        if (!room || room.status !== 'playing') return;
        
        if (!room.gameData || !room.gameData.spiesIds.includes(socket.id)) return;

        if (location === room.gameData.location) {
            finishGame(roomCode, 'spies', `Шпион угадал локацию: ${location}`);
        } else {
            finishGame(roomCode, 'civilians', `Шпион ошибся! Локация была: ${room.gameData.location}`);
        }
    });

    // --- VOTE ---
    socket.on('startVote', ({ roomCode, targetId }) => {
        const room = rooms[roomCode];
        if (!room || room.status !== 'playing' || room.vote) return;
        const target = room.players.find(p => p.id === targetId);
        const initiator = room.players.find(p => p.id === socket.id);
        if(!target || !initiator) return;

        room.vote = { targetId, initiatorId: socket.id, votes: {}, required: room.players.length - 1 };
        room.vote.votes[socket.id] = true;
        io.to(roomCode).emit('voteStarted', { targetName: target.name, initiatorName: initiator.name, targetId });
    });

    socket.on('submitVote', ({ roomCode, vote }) => {
        const room = rooms[roomCode];
        // Если игра уже закончилась (status !== 'playing'), голос игнорируется
        if (!room || room.status !== 'playing' || !room.vote) return;
        
        if (socket.id === room.vote.targetId) return;

        room.vote.votes[socket.id] = vote;
        if (vote === false) {
            io.to(roomCode).emit('voteResult', { success: false, msg: 'Голосование отклонено' });
            room.vote = null;
            return;
        }
        const votersCount = room.players.filter(p => p.id !== room.vote.targetId).length;
        const votesYes = Object.values(room.vote.votes).filter(v => v === true).length;

        if (votesYes === votersCount) {
            const isSpy = room.gameData && room.gameData.spiesIds.includes(room.vote.targetId);
            const targetName = room.players.find(p => p.id === room.vote.targetId).name;
            finishGame(roomCode, isSpy ? 'civilians' : 'spies', isSpy ? `Пойман шпион: ${targetName}` : `Ошибка! ${targetName} мирный.`);
            room.vote = null;
        }
    });

    // --- FINISH ---
    function finishGame(roomCode, winner, reason) {
        const room = rooms[roomCode];
        
        // --- ГЛАВНОЕ ИСПРАВЛЕНИЕ ---
        // Если комната не найдена ИЛИ игра уже закончилась (status уже 'results' или 'lobby')
        // То мы выходим и не отправляем повторный Game Over
        if (!room || room.status !== 'playing') return;
        
        // Сразу меняем статус, чтобы заблокировать другие вызовы
        room.status = 'results';
        
        clearInterval(room.timerInterval);
        
        let spiesNames = "Никто";
        if(room.gameData) {
            spiesNames = room.players.filter(p => room.gameData.spiesIds.includes(p.id)).map(p => p.name).join(', ');
        }
        
        const loc = room.gameData ? room.gameData.location : "Неизвестно";
        
        io.to(roomCode).emit('gameOver', { winner, reason, location: loc, spiesNames });
    }

    socket.on('returnToLobby', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.hostId === socket.id) {
            clearInterval(room.timerInterval);
            room.status = 'lobby'; 
            room.vote = null; 
            room.gameData = null;
            io.to(roomCode).emit('returnToLobby');
        }
    });

    socket.on('disconnect', () => {});
});

server.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});