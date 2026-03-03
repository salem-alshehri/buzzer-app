const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'host.html')));
app.get('/player', (req, res) => res.sendFile(path.join(__dirname, 'player.html')));

let rooms = {};

io.on('connection', (socket) => {
    
    socket.on('create_room', () => {
        const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
        const hostToken = Math.random().toString(36).substring(2);
        // التعديل: إضافة currentWinner لتسجيل حالة الفائز الحالية
        rooms[roomCode] = { hostToken, hostSocket: socket.id, isLocked: false, blockedTeam: null, players: [], timer: null, timersEnabled: true, currentWinner: null };
        socket.join(roomCode);
        socket.emit('room_created', { roomCode, hostToken });
    });

    socket.on('rejoin_host', (data) => {
        const { roomCode, hostToken } = data;
        if (rooms[roomCode] && rooms[roomCode].hostToken === hostToken) {
            clearTimeout(rooms[roomCode].timer);
            rooms[roomCode].hostSocket = socket.id;
            socket.join(roomCode);
            socket.emit('room_created', { roomCode, hostToken });
            socket.emit('update_players', rooms[roomCode].players);
        } else {
            socket.emit('room_closed');
        }
    });

    socket.on('check_room', (code, callback) => {
        callback({ exists: !!rooms[code] });
    });

    socket.on('join_room', (data) => {
        const { roomCode, name, color, deviceId } = data;
        if (rooms[roomCode]) {
            socket.join(roomCode);
            let existingPlayer = rooms[roomCode].players.find(p => p.deviceId === deviceId);
            
            if (existingPlayer) {
                existingPlayer.id = socket.id;
                socket.emit('join_success', existingPlayer); 
            } else {
                let newPlayer = { id: socket.id, deviceId, name, color };
                rooms[roomCode].players.push(newPlayer);
                socket.emit('join_success', newPlayer);
            }
            io.to(roomCode).emit('update_players', rooms[roomCode].players);
        }
    });

    socket.on('kick_player', (data) => {
        const { roomCode, deviceId } = data;
        if (rooms[roomCode] && rooms[roomCode].hostSocket === socket.id) {
            const kickedPlayer = rooms[roomCode].players.find(p => p.deviceId === deviceId);
            if (kickedPlayer) {
                rooms[roomCode].players = rooms[roomCode].players.filter(p => p.deviceId !== deviceId);
                io.to(roomCode).emit('update_players', rooms[roomCode].players);
                io.to(kickedPlayer.id).emit('you_were_kicked');
            }
        }
    });

    socket.on('buzz', (roomCode) => {
        if (rooms[roomCode] && !rooms[roomCode].isLocked) {
            const player = rooms[roomCode].players.find(p => p.id === socket.id);
            if(player) {
                if(rooms[roomCode].blockedTeam === player.color) return;

                rooms[roomCode].isLocked = true;
                
                if (rooms[roomCode].blockedTeam !== null) {
                    rooms[roomCode].timersEnabled = false; 
                    rooms[roomCode].blockedTeam = null; 
                }

                // التعديل: حفظ الفائز الحالي
                rooms[roomCode].currentWinner = player;
                io.to(roomCode).emit('declare_winner', { ...player, timersEnabled: rooms[roomCode].timersEnabled });
            }
        }
    });

    socket.on('time_3s_finished', (roomCode) => {
        if (rooms[roomCode]) {
            io.to(roomCode).emit('remove_glow');
        }
    });

    socket.on('start_other_team_time', (data) => {
        const { roomCode, blockedTeam } = data;
        if (rooms[roomCode]) {
            rooms[roomCode].blockedTeam = blockedTeam; 
            rooms[roomCode].isLocked = false; 
            io.to(roomCode).emit('other_team_time_started', blockedTeam);
        }
    });

    socket.on('timer_10s_finished', (roomCode) => {
        if (rooms[roomCode]) {
            rooms[roomCode].blockedTeam = null; 
            rooms[roomCode].isLocked = true; 
            // التعديل: تسجيل حالة انتهاء الوقت
            rooms[roomCode].currentWinner = 'timeout';
            io.to(roomCode).emit('time_locked'); 
        }
    });

    socket.on('reset', (data) => {
        const { roomCode, isNewQuestion } = data;
        if (rooms[roomCode]) {
            rooms[roomCode].isLocked = false;
            rooms[roomCode].blockedTeam = null;
            rooms[roomCode].timersEnabled = isNewQuestion; 
            // التعديل: تصفير حالة الفائز
            rooms[roomCode].currentWinner = null;
            io.to(roomCode).emit('clear_buzzers');
        }
    });

    // التعديل الأهم: أمر التزامن المباشر للّاعبين عند عودتهم للصفحة
    socket.on('request_sync', (roomCode) => {
        if (rooms[roomCode]) {
            const room = rooms[roomCode];
            
            socket.emit('update_players', room.players);

            if (room.currentWinner === 'timeout') {
                socket.emit('time_locked');
            } else if (room.blockedTeam !== null) {
                socket.emit('other_team_time_started', room.blockedTeam);
            } else if (room.currentWinner) {
                socket.emit('declare_winner', { ...room.currentWinner, timersEnabled: room.timersEnabled });
            } else {
                socket.emit('clear_buzzers');
            }
        }
    });

    socket.on('disconnect', () => {
        for (let code in rooms) {
            if (rooms[code].hostSocket === socket.id) {
                rooms[code].timer = setTimeout(() => {
                    io.to(code).emit('room_closed');
                    delete rooms[code];
                }, 10 * 60 * 1000);
            }
        }
    });
});

http.listen(3000, '0.0.0.0', () => console.log(`Ready To Go`));