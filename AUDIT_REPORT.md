# Reconnection System - Bug Audit Report

## Summary
**Total Issues Found: 7**
- 🔴 **Critical**: 2
- 🟠 **High**: 2
- 🟡 **Medium**: 3

---

## 🔴 CRITICAL BUGS

### 1. **Race Condition in handlePlayerReconnect (Line 303)**
**File:** `src/reconnection-handler.js:303`

```javascript
playersByToken[token].socketId = socket.id;
```

**Problem:**
- If `handlePlayerDisconnect` fires its grace period callback AND `handlePlayerReconnect` is called, there's a race condition
- `playersByToken[token]` might not exist if it was deleted during cleanup
- This causes an error: `Cannot set property 'socketId' of undefined`

**Impact:** 🔴 Critical - Server crash/undefined error

**Fix:**
```javascript
function handlePlayerReconnect(socket, token, game, playersByToken, io, reconnectionManager) {
  const storedPlayer = reconnectionManager.getDisconnectedPlayer(token);

  if (!storedPlayer) {
    console.log(`❌ Player token ${token} not found or expired`);
    return false;
  }

  // ✅ FIX: Check if playersByToken entry still exists
  if (!playersByToken[token]) {
    console.log(`❌ Player session data lost for token ${token}`);
    return false;
  }

  reconnectionManager.cancelGracePeriod(token);

  game.players[socket.id] = {
    name: storedPlayer.name,
    score: storedPlayer.score,
    avatar: storedPlayer.avatar,
    token: token,
  };

  playersByToken[token].socketId = socket.id;  // Now safe
  // ... rest of function
}
```

---

### 2. **Memory Leak - Cleanup Interval Never Stops**
**File:** `src/reconnection-handler.js:124-155`

**Problem:**
- `startCleanupInterval()` creates a `setInterval` that runs forever
- No way to stop it when server restarts or needs cleanup
- On server reboot, all old intervals keep running
- This is especially problematic for long-running servers

**Impact:** 🔴 Critical - Memory leak, performance degradation over time

**Fix:**
```javascript
class ReconnectionManager {
  constructor() {
    this.disconnectedPlayers = new Map();
    this.reconnectTimers = new Map();
    this.cleanupInterval = null;  // ✅ Track the interval
    this.startCleanupInterval();
  }

  startCleanupInterval() {
    this.cleanupInterval = setInterval(() => {
      // ... existing cleanup code ...
    }, RECONNECT_CONFIG.CLEANUP_INTERVAL);
  }

  // ✅ NEW: Add method to stop cleanup
  stopCleanupInterval() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  // ✅ NEW: Destructor/shutdown hook
  destroy() {
    this.stopCleanupInterval();
    this.reconnectTimers.forEach(timer => clearTimeout(timer));
    this.reconnectTimers.clear();
    this.disconnectedPlayers.clear();
  }
}

// In server.js, add shutdown handler:
process.on('SIGTERM', () => {
  reconnectionManager.destroy();
  process.exit(0);
});
```

---

## 🟠 HIGH PRIORITY BUGS

### 3. **Inefficient Import in Callback**
**File:** `src/reconnection-handler.js:251`

```javascript
const scoring = require('./scoring');
```

**Problem:**
- Importing `scoring` module inside the grace period callback
- Callback runs during disconnect, importing is expensive
- Called once per disconnected player during grace period

**Impact:** 🟠 High - Performance issue, can be called repeatedly

**Fix:**
```javascript
// At top of file with other imports:
const scoring = require('./src/scoring');

// Then in handlePlayerDisconnect, use pre-imported module:
const scorer = scoring.getScorerForMode(game.gameMode);
```

---

### 4. **lastActivity Field Never Updated**
**File:** `src/reconnection-handler.js:44, 145`

**Problem:**
- `lastActivity` is set when player disconnects (line 44)
- But it's never updated when player is stored
- Cleanup logic on line 145 sorts by `lastActivity` but it never changes
- This means "oldest by activity" is actually "oldest by disconnect time", which is confusing and incorrect

**Impact:** 🟠 High - Incorrect cleanup order, misleading logic

**Fix:**
```javascript
storeDisconnectedPlayer(token, playerData) {
  if (!token) return false;

  // Check if this is an update to existing player
  const existingEntry = this.disconnectedPlayers.get(token);

  this.disconnectedPlayers.set(token, {
    name: playerData.name,
    score: playerData.score,
    avatar: playerData.avatar,
    sessionStartTime: existingEntry?.sessionStartTime || playerData.sessionStartTime || Date.now(),
    lastActivity: Date.now(),  // ✅ Always update on store
    wasPlaying: playerData.wasPlaying || false,
  });

  return true;
}
```

---

## 🟡 MEDIUM PRIORITY ISSUES

### 5. **Missing Reconnect Info UI Implementation**
**File:** `public/phone.html`

**Problem:**
- `screen-reconnect` HTML exists but has no "rejoin" button wired up
- `getRejoinInfo()` exists in reconnection-handler but is never called
- Player sees "reconnecting" state but has no way to manually rejoin

**Impact:** 🟡 Medium - UX issue, grace timer shows but no action buttons work

**Fix:**
```javascript
// In phone.html, after reconnect event handlers:

document.getElementById('btn-rejoin').addEventListener('click', () => {
  if (myToken) {
    socket.emit('reconnect-attempt', myToken);
  }
});

document.getElementById('btn-new-session').addEventListener('click', () => {
  myToken = null;
  sessionStorage.removeItem('hottake-token');
  location.reload();
});
```

---

### 6. **Duplicate Host Transfer Logic**
**File:** `server.js:695-703`

**Problem:**
- Host transfer logic exists in TWO places:
  - `handlePlayerDisconnect` (line 260-269)
  - `server.js disconnect handler` (line 695-703)
- If host disconnects during game, both run
- Slightly redundant but harmless

**Impact:** 🟡 Medium - Code duplication, confusing flow

**Fix:**
```javascript
// In server.js disconnect handler, remove the duplicate:
socket.on('disconnect', () => {
  const player = game.players[socket.id];

  if (socket.id === game.tvSocket) {
    game.tvSocket = null;
    console.log('📺 TV display disconnected');
  }

  if (player) {
    handlePlayerDisconnect(
      socket,
      game,
      playersByToken,
      io,
      reconnectionManager,
      gameLogic
    );
    // ✅ Remove duplicate host transfer from here
    // Host transfer is already handled in handlePlayerDisconnect
  }
});
```

---

### 7. **Grace Timer UI Not Hidden Initially**
**File:** `public/phone.html`

**Problem:**
- Reconnection screen starts as "hidden"
- Grace timer updates every second even when hidden
- Timer could be counting down on unseen page for days

**Impact:** 🟡 Medium - Wasted CPU cycles, DOM updates

**Fix:**
```javascript
function startGraceTimer() {
  graceSecondsRemaining = 120;
  if (graceTimerInterval) clearInterval(graceTimerInterval);

  // Only start timer if screen is actually visible
  if (!document.getElementById('screen-reconnect').classList.contains('hidden')) {
    graceTimerInterval = setInterval(() => {
      graceSecondsRemaining--;
      document.getElementById('grace-timer').textContent = graceSecondsRemaining;

      if (graceSecondsRemaining <= 30) {
        document.getElementById('grace-timer').className = 'grace-timer critical';
      }

      if (graceSecondsRemaining <= 0) {
        clearGraceTimer();
        showStatusMessage('Grace period expired. Starting new session...');
      }
    }, 1000);
  }
}
```

---

## 🟢 GOOD PRACTICES (No Issues)

✅ **Token Generation** - Using `crypto.randomBytes(16).toString('hex')` is secure
✅ **Grace Period Logic** - Correctly implemented with configurable timeouts
✅ **Game State Preservation** - Scores and answers correctly preserved
✅ **Error Handling** - Graceful fallbacks when reconnect fails
✅ **Cleanup** - Periodic cleanup of expired sessions (despite memory leak)

---

## Testing Checklist

After fixes, test these scenarios:

- [ ] **Rapid Reconnect**: Disconnect & reconnect within 1 second → Player restores
- [ ] **Grace Period Expiry**: Disconnect, wait > 120s → Graceful removal, game continues
- [ ] **Concurrent Disconnect/Reconnect**: Two clients simultaneously disconnect/reconnect → No crashes
- [ ] **Grace Timer**: Grace period countdown should match server state
- [ ] **Host Transfer**: If host disconnects, another player becomes host
- [ ] **Game Auto-Advance**: If player disconnects during prompt, game should advance when remaining players answer
- [ ] **Memory**: Long-running server (1+ hour) should not increase memory usage
- [ ] **Token Expiry**: After 1 hour, token should be invalid and player must rejoin

---

## Deployment Status

- ❌ **Do NOT deploy** until critical bugs (#1, #2) are fixed
- ⚠️ **High priority** bugs (#3, #4) should be fixed before production
- ℹ️ **Medium priority** bugs (#5, #6, #7) can be fixed in next sprint

---

## Summary of Fixes

| Issue | Severity | Fix Time | Priority |
|-------|----------|----------|----------|
| Race condition in reconnect | 🔴 | 5 min | NOW |
| Memory leak in cleanup | 🔴 | 10 min | NOW |
| Import in callback | 🟠 | 2 min | Before deploy |
| lastActivity not updated | 🟠 | 3 min | Before deploy |
| Missing rejoin UI | 🟡 | 5 min | Nice to have |
| Duplicate host transfer | 🟡 | 5 min | Nice to have |
| Grace timer always runs | 🟡 | 3 min | Nice to have |

**Total time to fix critical/high: ~25 minutes**

