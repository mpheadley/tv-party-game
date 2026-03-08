const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Redirect root to TV page
app.get('/', (req, res) => res.redirect('/tv.html'));

// ── Prompts — family-friendly, fun for ages 9-16 ──
const PROMPTS = [
  // Classic silly
  "What's the worst name for a pet goldfish?",
  "What would a dog's first text message say?",
  "Invent a holiday that should exist but doesn't.",
  "What's the worst superpower to have at school?",
  "Name a new ice cream flavor nobody asked for.",
  "Write a one-star review of the ocean.",
  "If animals could talk, which one would be the rudest?",
  "What's the worst thing to say on a roller coaster?",
  "Invent a sport that would never make the Olympics.",
  "Name a breakfast cereal for villains.",
  "What's the most useless app idea?",
  "If you could rename any planet, what would you call it?",
  "Name a rejected crayon color.",
  "What's the worst name for a band made of grandparents?",
  "Write a one-star review of gravity.",
  "What's the worst flavor of toothpaste?",
  "Name a movie sequel nobody wants.",
  "What's the worst thing to yell in a library?",
  "Name a terrible video game power-up.",
  "What's the worst excuse for not doing chores?",
  "What would aliens say about Earth after visiting?",
  "What's the worst thing to put on a sandwich?",
  "Name a terrible name for a superhero.",
  "What's the funniest thing to find inside a treasure chest?",
  "Name a video game that would be impossible to win.",

  // Social media / internet age
  "What would a penguin's TikTok bio say?",
  "Write the most unhinged Google search in your history.",
  "What's the worst WiFi password?",
  "Name a YouTube channel that would get zero subscribers.",
  "What's the worst group chat name?",
  "Write the most suspicious text to accidentally send your teacher.",
  "What notification would ruin your day?",
  "Describe a social media influencer for ants.",
  "What's the worst thing to go viral for?",
  "Write a one-star review of sleep.",

  // School / teen life
  "What's something you'd never want your teacher to find out?",
  "What's the worst excuse for being late to class?",
  "Describe the worst school field trip destination.",
  "What's the most suspicious thing to have in your locker?",
  "Write a text that would get you grounded instantly.",
  "What's the worst thing to whisper to the person next to you during a test?",
  "Invent a new school rule that would cause chaos.",
  "What's the worst yearbook quote?",

  // Absurd / creative
  "If your refrigerator could talk, what secret would it expose?",
  "What would a fish think about all day?",
  "If socks could talk, what would they complain about?",
  "Describe a useless invention by a lazy genius.",
  "What would a cloud write in its diary?",
  "What would a talking pizza say right before being eaten?",
  "Write a complaint letter from a snowman to the sun.",
  "What would happen if dogs could drive cars?",
  "If you had a pet dragon, what would go wrong first?",
  "Write a fortune cookie message that makes no sense.",
  "What would a robot say on its first day of school?",

  // Spicy (still family-safe but funnier for teens)
  "What's the worst dating advice you could give?",
  "What's the most embarrassing thing to have fall out of your backpack?",
  "Describe the worst possible first impression.",
  "What would your browser history say about you in court?",
  "What's the worst thing to say during an awkward silence?",
  "Write a terrible motivational poster for a gym.",
  "What's the worst thing to accidentally say on a hot mic?",
  "Name a candle scent that would sell zero units.",
  "What would your pet say about you behind your back?",
  "What's the worst thing to put on a resume?",
];

const AVATARS = [
  '🦊', '🐸', '🦉', '🐙', '🦄', '🐲', '🦋', '🐢',
  '🦁', '🐧', '🦖', '🐬', '🦩', '🐨', '🦝', '🐝',
];

const ROUND_TIME = 45; // seconds
const VOTE_TIME = 20;  // seconds

let game = {
  phase: 'lobby',       // lobby | prompt | vote | results | gameover
  players: {},          // { socketId: { name, score, avatar } }
  round: 0,
  totalRounds: 5,
  currentPrompt: '',
  answers: {},          // { socketId: answerText }
  votes: {},            // { voterSocketId: answererSocketId }
  usedPrompts: [],
  tvSocket: null,
  hostSocket: null,     // first player to join becomes host
  roundTimer: null,
};

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

function pickPrompt() {
  const available = PROMPTS.filter(p => !game.usedPrompts.includes(p));
  if (available.length === 0) game.usedPrompts = [];
  const pool = available.length > 0 ? available : PROMPTS;
  const prompt = pool[Math.floor(Math.random() * pool.length)];
  game.usedPrompts.push(prompt);
  return prompt;
}

function startRound() {
  game.round++;
  game.phase = 'prompt';
  game.currentPrompt = pickPrompt();
  game.answers = {};
  game.votes = {};

  io.emit('phase', {
    phase: 'prompt',
    prompt: game.currentPrompt,
    round: game.round,
    totalRounds: game.totalRounds,
    timeLimit: ROUND_TIME,
  });

  // Auto-advance when timer expires
  clearTimeout(game.roundTimer);
  game.roundTimer = setTimeout(() => {
    if (game.phase === 'prompt') {
      // Fill in blank answers for players who didn't submit
      for (const id of Object.keys(game.players)) {
        if (!game.answers[id]) {
          game.answers[id] = '(no answer)';
        }
      }
      io.emit('sound', 'times-up');
      startVoting();
    }
  }, (ROUND_TIME + 1) * 1000);
}

function checkAllAnswered() {
  const playerIds = Object.keys(game.players);
  const answered = Object.keys(game.answers);
  return playerIds.length > 0 && playerIds.every(id => answered.includes(id));
}

function startVoting() {
  clearTimeout(game.roundTimer);
  game.phase = 'vote';

  // Remove answers from players who disconnected
  for (const id of Object.keys(game.answers)) {
    if (!game.players[id]) delete game.answers[id];
  }

  // Build anonymous answer list (shuffled)
  const answerList = Object.entries(game.answers)
    .map(([id, text]) => ({ id, text }))
    .sort(() => Math.random() - 0.5);

  // Send TV the full list
  if (game.tvSocket) {
    io.to(game.tvSocket).emit('phase', {
      phase: 'vote',
      answers: answerList,
      prompt: game.currentPrompt,
      round: game.round,
      totalRounds: game.totalRounds,
      timeLimit: VOTE_TIME,
    });
  }

  // Send each player only answers they can vote on (not their own)
  for (const playerId of Object.keys(game.players)) {
    const filtered = answerList.filter(a => a.id !== playerId);
    io.to(playerId).emit('phase', {
      phase: 'vote',
      answers: filtered,
      prompt: game.currentPrompt,
      round: game.round,
      totalRounds: game.totalRounds,
      timeLimit: VOTE_TIME,
    });
  }

  // Auto-advance voting after timeout
  game.roundTimer = setTimeout(() => {
    if (game.phase === 'vote') {
      // Auto-vote for players who didn't vote (random pick)
      for (const id of Object.keys(game.players)) {
        if (!game.votes[id]) {
          const others = Object.keys(game.answers).filter(a => a !== id);
          if (others.length > 0) {
            game.votes[id] = others[Math.floor(Math.random() * others.length)];
          }
        }
      }
      tallyAndShowResults();
    }
  }, (VOTE_TIME + 1) * 1000);
}

function checkAllVoted() {
  const playerIds = Object.keys(game.players);
  const voted = Object.keys(game.votes);
  return playerIds.length > 0 && playerIds.every(id => voted.includes(id));
}

function tallyAndShowResults() {
  clearTimeout(game.roundTimer);
  game.phase = 'results';

  // Count votes per answer
  const voteCounts = {};
  for (const answerId of Object.values(game.votes)) {
    voteCounts[answerId] = (voteCounts[answerId] || 0) + 1;
  }

  // Award points (1 point per vote received)
  for (const [answerId, count] of Object.entries(voteCounts)) {
    if (game.players[answerId]) {
      game.players[answerId].score += count;
    }
  }

  // Build results
  const results = Object.entries(game.answers).map(([id, text]) => ({
    text,
    author: game.players[id]?.name || 'Unknown',
    avatar: game.players[id]?.avatar || '',
    votes: voteCounts[id] || 0,
  })).sort((a, b) => b.votes - a.votes);

  const scoreboard = getPlayerList().sort((a, b) => b.score - a.score);

  io.emit('phase', {
    phase: 'results',
    results,
    scoreboard,
    round: game.round,
    totalRounds: game.totalRounds,
  });
}

function endGame() {
  clearTimeout(game.roundTimer);
  game.phase = 'gameover';
  const scoreboard = getPlayerList().sort((a, b) => b.score - a.score);
  io.emit('phase', { phase: 'gameover', scoreboard });
}

function resetGame() {
  clearTimeout(game.roundTimer);
  game.phase = 'lobby';
  game.round = 0;
  game.totalRounds = 10;
  game.currentPrompt = '';
  game.answers = {};
  game.votes = {};
  game.usedPrompts = [];
  for (const id of Object.keys(game.players)) {
    game.players[id].score = 0;
  }
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
    });
  });

  // Player joins
  socket.on('join', (name) => {
    if (game.phase !== 'lobby') {
      socket.emit('error-msg', 'Game already in progress! Wait for the next game.');
      return;
    }
    // Prevent duplicate joins from same socket
    if (game.players[socket.id]) return;

    const cleanName = String(name).trim().slice(0, 20);
    if (!cleanName) return;

    const avatar = pickAvatar();
    game.players[socket.id] = { name: cleanName, score: 0, avatar };

    // First player becomes host
    const isHost = !game.hostSocket;
    if (isHost) game.hostSocket = socket.id;

    socket.emit('joined', { name: cleanName, avatar, isHost });
    io.emit('player-update', getPlayerList());
    io.emit('sound', 'join');
    console.log(`${avatar} ${cleanName} joined${isHost ? ' (host)' : ''}`);
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
      game.totalRounds = rounds;
    }
    io.emit('sound', 'round-start');
    startRound();
  });

  // Player submits answer
  socket.on('answer', (text) => {
    if (game.phase !== 'prompt') return;
    // Prevent duplicate submissions
    if (game.answers[socket.id]) return;

    const cleanText = String(text).trim().slice(0, 200);
    if (!cleanText) return;

    game.answers[socket.id] = cleanText;
    socket.emit('answer-received');
    io.emit('sound', 'submit');

    io.emit('answer-progress', {
      answered: Object.keys(game.answers).length,
      total: Object.keys(game.players).length,
    });

    if (checkAllAnswered()) {
      clearTimeout(game.roundTimer);
      startVoting();
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

    if (checkAllVoted()) {
      tallyAndShowResults();
    }
  });

  // Next round (from TV or host phone)
  socket.on('next-round', () => {
    if (socket.id !== game.tvSocket && socket.id !== game.hostSocket) return;
    if (game.round >= game.totalRounds) {
      endGame();
    } else {
      io.emit('sound', 'round-start');
      startRound();
    }
  });

  // Play again (from TV or host phone)
  socket.on('play-again', () => {
    if (socket.id !== game.tvSocket && socket.id !== game.hostSocket) return;
    resetGame();
    io.emit('phase', { phase: 'lobby' });
    io.emit('player-update', getPlayerList());
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (game.players[socket.id]) {
      console.log(`${game.players[socket.id].name} disconnected`);
      delete game.players[socket.id];
      // Clean up any answers/votes from disconnected player
      delete game.answers[socket.id];
      delete game.votes[socket.id];
      io.emit('player-update', getPlayerList());

      // If mid-round and everyone remaining has answered/voted, advance
      if (game.phase === 'prompt' && checkAllAnswered() && Object.keys(game.players).length >= 2) {
        clearTimeout(game.roundTimer);
        startVoting();
      } else if (game.phase === 'vote' && checkAllVoted() && Object.keys(game.players).length >= 2) {
        tallyAndShowResults();
      }

      // If fewer than 2 players remain mid-game, end it
      if (game.phase !== 'lobby' && Object.keys(game.players).length < 2) {
        clearTimeout(game.roundTimer);
        endGame();
      }
    }
    if (socket.id === game.tvSocket) {
      game.tvSocket = null;
    }
    // Transfer host to next player if host disconnected
    if (socket.id === game.hostSocket) {
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
  console.log('  Party Game Server Running!');
  console.log(`   Local:   http://${ip}:${PORT}/tv.html`);
  console.log(`   Phones:  http://${ip}:${PORT}/phone.html`);
  console.log('');
});
