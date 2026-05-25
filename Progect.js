const BOARD_SIZE = 10;
const LETTERS = ["А","Б","В","Г","Д","Е","Є","Ж","З","И"];
const SHIP_SIZES = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];

let socket = null;
let gameMode = 'bot';
let myNumber = 1;
let currentRoomId = '';

let playerBoard, enemyBoard, playerShips, enemyShips;
let isPlayerTurn = true, isGameOver = false;

// Стадія розставлення флоту
let isPlacementPhase = false;
let currentShipIndex = 0;
let placementDirection = 'H'; // 'H' - горизонтально, 'V' - вертикально

// Змінні для ШІ
let compHunting = false, compHits = [], compNextTargets = [];

function updateStatsDisplay() {
    fetch('/api/stats')
        .then(res => res.json())
        .then(data => {
            document.getElementById('stats-display').innerText = `Перемог: ${data.wins} | Програшів: ${data.losses}`;
        }).catch(() => {
        document.getElementById('stats-display').innerText = `Офлайн режим (сервер не підключено)`;
    });
}
updateStatsDisplay();

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    if(screenId === 'menu-screen') updateStatsDisplay();
}

function exitToMenu() {
    if(socket) { socket.disconnect(); socket = null; }
    showScreen('menu-screen');
}

// Налаштування напрямку розставлення кораблів
function setPlacementDirection(dir) {
    placementDirection = dir;
    document.getElementById('dir-h-btn').classList.toggle('active', dir === 'H');
    document.getElementById('dir-v-btn').classList.toggle('active', dir === 'V');
}

// Оновлення текстової інструкції на екрані
function updatePlacementInstruction() {
    if (currentShipIndex < SHIP_SIZES.length) {
        const size = SHIP_SIZES[currentShipIndex];
        document.getElementById('placement-instruction').innerText = `Встановіть ${size}-палубний корабель (${currentShipIndex + 1}/${SHIP_SIZES.length})`;
    }
}

// Ініціалізація матриць перед початком будь-якої гри
function initEmptyBoards() {
    playerBoard = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill('.'));
    enemyBoard = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill('.'));
    playerShips = [];
    enemyShips = [];
    currentShipIndex = 0;
    isGameOver = false;
}

// --- СТАРТ ГРИ ПРОТИ ШІ ---
function startBotGame() {
    gameMode = 'bot';
    isPlayerTurn = true;
    isPlacementPhase = true;
    placementDirection = 'H';

    document.getElementById('game-mode-title').innerText = "Локальна симуляція (Підготовка флоту)";
    document.getElementById('status-text').innerText = "Стратегічне розгортання сил...";

    document.getElementById('placement-controls').style.display = 'block';
    document.getElementById('enemy-board-wrapper').style.display = 'none';
    setPlacementDirection('H');
    updatePlacementInstruction();

    initEmptyBoards();
    enemyShips = generateFleetRandomly(enemyBoard); // ШІ розставляє флот одразу

    renderBoards();
    showScreen('game-screen');
}

// --- СТАРТ МЕРЕЖЕВОЇ ГРИ ---
function showOnlineSetup() {
    const newRoomId = 'room-' + Math.random().toString(36).substr(2, 4);
    document.getElementById('generated-room-id').innerText = newRoomId;
    document.getElementById('room-input-code').value = '';
    showScreen('online-screen');
}

function createAndConnectRoom() {
    const roomId = document.getElementById('generated-room-id').innerText;
    startOnlineGame(roomId);
}

function connectToExistingRoom() {
    const roomId = document.getElementById('room-input-code').value.trim();
    if(!roomId) return alert("Введіть ідентифікатор лобі!");
    startOnlineGame(roomId);
}

function startOnlineGame(roomId) {
    gameMode = 'online';
    isPlacementPhase = true; // Тепер в онлайні теж є фаза розставлення кораблів!
    currentRoomId = roomId;
    socket = io();

    document.getElementById('placement-controls').style.display = 'block';
    document.getElementById('enemy-board-wrapper').style.display = 'none';
    document.getElementById('game-mode-title').innerText = "Мережева гра (Підготовка флоту)";
    document.getElementById('status-text').innerText = "З'єднання із сервером...";

    setPlacementDirection('H');
    updatePlacementInstruction();
    initEmptyBoards();
    renderBoards();
    showScreen('game-screen');

    socket.emit('joinOnlineRoom', currentRoomId);

    socket.on('playerAssignment', (data) => {
        myNumber = data.playerNum;
        isPlayerTurn = (myNumber === 1);
        document.getElementById('status-text').innerText = "Очікування підключення супротивника для початку розстановки...";
    });

    socket.on('gameStarted', () => {
        // Коли обидва гравці підключилися, даємо їм розставити кораблі
        document.getElementById('status-text').innerText = "Супротивник на місці. Розставте свої кораблі!";
    });

    // Очікування пострілів від ворога
    socket.on('enemyShotAttempt', ({ r, c }) => {
        let cellState = playerBoard[r][c];
        let result = 'miss';
        let isSunk = false;

        if (cellState === 'S') {
            playerBoard[r][c] = 'X';
            result = 'hit';
            isSunk = checkShipSunkInternal(playerBoard, playerShips, r, c);
        } else if (cellState === '.') {
            playerBoard[r][c] = 'M';
        }

        renderBoards();
        socket.emit('shareShotResult', { roomId: currentRoomId, r, c, result, isSunk });

        if (result === 'miss') {
            isPlayerTurn = true;
            document.getElementById('status-text').innerText = "Ваш хід";
        } else {
            document.getElementById('status-text').innerText = "Супротивник атакує знову";
            if (checkWinConditions(playerShips)) sendGameResultToDB('loss');
        }
    });

    // Результат нашого пострілу
    socket.on('enemyShotResult', ({ r, c, result, isSunk }) => {
        if (result === 'hit') {
            enemyBoard[r][c] = isSunk ? 'K' : 'X';
            if(isSunk) markSunkVisualAround(enemyBoard, r, c);
            document.getElementById('status-text').innerText = isSunk ? "Ціль знищено!" : "Влучання!";
            if (countKCells(enemyBoard) === 20) sendGameResultToDB('win');
        } else {
            enemyBoard[r][c] = 'M';
            isPlayerTurn = false;
            document.getElementById('status-text').innerText = "Хід супротивника";
        }
        renderBoards();
    });

    socket.on('enemyDisconnected', () => {
        if(!isGameOver) {
            alert("Супротивник розірвав з'єднання. Вам зараховано перемогу.");
            sendGameResultToDB('win');
        }
    });
}

// --- ЗАГАЛЬНИЙ КЛІК ПО ВЛАСНОМУ ПОЛЮ (ДЛЯ РОЗСТАВЛЕННЯ) ---
function handlePlayerBoardClick(r, c) {
    if (!isPlacementPhase) return;

    const size = SHIP_SIZES[currentShipIndex];

    if (isValidPosition(playerBoard, r, c, size, placementDirection)) {
        let coords = [];
        for (let i = 0; i < size; i++) {
            let nr = r + (placementDirection === 'V' ? i : 0);
            let nc = c + (placementDirection === 'H' ? i : 0);
            playerBoard[nr][nc] = 'S';
            coords.push({ r: nr, c: nc });
        }
        playerShips.push({ coords, hits: 0, sunk: false });

        currentShipIndex++;

        if (currentShipIndex >= SHIP_SIZES.length) {
            endPlacementPhaseAndStartBattle();
        } else {
            updatePlacementInstruction();
        }
        renderBoards();
    } else {
        alert("Недопустима позиція! Кораблі не повинні перетинатися чи торкатися один одного.");
    }
}

// Кнопка випадкового розставлення
function autoPlaceRemaining() {
    if (!isPlacementPhase) return;
    playerBoard = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill('.'));
    playerShips = generateFleetRandomly(playerBoard);
    endPlacementPhaseAndStartBattle();
}

function endPlacementPhaseAndStartBattle() {
    isPlacementPhase = false;
    document.getElementById('placement-controls').style.display = 'none';
    document.getElementById('enemy-board-wrapper').style.display = 'block';

    if (gameMode === 'bot') {
        document.getElementById('game-mode-title').innerText = "Локальна симуляція (Бій)";
        document.getElementById('status-text').innerText = "Ваш хід. Стріляйте по ворожому радару.";
    } else {
        document.getElementById('game-mode-title').innerText = "Мережева операція (Бій)";
        document.getElementById('status-text').innerText = isPlayerTurn ? "Ваш хід" : "Хід супротивника";
        // Повідомляємо сервер, що ми готові до бою (передаємо координати флоту за потреби)
        socket.emit('playerReady', { roomId: currentRoomId });
    }
    renderBoards();
}

// --- КЛІК ПО ВОРОЖОМУ ПОЛЮ (АТАКА В БОЮ) ---
function handleCellClick(r, c) {
    if (isPlacementPhase || !isPlayerTurn || isGameOver || enemyBoard[r][c] === 'X' || enemyBoard[r][c] === 'M' || enemyBoard[r][c] === 'K') return;

    if (gameMode === 'online') {
        // Щоб гравець не клікав двічі під час пінгу, блокуємо хід локально до відповіді сервера
        isPlayerTurn = false;
        socket.emit('makeShot', { roomId: currentRoomId, r, c });
    } else {
        if (enemyBoard[r][c] === '.') {
            enemyBoard[r][c] = 'M';
            document.getElementById('status-text').innerText = "Промах";
            isPlayerTurn = false;
            renderBoards();
            setTimeout(robotTurnLogic, 600);
        } else if (enemyBoard[r][c] === 'S') {
            enemyBoard[r][c] = 'X';
            let sunk = checkShipSunkInternal(enemyBoard, enemyShips, r, c);
            if (checkWinConditions(enemyShips)) {
                sendGameResultToDB('win');
            } else {
                document.getElementById('status-text').innerText = sunk ? "Ціль знищено!" : "Влучання!";
                renderBoards();
            }
        }
    }
}

// Логіка штучного інтелекту
function robotTurnLogic() {
    if (isGameOver) return;
    let r, c;
    if (compHunting && compNextTargets.length > 0) {
        let target = compNextTargets.shift(); r = target.r; c = target.c;
    } else {
        do {
            r = Math.floor(Math.random() * BOARD_SIZE); c = Math.floor(Math.random() * BOARD_SIZE);
        } while (playerBoard[r][c] === 'X' || playerBoard[r][c] === 'M' || playerBoard[r][c] === 'K');
    }

    if (playerBoard[r][c] === '.' || playerBoard[r][c] === 'M') {
        playerBoard[r][c] = 'M';
        document.getElementById('status-text').innerText = "Ваш хід";
        isPlayerTurn = true;
        renderBoards();
    } else if (playerBoard[r][c] === 'S') {
        playerBoard[r][c] = 'X';
        compHits.push({r, c}); compHunting = true;
        let sunk = checkShipSunkInternal(playerBoard, playerShips, r, c);

        if (sunk) {
            compHunting = false; compHits = []; compNextTargets = [];
        } else {
            let dirs = [{r:-1,c:0}, {r:1,c:0}, {r:0,c:-1}, {r:0,c:1}];
            dirs.forEach(d => {
                let nr = r + d.r, nc = c + d.c;
                if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                    if (playerBoard[nr][nc] === '.' || playerBoard[nr][nc] === 'S') compNextTargets.push({r: nr, c: nc});
                }
            });
        }
        if (checkWinConditions(playerShips)) {
            sendGameResultToDB('loss');
        } else {
            renderBoards();
            setTimeout(robotTurnLogic, 600);
        }
    }
}

function sendGameResultToDB(outcome) {
    isGameOver = true;
    document.getElementById('status-text').innerText = outcome === 'win' ? "Операція успішна (Перемога)" : "Операція провалена (Поразка)";

    fetch('/api/stats/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result: outcome })
    }).then(() => { if(socket) socket.disconnect(); });
}

// --- МАТЕМАТИЧНА СИСТЕМНА ЛОГІКА НА КАРТІ ---
function generateFleetRandomly(board) {
    let fleet = [];
    SHIP_SIZES.forEach(size => {
        let placed = false;
        while (!placed) {
            let dir = Math.random() < 0.5 ? 'H' : 'V';
            let r = Math.floor(Math.random() * BOARD_SIZE), c = Math.floor(Math.random() * BOARD_SIZE);
            if (isValidPosition(board, r, c, size, dir)) {
                let coords = [];
                for (let i = 0; i < size; i++) {
                    let nr = r + (dir === 'V' ? i : 0), nc = c + (dir === 'H' ? i : 0);
                    board[nr][nc] = 'S'; coords.push({r: nr, c: nc});
                }
                fleet.push({ coords, hits: 0, sunk: false }); placed = true;
            }
        }
    });
    return fleet;
}

function isValidPosition(board, r, c, size, dir) {
    for (let i = 0; i < size; i++) {
        let nr = r + (dir === 'V' ? i : 0), nc = c + (dir === 'H' ? i : 0);
        if (nr >= BOARD_SIZE || nc >= BOARD_SIZE) return false;
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                let cr = nr + dr, cc = nc + dc;
                if (cr >= 0 && cr < BOARD_SIZE && cc >= 0 && cc < BOARD_SIZE && board[cr][cc] === 'S') return false;
            }
        }
    }
    return true;
}

function checkShipSunkInternal(board, fleet, r, c) {
    for (let ship of fleet) {
        if (ship.coords.some(co => co.r === r && co.c === c)) {
            ship.hits++;
            if (ship.hits === ship.coords.length) {
                ship.sunk = true;
                ship.coords.forEach(co => {
                    board[co.r][co.c] = 'K';
                    for (let dr = -1; dr <= 1; dr++) {
                        for (let dc = -1; dc <= 1; dc++) {
                            let nr = co.r + dr, nc = co.c + dc;
                            if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === '.') board[nr][nc] = 'M';
                        }
                    }
                });
                return true;
            }
            return false;
        }
    }
    return false;
}

function markSunkVisualAround(board, startR, startC) {
    board[startR][startC] = 'K';
    for(let dr=-1; dr<=1; dr++){
        for(let dc=-1; dc<=1; dc++){
            let nr = startR+dr, nc = startC+dc;
            if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] === '.') board[nr][nc] = 'M';
        }
    }
}

function countKCells(board) {
    let count = 0;
    for(let r=0; r<BOARD_SIZE; r++)
        for(let c=0; c<BOARD_SIZE; c++) if(board[r][c] === 'K') count++;
    return count;
}

function checkWinConditions(fleet) { return fleet.every(s => s.sunk); }

function renderGridElements(gridId, boardData, isEnemy) {
    const grid = document.getElementById(gridId);
    grid.innerHTML = '';

    if (!isEnemy && isPlacementPhase) {
        grid.className = "grid player-board placing-mode";
    } else if (!isEnemy) {
        grid.className = "grid player-board";
    } else {
        grid.className = "grid enemy-board";
    }

    const corner = document.createElement('div'); corner.className = 'cell label'; grid.appendChild(corner);
    for (let i = 0; i < BOARD_SIZE; i++) {
        const l = document.createElement('div'); l.className = 'cell label'; l.innerText = LETTERS[i]; grid.appendChild(l);
    }
    for (let r = 0; r < BOARD_SIZE; r++) {
        const num = document.createElement('div'); num.className = 'cell label'; num.innerText = r + 1; grid.appendChild(num);
        for (let c = 0; c < BOARD_SIZE; c++) {
            const cell = document.createElement('div'); cell.className = 'cell game-cell';
            if (boardData[r][c] === 'S' && !isEnemy) cell.classList.add('ship');
            if (boardData[r][c] === 'X') cell.classList.add('hit');
            if (boardData[r][c] === 'M') cell.classList.add('miss');
            if (boardData[r][c] === 'K') cell.classList.add('sunk');

            if (isEnemy && !isGameOver && !isPlacementPhase) {
                cell.addEventListener('click', () => handleCellClick(r, c));
            } else if (!isEnemy && isPlacementPhase) {
                cell.addEventListener('click', () => handlePlayerBoardClick(r, c));
            }
            grid.appendChild(cell);
        }
    }
}

function renderBoards() {
    renderGridElements('player-board', playerBoard, false);
    renderGridElements('enemy-board', enemyBoard, true);
}
