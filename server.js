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
    team: p.team,
    teamName: p.team && game.teams[p.team] ? game.teams[p.team].name : null,
    teamColor: p.team && game.teams[p.team] ? game.teams[p.team].color : null,
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

function getTeamScoreboard() {
  return teamsModule.getTeamScoreboard(game.teams);
}

// Attach helper to game object for use by game-logic
game._getTeamScoreboard = getTeamScoreboard;

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
      settings: {
        roundTime: game.customSettings.roundTime,
        voteTime: game.customSettings.voteTime,
        totalRounds: game.customSettings.totalRounds,
        estimatedDuration: settingsModule.getEstimatedDuration(game.customSettings),
      },
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
    const teamId = typeof data === 'object' ? data?.team : null;

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

    // Handle team assignment
    let assignedTeam = null;
    if (game.teamMode) {
      // Auto-assign to smallest team if not specified
      const targetTeamId = teamId || (teamsModule.getSmallestTeam(game.teams)?.id);
      if (targetTeamId && game.teams[targetTeamId]) {
        teamsModule.assignPlayerToTeam(game.teams, targetTeamId, socket.id);
        assignedTeam = targetTeamId;
      }
    }

    game.players[socket.id] = { name: cleanName, score: 0, avatar, token, team: assignedTeam };

    // Store persistent identity
    playersByToken[token] = { name: cleanName, score: 0, avatar, socketId: socket.id, disconnectTimer: null };

    // First player becomes host
    const isHost = !game.hostSocket;
    if (isHost) game.hostSocket = socket.id;

    socket.emit('joined', { name: cleanName, avatar, isHost, token, team: assignedTeam });
    io.emit('player-update', getPlayerList());
    io.emit('sound', 'join');
    console.log(`${avatar} ${cleanName} joined${isHost ? ' (host)' : ''}${assignedTeam ? ` (${game.teams[assignedTeam]?.name})` : ''}`);
  });

  // Update game settings (TV only, host only)
  socket.on('update-settings', (updates) => {
    if (socket.id !== game.tvSocket && socket.id !== game.hostSocket) return;
    if (game.phase !== 'lobby') {
      socket.emit('error-msg', 'Can only change settings in lobby');
      return;
    }

    const { settings, changed } = settingsModule.updateSettings(game.customSettings, updates);
    if (changed) {
      game.customSettings = settings;
      game.totalRounds = settings.totalRounds;
      io.emit('settings-updated', {
        roundTime: settings.roundTime,
        voteTime: settings.voteTime,
        totalRounds: settings.totalRounds,
        estimatedDuration: settingsModule.getEstimatedDuration(settings),
      });
      console.log(`Settings updated:`, settings);
    }
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

  // Set game mode (TV only, host only, lobby only)
  socket.on('set-game-mode', (mode) => {
    if (socket.id !== game.tvSocket && socket.id !== game.hostSocket) return;
    if (game.phase !== 'lobby') return;

    const validModes = ['hot-take', 'speed-drawing', 'pictionary'];
    if (validModes.includes(mode)) {
      game.gameMode = mode;
      io.emit('game-mode-updated', mode);
      console.log(`Game mode set to: ${mode}`);
    }
  });

  // Toggle team mode (TV only, host only, lobby only)
  socket.on('set-team-mode', (data) => {
    if (socket.id !== game.tvSocket && socket.id !== game.hostSocket) return;
    if (game.phase !== 'lobby') return;

    const teamMode = Boolean(data.teamMode);
    const teamCount = Math.max(2, Math.min(6, parseInt(data.teamCount) || 2));

    if (game.teamMode !== teamMode || (teamMode && Object.keys(game.teams).length !== teamCount)) {
      game.teamMode = teamMode;
      if (teamMode) {
        game.teams = teamsModule.createTeams(teamCount);
      } else {
        game.teams = {};
      }
      io.emit('team-mode-updated', { teamMode, teamCount, teams: game.teams });
      console.log(`Team mode: ${teamMode ? `ON (${teamCount} teams)` : 'OFF'}`);
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

    // Get appropriate prompt picker for game mode
    let pickPromptFn;
    if (game.gameMode === 'speed-drawing') {
      pickPromptFn = () => speedDrawingMode.pickPrompt(game, customPrompts);
    } else {
      // Hot Take (default)
      pickPromptFn = () => promptsModule.pickPrompt(game, customPrompts);
    }

    gameLogic.startRound(game, pickPromptFn, io);
  });

  // Player submits answer (text or drawing)
  socket.on('answer', (data) => {
    if (game.phase !== 'prompt') return;
    // Prevent duplicate submissions
    if (game.answers[socket.id]) return;

    let answer = null;

    if (game.gameMode === 'speed-drawing') {
      // Drawing submission
      const imageData = speedDrawingMode.validateDrawing(data);
      if (!imageData) return;
      answer = imageData;
      game.drawings[socket.id] = imageData;
    } else {
      // Text submission (Hot Take)
      const text = hotTakeMode.validateAnswer(data);
      if (!text) return;
      answer = text;
    }

    game.answers[socket.id] = answer;
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
      let scoreRound;

      if (game.teamMode) {
        // Team mode: award points to team instead of individual
        scoreRound = (game, voteCounts) => {
          for (const [answerId, count] of Object.entries(voteCounts)) {
            teamsModule.scoreTeamRound(game.teams, answerId, count);
            // Also update player's personal score for tracking
            if (game.players[answerId]) {
              game.players[answerId].score += count;
              const token = game.players[answerId].token;
              if (token && playersByToken[token]) {
                playersByToken[token].score = game.players[answerId].score;
              }
            }
          }
        };
      } else {
        // Solo mode: use regular scoring
        scoreRound = (game, voteCounts) => scorer(game, voteCounts, playersByToken);
      }

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

      // Get appropriate prompt picker for game mode
      let pickPromptFn;
      if (game.gameMode === 'speed-drawing') {
        pickPromptFn = () => speedDrawingMode.pickPrompt(game, customPrompts);
      } else {
        pickPromptFn = () => promptsModule.pickPrompt(game, customPrompts);
      }

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
