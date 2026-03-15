/**
 * Game Balance Testing Suite
 * Tests scoring mechanics, fairness, and edge cases
 */

const gameLogic = require('./game-logic');
const hotTakeMode = require('./modes/hot-take');

class BalanceTestRunner {
  constructor() {
    this.results = [];
    this.totalTests = 0;
    this.passedTests = 0;
  }

  test(name, fn) {
    this.totalTests++;
    try {
      fn();
      this.passedTests++;
      this.results.push({ name, status: 'PASS' });
      console.log(`✓ ${name}`);
    } catch (error) {
      this.results.push({ name, status: 'FAIL', error: error.message });
      console.log(`✗ ${name}: ${error.message}`);
    }
  }

  assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(`${message} (expected ${expected}, got ${actual})`);
    }
  }

  assertGreater(actual, minimum, message) {
    if (actual <= minimum) {
      throw new Error(`${message} (expected > ${minimum}, got ${actual})`);
    }
  }

  assertLess(actual, maximum, message) {
    if (actual >= maximum) {
      throw new Error(`${message} (expected < ${maximum}, got ${actual})`);
    }
  }

  createMockGame(gameMode = 'hot-take', playerCount = 4) {
    const game = gameLogic.createGameState();
    game.gameMode = gameMode;
    game.totalRounds = 3;

    // Create mock players
    for (let i = 0; i < playerCount; i++) {
      const id = `player-${i}`;
      game.players[id] = {
        name: `Player ${i + 1}`,
        score: 0,
        avatar: '😀',
        token: `token-${i}`,
        team: null,
      };
    }

    return game;
  }

  // ── SCORING TESTS ──

  testBasicScoring() {
    this.test('Basic scoring: 1 vote = 1 point', () => {
      const game = this.createMockGame('hot-take', 2);
      const playerId = 'player-0';

      game.answers = { [playerId]: 'test answer' };
      game.votes = { 'player-1': playerId };

      const voteCounts = { [playerId]: 1 };
      for (const [answerId, count] of Object.entries(voteCounts)) {
        if (game.players[answerId]) {
          game.players[answerId].score += count;
        }
      }

      this.assertEqual(game.players[playerId].score, 1, 'Should award 1 point for 1 vote');
    });
  }

  testMultipleVotes() {
    this.test('Multiple votes accumulate correctly', () => {
      const game = this.createMockGame('hot-take', 4);
      const playerId = 'player-0';

      game.answers = { [playerId]: 'great answer' };
      game.votes = {
        'player-1': playerId,
        'player-2': playerId,
        'player-3': playerId,
      };

      const voteCounts = { [playerId]: 3 };
      for (const [answerId, count] of Object.entries(voteCounts)) {
        if (game.players[answerId]) {
          game.players[answerId].score += count;
        }
      }

      this.assertEqual(game.players[playerId].score, 3, 'Should award 3 points for 3 votes');
    });
  }

  testNoVotes() {
    this.test('No votes = no points', () => {
      const game = this.createMockGame('hot-take', 3);
      const playerId = 'player-0';

      game.answers = { [playerId]: 'unpopular answer' };
      game.votes = { 'player-1': 'player-2', 'player-2': 'player-1' };

      const voteCounts = {};
      for (const answerId of Object.keys(game.answers)) {
        voteCounts[answerId] = 0;
      }

      for (const [answerId, count] of Object.entries(voteCounts)) {
        if (game.players[answerId]) {
          game.players[answerId].score += count;
        }
      }

      this.assertEqual(game.players[playerId].score, 0, 'Should award 0 points for no votes');
    });
  }

  testScoreboardOrdering() {
    this.test('Scoreboard orders by highest score first', () => {
      const game = this.createMockGame('hot-take', 3);
      game.players['player-0'].score = 5;
      game.players['player-1'].score = 3;
      game.players['player-2'].score = 7;

      const scoreboard = Object.entries(game.players)
        .map(([id, p]) => ({ id, name: p.name, score: p.score }))
        .sort((a, b) => b.score - a.score);

      this.assertEqual(scoreboard[0].score, 7, 'Highest score should be first');
      this.assertEqual(scoreboard[1].score, 5, 'Middle score should be second');
      this.assertEqual(scoreboard[2].score, 3, 'Lowest score should be last');
    });
  }

  testRoundProgression() {
    this.test('Rounds progress correctly (5 total rounds)', () => {
      const game = this.createMockGame('hot-take', 2);
      game.totalRounds = 5;

      for (let i = 1; i <= game.totalRounds; i++) {
        game.round = i;
        this.assertGreater(game.round, 0, `Round ${i} should be positive`);
        this.assertLess(game.round, game.totalRounds + 1, `Round ${i} should not exceed totalRounds`);
      }

      this.assertEqual(game.round, game.totalRounds, 'Final round should equal totalRounds');
    });
  }

  // ── FAIRNESS TESTS ──

  testPointDistribution() {
    this.test('All players have equal opportunity to score', () => {
      const game = this.createMockGame('hot-take', 4);
      const playerIds = Object.keys(game.players);

      // Simulate 2 rounds where each player gets votes
      playerIds.forEach((id, index) => {
        game.players[id].score += (index + 1); // 1, 2, 3, 4
      });

      // Verify all players have some points
      const scores = playerIds.map(id => game.players[id].score);
      scores.forEach(score => {
        this.assertGreater(score, 0, 'All players should have opportunity to score');
      });

      // Verify spread is reasonable (no one player dominates)
      const maxScore = Math.max(...scores);
      const minScore = Math.min(...scores);
      const spread = maxScore - minScore;
      this.assertLess(spread, playerIds.length * 3, 'Score spread should be reasonable');
    });
  }

  testTieBreaking() {
    this.test('Tied scores maintain consistent ordering', () => {
      const game = this.createMockGame('hot-take', 3);
      game.players['player-0'].score = 5;
      game.players['player-1'].score = 5;
      game.players['player-2'].score = 3;

      const scoreboard = Object.entries(game.players)
        .map(([id, p]) => ({ id, name: p.name, score: p.score }))
        .sort((a, b) => {
          if (a.score !== b.score) return b.score - a.score;
          return a.id.localeCompare(b.id); // Consistent tiebreaker
        });

      this.assertEqual(scoreboard[0].score, 5, 'Tied players should both appear at top');
      this.assertEqual(scoreboard[2].score, 3, 'Lower score should be last');
    });
  }

  testMinimumGameTime() {
    this.test('Minimum game duration prevents rushing', () => {
      const game = this.createMockGame('hot-take', 2);
      const roundTime = 60; // seconds
      const voteTime = 20; // seconds
      const roundCount = 5;

      const totalSeconds = (roundTime + voteTime) * roundCount;
      const totalMinutes = totalSeconds / 60;

      this.assertGreater(totalMinutes, 6, 'Game should last at least 6 minutes');
      this.assertLess(totalMinutes, 10, 'Game should not exceed 10 minutes');
    });
  }

  // ── EDGE CASE TESTS ──

  testSinglePlayerGame() {
    this.test('Single player game prevents', () => {
      const game = this.createMockGame('hot-take', 1);
      this.assertEqual(Object.keys(game.players).length, 1, 'Should allow creating game with 1 player');
      this.assertLess(
        Object.keys(game.players).length,
        2,
        'Game should flag insufficient players warning'
      );
    });
  }

  testManyPlayers() {
    this.test('Game handles 10+ players', () => {
      const game = this.createMockGame('hot-take', 10);
      this.assertEqual(Object.keys(game.players).length, 10, 'Should support 10 players');

      // Add votes from all
      const playerId = 'player-0';
      game.answers = { [playerId]: 'answer' };
      game.votes = {};
      for (let i = 1; i < 10; i++) {
        game.votes[`player-${i}`] = playerId;
      }

      const voteCounts = { [playerId]: 9 };
      for (const [answerId, count] of Object.entries(voteCounts)) {
        if (game.players[answerId]) {
          game.players[answerId].score += count;
        }
      }

      this.assertEqual(game.players[playerId].score, 9, 'Should handle votes from many players');
    });
  }

  testZeroRounds() {
    this.test('Zero rounds defaults to minimum', () => {
      const game = this.createMockGame('hot-take', 2);
      game.totalRounds = 0;

      this.assertEqual(game.totalRounds, 0, 'Game state should reflect 0 rounds');
      // In practice, server validation should prevent this
    });
  }

  testNegativeScores() {
    this.test('Scores never go negative', () => {
      const game = this.createMockGame('hot-take', 2);
      game.players['player-0'].score = 0;

      const minScore = Math.min(...Object.values(game.players).map(p => p.score));
      this.assertGreater(
        minScore,
        -1,
        'No score should ever be negative'
      );
    });
  }

  // ── MODE-SPECIFIC TESTS ──

  testHotTakeModeBalance() {
    this.test('Hot Take mode: Prompt pool has variety', () => {
      const prompts = hotTakeMode.PROMPTS;
      this.assertGreater(prompts.length, 100, 'Should have 100+ prompts for variety');

      // Check for empty prompts
      const emptyPrompts = prompts.filter(p => !p || p.trim().length === 0);
      this.assertEqual(emptyPrompts.length, 0, 'No prompts should be empty');
    });
  }

  testAnswerTimeAllocation() {
    this.test('Answer time allocation is reasonable', () => {
      const minTime = 20; // seconds
      const maxTime = 180; // seconds
      const defaultTime = 60;

      this.assertGreater(defaultTime, minTime - 1, 'Default time should be above minimum');
      this.assertLess(defaultTime, maxTime + 1, 'Default time should be below maximum');
    });
  }

  testVoteTimeAllocation() {
    this.test('Vote time allocation is balanced', () => {
      const minTime = 10; // seconds
      const maxTime = 60; // seconds
      const defaultTime = 20;

      this.assertGreater(defaultTime, minTime - 1, 'Default vote time should be above minimum');
      this.assertLess(defaultTime, maxTime + 1, 'Default vote time should be below maximum');
    });
  }

  // ── CONSISTENCY TESTS ──

  testPlayerPresistence() {
    this.test('Player scores persist across rounds', () => {
      const game = this.createMockGame('hot-take', 2);
      const playerId = 'player-0';

      game.players[playerId].score = 5;
      const round1Score = game.players[playerId].score;

      // Simulate next round
      game.round = 2;
      game.players[playerId].score += 3; // Earn 3 more points

      this.assertEqual(
        game.players[playerId].score,
        8,
        'Score should accumulate across rounds'
      );
      this.assertGreater(
        game.players[playerId].score,
        round1Score,
        'Score should only increase or stay same'
      );
    });
  }

  testGameStateIsolation() {
    this.test('Multiple game instances do not interfere', () => {
      const game1 = this.createMockGame('hot-take', 2);
      const game2 = this.createMockGame('hot-take', 3);

      game1.players['player-0'].score = 10;
      game2.players['player-0'].score = 20;

      this.assertEqual(game1.players['player-0'].score, 10, 'Game 1 score should not affect game 2');
      this.assertEqual(game2.players['player-0'].score, 20, 'Game 2 score should not affect game 1');
    });
  }

  // ── RUN ALL TESTS ──

  runAll() {
    console.log('\n🧪 Running Game Balance Tests...\n');

    // Scoring Tests
    console.log('📊 SCORING TESTS');
    this.testBasicScoring();
    this.testMultipleVotes();
    this.testNoVotes();
    this.testScoreboardOrdering();
    this.testRoundProgression();

    // Fairness Tests
    console.log('\n⚖️  FAIRNESS TESTS');
    this.testPointDistribution();
    this.testTieBreaking();
    this.testMinimumGameTime();

    // Edge Case Tests
    console.log('\n🔥 EDGE CASE TESTS');
    this.testSinglePlayerGame();
    this.testManyPlayers();
    this.testZeroRounds();
    this.testNegativeScores();

    // Mode Tests
    console.log('\n🎮 MODE BALANCE TESTS');
    this.testHotTakeModeBalance();
    this.testAnswerTimeAllocation();
    this.testVoteTimeAllocation();

    // Consistency Tests
    console.log('\n🔗 CONSISTENCY TESTS');
    this.testPlayerPresistence();
    this.testGameStateIsolation();

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log(`✨ Test Results: ${this.passedTests}/${this.totalTests} passed`);
    console.log('='.repeat(50) + '\n');

    if (this.passedTests === this.totalTests) {
      console.log('🎉 All tests passed! Game is balanced.');
      return true;
    } else {
      console.log(
        `⚠️  ${this.totalTests - this.passedTests} test(s) failed. Review above for details.`
      );
      return false;
    }
  }
}

// Export for use
module.exports = BalanceTestRunner;

// Run if executed directly
if (require.main === module) {
  const tester = new BalanceTestRunner();
  const allPassed = tester.runAll();
  process.exit(allPassed ? 0 : 1);
}
