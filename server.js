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
  createRoom(code);
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
      settings: {
        roundTime: room.customSettings.roundTime,
        voteTime: room.customSettings.voteTime,
        totalRounds: room.customSettings.totalRounds,
        estimatedDuration: settingsModule.getEstimatedDuration(room.customSettings),
      },
    });
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

    socket.emit('joined', { name: cleanName, avatar, isHost, token, team: assignedTeam, roomCode: room.code });
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

    const validModes = ['hot-take', 'speed-drawing', 'pictionary'];
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
  socket.on('start-game', (rounds) => {
    const room = getRoom(socketRoom);
    if (!room) return;
    if (socket.id !== room.tvSocket && socket.id !== room.hostSocket) return;
    if (Object.keys(room.players).length < 2) {
      socket.emit('error-msg', 'Need at least 2 players!');
      return;
    }

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
    if (room.phase !== 'prompt') return;

    if (room.gameMode === 'pictionary') {
      if (socket.id === room.currentDrawer) return;
      if (room.guesses[socket.id]) return;

      const guess = pictionaryMode.validateGuess(data);
      if (!guess) return;

      room.guesses[socket.id] = guess;
      socket.emit('answer-received');
      emitToRoom(room, 'sound', 'submit');

      const nonDrawerCount = Object.keys(room.players).length - 1;
      const guessedCount = Object.keys(room.guesses).length;

      emitToRoom(room, 'answer-progress', {
        answered: guessedCount,
        total: nonDrawerCount,
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

      emitToRoom(room, 'answer-progress', {
        answered: Object.keys(room.answers).length,
        total: Object.keys(room.players).length,
      });

      if (gameLogic.checkAllAnswered(room)) {
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
    if (room.phase !== 'vote') return;

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

      emitToRoom(room, 'vote-progress', {
        voted: Object.keys(room.votes).length,
        total: Object.keys(room.players).length,
      });

      if (gameLogic.checkAllVoted(room)) {
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

  // Play again
  socket.on('play-again', () => {
    const room = getRoom(socketRoom);
    if (!room) return;
    if (socket.id !== room.tvSocket && socket.id !== room.hostSocket) return;
    gameLogic.resetGame(room, room.playersByToken);
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
