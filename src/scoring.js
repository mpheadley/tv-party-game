/**
 * Scoring Module
 * Handles point calculation per game mode
 */

/**
 * Score Hot Take round
 * 1 point per vote received
 */
function scoreHotTake(game, voteCounts, playersByToken) {
  for (const [answerId, count] of Object.entries(voteCounts)) {
    if (game.players[answerId]) {
      game.players[answerId].score += count;
      // Sync to persistent store
      const token = game.players[answerId].token;
      if (token && playersByToken[token]) {
        playersByToken[token].score = game.players[answerId].score;
      }
    }
  }
}

/**
 * Score Speed Drawing round
 * 1 point per vote received (same as Hot Take)
 */
function scoreSpeedDrawing(game, voteCounts, playersByToken) {
  // Could implement 2x scoring or other variants
  scoreHotTake(game, voteCounts, playersByToken);
}

/**
 * Score Pictionary round
 * Drawer: +1 per correct guess
 * Guesser: +1 per accepted guess
 */
function scorePictionary(game, voteCounts, playersByToken) {
  // voteCounts here represents votes/approvals on guesses
  // Drawer gets points from approved guesses
  const drawerId = game.currentDrawer;
  if (drawerId && game.players[drawerId]) {
    const approvalCount = voteCounts[drawerId] || 0;
    game.players[drawerId].score += approvalCount;
    const token = game.players[drawerId].token;
    if (token && playersByToken[token]) {
      playersByToken[token].score = game.players[drawerId].score;
    }
  }

  // Guessers get points from approved guesses
  for (const [guesserId, count] of Object.entries(voteCounts)) {
    if (guesserId !== drawerId && game.players[guesserId]) {
      game.players[guesserId].score += count;
      const token = game.players[guesserId].token;
      if (token && playersByToken[token]) {
        playersByToken[token].score = game.players[guesserId].score;
      }
    }
  }
}

/**
 * Get appropriate scorer function for game mode
 */
function getScorerForMode(mode) {
  const scorers = {
    'hot-take': scoreHotTake,
    'speed-drawing': scoreSpeedDrawing,
    'pictionary': scorePictionary,
  };
  return scorers[mode] || scoreHotTake;
}

module.exports = {
  scoreHotTake,
  scoreSpeedDrawing,
  scorePictionary,
  getScorerForMode,
};
