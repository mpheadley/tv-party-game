/**
 * Game Logic Module
 * Handles phase transitions, round management, and core game loop
 */

const ROUND_TIME = 60; // seconds (configurable via customSettings later)
const VOTE_TIME = 20;  // seconds (configurable via customSettings later)

// Initialize game state
function createGameState() {
  return {
    phase: 'lobby',       // lobby | prompt | vote | results | gameover
    players: {},          // { socketId: { name, score, avatar, token, team } }
    round: 0,
    totalRounds: 5,
    gameMode: 'hot-take', // 'hot-take' | 'speed-drawing' | 'pictionary'
    currentPrompt: '',
    answers: {},          // { socketId: answerText | imageData }
    votes: {},            // { voterSocketId: answerId }
    usedPrompts: [],
    tvSocket: null,
    hostSocket: null,
    roundTimer: null,

    // Custom settings (Phase 2-3)
    customSettings: {
      roundTime: ROUND_TIME,
      voteTime: VOTE_TIME,
      totalRounds: 5,
      useCustomPrompts: false,
      customPromptList: [],
    },

    // Teams (Phase 4)
    teamMode: false,
    teams: {},

    // Mode-specific state (Phases 5-6)
    drawings: {},         // { socketId: base64ImageData }
    currentDrawer: null,  // Pictionary
    picturePrompt: '',    // Pictionary
    guesses: {},          // { socketId: guessText } - Pictionary
  };
}

/**
 * Start a new round
 * Called by mode-specific handlers
 */
function startRound(game, pickPrompt, io) {
  game.round++;
  game.phase = 'prompt';
  game.currentPrompt = pickPrompt();
  game.answers = {};
  game.votes = {};
  game.drawings = {};
  game.guesses = {};

  console.log(`[ROUND ${game.round}/${game.totalRounds}] START — mode=${game.gameMode}, players=${Object.keys(game.players).length}, prompt="${game.currentPrompt}", timeLimit=${game.customSettings.roundTime}s`);

  const payload = {
    phase: 'prompt',
    prompt: game.currentPrompt,
    gameMode: game.gameMode,
    round: game.round,
    totalRounds: game.totalRounds,
    timeLimit: game.customSettings.roundTime,
  };

  // For pictionary: send to each player whether they're the drawer
  if (game.gameMode === 'pictionary') {
    // Emit to each player individually with their drawer status
    for (const playerId of Object.keys(game.players)) {
      const payloadForPlayer = { ...payload, isDrawer: playerId === game.currentDrawer };
      // This would require changing how we emit, instead use a second event
    }
    // For now, send drawer info to all (clients will handle it)
    payload.currentDrawer = game.currentDrawer;
  }

  io.emit('phase', payload);

  // Auto-advance when timer expires
  clearTimeout(game.roundTimer);
  game.roundTimer = setTimeout(() => {
    if (game.phase === 'prompt') {
      const answered = Object.keys(game.answers).length;
      const total = Object.keys(game.players).length;
      console.log(`[ROUND ${game.round}] TIMER EXPIRED — ${answered}/${total} answered, auto-advancing to vote`);
      for (const id of Object.keys(game.players)) {
        if (!game.answers[id]) {
          game.answers[id] = '(no answer)';
        }
      }
      io.emit('sound', 'times-up');
      startVoting(game, io);
    } else {
      console.log(`[ROUND ${game.round}] TIMER EXPIRED but phase is '${game.phase}', ignoring`);
    }
  }, (game.customSettings.roundTime + 1) * 1000);
}

/**
 * Check if all active players have answered
 */
function checkAllAnswered(game) {
  const playerIds = Object.keys(game.players);
  const answered = Object.keys(game.answers);
  return playerIds.length > 0 && playerIds.every(id => answered.includes(id));
}

/**
 * Transition to voting phase
 */
function startVoting(game, io) {
  clearTimeout(game.roundTimer);
  game.phase = 'vote';
  const answerCount = Object.keys(game.answers).length;
  const guessCount = Object.keys(game.guesses).length;
  console.log(`[ROUND ${game.round}] VOTE START — answers=${answerCount}, guesses=${guessCount}, players=${Object.keys(game.players).length}`);
  io.emit('sound', 'vote-open');

  // Remove answers from players who disconnected
  for (const id of Object.keys(game.answers)) {
    if (!game.players[id]) delete game.answers[id];
  }

  // Build anonymous answer list (shuffled)
  const answerList = Object.entries(game.answers)
    .map(([id, text]) => ({ id, text }))
    .sort(() => Math.random() - 0.5);

  // Send TV the full list (for pictionary, send guesses instead of drawing data)
  if (game.tvSocket) {
    let tvAnswers = answerList;
    if (game.gameMode === 'pictionary') {
      tvAnswers = Object.entries(game.guesses)
        .map(([id, text]) => ({ id, text }))
        .sort(() => Math.random() - 0.5);
    }
    io.to(game.tvSocket).emit('phase', {
      phase: 'vote',
      answers: tvAnswers,
      prompt: game.currentPrompt,
      gameMode: game.gameMode,
      currentDrawer: game.currentDrawer,
      round: game.round,
      totalRounds: game.totalRounds,
      timeLimit: game.customSettings.voteTime,
    });
  }

  // Send each player the appropriate voting data
  for (const playerId of Object.keys(game.players)) {
    let payload = {
      phase: 'vote',
      prompt: game.currentPrompt,
      gameMode: game.gameMode,
      isDrawer: playerId === game.currentDrawer,
      currentDrawer: game.currentDrawer,
      round: game.round,
      totalRounds: game.totalRounds,
      timeLimit: game.customSettings.voteTime,
    };

    if (game.gameMode === 'pictionary') {
      // In pictionary, drawer sees guesses (from game.guesses), others wait
      if (playerId === game.currentDrawer) {
        // Drawer votes on guesses — use guesses, not answers (answers has drawing data)
        const guessList = Object.entries(game.guesses)
          .map(([id, text]) => ({ id, text }))
          .sort(() => Math.random() - 0.5);
        payload.answers = guessList;
      } else {
        // Others see the drawing being drawn (during voting = results phase for them)
        payload.answers = []; // They don't vote, just wait
      }
    } else {
      // Regular mode: filtered answers
      const filtered = answerList.filter(a => a.id !== playerId);
      payload.answers = filtered;
    }

    io.to(playerId).emit('phase', payload);
  }

  // Test mode with 1 player: skip voting and go straight to results
  if (game.testMode && Object.keys(game.players).length <= 1) {
    game.roundTimer = setTimeout(() => {
      if (game.phase === 'vote') tallyAndShowResults(game, io);
    }, 2000);
    return;
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
      tallyAndShowResults(game, io);
    }
  }, (game.customSettings.voteTime + 1) * 1000);
}

/**
 * Check if all active players have voted
 */
function checkAllVoted(game) {
  const playerIds = Object.keys(game.players);
  const voted = Object.keys(game.votes);
  return playerIds.length > 0 && playerIds.every(id => voted.includes(id));
}

/**
 * Tally votes and show results
 * Delegates to mode-specific scoring
 */
function tallyAndShowResults(game, io, scoreRound) {
  clearTimeout(game.roundTimer);
  game.phase = 'results';
  console.log(`[ROUND ${game.round}] RESULTS — votes=${Object.keys(game.votes).length}, players=${Object.keys(game.players).length}`);
  io.emit('sound', 'vote-close');

  // Count votes per answer
  const voteCounts = {};
  for (const answerId of Object.values(game.votes)) {
    voteCounts[answerId] = (voteCounts[answerId] || 0) + 1;
  }

  // Let mode-specific handler tally and award points
  if (scoreRound) {
    scoreRound(game, voteCounts);
  } else {
    // Default: 1 point per vote
    for (const [answerId, count] of Object.entries(voteCounts)) {
      if (game.players[answerId]) {
        game.players[answerId].score += count;
      }
    }
  }

  // Build results (for pictionary, show guesses + the drawing)
  let resultsSource = game.answers;
  if (game.gameMode === 'pictionary') {
    resultsSource = game.guesses;
  }
  const results = Object.entries(resultsSource).map(([id, text]) => ({
    text,
    author: game.players[id]?.name || 'Unknown',
    avatar: game.players[id]?.avatar || '',
    votes: voteCounts[id] || 0,
  })).sort((a, b) => b.votes - a.votes);

  // For pictionary, include the drawing in the payload
  if (game.gameMode === 'pictionary' && game.currentDrawer && game.drawings[game.currentDrawer]) {
    // Add drawing as a special result entry so it displays on results screen
    results.unshift({
      text: game.drawings[game.currentDrawer],
      author: game.players[game.currentDrawer]?.name || 'Unknown',
      avatar: game.players[game.currentDrawer]?.avatar || '',
      votes: 0,
      isDrawing: true,
    });
  }

  const scoreboard = Object.entries(game.players)
    .map(([id, p]) => ({ id, name: p.name, score: p.score, avatar: p.avatar }))
    .sort((a, b) => b.score - a.score);

  // Build team scoreboard if in team mode (requires teams module)
  const payload = {
    phase: 'results',
    results,
    scoreboard,
    round: game.round,
    totalRounds: game.totalRounds,
    commentary: getRandomCommentary(),
  };

  // Add team scoreboard if available (passed as context)
  if (game.teamMode && game._getTeamScoreboard) {
    payload.teamScoreboard = game._getTeamScoreboard();
  }

  io.emit('phase', payload);
}

/**
 * End the game
 */
function endGame(game, io) {
  clearTimeout(game.roundTimer);
  game.phase = 'gameover';
  io.emit('sound', 'gameover');
  const scoreboard = Object.entries(game.players)
    .map(([id, p]) => ({ id, name: p.name, score: p.score, avatar: p.avatar }))
    .sort((a, b) => b.score - a.score);

  const payload = { phase: 'gameover', scoreboard };

  // Add team scoreboard if in team mode
  if (game.teamMode && game._getTeamScoreboard) {
    payload.teamScoreboard = game._getTeamScoreboard();
  }

  io.emit('phase', payload);
}

/**
 * Reset game to lobby state
 */
function resetGame(game, playersByToken) {
  clearTimeout(game.roundTimer);
  game.phase = 'lobby';
  game.round = 0;
  game.currentPrompt = '';
  game.answers = {};
  game.votes = {};
  game.usedPrompts = [];
  game.drawings = {};
  game.guesses = {};
  game.currentDrawer = null;
  game.currentDrawerTeamId = null;

  for (const id of Object.keys(game.players)) {
    game.players[id].score = 0;
  }

  // Reset scores in persistent store and clear grace timers
  for (const token of Object.keys(playersByToken)) {
    clearTimeout(playersByToken[token].disconnectTimer);
    playersByToken[token].score = 0;
  }
}

/**
 * Get random snarky commentary
 * Extracted to allow mode-specific overrides
 */
function getRandomCommentary() {
  const SNARKY_COMMENTARY = [
    "Well, THAT happened.",
    "Your ancestors are watching. They're confused.",
    "Bold strategy. Let's see if it pays off.",
    "I'm not mad, I'm just disappointed.",
    "The bar was on the floor and somehow...",
    "Somebody's parents are going to hear about this.",
    "This is why we can't have nice things.",
    "I'd say 'interesting choices' but I'd be lying.",
    "The judges would like to remind you this is a FAMILY game.",
    "That answer is going in the vault. Forever.",
    "Somewhere, a guidance counselor just felt a chill.",
    "You all chose violence today and honestly? Respect.",
    "This round sponsored by questionable life decisions.",
    "The algorithm is judging you. So am I.",
    "No thoughts, just vibes. Mostly concerning vibes.",
    "Not gonna lie, somebody cooked here. 🔥",
    "That was lowkey unhinged and I'm here for it.",
    "Main character energy detected. Proceed with caution.",
    "The delulu is strong with this group.",
    "Bro really said that with their whole chest. 💀",
    "Slay or be slayed. There is no in between.",
    "This round is living rent-free in my head now.",
    "Tell me you're chronically online without telling me.",
    "It's giving... chaos. Pure chaos.",
    "POV: you just witnessed a crime against comedy.",
  ];
  return SNARKY_COMMENTARY[Math.floor(Math.random() * SNARKY_COMMENTARY.length)];
}

module.exports = {
  createGameState,
  startRound,
  checkAllAnswered,
  startVoting,
  checkAllVoted,
  tallyAndShowResults,
  endGame,
  resetGame,
  getRandomCommentary,
};
