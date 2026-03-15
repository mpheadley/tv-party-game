/**
 * Reconnection Handler
 * Ensures players are never permanently booted from the game
 */

// Import scoring module at top to avoid repeated imports
const scoring = require('./scoring');

/**
 * Configuration for graceful disconnection handling
 */
const RECONNECT_CONFIG = {
  // Grace periods (time before player is actually removed)
  GRACE_PERIOD_LOBBY: 15000,        // 15s in lobby (can rejoin)
  GRACE_PERIOD_MID_GAME: 120000,    // 2 minutes mid-game (generous for mobile)

  // Reconnection tokens (how long token remains valid)
  TOKEN_VALIDITY: 3600000,          // 1 hour - token never expires in active session

  // Automatic cleanup
  MAX_DISCONNECTED_PLAYERS: 50,     // Store up to 50 disconnected player sessions
  CLEANUP_INTERVAL: 300000,         // Every 5 minutes, clean old disconnected players
};

/**
 * Manages persistent player sessions across disconnections
 */
class ReconnectionManager {
  constructor() {
    // playersByToken stores: { token: { name, score, avatar, sessionStartTime, lastActivity } }
    this.disconnectedPlayers = new Map();
    this.reconnectTimers = new Map();
    this.cleanupInterval = null;
    this.startCleanupInterval();
  }

  /**
   * Store player session when they disconnect
   */
  storeDisconnectedPlayer(token, playerData) {
    if (!token) return false;

    // Preserve sessionStartTime if updating existing player
    const existingEntry = this.disconnectedPlayers.get(token);
    const sessionStartTime = existingEntry?.sessionStartTime || playerData.sessionStartTime || Date.now();

    this.disconnectedPlayers.set(token, {
      name: playerData.name,
      score: playerData.score,
      avatar: playerData.avatar,
      sessionStartTime: sessionStartTime,
      lastActivity: Date.now(),  // Always update on store
      wasPlaying: playerData.wasPlaying || false,
    });

    return true;
  }

  /**
   * Retrieve player session and check if still valid
   */
  getDisconnectedPlayer(token) {
    if (!token) return null;

    const player = this.disconnectedPlayers.get(token);
    if (!player) return null;

    // Check if token is still valid (within session lifetime)
    const timeSinceStart = Date.now() - player.sessionStartTime;
    if (timeSinceStart > RECONNECT_CONFIG.TOKEN_VALIDITY) {
      this.disconnectedPlayers.delete(token);
      return null;
    }

    return player;
  }

  /**
   * Clear disconnected player session (after grace period expires)
   */
  clearDisconnectedPlayer(token) {
    this.disconnectedPlayers.delete(token);
    if (this.reconnectTimers.has(token)) {
      clearTimeout(this.reconnectTimers.get(token));
      this.reconnectTimers.delete(token);
    }
  }

  /**
   * Set up grace period timer
   * @param token - Player's persistent token
   * @param graceMs - Grace period duration
   * @param onExpire - Callback when grace expires
   */
  setGracePeriod(token, graceMs, onExpire) {
    // Cancel existing timer
    if (this.reconnectTimers.has(token)) {
      clearTimeout(this.reconnectTimers.get(token));
    }

    const timer = setTimeout(() => {
      this.clearDisconnectedPlayer(token);
      if (onExpire) onExpire();
    }, graceMs);

    this.reconnectTimers.set(token, timer);
  }

  /**
   * Cancel grace period (player reconnected)
   */
  cancelGracePeriod(token) {
    if (this.reconnectTimers.has(token)) {
      clearTimeout(this.reconnectTimers.get(token));
      this.reconnectTimers.delete(token);
    }
  }

  /**
   * Get all valid disconnected players
   */
  getAllDisconnectedPlayers() {
    return Array.from(this.disconnectedPlayers.entries()).map(([token, data]) => ({
      token,
      ...data,
    }));
  }

  /**
   * Clean up old sessions periodically
   */
  startCleanupInterval() {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;

      for (const [token, player] of this.disconnectedPlayers.entries()) {
        const age = now - player.sessionStartTime;
        if (age > RECONNECT_CONFIG.TOKEN_VALIDITY) {
          this.clearDisconnectedPlayer(token);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        console.log(`🧹 Cleaned up ${cleaned} expired player session(s)`);
      }

      // Also enforce max disconnected players
      if (this.disconnectedPlayers.size > RECONNECT_CONFIG.MAX_DISCONNECTED_PLAYERS) {
        const toRemove = this.disconnectedPlayers.size - RECONNECT_CONFIG.MAX_DISCONNECTED_PLAYERS;
        const entries = Array.from(this.disconnectedPlayers.entries())
          .sort((a, b) => a[1].lastActivity - b[1].lastActivity)
          .slice(0, toRemove);

        entries.forEach(([token]) => {
          this.clearDisconnectedPlayer(token);
        });

        console.log(`⚠️  Removed ${toRemove} oldest disconnected player session(s)`);
      }
    }, RECONNECT_CONFIG.CLEANUP_INTERVAL);
  }

  /**
   * Stop cleanup interval (for graceful shutdown)
   */
  stopCleanupInterval() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Clean up all timers and data (for shutdown)
   */
  destroy() {
    this.stopCleanupInterval();
    this.reconnectTimers.forEach(timer => clearTimeout(timer));
    this.reconnectTimers.clear();
    this.disconnectedPlayers.clear();
  }

  /**
   * Check if player can rejoin with their token
   */
  canPlayerRejoin(token) {
    return this.getDisconnectedPlayer(token) !== null;
  }

  /**
   * Get rejoin info for display
   */
  getRejoinInfo(token) {
    const player = this.getDisconnectedPlayer(token);
    if (!player) return null;

    return {
      name: player.name,
      avatar: player.avatar,
      score: player.score,
      wasPlaying: player.wasPlaying,
      message: player.wasPlaying
        ? `${player.name}, you were disconnected! Tap to rejoin the game.`
        : `Welcome back, ${player.name}! Your stats have been saved.`,
    };
  }
}

/**
 * Enhanced disconnect handler for socket.io events
 * Call this from server.js disconnect handler
 */
function handlePlayerDisconnect(socket, game, playersByToken, io, reconnectionManager, gameLogic) {
  const player = game.players[socket.id];

  if (!player) return;

  const token = player.token;
  const wasInGame = game.phase !== 'lobby';
  const inLobby = !wasInGame;

  console.log(`⚠️  ${player.name} disconnected (token: ${token})${inLobby ? ' [lobby]' : ' [mid-game]'}`);

  // In lobby, remove immediately (no game state to preserve)
  if (inLobby) {
    delete game.players[socket.id];
    // Still store in reconnectionManager but with immediate cleanup option
    reconnectionManager.storeDisconnectedPlayer(token, {
      name: player.name,
      score: player.score,
      avatar: player.avatar,
      sessionStartTime: playersByToken[token]?.sessionStartTime,
      wasPlaying: false,
    });
    io.emit('player-update', Object.values(game.players).map(p => ({
      name: p.name,
      avatar: p.avatar,
    })));
    return;
  }

  // Store in persistent session (mid-game disconnect)
  reconnectionManager.storeDisconnectedPlayer(token, {
    name: player.name,
    score: player.score,
    avatar: player.avatar,
    sessionStartTime: playersByToken[token]?.sessionStartTime,
    wasPlaying: wasInGame,
  });

  // Update playersByToken
  if (playersByToken[token]) {
    playersByToken[token].score = player.score;
  }

  // Set up grace period for mid-game disconnects
  reconnectionManager.setGracePeriod(token, RECONNECT_CONFIG.GRACE_PERIOD_MID_GAME, () => {
    // Grace period expired
    console.log(`⏱️  ${player.name}'s grace period expired — removing from game`);

    // Remove from current game
    delete game.players[socket.id];
    delete game.answers[socket.id];
    delete game.votes[socket.id];

    // Notify remaining players
    io.emit('player-update', Object.values(game.players).map(p => ({
      name: p.name,
      avatar: p.avatar,
    })));

    // Check game state
    const remaining = Object.keys(game.players).length;

    if (remaining === 0) {
      // All gone — reset
      gameLogic.resetGame(game, playersByToken);
      console.log('👋 All players disconnected — game reset to lobby');
    } else if (remaining === 1 && wasInGame) {
      // Only 1 player left mid-game
      console.log('⚠️  Not enough players to continue');
      gameLogic.endGame(game, io);
    } else if (remaining >= 1 && wasInGame) {
      // Game continues with remaining players
      // Check if we can auto-advance
      if (game.phase === 'prompt' && gameLogic.checkAllAnswered(game)) {
        clearTimeout(game.roundTimer);
        gameLogic.startVoting(game, io);
        console.log('✅ All remaining players answered — advancing to voting');
      } else if (game.phase === 'vote' && gameLogic.checkAllVoted(game)) {
        const scorer = scoring.getScorerForMode(game.gameMode);
        const scoreRound = (game, voteCounts) => scorer(game, voteCounts, playersByToken);
        gameLogic.tallyAndShowResults(game, io, scoreRound);
        console.log('✅ All remaining players voted — showing results');
      }
    }

    // Handle host transfer
    if (game.hostSocket === socket.id) {
      const remainingIds = Object.keys(game.players);
      if (remainingIds.length > 0) {
        game.hostSocket = remainingIds[0];
        io.to(game.hostSocket).emit('host-assigned');
        console.log(`👑 Host transferred to ${game.players[game.hostSocket].name}`);
      } else {
        game.hostSocket = null;
      }
    }
  });

  // Emit disconnect notification (only for mid-game, since we return early for lobby)
  io.emit('player-disconnected', {
    name: player.name,
    graceSeconds: Math.floor(RECONNECT_CONFIG.GRACE_PERIOD_MID_GAME / 1000),
    canRejoin: true,
  });
}

/**
 * Handle player reconnection
 * Call this when a player rejoins with their token
 */
function handlePlayerReconnect(socket, token, game, playersByToken, io, reconnectionManager) {
  const storedPlayer = reconnectionManager.getDisconnectedPlayer(token);

  if (!storedPlayer) {
    console.log(`❌ Player token ${token} not found or expired`);
    return false;
  }

  // ✅ FIX: Check if playersByToken entry still exists (race condition)
  if (!playersByToken[token]) {
    console.log(`❌ Player session data lost for token ${token} (grace period may have expired)`);
    return false;
  }

  // Cancel grace period
  reconnectionManager.cancelGracePeriod(token);

  // Re-add player to game
  game.players[socket.id] = {
    name: storedPlayer.name,
    score: storedPlayer.score,
    avatar: storedPlayer.avatar,
    token: token,
  };

  // Now safe to update socketId (playersByToken[token] is guaranteed to exist)
  playersByToken[token].socketId = socket.id;

  console.log(`✅ ${storedPlayer.name} reconnected (was in game: ${storedPlayer.wasPlaying})`);

  // Emit reconnect notification
  io.emit('player-reconnected', {
    name: storedPlayer.name,
    avatar: storedPlayer.avatar,
  });

  io.emit('player-update', Object.values(game.players).map(p => ({
    name: p.name,
    avatar: p.avatar,
  })));

  return true;
}

module.exports = {
  RECONNECT_CONFIG,
  ReconnectionManager,
  handlePlayerDisconnect,
  handlePlayerReconnect,
};
