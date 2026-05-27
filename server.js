const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Мідлварі для парсингу JSON та роздачі статики (CSS)
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// Переконайся, що твій style.css лежить у папці public/css/style.css

// Імітація бази даних у пам'яті сервера для статистики
let dbStats = { wins: 0, losses: 0 };

app.get('/api/stats', (req, res) => {
    res.json(dbStats);
});

app.post('/api/stats/update', (req, res) => {
    const { result } = req.body;
    if (result === 'win') dbStats.wins++;
    if (result === 'loss') dbStats.losses++;
    res.json({ success: true, stats: dbStats });
});

// Роздаємо головну сторінку
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Логіка Socket.io для кімнат
const rooms = {};

io.on('connection', (socket) => {
    console.log(`Клієнт підключився: ${socket.id}`);

    socket.on('joinOnlineRoom', (roomId) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = { p1: socket.id, p2: null, readyCount: 0 };
            socket.emit('playerAssignment', { playerNum: 1 });
            console.log(`Гравець 1 створив кімнату: ${roomId}`);
        } else if (!rooms[roomId].p2) {
            rooms[roomId].p2 = socket.id;
            socket.emit('playerAssignment', { playerNum: 2 });
            io.to(roomId).emit('gameStarted');
            console.log(`Гравець 2 приєднався до кімнати: ${roomId}`);
        }
    });

    socket.on('makeShot', (data) => {
        // Пересилаємо постріл супротивнику у кімнаті
        socket.to(data.roomId).emit('enemyShotAttempt', { r: data.r, c: data.c });
    });

    socket.on('shareShotResult', (data) => {
        // Повертаємо результат пострілу автору пострілу
        socket.to(data.roomId).emit('enemyShotResult', {
            r: data.r,
            c: data.c,
            result: data.result,
            isSunk: data.isSunk
        });
    });

    socket.on('disconnect', () => {
        console.log(`Клієнт відключився: ${socket.id}`);
        // Пошук кімнати, яку треба закрити через дисконект
        for (const roomId in rooms) {
            if (rooms[roomId].p1 === socket.id || rooms[roomId].p2 === socket.id) {
                socket.to(roomId).emit('enemyDisconnected');
                delete rooms[roomId];
                break;
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Сервер симулятора запущено на http://localhost:${PORT}`);
});
