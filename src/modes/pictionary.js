/**
 * Pictionary Mode Handler
 * One player draws a word, others guess. Voting on guess correctness
 */

const PICTIONARY_WORDS = [
  // Objects
  "cat", "dog", "house", "tree", "car", "phone", "book", "cup",
  "shoe", "hat", "flower", "sun", "cloud", "moon", "star", "pizza",
  "bicycle", "airplane", "ship", "train", "elephant", "penguin",

  // Actions / Verbs
  "jump", "dance", "run", "swim", "fly", "sing", "sleep", "eat",
  "write", "draw", "read", "laugh", "cry", "scream", "yawn",

  // Emotions / States
  "happy", "sad", "angry", "tired", "scared", "excited", "bored",
  "confused", "sick", "dizzy",

  // Concepts
  "money", "love", "time", "dream", "magic", "ghost", "robot",
  "dinosaur", "alien", "volcano", "ice cream", "cake", "rainbow",

  // School / Life
  "homework", "test", "school", "teacher", "student", "pencil",
  "computer", "keyboard", "mouse", "monitor", "desk", "chair",

  // Hard (Tricky) - use less often
  "procrastination", "reflection", "gravity", "telescope", "microscope",
  "skeleton", "bridge", "ladder", "crown", "pyramid", "anchor",

  // Silly / Funny
  "potato", "spaghetti", "pickle", "taco", "donut", "sushi",
  "burger", "noodles", "chicken", "fish", "octopus", "jellyfish",
];

/**
 * Pick a word for Pictionary
 */
function pickWord(game, customPrompts = []) {
  const allWords = [...PICTIONARY_WORDS, ...customPrompts];
  const available = allWords.filter(w => !game.usedPrompts.includes(w));

  if (available.length === 0) {
    game.usedPrompts = [];
  }

  const pool = available.length > 0 ? available : allWords;
  const word = pool[Math.floor(Math.random() * pool.length)];
  game.usedPrompts.push(word);
  return word;
}

/**
 * Assign the next drawer (rotate through players)
 * In team mode, rotate within team
 */
function assignDrawer(game, teamsModule) {
  const playerIds = Object.keys(game.players);
  if (playerIds.length === 0) return null;

  if (game.teamMode && teamsModule) {
    // Get next team to have someone draw
    const teamIds = Object.keys(game.teams);
    const currentTeamId = game.currentDrawerTeamId;

    let nextTeamId;
    if (!currentTeamId) {
      nextTeamId = teamIds[0];
    } else {
      const currentIndex = teamIds.indexOf(currentTeamId);
      nextTeamId = teamIds[(currentIndex + 1) % teamIds.length];
    }

    game.currentDrawerTeamId = nextTeamId;
    const team = game.teams[nextTeamId];

    // Get next player from team
    if (team && team.players.length > 0) {
      const playerId = team.players[team.currentAnswerIndex];
      team.currentAnswerIndex = (team.currentAnswerIndex + 1) % team.players.length;
      return playerId;
    }
  } else {
    // Solo mode: rotate through all players
    const currentDrawerId = game.currentDrawer;
    let nextIndex = 0;

    if (currentDrawerId) {
      const currentIndex = playerIds.indexOf(currentDrawerId);
      nextIndex = (currentIndex + 1) % playerIds.length;
    }

    return playerIds[nextIndex];
  }

  return null;
}

/**
 * Validate a guess (simple string)
 */
function validateGuess(text) {
  const cleaned = String(text).trim().slice(0, 100);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Check if a guess is correct (simple case-insensitive comparison)
 */
function isGuessCorrect(guess, answer) {
  const normGuess = guess.toLowerCase().trim();
  const normAnswer = answer.toLowerCase().trim();

  // Exact match or very close
  return normGuess === normAnswer;
}

module.exports = {
  PICTIONARY_WORDS,
  pickWord,
  assignDrawer,
  validateGuess,
  isGuessCorrect,
};
