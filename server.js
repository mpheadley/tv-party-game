const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const QRCode = require('qrcode');
const crypto = require('crypto');

// Import modules
const gameLogic = require('./src/game-logic');
const scoring = require('./src/scoring');
const hotTakeMode = require('./src/modes/hot-take');
const promptsModule = require('./src/prompts');
const settingsModule = require('./src/settings');
const teamsModule = require('./src/teams');
const speedDrawingMode = require('./src/modes/speed-drawing');
const pictionaryMode = require('./src/modes/pictionary');
const { ReconnectionManager, handlePlayerDisconnect, handlePlayerReconnect } = require('./src/reconnection-handler');
const nightFallsMode = require('./src/modes/night-falls');
const { createBots } = require('./src/bots');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

// Root serves the landing page (index.html) via express.static — no redirect needed

const AVATARS = [
  '🦊', '🐸', '🦉', '🐙', '🦄', '🐲', '🦋', '🐢',
  '🦁', '🐧', '🦖', '🐬', '🦩', '🐨', '🦝', '🐝',
];

const ROOM_CLEANUP_DELAY = 300000; // 5 minutes after empty before deleting room

// ── Room Management ──
const rooms = {};        // { roomCode: { room state } }
const tokenToRoom = {};  // { token: roomCode }

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // No I or O (ambiguous)
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms[code]);
  return code;
}

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

function createRoom(code) {
  const game = gameLogic.createGameState();
  const customPrompts = promptsModule.loadCustomPrompts();
  game.customSettings.customPromptList = customPrompts;

  // Extend game state with room-specific fields
  game.code = code;
  game.playersByToken = {};   // { token: { name, score, avatar, socketId, disconnectTimer, sessionStartTime } }
  game.cleanupTimer = null;
  game.customPrompts = customPrompts;
  game.reconnectionManager = new ReconnectionManager();

  // Attach team scoreboard helper
  game._getTeamScoreboard = () => teamsModule.getTeamScoreboard(game.teams);

  rooms[code] = game;
  console.log(`Room ${code} created`);
  return game;
}

function getRoom(code) {
  return rooms[code] || null;
}

function deleteRoom(code) {
  const room = rooms[code];
  if (!room) return;
  clearTimeout(room.roundTimer);
  clearTimeout(room.cleanupTimer);
  if (room.reconnectionManager) room.reconnectionManager.destroy();
  // Clean up bots
  if (activeBots[code]) {
    activeBots[code].cleanup();
    delete activeBots[code];
  }
  // Clean up token mappings
  for (const token of Object.keys(room.playersByToken)) {
    delete tokenToRoom[token];
  }
  delete rooms[code];
  console.log(`Room ${code} deleted`);
}

function scheduleRoomCleanup(code) {
  const room = rooms[code];
  if (!room) return;
  clearTimeout(room.cleanupTimer);
  room.cleanupTimer = setTimeout(() => {
    if (Object.keys(room.players).length === 0 && !room.tvSocket) {
      deleteRoom(code);
    }
  }, ROOM_CLEANUP_DELAY);
}

// ── REST API Endpoints ──

app.post('/api/create-room', (req, res) => {
  const code = generateRoomCode();
  const room = createRoom(code);
  // Test mode: skip player minimums (pass ?test=1 from client)
  if (req.query.test === '1') {
    room.testMode = true;
    console.log(`Room ${code} created in TEST MODE (no player minimums)`);
  }
  res.json({ code });
});

app.get('/api/room/:code', (req, res) => {
  const room = getRoom(req.params.code.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({
    code: room.code,
    phase: room.phase,
    playerCount: Object.keys(room.players).length,
  });
});

// ── Bot Management ──
const activeBots = {}; // { roomCode: { bots, cleanup } }

app.post('/api/add-bots', (req, res) => {
  const roomCode = (req.query.room || '').toUpperCase();
  const count = Math.max(1, Math.min(12, parseInt(req.query.count) || 3));

  const room = getRoom(roomCode);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.phase !== 'lobby') return res.status(400).json({ error: 'Game already in progress' });

  // Clean up any existing bots in this room
  if (activeBots[roomCode]) {
    activeBots[roomCode].cleanup();
    delete activeBots[roomCode];
  }

  const port = server.address()?.port || PORT;
  const serverUrl = `http://localhost:${port}`;
  const botGroup = createBots(serverUrl, roomCode, count);
  activeBots[roomCode] = botGroup;

  console.log(`[BOTS] Added ${count} bots to room ${roomCode}`);
  res.json({ added: count, room: roomCode, names: botGroup.bots.map(b => b.name) });
});

app.post('/api/remove-bots', (req, res) => {
  const roomCode = (req.query.room || '').toUpperCase();
  if (activeBots[roomCode]) {
    activeBots[roomCode].cleanup();
    delete activeBots[roomCode];
    console.log(`[BOTS] Removed bots from room ${roomCode}`);
    res.json({ removed: true, room: roomCode });
  } else {
    res.json({ removed: false, message: 'No bots in this room' });
  }
});

// ── Room Helper Functions ──

function getPlayerList(room) {
  return Object.entries(room.players).map(([id, p]) => ({
    id,
    name: p.name,
    score: p.score,
    avatar: p.avatar,
    team: p.team,
    teamName: p.team && room.teams[p.team] ? room.teams[p.team].name : null,
    teamColor: p.team && room.teams[p.team] ? room.teams[p.team].color : null,
  }));
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function pickAvatar(room) {
  const usedAvatars = Object.values(room.players).map(p => p.avatar);
  const available = AVATARS.filter(a => !usedAvatars.includes(a));
  return available.length > 0
    ? available[Math.floor(Math.random() * available.length)]
    : AVATARS[Math.floor(Math.random() * AVATARS.length)];
}

// Emit to all sockets in a room (TV + all players)
function emitToRoom(room, event, data) {
  if (room.tvSocket) {
    io.to(room.tvSocket).emit(event, data);
  }
  for (const playerId of Object.keys(room.players)) {
    io.to(playerId).emit(event, data);
  }
}

function migrateSocketId(room, oldId, newId) {
  if (room.answers[oldId]) {
    room.answers[newId] = room.answers[oldId];
    delete room.answers[oldId];
  }
  if (room.votes[oldId]) {
    room.votes[newId] = room.votes[oldId];
    delete room.votes[oldId];
  }
  for (const [voterId, answerId] of Object.entries(room.votes)) {
    if (answerId === oldId) {
      room.votes[voterId] = newId;
    }
  }
  if (room.hostSocket === oldId) {
    room.hostSocket = newId;
  }
}

// ── Socket Handlers ──
io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  // Track which room this socket belongs to
  let socketRoom = null;

  // TV connects
  socket.on('tv-connect', async (data) => {
    // Support both old format (string publicUrl) and new format ({ roomCode, publicUrl })
    const roomCode = typeof data === 'object' ? data.roomCode : null;
    const publicUrl = typeof data === 'object' ? data.publicUrl : data;

    const room = getRoom(roomCode);
    if (!room) {
      socket.emit('error-msg', 'Room not found');
      return;
    }

    socketRoom = roomCode;
    room.tvSocket = socket.id;
    clearTimeout(room.cleanupTimer);

    let qrDataUrl = null;
    if (publicUrl) {
      try {
        const phoneUrl = publicUrl + '/phone.html?room=' + roomCode;
        qrDataUrl = await QRCode.toDataURL(phoneUrl, { width: 200, margin: 1 });
      } catch (e) { /* QR generation failed */ }
    }

    socket.emit('game-state', {
      phase: room.phase,
      players: getPlayerList(room),
      ip: getLocalIP(),
      port: PORT,
      qrDataUrl,
      roomCode: room.code,
      customPrompts: room.customPrompts,
      testMode: room.testMode || false,
      settings: {
        roundTime: room.customSettings.roundTime,
        voteTime: room.customSettings.voteTime,
        totalRounds: room.customSettings.totalRounds,
        estimatedDuration: settingsModule.getEstimatedDuration(room.customSettings),
      },
    });

    // Notify players that TV is connected
    emitToRoom(room, 'tv-status', { connected: true });
  });

  // Player reconnects with token
  socket.on('reconnect-attempt', (data) => {
    const token = typeof data === 'object' ? data.token : data;
    const roomCode = typeof data === 'object' ? data.roomCode : tokenToRoom[token];

    const room = getRoom(roomCode);
    if (!room) {
      socket.emit('reconnect-failed');
      return;
    }

    const stored = room.playersByToken[token];
    if (!stored) {
      socket.emit('reconnect-failed');
      return;
    }

    // Cancel the disconnect grace timer
    if (stored.disconnectTimer) {
      clearTimeout(stored.disconnectTimer);
      stored.disconnectTimer = null;
    }
    if (room.reconnectionManager) {
      room.reconnectionManager.cancelGracePeriod(token);
    }

    const oldId = stored.socketId;
    const newId = socket.id;

    // Remove ghost entry
    if (oldId !== newId && room.players[oldId]) {
      delete room.players[oldId];
    }

    // Restore player
    room.players[newId] = { name: stored.name, score: stored.score, avatar: stored.avatar, token };
    stored.socketId = newId;
    socketRoom = roomCode;
    clearTimeout(room.cleanupTimer);

    if (oldId !== newId) {
      migrateSocketId(room, oldId, newId);
    }

    const isHost = room.hostSocket === newId;

    socket.emit('reconnected', {
      name: stored.name,
      avatar: stored.avatar,
      score: stored.score,
      token,
      isHost,
      phase: room.phase,
      roomCode: room.code,
    });

    // Send current phase data
    if (room.phase === 'prompt') {
      const alreadyAnswered = !!room.answers[newId];
      socket.emit('phase', {
        phase: 'prompt',
        prompt: room.currentPrompt,
        gameMode: room.gameMode,
        round: room.round,
        totalRounds: room.totalRounds,
        timeLimit: room.customSettings.roundTime,
      });
      if (alreadyAnswered) socket.emit('answer-received');
    } else if (room.phase === 'vote') {
      const answerList = Object.entries(room.answers)
        .map(([id, text]) => ({ id, text }))
        .sort(() => Math.random() - 0.5);
      const filtered = answerList.filter(a => a.id !== newId);
      socket.emit('phase', {
        phase: 'vote',
        answers: filtered,
        prompt: room.currentPrompt,
        gameMode: room.gameMode,
        round: room.round,
        totalRounds: room.totalRounds,
        timeLimit: room.customSettings.voteTime,
      });
      if (room.votes[newId]) socket.emit('vote-received');
    } else if (room.phase === 'results' || room.phase === 'gameover') {
      const scoreboard = getPlayerList(room).sort((a, b) => b.score - a.score);
      socket.emit('phase', { phase: room.phase, scoreboard, round: room.round, totalRounds: room.totalRounds });
    }

    emitToRoom(room, 'player-update', getPlayerList(room));
    console.log(`${stored.avatar} ${stored.name} reconnected to room ${roomCode}`);
  });

  // Player joins
  socket.on('join', (data) => {
    const name = typeof data === 'string' ? data : data?.name;
    const requestedAvatar = typeof data === 'object' ? data?.avatar : null;
    const teamId = typeof data === 'object' ? data?.team : null;
    const roomCode = typeof data === 'object' ? data?.roomCode : null;

    const room = getRoom(roomCode);
    if (!room) {
      socket.emit('error-msg', 'Room not found. Check the code and try again.');
      return;
    }

    if (room.phase !== 'lobby') {
      socket.emit('error-msg', 'Game already in progress! Wait for the next game.');
      return;
    }
    if (room.players[socket.id]) return;

    const cleanName = String(name).trim().slice(0, 20);
    if (!cleanName) return;

    const usedAvatars = Object.values(room.players).map(p => p.avatar);
    const avatar = (requestedAvatar && AVATARS.includes(requestedAvatar) && !usedAvatars.includes(requestedAvatar))
      ? requestedAvatar : pickAvatar(room);
    const token = generateToken();

    // Handle team assignment
    let assignedTeam = null;
    if (room.teamMode) {
      const targetTeamId = teamId || (teamsModule.getSmallestTeam(room.teams)?.id);
      if (targetTeamId && room.teams[targetTeamId]) {
        teamsModule.assignPlayerToTeam(room.teams, targetTeamId, socket.id);
        assignedTeam = targetTeamId;
      }
    }

    room.players[socket.id] = { name: cleanName, score: 0, avatar, token, team: assignedTeam };

    room.playersByToken[token] = {
      name: cleanName,
      score: 0,
      avatar,
      socketId: socket.id,
      disconnectTimer: null,
      sessionStartTime: Date.now(),
    };
    tokenToRoom[token] = roomCode;

    socketRoom = roomCode;
    clearTimeout(room.cleanupTimer);

    const isHost = !room.hostSocket;
    if (isHost) room.hostSocket = socket.id;

    socket.emit('joined', { name: cleanName, avatar, isHost, token, team: assignedTeam, roomCode: room.code, testMode: room.testMode || false });
    emitToRoom(room, 'player-update', getPlayerList(room));
    emitToRoom(room, 'sound', 'join');
    console.log(`${avatar} ${cleanName} joined room ${roomCode}${isHost ? ' (host)' : ''}${assignedTeam ? ` (${room.teams[assignedTeam]?.name})` : ''}`);
  });

  // Update game settings
  socket.on('update-settings', (updates) => {
    const room = getRoom(socketRoom);
    if (!room) return;
    if (socket.id !== room.tvSocket && socket.id !== room.hostSocket) return;
    if (room.phase !== 'lobby') {
      socket.emit('error-msg', 'Can only change settings in lobby');
      return;
    }

    const { settings, changed } = settingsModule.updateSettings(room.customSettings, updates);
    if (changed) {
      room.customSettings = settings;
      room.totalRounds = settings.totalRounds;
      emitToRoom(room, 'settings-updated', {
        roundTime: settings.roundTime,
        voteTime: settings.voteTime,
        totalRounds: settings.totalRounds,
        estimatedDuration: settingsModule.getEstimatedDuration(settings),
      });
      console.log(`Room ${socketRoom} settings updated:`, settings);
    }
  });

  // Add custom prompt
  socket.on('add-custom-prompt', (text) => {
    const room = getRoom(socketRoom);
    if (!room) return;
    if (socket.id !== room.tvSocket && socket.id !== room.hostSocket) return;
    if (room.phase !== 'lobby') {
      socket.emit('error-msg', 'Can only manage prompts in lobby');
      return;
    }

    const added = promptsModule.addCustomPrompt(room.customPrompts, text);
    if (added) {
      promptsModule.saveCustomPrompts(room.customPrompts);
      room.customSettings.customPromptList = room.customPrompts;
      emitToRoom(room, 'custom-prompts-update', room.customPrompts);
      socket.emit('prompt-added', added);
    } else {
      socket.emit('error-msg', 'Invalid prompt (must be 5-200 chars, not a duplicate, max 50)');
    }
  });

  // Remove custom prompt
  socket.on('remove-custom-prompt', (index) => {
    const room = getRoom(socketRoom);
    if (!room) return;
    if (socket.id !== room.tvSocket && socket.id !== room.hostSocket) return;
    if (room.phase !== 'lobby') {
      socket.emit('error-msg', 'Can only manage prompts in lobby');
      return;
    }

    const removed = promptsModule.removeCustomPrompt(room.customPrompts, index);
    if (removed) {
      promptsModule.saveCustomPrompts(room.customPrompts);
      room.customSettings.customPromptList = room.customPrompts;
      emitToRoom(room, 'custom-prompts-update', room.customPrompts);
      socket.emit('prompt-removed');
    } else {
      socket.emit('error-msg', 'Invalid prompt index');
    }
  });

  // Set game mode
  socket.on('set-game-mode', (mode) => {
    const room = getRoom(socketRoom);
    if (!room) return;
    if (socket.id !== room.tvSocket && socket.id !== room.hostSocket) return;
    if (room.phase !== 'lobby') return;

    const validModes = ['hot-take', 'speed-drawing', 'pictionary', 'night-falls'];
    if (validModes.includes(mode)) {
      room.gameMode = mode;
      emitToRoom(room, 'game-mode-updated', mode);
      console.log(`Room ${socketRoom} mode set to: ${mode}`);
    }
  });

  // Toggle team mode
  socket.on('set-team-mode', (data) => {
    const room = getRoom(socketRoom);
    if (!room) return;
    if (socket.id !== room.tvSocket && socket.id !== room.hostSocket) return;
    if (room.phase !== 'lobby') return;

    const teamMode = Boolean(data.teamMode);
    const teamCount = Math.max(2, Math.min(6, parseInt(data.teamCount) || 2));

    if (room.teamMode !== teamMode || (teamMode && Object.keys(room.teams).length !== teamCount)) {
      room.teamMode = teamMode;
      if (teamMode) {
        room.teams = teamsModule.createTeams(teamCount);
      } else {
        room.teams = {};
      }
      emitToRoom(room, 'team-mode-updated', { teamMode, teamCount, teams: room.teams });
    }
  });

  // Start game
  socket.on('start-game', (data) => {
    const room = getRoom(socketRoom);
    if (!room) return;
    if (socket.id !== room.tvSocket && socket.id !== room.hostSocket) return;
    console.log(`[GAME] START — mode=${room.gameMode}, players=${Object.keys(room.players).length}, rounds=${data}`);

    const playerCount = Object.keys(room.players).length;
    const testMode = room.testMode || false;

    // Night Falls requires 5+ players (unless test mode)
    if (room.gameMode === 'night-falls') {
      if (!testMode && playerCount < 5) {
        socket.emit('error-msg', 'Night Falls needs at least 5 players!');
        return;
      }
      if (playerCount > 16) {
        socket.emit('error-msg', 'Night Falls supports up to 16 players!');
        return;
      }
      startNightFallsGame(room, data);
      return;
    }

    // Other modes: 3+ players (unless test mode)
    if (!testMode && playerCount < 3) {
      socket.emit('error-msg', 'Need at least 3 players!');
      return;
    }

    const rounds = typeof data === 'number' ? data : data?.rounds;
    const validRounds = [5, 10, 15];
    if (validRounds.includes(rounds)) {
      room.customSettings.totalRounds = rounds;
      room.totalRounds = rounds;
    }
    emitToRoom(room, 'sound', 'round-start');

    if (room.gameMode === 'pictionary') {
      room.currentDrawer = pictionaryMode.assignDrawer(room, teamsModule);
    }

    let pickPromptFn;
    if (room.gameMode === 'speed-drawing') {
      pickPromptFn = () => speedDrawingMode.pickPrompt(room, room.customPrompts);
    } else if (room.gameMode === 'pictionary') {
      pickPromptFn = () => pictionaryMode.pickWord(room, room.customPrompts);
    } else {
      pickPromptFn = () => promptsModule.pickPrompt(room, room.customPrompts);
    }

    // Use emitToRoom wrapper instead of io directly
    const roomIo = createRoomEmitter(room);
    gameLogic.startRound(room, pickPromptFn, roomIo);
  });

  // Player submits answer
  socket.on('answer', (data) => {
    const room = getRoom(socketRoom);
    if (!room) return;
    if (room.phase !== 'prompt') {
      console.log(`[ANSWER] REJECTED — phase is '${room.phase}', not 'prompt' (player=${room.players[socket.id]?.name})`);
      return;
    }
    const playerName = room.players[socket.id]?.name || socket.id;
    const dataType = typeof data === 'string' && data.startsWith('data:image') ? 'drawing' : 'text';
    console.log(`[ANSWER] ${playerName} submitted ${dataType} (mode=${room.gameMode}, round=${room.round})`);

    if (room.gameMode === 'pictionary') {
      // In test mode, drawer submits drawing → store it and auto-advance
      if (socket.id === room.currentDrawer) {
        if (!room.testMode) return;
        room.drawings[socket.id] = data;
        socket.emit('answer-received');
        clearTimeout(room.roundTimer);
        const roomIo = createRoomEmitter(room);
        // In test mode with 1 player, skip voting (no guessers) and go to results
        if (Object.keys(room.players).length <= 1) {
          gameLogic.tallyAndShowResults(room, roomIo);
        } else {
          gameLogic.startVoting(room, roomIo);
        }
        return;
      }
      if (room.guesses[socket.id]) return;

      const guess = pictionaryMode.validateGuess(data);
      if (!guess) return;

      room.guesses[socket.id] = guess;
      socket.emit('answer-received');
      emitToRoom(room, 'sound', 'submit');

      const nonDrawerCount = Object.keys(room.players).length - 1;
      const guessedCount = Object.keys(room.guesses).length;

      const pendingGuess = Object.keys(room.players)
        .filter(id => id !== room.currentDrawer && !room.guesses[id])
        .map(id => room.players[id].name);
      emitToRoom(room, 'answer-progress', {
        answered: guessedCount,
        total: nonDrawerCount,
        pending: pendingGuess,
      });

      if (guessedCount >= nonDrawerCount) {
        clearTimeout(room.roundTimer);
        const roomIo = createRoomEmitter(room);
        gameLogic.startVoting(room, roomIo);
      }
    } else {
      if (room.answers[socket.id]) return;

      let answer = null;
      if (room.gameMode === 'speed-drawing') {
        const imageData = speedDrawingMode.validateDrawing(data);
        if (!imageData) return;
        answer = imageData;
        room.drawings[socket.id] = imageData;
      } else {
        const text = hotTakeMode.validateAnswer(data);
        if (!text) return;
        answer = text;
      }

      room.answers[socket.id] = answer;
      socket.emit('answer-received');
      emitToRoom(room, 'sound', 'submit');

      const pendingAnswer = Object.keys(room.players)
        .filter(id => !room.answers[id])
        .map(id => room.players[id].name);
      emitToRoom(room, 'answer-progress', {
        answered: Object.keys(room.answers).length,
        total: Object.keys(room.players).length,
        pending: pendingAnswer,
      });

      if (gameLogic.checkAllAnswered(room)) {
        console.log(`[ANSWER] ALL ANSWERED — ${Object.keys(room.answers).length}/${Object.keys(room.players).length}, advancing to vote`);
        clearTimeout(room.roundTimer);
        const roomIo = createRoomEmitter(room);
        gameLogic.startVoting(room, roomIo);
      }
    }
  });

  // Player votes
  socket.on('vote', (data) => {
    const room = getRoom(socketRoom);
    if (!room) return;
    if (room.phase !== 'vote') {
      console.log(`[VOTE] REJECTED — phase is '${room.phase}', not 'vote' (player=${room.players[socket.id]?.name})`);
      return;
    }
    console.log(`[VOTE] ${room.players[socket.id]?.name} voted (round=${room.round})`);

    if (room.gameMode === 'pictionary') {
      const guesserId = data.guesserId;
      const approved = Boolean(data.approved);

      if (socket.id !== room.currentDrawer) return;
      if (room.votes[guesserId]) return;
      if (!room.guesses[guesserId]) return;

      room.votes[guesserId] = approved ? 1 : 0;
      socket.emit('vote-received');

      emitToRoom(room, 'vote-progress', {
        voted: Object.keys(room.votes).length,
        total: Object.keys(room.guesses).length,
      });

      if (Object.keys(room.votes).length >= Object.keys(room.guesses).length) {
        let scoreRound;
        if (room.teamMode) {
          scoreRound = (game, voteCounts) => {
            for (const [guesserId, approved] of Object.entries(game.votes)) {
              if (approved) {
                teamsModule.scoreTeamRound(game.teams, guesserId, 1);
                if (game.players[guesserId]) {
                  game.players[guesserId].score += 1;
                  const token = game.players[guesserId].token;
                  if (token && game.playersByToken[token]) {
                    game.playersByToken[token].score = game.players[guesserId].score;
                  }
                }
                teamsModule.scoreTeamRound(game.teams, game.currentDrawer, 1);
                if (game.players[game.currentDrawer]) {
                  game.players[game.currentDrawer].score += 1;
                  const token = game.players[game.currentDrawer].token;
                  if (token && game.playersByToken[token]) {
                    game.playersByToken[token].score = game.players[game.currentDrawer].score;
                  }
                }
              }
            }
          };
        } else {
          scoreRound = (game, voteCounts) => {
            for (const [guesserId, approved] of Object.entries(game.votes)) {
              if (approved) {
                if (game.players[guesserId]) {
                  game.players[guesserId].score += 1;
                  const token = game.players[guesserId].token;
                  if (token && game.playersByToken[token]) {
                    game.playersByToken[token].score = game.players[guesserId].score;
                  }
                }
                if (game.players[game.currentDrawer]) {
                  game.players[game.currentDrawer].score += 1;
                  const token = game.players[game.currentDrawer].token;
                  if (token && game.playersByToken[token]) {
                    game.playersByToken[token].score = game.players[game.currentDrawer].score;
                  }
                }
              }
            }
          };
        }

        const roomIo = createRoomEmitter(room);
        gameLogic.tallyAndShowResults(room, roomIo, scoreRound);
      }
    } else {
      if (room.votes[socket.id]) return;
      if (data === socket.id) {
        socket.emit('error-msg', "Can't vote for your own answer!");
        return;
      }
      if (!room.answers[data]) return;

      room.votes[socket.id] = data;
      socket.emit('vote-received');

      const pendingVote = Object.keys(room.players)
        .filter(id => !room.votes[id])
        .map(id => room.players[id].name);
      emitToRoom(room, 'vote-progress', {
        voted: Object.keys(room.votes).length,
        total: Object.keys(room.players).length,
        pending: pendingVote,
      });

      if (gameLogic.checkAllVoted(room)) {
        console.log(`[VOTE] ALL VOTED — ${Object.keys(room.votes).length}/${Object.keys(room.players).length}, advancing to results`);
        const scorer = scoring.getScorerForMode(room.gameMode);
        let scoreRound;

        if (room.teamMode) {
          scoreRound = (game, voteCounts) => {
            for (const [answerId, count] of Object.entries(voteCounts)) {
              teamsModule.scoreTeamRound(game.teams, answerId, count);
              if (game.players[answerId]) {
                game.players[answerId].score += count;
                const token = game.players[answerId].token;
                if (token && game.playersByToken[token]) {
                  game.playersByToken[token].score = game.players[answerId].score;
                }
              }
            }
          };
        } else {
          scoreRound = (game, voteCounts) => scorer(game, voteCounts, game.playersByToken);
        }

        const roomIo = createRoomEmitter(room);
        gameLogic.tallyAndShowResults(room, roomIo, scoreRound);
      }
    }
  });

  // Next round
  socket.on('next-round', () => {
    const room = getRoom(socketRoom);
    if (!room) return;
    if (socket.id !== room.tvSocket && socket.id !== room.hostSocket) return;
    console.log(`[GAME] NEXT ROUND requested — current round=${room.round}, phase=${room.phase}`);

    if (room.round >= room.totalRounds) {
      const roomIo = createRoomEmitter(room);
      gameLogic.endGame(room, roomIo);
    } else {
      emitToRoom(room, 'sound', 'round-start');

      if (room.gameMode === 'pictionary') {
        room.currentDrawer = pictionaryMode.assignDrawer(room, teamsModule);
      }

      let pickPromptFn;
      if (room.gameMode === 'speed-drawing') {
        pickPromptFn = () => speedDrawingMode.pickPrompt(room, room.customPrompts);
      } else if (room.gameMode === 'pictionary') {
        pickPromptFn = () => pictionaryMode.pickWord(room, room.customPrompts);
      } else {
        pickPromptFn = () => promptsModule.pickPrompt(room, room.customPrompts);
      }

      const roomIo = createRoomEmitter(room);
      gameLogic.startRound(room, pickPromptFn, roomIo);
    }
  });

  // ── Night Falls Socket Events ──

  // Night action (werewolf vote, seer investigate, doctor protect, etc.)
  socket.on('night-action', (data) => {
    const room = getRoom(socketRoom);
    if (!room || !room.nfState || room.phase !== 'nf-night') return;
    const nf = room.nfState;
    const role = nf.roles[socket.id];
    if (!role || !nf.alive[socket.id]) return;

    switch (data.action) {
      case 'eliminate': // Werewolf
        if (role !== 'werewolf') return;
        if (!data.targetId || !nf.alive[data.targetId]) return;
        if (nf.roles[data.targetId] === 'werewolf') return; // Can't target own team
        nf.nightActions.werewolfVotes[socket.id] = data.targetId;
        // Broadcast wolf votes to other wolves
        const wolves = Object.keys(nf.roles).filter(id => nf.roles[id] === 'werewolf' && nf.alive[id]);
        for (const wolfId of wolves) {
          io.to(wolfId).emit('wolf-vote-update', {
            voterId: socket.id,
            voterName: room.players[socket.id]?.name,
            voterAvatar: room.players[socket.id]?.avatar,
            targetName: room.players[data.targetId]?.name,
          });
        }
        break;

      case 'investigate': // Seer
        if (role !== 'seer') return;
        if (!data.targetId || !nf.alive[data.targetId]) return;
        nf.nightActions.seerTarget = data.targetId;
        const targetRole = nf.roles[data.targetId];
        const alignment = targetRole === 'werewolf' ? 'evil' : 'good';
        socket.emit('investigation-result', {
          targetId: data.targetId,
          targetName: room.players[data.targetId]?.name,
          targetAvatar: room.players[data.targetId]?.avatar,
          alignment,
        });
        break;

      case 'protect': // Doctor or Bodyguard
        if (role !== 'doctor' && role !== 'bodyguard') return;
        if (!data.targetId || !nf.alive[data.targetId]) return;
        if (role === 'doctor') {
          if (data.targetId === nf.lastDoctorTarget) {
            socket.emit('error-msg', "Can't protect the same player twice in a row!");
            return;
          }
          nf.nightActions.doctorTarget = data.targetId;
        } else {
          nf.nightActions.bodyguardTarget = data.targetId;
        }
        socket.emit('action-confirmed', { action: 'protect', targetName: room.players[data.targetId]?.name });
        break;

      case 'witch-heal':
        if (role !== 'witch' || nf.witchHealUsed) return;
        nf.nightActions.witchHeal = true;
        socket.emit('action-confirmed', { action: 'witch-heal' });
        break;

      case 'witch-kill':
        if (role !== 'witch' || nf.witchKillUsed) return;
        if (!data.targetId || !nf.alive[data.targetId]) return;
        nf.nightActions.witchKill = data.targetId;
        socket.emit('action-confirmed', { action: 'witch-kill', targetName: room.players[data.targetId]?.name });
        break;

      case 'witch-skip':
        if (role !== 'witch') return;
        socket.emit('action-confirmed', { action: 'witch-skip' });
        break;

      case 'pair-lovers': // Cupid
        if (role !== 'cupid' || nf.nightNumber !== 1 || nf.cupidLovers) return;
        if (!data.lover1 || !data.lover2 || data.lover1 === data.lover2) return;
        if (!nf.alive[data.lover1] || !nf.alive[data.lover2]) return;
        nf.nightActions.cupidPair = [data.lover1, data.lover2];
        socket.emit('action-confirmed', {
          action: 'pair-lovers',
          lover1: room.players[data.lover1]?.name,
          lover2: room.players[data.lover2]?.name,
        });
        // Notify the lovers
        io.to(data.lover1).emit('lover-paired', {
          loverId: data.lover2,
          loverName: room.players[data.lover2]?.name,
          loverAvatar: room.players[data.lover2]?.avatar,
        });
        io.to(data.lover2).emit('lover-paired', {
          loverId: data.lover1,
          loverName: room.players[data.lover1]?.name,
          loverAvatar: room.players[data.lover1]?.avatar,
        });
        break;
    }

    // Check if all night actions are in
    if (nightFallsMode.checkAllNightActionsSubmitted(nf)) {
      clearTimeout(room.roundTimer);
      resolveNightPhase(room);
    }
  });

  // Day vote
  socket.on('day-vote', (data) => {
    const room = getRoom(socketRoom);
    if (!room || !room.nfState || room.phase !== 'nf-day-vote') return;
    const nf = room.nfState;
    if (!nf.alive[socket.id]) return;
    if (nf.dayVotes[socket.id] !== undefined) return;

    const targetId = data.targetId || 'skip';
    if (targetId !== 'skip') {
      if (!nf.alive[targetId] || targetId === socket.id) return;
    }

    nf.dayVotes[socket.id] = targetId;
    socket.emit('vote-received');
    emitToRoom(room, 'sound', 'submit');

    // Broadcast progress
    const aliveCount = Object.keys(nf.alive).filter(id => nf.alive[id]).length;
    const votedCount = Object.keys(nf.dayVotes).length;
    emitToRoom(room, 'nf-vote-progress', { voted: votedCount, total: aliveCount });

    if (nightFallsMode.checkAllDayVotes(nf)) {
      clearTimeout(room.roundTimer);
      resolveDayVotePhase(room);
    }
  });

  // Hunter's revenge shot
  socket.on('hunter-target', (data) => {
    const room = getRoom(socketRoom);
    if (!room || !room.nfState) return;
    const nf = room.nfState;
    if (nf.hunterPending !== socket.id) return;

    const eliminated = nightFallsMode.resolveHunterShot(nf, data.targetId, room.players);
    if (eliminated && eliminated.length > 0) {
      emitToRoom(room, 'sound', 'nf-eliminate');
      emitToRoom(room, 'nf-hunter-result', {
        hunterName: room.players[socket.id]?.name || 'Hunter',
        eliminated: eliminated.map(e => ({
          name: e.name, avatar: e.avatar, role: e.roleName, roleEmoji: e.roleEmoji,
        })),
      });
    }

    // Continue to check win or next phase
    const win = nightFallsMode.checkWinCondition(nf);
    if (win) {
      endNightFallsGame(room, win);
    } else if (room.phase === 'nf-dawn' || room.phase === 'nf-vote-reveal') {
      // After hunter shot, continue to next appropriate phase
      setTimeout(() => {
        if (room.phase === 'nf-dawn') startDayDiscussion(room);
        else startNightPhase(room);
      }, 3000);
    }
  });

  // Night Falls role config from lobby
  socket.on('nf-configure', (data) => {
    const room = getRoom(socketRoom);
    if (!room) return;
    if (socket.id !== room.tvSocket && socket.id !== room.hostSocket) return;
    if (room.phase !== 'lobby' || room.gameMode !== 'night-falls') return;

    if (data.enabledRoles && Array.isArray(data.enabledRoles)) {
      room.nfEnabledRoles = data.enabledRoles;
    }
    if (data.nightDuration) room.nfNightDuration = Math.max(15, Math.min(45, data.nightDuration));
    if (data.discussionDuration) room.nfDiscussionDuration = Math.max(60, Math.min(300, data.discussionDuration));
    if (data.voteDuration) room.nfVoteDuration = Math.max(15, Math.min(60, data.voteDuration));

    emitToRoom(room, 'nf-config-updated', {
      enabledRoles: room.nfEnabledRoles,
      nightDuration: room.nfNightDuration,
      discussionDuration: room.nfDiscussionDuration,
      voteDuration: room.nfVoteDuration,
    });
  });

  // End game (TV/host force-ends the game mid-round, back to lobby)
  socket.on('end-game', () => {
    const room = getRoom(socketRoom);
    if (!room) return;
    if (socket.id !== room.tvSocket && socket.id !== room.hostSocket) return;
    if (room.phase === 'lobby') return;
    console.log(`[GAME] END GAME forced by ${socket.id === room.tvSocket ? 'TV' : 'host'} in room ${socketRoom}`);
    gameLogic.resetGame(room, room.playersByToken);
    room.nfState = null;
    emitToRoom(room, 'phase', { phase: 'lobby' });
    emitToRoom(room, 'player-update', getPlayerList(room));
  });

  // Player leaves game (back to join screen)
  socket.on('leave-game', () => {
    const room = getRoom(socketRoom);
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;
    console.log(`[GAME] ${player.avatar} ${player.name} left room ${socketRoom}`);

    // Remove from active players
    const token = player.token;
    delete room.players[socket.id];
    if (token && room.playersByToken[token]) {
      delete room.playersByToken[token];
      delete tokenToRoom[token];
    }

    // Transfer host if needed
    if (socket.id === room.hostSocket) {
      const remainingIds = Object.keys(room.players);
      if (remainingIds.length > 0) {
        room.hostSocket = remainingIds[0];
        io.to(room.hostSocket).emit('host-assigned');
      } else {
        room.hostSocket = null;
      }
    }

    emitToRoom(room, 'player-update', getPlayerList(room));
    socket.emit('left-game');
    socketRoom = null;

    // Schedule cleanup if empty
    if (Object.keys(room.players).length === 0 && !room.tvSocket) {
      scheduleRoomCleanup(room.code);
    }
  });

  // Play again
  socket.on('play-again', () => {
    const room = getRoom(socketRoom);
    if (!room) return;
    if (socket.id !== room.tvSocket && socket.id !== room.hostSocket) return;
    gameLogic.resetGame(room, room.playersByToken);
    room.nfState = null; // Clear Night Falls state
    emitToRoom(room, 'phase', { phase: 'lobby' });
    emitToRoom(room, 'player-update', getPlayerList(room));
  });

  // Disconnect
  socket.on('disconnect', () => {
    const room = getRoom(socketRoom);

    if (room) {
      // Handle TV disconnect
      if (socket.id === room.tvSocket) {
        room.tvSocket = null;
        console.log(`📺 TV disconnected from room ${socketRoom}`);
        emitToRoom(room, 'tv-status', { connected: false });
      }

      const player = room.players[socket.id];
      if (player) {
        handlePlayerDisconnect(
          socket,
          room,
          room.playersByToken,
          { emit: (event, data) => emitToRoom(room, event, data) },
          room.reconnectionManager,
          gameLogic
        );
      }

      // Transfer host in lobby
      if (room.phase === 'lobby' && socket.id === room.hostSocket) {
        const remainingIds = Object.keys(room.players);
        if (remainingIds.length > 0) {
          room.hostSocket = remainingIds[0];
          io.to(room.hostSocket).emit('host-assigned');
          console.log(`👑 Host transferred in room ${socketRoom}`);
        } else {
          room.hostSocket = null;
        }
      }

      // Schedule cleanup if room is empty
      if (Object.keys(room.players).length === 0 && !room.tvSocket) {
        scheduleRoomCleanup(socketRoom);
      }
    }

    console.log(`Disconnected: ${socket.id}`);
  });
});

// ── Night Falls Game Flow Functions ──

function startNightFallsGame(room, data) {
  const playerIds = Object.keys(room.players);
  const enabledRoles = room.nfEnabledRoles || ['seer', 'doctor'];

  // Assign roles
  const roles = nightFallsMode.assignRoles(playerIds, enabledRoles);
  if (!roles) {
    emitToRoom(room, 'error-msg', 'Could not assign roles for this player count.');
    return;
  }

  // Initialize Night Falls state
  const nf = nightFallsMode.createNightFallsState();
  nf.roles = roles;
  nf.enabledRoles = enabledRoles;
  nf.nightDuration = room.nfNightDuration || 25;
  nf.discussionDuration = room.nfDiscussionDuration || 120;
  nf.voteDuration = room.nfVoteDuration || 30;

  // Mark all players alive
  for (const id of playerIds) {
    nf.alive[id] = true;
  }

  room.nfState = nf;
  room.phase = 'nf-role-reveal';

  emitToRoom(room, 'sound', 'nf-role-reveal');

  // Send each player their role privately
  for (const playerId of playerIds) {
    const roleInfo = nightFallsMode.getRoleInfo(nf, playerId, room.players);
    io.to(playerId).emit('nf-role-assigned', roleInfo);
  }

  // TV shows atmospheric "roles are being revealed" screen
  emitToRoom(room, 'phase', {
    phase: 'nf-role-reveal',
    gameMode: 'night-falls',
    playerCount: playerIds.length,
  });

  // After reveal time, start first night
  room.roundTimer = setTimeout(() => {
    startNightPhase(room);
  }, 8000); // 8 seconds to read role
}

function startNightPhase(room) {
  const nf = room.nfState;
  nf.nightNumber++;
  room.phase = 'nf-night';

  // Reset night actions
  nf.nightActions = {
    werewolfVotes: {},
    seerTarget: null,
    doctorTarget: null,
    witchHeal: false,
    witchKill: null,
    cupidPair: null,
    bodyguardTarget: null,
  };

  emitToRoom(room, 'sound', 'nf-night');

  // TV: atmospheric night screen
  const tvData = nightFallsMode.getTVData(nf, room.players, 'nf-night');
  emitToRoom(room, 'phase', {
    ...tvData,
    gameMode: 'night-falls',
    timeLimit: nf.nightDuration,
  });

  // Send each alive player their night prompt
  const aliveIds = Object.keys(nf.alive).filter(id => nf.alive[id]);
  for (const playerId of aliveIds) {
    const prompt = nightFallsMode.getNightPrompt(nf, playerId, room.players);
    io.to(playerId).emit('nf-night-prompt', prompt);
  }

  // Dead players see spectator view
  for (const playerId of Object.keys(room.players)) {
    if (!nf.alive[playerId]) {
      io.to(playerId).emit('nf-night-prompt', { action: 'spectator', nightNumber: nf.nightNumber });
    }
  }

  // Auto-resolve when timer expires
  clearTimeout(room.roundTimer);
  room.roundTimer = setTimeout(() => {
    if (room.phase === 'nf-night') {
      resolveNightPhase(room);
    }
  }, (nf.nightDuration + 1) * 1000);
}

function resolveNightPhase(room) {
  clearTimeout(room.roundTimer);
  const nf = room.nfState;
  room.phase = 'nf-dawn';

  const results = nightFallsMode.resolveNight(nf, room.players);

  emitToRoom(room, 'sound', results.survived ? 'nf-survived' : 'nf-eliminate');

  // Dawn reveal on TV and all phones
  emitToRoom(room, 'phase', {
    phase: 'nf-dawn',
    gameMode: 'night-falls',
    nightNumber: nf.nightNumber,
    eliminated: results.eliminated.map(e => ({
      name: e.name, avatar: e.avatar, role: e.roleName, roleEmoji: e.roleEmoji, cause: e.cause,
    })),
    survived: results.survived,
    events: results.events,
    aliveCount: Object.keys(nf.alive).filter(id => nf.alive[id]).length,
  });

  // Check win condition
  const win = nightFallsMode.checkWinCondition(nf);
  if (win) {
    setTimeout(() => endNightFallsGame(room, win), 6000);
    return;
  }

  // Check for hunter trigger
  if (nf.hunterPending) {
    io.to(nf.hunterPending).emit('nf-hunter-trigger', {
      alivePlayers: nightFallsMode.getAlivePlayers(nf, room.players, nf.hunterPending),
    });
    emitToRoom(room, 'nf-waiting-hunter', {
      hunterName: room.players[nf.hunterPending]?.name || 'Hunter',
    });
    // Hunter has 15 seconds to pick
    room.roundTimer = setTimeout(() => {
      if (nf.hunterPending) {
        // Auto-skip hunter shot
        nf.hunterPending = null;
        startDayDiscussion(room);
      }
    }, 15000);
    return;
  }

  // After dawn reveal, transition to day discussion
  setTimeout(() => startDayDiscussion(room), 6000);
}

function startDayDiscussion(room) {
  const nf = room.nfState;
  room.phase = 'nf-day-discuss';
  nf.dayVotes = {};

  emitToRoom(room, 'sound', 'nf-day');

  const tvData = nightFallsMode.getTVData(nf, room.players, 'nf-day-discuss');
  emitToRoom(room, 'phase', {
    ...tvData,
    gameMode: 'night-falls',
    timeLimit: nf.discussionDuration,
  });

  // Auto-transition to voting after discussion time
  clearTimeout(room.roundTimer);
  room.roundTimer = setTimeout(() => {
    if (room.phase === 'nf-day-discuss') {
      startDayVote(room);
    }
  }, (nf.discussionDuration + 1) * 1000);
}

function startDayVote(room) {
  const nf = room.nfState;
  room.phase = 'nf-day-vote';

  emitToRoom(room, 'sound', 'vote-open');

  const alivePlayers = nightFallsMode.getAllAlivePlayers(nf, room.players);
  emitToRoom(room, 'phase', {
    phase: 'nf-day-vote',
    gameMode: 'night-falls',
    alivePlayers,
    eliminatedPlayers: nf.eliminated.map(e => ({
      name: e.name, avatar: e.avatar, role: e.roleName, roleEmoji: e.roleEmoji,
    })),
    timeLimit: nf.voteDuration,
  });

  // Auto-resolve after vote timer
  clearTimeout(room.roundTimer);
  room.roundTimer = setTimeout(() => {
    if (room.phase === 'nf-day-vote') {
      // Auto-skip for players who didn't vote
      const aliveIds = Object.keys(nf.alive).filter(id => nf.alive[id]);
      for (const id of aliveIds) {
        if (nf.dayVotes[id] === undefined) {
          nf.dayVotes[id] = 'skip';
        }
      }
      resolveDayVotePhase(room);
    }
  }, (nf.voteDuration + 1) * 1000);
}

function resolveDayVotePhase(room) {
  clearTimeout(room.roundTimer);
  const nf = room.nfState;
  room.phase = 'nf-vote-reveal';

  const results = nightFallsMode.resolveDayVote(nf, room.players);

  emitToRoom(room, 'sound', results.ejected ? 'nf-eliminate' : 'vote-close');

  emitToRoom(room, 'phase', {
    phase: 'nf-vote-reveal',
    gameMode: 'night-falls',
    ejected: results.ejected ? {
      name: results.ejected.name,
      avatar: results.ejected.avatar,
      role: results.ejected.roleName,
      roleEmoji: results.ejected.roleEmoji,
    } : null,
    tie: results.tie,
    voteTally: results.voteTally,
    skipCount: results.skipCount,
    jesterWin: results.jesterWin || false,
    loverDeath: results.loverDeath ? {
      name: results.loverDeath.name, avatar: results.loverDeath.avatar,
      role: results.loverDeath.roleName, roleEmoji: results.loverDeath.roleEmoji,
    } : null,
    aliveCount: Object.keys(nf.alive).filter(id => nf.alive[id]).length,
  });

  // Check jester win
  if (results.jesterWin) {
    setTimeout(() => {
      endNightFallsGame(room, { winner: 'jester', reason: 'The Jester tricked the village into voting them out!' });
    }, 5000);
    return;
  }

  // Check win condition
  const win = nightFallsMode.checkWinCondition(nf);
  if (win) {
    setTimeout(() => endNightFallsGame(room, win), 5000);
    return;
  }

  // Check hunter trigger
  if (nf.hunterPending) {
    io.to(nf.hunterPending).emit('nf-hunter-trigger', {
      alivePlayers: nightFallsMode.getAlivePlayers(nf, room.players, nf.hunterPending),
    });
    emitToRoom(room, 'nf-waiting-hunter', {
      hunterName: room.players[nf.hunterPending]?.name || 'Hunter',
    });
    room.roundTimer = setTimeout(() => {
      if (nf.hunterPending) {
        nf.hunterPending = null;
        startNightPhase(room);
      }
    }, 15000);
    return;
  }

  // Next night
  setTimeout(() => startNightPhase(room), 5000);
}

function endNightFallsGame(room, win) {
  clearTimeout(room.roundTimer);
  const nf = room.nfState;
  room.phase = 'nf-gameover';

  const soundMap = {
    villagers: 'nf-village-wins',
    werewolves: 'nf-wolves-win',
    jester: 'nf-jester-wins',
  };
  emitToRoom(room, 'sound', soundMap[win.winner] || 'gameover');

  emitToRoom(room, 'phase', {
    phase: 'nf-gameover',
    gameMode: 'night-falls',
    winner: win.winner,
    reason: win.reason,
    allRoles: nightFallsMode.getAllRoles(nf, room.players),
    nightsPlayed: nf.nightNumber,
  });
}

// Create an io-like object that emits to a specific room instead of globally
function createRoomEmitter(room) {
  return {
    emit: (event, data) => emitToRoom(room, event, data),
    to: (socketId) => ({
      emit: (event, data) => io.to(socketId).emit(event, data),
    }),
  };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('');
  console.log('  Hot Take 🔥 Server Running!');
  console.log(`   Local:   http://${ip}:${PORT}`);
  console.log(`   Create a room at http://${ip}:${PORT}`);
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📴 SIGTERM received, shutting down gracefully...');
  for (const code of Object.keys(rooms)) {
    if (rooms[code].reconnectionManager) rooms[code].reconnectionManager.destroy();
  }
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('📴 SIGINT received, shutting down gracefully...');
  for (const code of Object.keys(rooms)) {
    if (rooms[code].reconnectionManager) rooms[code].reconnectionManager.destroy();
  }
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
