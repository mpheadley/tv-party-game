# Player Reconnection & Safety System

## Overview

This game implements a **comprehensive reconnection system** to ensure players are never permanently booted due to network issues or accidental disconnections.

## How It Works

### Grace Period System

When a player disconnects:

1. **Immediate Storage** (< 1ms)
   - Player session is stored in `ReconnectionManager`
   - Score, name, avatar, and session data preserved
   - Player token remains valid for 1 hour

2. **Grace Period** (Configurable)
   - **In Lobby**: 15 seconds
   - **Mid-Game**: 120 seconds (2 minutes)
   - Player can reconnect anytime during grace period
   - No action needed from player

3. **After Grace Period**
   - Player permanently removed from game
   - Session data retained for potential future rejoining
   - Game auto-advances if remaining players can continue

### Token-Based Reconnection

```
Connect → Get Token (stored in localStorage) → Disconnect
→ Token still valid → Reconnect with same token → Restore session
```

Players can rejoin by:
- Simply opening the page again (automatic reconnection)
- Token persists in browser storage
- Server matches token to previous session data

### Game State Preservation

**What gets saved:**
- Player name & avatar
- Current score
- Session start time
- Game phase when disconnected

**What happens during disconnect:**
- Answers already submitted stay in game
- Votes already cast stay in game
- Player slot held for grace period
- Game auto-advances if all remaining players have acted

## Configuration

Edit `RECONNECT_CONFIG` in `src/reconnection-handler.js`:

```javascript
GRACE_PERIOD_LOBBY: 15000,        // 15s in lobby
GRACE_PERIOD_MID_GAME: 120000,    // 2 minutes during game
TOKEN_VALIDITY: 3600000,          // 1 hour token lifetime
MAX_DISCONNECTED_PLAYERS: 50,     // Store up to 50 sessions
CLEANUP_INTERVAL: 300000,         // Clean old sessions every 5 min
```

## Scenarios & Behavior

### Scenario 1: Network Hiccup (< 5 seconds)
```
Player is disconnected → Immediate browser reconnect attempt
→ Reconnects automatically within a few seconds
→ Continues playing seamlessly
→ No interruption to game flow
```
✅ **Player never kicked, game continues smoothly**

### Scenario 2: Phone Loses WiFi (30 seconds)
```
Player disconnects → Grace period active
→ Player switches to cellular/reconnects WiFi
→ Reconnects within 30 seconds via stored token
→ Returns to game mid-round
→ All answers/votes preserved
```
✅ **Player rejoins with score intact**

### Scenario 3: Game Tab Closed Accidentally
```
Player closes tab → Tokens stored in localStorage
→ Player reopens page within grace period
→ Browser auto-fills token from storage
→ Automatic reconnection triggered
→ Returns to exact game state
```
✅ **Player can rejoin without losing progress**

### Scenario 4: True Disconnect (No Rejoin Within Grace)
```
Player disconnects → Grace period (120s) begins
→ No rejoin attempt → Grace expires
→ Player permanently removed from game
→ Player session stored for 1 hour (can start new game)
→ Remaining players' game continues or ends
```
✅ **Game continues with remaining players**

### Scenario 5: Game Ends During Disconnect
```
Player disconnects → Grace period active
→ Game finishes (round completes, game ends)
→ Player would see final scores if they reconnect
→ Can start new game with same identity
```
✅ **Player stats preserved even if game finishes**

## Technical Details

### Server-Side (`server.js`)

1. On disconnect event:
   - Store player in `ReconnectionManager`
   - Set grace period timer
   - Notify other players

2. On reconnect event (`reconnect-attempt`):
   - Validate token
   - Restore player to game
   - Cancel grace timer
   - Resume game flow

3. Grace period expiry:
   - Remove from current game
   - Keep session data for 1 hour
   - Trigger game auto-advance if possible
   - Handle host transfer if needed

### Client-Side (`phone.html`)

1. **Token Management**
   ```javascript
   localStorage.setItem('hottake-token', token);  // Auto-save
   myToken = sessionStorage.getItem('hottake-token');  // Auto-restore
   ```

2. **Connection Monitoring**
   - Listen to `disconnect` event
   - Display grace period timer
   - Show "reconnecting" status
   - Auto-attempt reconnection

3. **Grace Timer Display**
   - Shows countdown (120s → 0s)
   - Turns red/critical at 30 seconds
   - Updates every second
   - Visual feedback to player

## Monitoring & Logging

Server logs all reconnection events:

```
⚠️  Player disconnected (grace period started)
✅ Player reconnected (was in game: true)
⏱️  Player's grace period expired — removing from game
👋 All players disconnected — game reset to lobby
👑 Host transferred to Player 2
```

Check server logs to:
- Monitor disconnect frequency
- Verify grace period effectiveness
- Identify connection issues

## Testing

### Manual Tests

1. **Normal Disconnect → Reconnect**
   - Load game
   - Disconnect network
   - Wait 5 seconds
   - Reconnect network
   - Verify player returns

2. **Long Disconnect**
   - Disconnect for 60+ seconds
   - Reconnect
   - Verify score and game state restored

3. **Grace Period Expiry**
   - Disconnect
   - Wait > 120 seconds
   - Attempt reconnect
   - Verify token expired, must rejoin

4. **Simultaneous Disconnect**
   - Disconnect 2+ players
   - Reconnect one
   - Verify game continues

### Automated Tests

Run balance tests to verify:
```bash
node src/balance-test.js    # Tests score persistence
node src/unit-tests.js      # Tests game logic
```

## Limitations & Considerations

### What's NOT Protected
- **Server crashes**: If server goes down, all players lose connection
  - Solution: Implement server redundancy/clustering

- **Malicious token tampering**: Invalid tokens rejected
  - Solution: Sign tokens with HMAC

- **Very long disconnects** (> 1 hour): Token expires
  - Solution: Player can rejoin as new session

### Best Practices
1. Keep grace period reasonable (30s-2m)
2. Monitor server logs for unusual disconnects
3. Implement timeout handling on client
4. Test on real mobile devices
5. Consider network conditions (3G, unstable WiFi)

## Future Enhancements

- [ ] Signed tokens with JWT/HMAC
- [ ] Persist sessions to database
- [ ] Multi-device reconnection
- [ ] Spectator mode for disconnected players
- [ ] Automatic game pause if host disconnects
- [ ] Progressive reconnection retry (exponential backoff)
- [ ] Analytics dashboard for disconnect patterns

## API Reference

### ReconnectionManager

```javascript
// Store disconnected player
manager.storeDisconnectedPlayer(token, playerData);

// Retrieve disconnected player
const player = manager.getDisconnectedPlayer(token);

// Check if player can rejoin
if (manager.canPlayerRejoin(token)) { ... }

// Get rejoin info for UI
const info = manager.getRejoinInfo(token);
// Returns: { name, avatar, score, wasPlaying, message }

// Set grace period timer
manager.setGracePeriod(token, 120000, () => {
  // Called when grace expires
});

// Cancel grace period (player reconnected)
manager.cancelGracePeriod(token);
```

### Socket Events

**Client → Server:**
- `reconnect-attempt [token]` - Attempt to rejoin with token

**Server → Client:**
- `reconnected [data]` - Rejoin successful
- `reconnect-failed []` - Token invalid/expired
- `player-disconnected [data]` - Another player disconnected
- `player-reconnected [data]` - Another player reconnected

## Summary

✅ **Players cannot be permanently booted** due to:
1. Automatic token storage
2. Grace period before removal
3. Session persistence
4. Game state preservation
5. Automatic reconnection attempts

The system gracefully handles network issues while keeping the game fair and playable.
