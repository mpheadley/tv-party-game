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

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Redirect root to TV page
app.get('/', (req, res) => res.redirect('/tv.html'));

const AVATARS = [
  '🦊', '🐸', '🦉', '🐙', '🦄', '🐲', '🦋', '🐢',
  '🦁', '🐧', '🦖', '🐬', '🦩', '🐨', '🦝', '🐝',
];

const RECONNECT_GRACE = 30000; // 30 seconds grace period for disconnected players

// Persistent player identity — survives reconnection
// { token: { name, score, avatar, socketId, disconnectTimer } }
let playersByToken = {};

let game = gameLogic.createGameState();

// Load custom prompts from file
let customPrompts = promptsModule.loadCustomPrompts();
game.customSettings.customPromptList = customPrompts;

// Helper functions

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

// Migrate answers/votes from old socket ID to new one
function migrateSocketId(oldId, newId) {
  if (game.answers[oldId]) {
    game.answers[newId] = game.answers[oldId];
    delete game.answers[oldId];
  }
  if (game.votes[oldId]) {
    game.votes[newId] = game.votes[oldId];
    delete game.votes[oldId];
  }
  // Update votes that pointed to the old ID
  for (const [voterId, answerId] of Object.entries(game.votes)) {
    if (answerId === oldId) {
      game.votes[voterId] = newId;
    }
  }
  if (game.hostSocket === oldId) {
    game.hostSocket = newId;
  }
}

function getPlayerList() {
  return Object.entries(game.players).map(([id, p]) => ({
    id,
    name: p.name,
    score: p.score,
    avatar: p.avatar,
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

function pickAvatar() {
  // Derive used avatars from current players — no stale state
  const usedAvatars = Object.values(game.players).map(p => p.avatar);
  const available = AVATARS.filter(a => !usedAvatars.includes(a));
  return available.length > 0
    ? available[Math.floor(Math.random() * available.length)]
    : AVATARS[Math.floor(Math.random() * AVATARS.length)];
}

// ── Socket Handlers ──
io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  // TV connects
  socket.on('tv-connect', async (publicUrl) => {
    game.tvSocket = socket.id;
    // Generate QR code server-side — publicUrl comes from the browser's location.origin
    let qrDataUrl = null;
    if (publicUrl) {
      try {
        const phoneUrl = publicUrl + '/phone.html';
        qrDataUrl = await QRCode.toDataURL(phoneUrl, { width: 200, margin: 1 });
      } catch (e) { /* QR generation failed, client will show URL only */ }
    }
    socket.emit('game-state', {
      phase: game.phase,
      players: getPlayerList(),
      ip: getLocalIP(),
      port: PORT,
      qrDataUrl,
      customPrompts,
    });
  });

  // Player reconnects with token
  socket.on('reconnect-attempt', (token) => {
    const stored = playersByToken[token];
    if (!stored) {
      // Token not found — tell client to rejoin fresh
      socket.emit('reconnect-failed');
      return;
    }

    // Cancel the disconnect grace timer
    if (stored.disconnectTimer) {
      clearTimeout(stored.disconnectTimer);
      stored.disconnectTimer = null;
    }

    const oldId = stored.socketId;
    const newId = socket.id;

    // Remove ghost entry if old socket is still in players
    if (oldId !== newId && game.players[oldId]) {
      delete game.players[oldId];
    }

    // Restore player with new socket ID
    game.players[newId] = { name: stored.name, score: stored.score, avatar: stored.avatar, token };
    stored.socketId = newId;

    // Migrate answers, votes, and host reference
    if (oldId !== newId) {
      migrateSocketId(oldId, newId);
    }

    const isHost = game.hostSocket === newId;

    // Send current game state to the reconnected player
    socket.emit('reconnected', {
      name: stored.name,
      avatar: stored.avatar,
      score: stored.score,
      token,
      isHost,
      phase: game.phase,
    });

    // Send them the current phase data so their screen updates
    if (game.phase === 'prompt') {
      const alreadyAnswered = !!game.answers[newId];
      socket.emit('phase', {
        phase: 'prompt',
        prompt: game.currentPrompt,
        round: game.round,
        totalRounds: game.totalRounds,
        timeLimit: ROUND_TIME,
      });
      if (alreadyAnswered) socket.emit('answer-received');
    } else if (game.phase === 'vote') {
      const answerList = Object.entries(game.answers)
        .map(([id, text]) => ({ id, text }))
        .sort(() => Math.random() - 0.5);
      const filtered = answerList.filter(a => a.id !== newId);
      socket.emit('phase', {
        phase: 'vote',
        answers: filtered,
        prompt: game.currentPrompt,
        round: game.round,
        totalRounds: game.totalRounds,
        timeLimit: VOTE_TIME,
      });
      if (game.votes[newId]) socket.emit('vote-received');
    } else if (game.phase === 'results' || game.phase === 'gameover') {
      // They'll get the current state from the next broadcast
      const scoreboard = getPlayerList().sort((a, b) => b.score - a.score);
      socket.emit('phase', { phase: game.phase, scoreboard, round: game.round, totalRounds: game.totalRounds });
    }

    io.emit('player-update', getPlayerList());
    console.log(`${stored.avatar} ${stored.name} reconnected`);
  });

  // Player joins
  socket.on('join', (data) => {
    // Support both old format (string) and new format (object)
    const name = typeof data === 'string' ? data : data?.name;
    const requestedAvatar = typeof data === 'object' ? data?.avatar : null;

    if (game.phase !== 'lobby') {
      socket.emit('error-msg', 'Game already in progress! Wait for the next game.');
      return;
    }
    // Prevent duplicate joins from same socket
    if (game.players[socket.id]) return;

    const cleanName = String(name).trim().slice(0, 20);
    if (!cleanName) return;

    const usedAvatars = Object.values(game.players).map(p => p.avatar);
    const avatar = (requestedAvatar && AVATARS.includes(requestedAvatar) && !usedAvatars.includes(requestedAvatar))
      ? requestedAvatar : pickAvatar();
    const token = generateToken();
    game.players[socket.id] = { name: cleanName, score: 0, avatar, token };

    // Store persistent identity
    playersByToken[token] = { name: cleanName, score: 0, avatar, socketId: socket.id, disconnectTimer: null };

    // First player becomes host
    const isHost = !game.hostSocket;
    if (isHost) game.hostSocket = socket.id;

    socket.emit('joined', { name: cleanName, avatar, isHost, token });
    io.emit('player-update', getPlayerList());
    io.emit('sound', 'join');
    console.log(`${avatar} ${cleanName} joined${isHost ? ' (host)' : ''}`);
  });

  // Add custom prompt (TV only, host only)
  socket.on('add-custom-prompt', (text) => {
    if (socket.id !== game.tvSocket && socket.id !== game.hostSocket) return;
    if (game.phase !== 'lobby') {
      socket.emit('error-msg', 'Can only manage prompts in lobby');
      return;
    }

    const added = promptsModule.addCustomPrompt(customPrompts, text);
    if (added) {
      promptsModule.saveCustomPrompts(customPrompts);
      game.customSettings.customPromptList = customPrompts;
      io.emit('custom-prompts-update', customPrompts);
      socket.emit('prompt-added', added);
      console.log(`Added custom prompt: "${added}"`);
    } else {
      socket.emit('error-msg', 'Invalid prompt (must be 5-200 chars, not a duplicate, max 50)');
    }
  });

  // Remove custom prompt (TV only, host only)
  socket.on('remove-custom-prompt', (index) => {
    if (socket.id !== game.tvSocket && socket.id !== game.hostSocket) return;
    if (game.phase !== 'lobby') {
      socket.emit('error-msg', 'Can only manage prompts in lobby');
      return;
    }

    const removed = promptsModule.removeCustomPrompt(customPrompts, index);
    if (removed) {
      promptsModule.saveCustomPrompts(customPrompts);
      game.customSettings.customPromptList = customPrompts;
      io.emit('custom-prompts-update', customPrompts);
      socket.emit('prompt-removed');
      console.log(`Removed custom prompt at index ${index}`);
    } else {
      socket.emit('error-msg', 'Invalid prompt index');
    }
  });

  // Start game (from TV or host phone)
  socket.on('start-game', (rounds) => {
    if (socket.id !== game.tvSocket && socket.id !== game.hostSocket) return;
    if (Object.keys(game.players).length < 2) {
      socket.emit('error-msg', 'Need at least 2 players!');
      return;
    }
    // Set round count from TV picker (5, 10, or 15)
    const validRounds = [5, 10, 15];
    if (validRounds.includes(rounds)) {
      game.customSettings.totalRounds = rounds;
      game.totalRounds = rounds;
    }
    io.emit('sound', 'round-start');
    // Use prompts module with custom prompts
    const pickPromptFn = () => promptsModule.pickPrompt(game, customPrompts);
    gameLogic.startRound(game, pickPromptFn, io);
  });

  // Player submits answer
  socket.on('answer', (text) => {
    if (game.phase !== 'prompt') return;
    // Prevent duplicate submissions
    if (game.answers[socket.id]) return;

    const cleanText = hotTakeMode.validateAnswer(text);
    if (!cleanText) return;

    game.answers[socket.id] = cleanText;
    socket.emit('answer-received');
    io.emit('sound', 'submit');

    io.emit('answer-progress', {
      answered: Object.keys(game.answers).length,
      total: Object.keys(game.players).length,
    });

    if (gameLogic.checkAllAnswered(game)) {
      clearTimeout(game.roundTimer);
      gameLogic.startVoting(game, io);
    }
  });

  // Player votes
  socket.on('vote', (answerId) => {
    if (game.phase !== 'vote') return;
    // Prevent duplicate votes
    if (game.votes[socket.id]) return;
    // Can't vote for yourself
    if (answerId === socket.id) {
      socket.emit('error-msg', "Can't vote for your own answer!");
      return;
    }
    // Validate answerId exists
    if (!game.answers[answerId]) return;

    game.votes[socket.id] = answerId;
    socket.emit('vote-received');

    io.emit('vote-progress', {
      voted: Object.keys(game.votes).length,
      total: Object.keys(game.players).length,
    });

    if (gameLogic.checkAllVoted(game)) {
      const scorer = scoring.getScorerForMode(game.gameMode);
      const scoreRound = (game, voteCounts) => scorer(game, voteCounts, playersByToken);
      gameLogic.tallyAndShowResults(game, io, scoreRound);
    }
  });

  // Next round (from TV or host phone)
  socket.on('next-round', () => {
    if (socket.id !== game.tvSocket && socket.id !== game.hostSocket) return;
    if (game.round >= game.totalRounds) {
      gameLogic.endGame(game, io);
    } else {
      io.emit('sound', 'round-start');
      const pickPromptFn = () => promptsModule.pickPrompt(game, customPrompts);
      gameLogic.startRound(game, pickPromptFn, io);
    }
  });

  // Play again (from TV or host phone)
  socket.on('play-again', () => {
    if (socket.id !== game.tvSocket && socket.id !== game.hostSocket) return;
    gameLogic.resetGame(game, playersByToken);
    io.emit('phase', { phase: 'lobby' });
    io.emit('player-update', getPlayerList());
  });

  // Disconnect — grace period before removing player
  socket.on('disconnect', () => {
    const player = game.players[socket.id];
    if (player) {
      const token = player.token;
      console.log(`${player.name} disconnected (grace period started)`);

      // Update persistent store with latest score
      if (playersByToken[token]) {
        playersByToken[token].score = player.score;
      }

      // In lobby, remove immediately (no game state to preserve)
      if (game.phase === 'lobby') {
        delete game.players[socket.id];
        if (playersByToken[token]) {
          clearTimeout(playersByToken[token].disconnectTimer);
          delete playersByToken[token];
        }
        io.emit('player-update', getPlayerList());
      } else {
        // Mid-game: keep player in game, start grace timer
        // Mark as disconnected but don't remove yet
        if (playersByToken[token]) {
          playersByToken[token].disconnectTimer = setTimeout(() => {
            // Grace period expired — remove for real
            console.log(`${player.name} grace period expired — removed from game`);
            delete game.players[socket.id];
            delete game.answers[socket.id];
            delete game.votes[socket.id];
            delete playersByToken[token];
            io.emit('player-update', getPlayerList());

            // Check if game can advance
            if (game.phase === 'prompt' && gameLogic.checkAllAnswered(game) && Object.keys(game.players).length >= 2) {
              clearTimeout(game.roundTimer);
              gameLogic.startVoting(game, io);
            } else if (game.phase === 'vote' && gameLogic.checkAllVoted(game) && Object.keys(game.players).length >= 2) {
              const scorer = scoring.getScorerForMode(game.gameMode);
              const scoreRound = (game, voteCounts) => scorer(game, voteCounts, playersByToken);
              gameLogic.tallyAndShowResults(game, io, scoreRound);
            }

            // If all players gone, reset
            if (Object.keys(game.players).length === 0) {
              gameLogic.resetGame(game, playersByToken);
              console.log('All players disconnected — reset to lobby');
            } else if (game.phase !== 'lobby' && Object.keys(game.players).length < 2) {
              clearTimeout(game.roundTimer);
              gameLogic.endGame(game, io);
            }

            // Transfer host if needed
            if (game.hostSocket === socket.id) {
              const remainingIds = Object.keys(game.players);
              if (remainingIds.length > 0) {
                game.hostSocket = remainingIds[0];
                io.to(game.hostSocket).emit('host-assigned');
                console.log(`Host transferred to ${game.players[game.hostSocket].name}`);
              } else {
                game.hostSocket = null;
              }
            }
          }, RECONNECT_GRACE);
        }
      }
    }
    if (socket.id === game.tvSocket) {
      game.tvSocket = null;
    }
    // Transfer host immediately in lobby
    if (game.phase === 'lobby' && socket.id === game.hostSocket) {
      const remainingIds = Object.keys(game.players);
      if (remainingIds.length > 0) {
        game.hostSocket = remainingIds[0];
        io.to(game.hostSocket).emit('host-assigned');
        console.log(`Host transferred to ${game.players[game.hostSocket].name}`);
      } else {
        game.hostSocket = null;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('');
  console.log('  Hot Take 🔥 Server Running!');
  console.log(`   Local:   http://${ip}:${PORT}/tv.html`);
  console.log(`   Phones:  http://${ip}:${PORT}/phone.html`);
  console.log('');
});
