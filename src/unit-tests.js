/**
 * Unit Test Suite for TV Party Game
 * Tests core game logic, scoring, and mode handlers
 */

const gameLogic = require('./game-logic');
const hotTakeMode = require('./modes/hot-take');
const speedDrawingMode = require('./modes/speed-drawing');
const pictionary = require('./modes/pictionary');

class TestRunner {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  test(name, fn) {
    try {
      fn();
      this.passed++;
      console.log(`✓ ${name}`);
    } catch (error) {
      this.failed++;
      console.log(`✗ ${name}`);
      console.log(`  Error: ${error.message}`);
    }
  }

  assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
    }
  }

  assertDefined(value, message) {
    if (value === undefined || value === null) {
      throw new Error(`${message} - value is undefined/null`);
    }
  }

  assertType(value, type, message) {
    if (typeof value !== type) {
      throw new Error(`${message} - expected ${type}, got ${typeof value}`);
    }
  }

  assertArray(value, message) {
    if (!Array.isArray(value)) {
      throw new Error(`${message} - expected array`);
    }
  }

  assertGreater(actual, minimum, message) {
    if (actual <= minimum) {
      throw new Error(`${message} - ${actual} is not greater than ${minimum}`);
    }
  }

  printSummary() {
    const total = this.passed + this.failed;
    console.log('\n' + '='.repeat(50));
    console.log(`Unit Test Results: ${this.passed}/${total} passed`);
    console.log('='.repeat(50) + '\n');

    if (this.failed === 0) {
      console.log('🎉 All unit tests passed!');
      return true;
    } else {
      console.log(`❌ ${this.failed} test(s) failed`);
      return false;
    }
  }
}

// ── GAME LOGIC TESTS ──

function testGameLogic(runner) {
  console.log('\n📋 GAME LOGIC TESTS');

  runner.test('createGameState: initializes valid game state', () => {
    const game = gameLogic.createGameState();
    runner.assertDefined(game.phase, 'Phase should be defined');
    runner.assertDefined(game.players, 'Players should be defined');
    runner.assertDefined(game.round, 'Round should be defined');
    runner.assertEqual(game.phase, 'lobby', 'Initial phase should be lobby');
    runner.assertEqual(game.round, 0, 'Initial round should be 0');
  });

  runner.test('createGameState: has required properties', () => {
    const game = gameLogic.createGameState();
    const required = ['phase', 'players', 'round', 'totalRounds', 'gameMode', 'currentPrompt', 'answers', 'votes', 'usedPrompts', 'customSettings'];
    required.forEach(prop => {
      runner.assertDefined(game[prop], `Game state should have ${prop}`);
    });
  });

  runner.test('createGameState: initializes empty players object', () => {
    const game = gameLogic.createGameState();
    runner.assertEqual(Object.keys(game.players).length, 0, 'Players should start empty');
  });

  runner.test('checkAllAnswered: returns false with no answers', () => {
    const game = gameLogic.createGameState();
    game.players = { 'p1': {}, 'p2': {} };
    const result = gameLogic.checkAllAnswered(game);
    runner.assertEqual(result, false, 'Should return false when no answers submitted');
  });

  runner.test('checkAllAnswered: returns true when all answered', () => {
    const game = gameLogic.createGameState();
    game.players = { 'p1': {}, 'p2': {} };
    game.answers = { 'p1': 'answer1', 'p2': 'answer2' };
    const result = gameLogic.checkAllAnswered(game);
    runner.assertEqual(result, true, 'Should return true when all players answered');
  });

  runner.test('checkAllVoted: returns false with no votes', () => {
    const game = gameLogic.createGameState();
    game.players = { 'p1': {}, 'p2': {} };
    const result = gameLogic.checkAllVoted(game);
    runner.assertEqual(result, false, 'Should return false when no votes submitted');
  });

  runner.test('checkAllVoted: returns true when all voted', () => {
    const game = gameLogic.createGameState();
    game.players = { 'p1': {}, 'p2': {} };
    game.votes = { 'p1': 'answer1', 'p2': 'answer2' };
    const result = gameLogic.checkAllVoted(game);
    runner.assertEqual(result, true, 'Should return true when all players voted');
  });

  runner.test('getRandomCommentary: returns a string', () => {
    const commentary = gameLogic.getRandomCommentary();
    runner.assertType(commentary, 'string', 'Commentary should be a string');
    runner.assertGreater(commentary.length, 0, 'Commentary should not be empty');
  });

  runner.test('getRandomCommentary: returns different commentaries', () => {
    const comments = new Set();
    for (let i = 0; i < 20; i++) {
      comments.add(gameLogic.getRandomCommentary());
    }
    runner.assertGreater(comments.size, 1, 'Should return multiple different commentaries');
  });
}

// ── HOT TAKE MODE TESTS ──

function testHotTakeMode(runner) {
  console.log('\n🔥 HOT TAKE MODE TESTS');

  runner.test('Hot Take: PROMPTS array is populated', () => {
    runner.assertArray(hotTakeMode.PROMPTS, 'PROMPTS should be an array');
    runner.assertGreater(hotTakeMode.PROMPTS.length, 100, 'Should have 100+ prompts');
  });

  runner.test('Hot Take: All prompts are non-empty strings', () => {
    hotTakeMode.PROMPTS.forEach((prompt, index) => {
      runner.assertType(prompt, 'string', `Prompt ${index} should be a string`);
      runner.assertGreater(prompt.length, 0, `Prompt ${index} should not be empty`);
    });
  });

  runner.test('Hot Take: pickPrompt returns a string', () => {
    const game = gameLogic.createGameState();
    const prompt = hotTakeMode.pickPrompt(game);
    runner.assertType(prompt, 'string', 'Should return a string prompt');
    runner.assertGreater(prompt.length, 0, 'Prompt should not be empty');
  });

  runner.test('Hot Take: pickPrompt cycles through prompts', () => {
    const game = gameLogic.createGameState();
    const prompts = new Set();
    for (let i = 0; i < 10; i++) {
      prompts.add(hotTakeMode.pickPrompt(game));
    }
    runner.assertGreater(prompts.size, 1, 'Should return different prompts');
  });

  runner.test('Hot Take: pickPrompt avoids duplicates within session', () => {
    const game = gameLogic.createGameState();
    const first = hotTakeMode.pickPrompt(game);
    const second = hotTakeMode.pickPrompt(game);
    runner.assert(first !== second, 'Should not return same prompt immediately after');
  });

  runner.test('Hot Take: validateAnswer accepts valid text', () => {
    const result = hotTakeMode.validateAnswer('valid answer');
    runner.assertDefined(result, 'Should accept valid answer text');
  });

  runner.test('Hot Take: validateAnswer rejects empty text', () => {
    const result = hotTakeMode.validateAnswer('   ');
    runner.assertEqual(result, null, 'Should reject whitespace-only text');
  });

  runner.test('Hot Take: validateAnswer truncates long text', () => {
    const longText = 'a'.repeat(300);
    const result = hotTakeMode.validateAnswer(longText);
    runner.assertGreater(result.length, 0, 'Should process long text');
    runner.assert(result.length <= 200, 'Should truncate to 200 chars');
  });
}

// ── SPEED DRAWING MODE TESTS ──

function testSpeedDrawingMode(runner) {
  console.log('\n🎨 SPEED DRAWING MODE TESTS');

  runner.test('Speed Drawing: DRAWING_PROMPTS array is populated', () => {
    runner.assertArray(speedDrawingMode.DRAWING_PROMPTS, 'Should be an array');
    runner.assertGreater(speedDrawingMode.DRAWING_PROMPTS.length, 50, 'Should have 50+ prompts');
  });

  runner.test('Speed Drawing: pickPrompt returns valid prompt', () => {
    const game = gameLogic.createGameState();
    const prompt = speedDrawingMode.pickPrompt(game);
    runner.assertType(prompt, 'string', 'Should return string prompt');
    runner.assert(prompt.includes('Draw'), 'Prompts should start with Draw');
  });

  runner.test('Speed Drawing: validateDrawing rejects non-base64', () => {
    const result = speedDrawingMode.validateDrawing('not-valid-base64');
    runner.assertEqual(result, null, 'Should reject invalid base64');
  });

  runner.test('Speed Drawing: validateDrawing accepts valid base64 image', () => {
    const validImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const result = speedDrawingMode.validateDrawing(validImage);
    runner.assertDefined(result, 'Should accept valid base64 image');
  });
}

// ── PICTIONARY MODE TESTS ──

function testPictionaryMode(runner) {
  console.log('\n🎭 PICTIONARY MODE TESTS');

  runner.test('Pictionary: PICTIONARY_WORDS array is populated', () => {
    runner.assertArray(pictionary.PICTIONARY_WORDS, 'Should be an array');
    runner.assertGreater(pictionary.PICTIONARY_WORDS.length, 80, 'Should have 80+ words');
  });

  runner.test('Pictionary: pickWord returns valid word', () => {
    const game = gameLogic.createGameState();
    const word = pictionary.pickWord(game);
    runner.assertType(word, 'string', 'Should return string word');
    runner.assertGreater(word.length, 0, 'Word should not be empty');
  });

  runner.test('Pictionary: validateGuess accepts valid text', () => {
    const result = pictionary.validateGuess('cat');
    runner.assertDefined(result, 'Should accept valid guess');
    runner.assertEqual(result, 'cat', 'Should return cleaned text');
  });

  runner.test('Pictionary: validateGuess rejects empty text', () => {
    const result = pictionary.validateGuess('   ');
    runner.assertEqual(result, null, 'Should reject empty guess');
  });

  runner.test('Pictionary: isGuessCorrect - exact match', () => {
    const result = pictionary.isGuessCorrect('cat', 'cat');
    runner.assertEqual(result, true, 'Should match exact word');
  });

  runner.test('Pictionary: isGuessCorrect - case insensitive', () => {
    const result = pictionary.isGuessCorrect('CAT', 'cat');
    runner.assertEqual(result, true, 'Should match case-insensitive');
  });

  runner.test('Pictionary: isGuessCorrect - ignores whitespace', () => {
    const result = pictionary.isGuessCorrect('  cat  ', 'cat');
    runner.assertEqual(result, true, 'Should match after trimming');
  });

  runner.test('Pictionary: isGuessCorrect - rejects wrong word', () => {
    const result = pictionary.isGuessCorrect('dog', 'cat');
    runner.assertEqual(result, false, 'Should not match different word');
  });

  runner.test('Pictionary: assignDrawer rotates players', () => {
    const game = gameLogic.createGameState();
    game.players = { 'p1': {}, 'p2': {}, 'p3': {} };
    game.currentDrawer = 'p1';

    const drawer1 = pictionary.assignDrawer(game);
    runner.assertDefined(drawer1, 'Should assign a drawer');
    runner.assert(Object.keys(game.players).includes(drawer1), 'Drawer should be a valid player');
  });
}

// ── MAIN TEST EXECUTION ──

function runAllTests() {
  const runner = new TestRunner();

  testGameLogic(runner);
  testHotTakeMode(runner);
  testSpeedDrawingMode(runner);
  testPictionaryMode(runner);

  return runner.printSummary();
}

// Export for use
module.exports = { TestRunner, runAllTests };

// Run if executed directly
if (require.main === module) {
  console.log('🧪 Running Unit Tests for TV Party Game\n');
  const allPassed = runAllTests();
  process.exit(allPassed ? 0 : 1);
}
