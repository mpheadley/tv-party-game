# Detailed Implementation Plan: Expanded Party Game System

## Executive Summary

Your existing "Hot Take 🔥" game has a solid foundation with:
- Proven game loop (prompt → answer → vote → results)
- Excellent socket.io infrastructure with reconnection support
- Rich frontend with audio, haptics, and animations
- Flexible scoring system ready for variations

The plan adds **Speed Drawing + Pictionary modes** with **teams, custom prompts, host customization, and eraser tool**—while keeping code DRY and maintainable.

---

## 1. ARCHITECTURAL OVERVIEW

### Game Mode Abstraction
Instead of duplicating logic, create a **game mode system** where:
- **Hot Take**: Text input → Text voting
- **Speed Drawing**: Canvas drawing → Visual voting
- **Pictionary**: One player draws, others guess the word

Each mode shares:
- Phase system (lobby → active round → vote/reveal → results)
- Scoring engine
- Team management
- Reconnection logic

### Team System Foundation
Teams will be optional (single-player mode vs team mode):
- When teams are enabled, players select a team during join
- Scoring aggregates per team
- Each team has a combined avatar/name display
- Reconnection preserves team membership

### Data Flow Evolution
```
Game State Structure:
- game.gameMode: 'hot-take' | 'speed-drawing' | 'pictionary'
- game.isTeamMode: boolean
- game.teams: { [teamId]: { name, avatar, players[], score } }
- game.customSettings: { roundTime, voteTime, roundCount }
- For modes with drawings:
  - game.drawings: { [playerId]: { imageData, timestamp } }
```

---

## 2. FEATURE BREAKDOWN & TRADE-OFFS

### Feature 1: Custom Prompts
**Recommendation: INCLUDE** ✓

Trade-offs:
- **Pro**: Hugely increases replayability, minimal backend code
- **Pro**: Host can inject inside-jokes, context-specific prompts
- **Con**: Need persistent prompt storage (JSON file or simple DB)
- **Implementation complexity**: LOW (2-3 hours)

Approach:
- Add "Custom Game" option in lobby
- Host can add/remove prompts before starting
- Mix custom + default prompts during game
- Store custom prompts in JSON file on server

### Feature 2: Host Customization (Rounds/Timers)
**Recommendation: INCLUDE** ✓

Trade-offs:
- **Pro**: Already have round picker (5/10/15), just extend it
- **Pro**: Adjustable timers let casual vs competitive play
- **Con**: More UI state to manage
- **Implementation complexity**: LOW (1-2 hours)

Approach:
- Expand lobby settings UI
- Store in `game.customSettings` object
- Pass to each phase handler
- Validate ranges on server

### Feature 3: Eraser Tool for Drawings
**Recommendation: INCLUDE** ✓

Trade-offs:
- **Pro**: Essential for drawing games, users expect it
- **Pro**: Canvas API supports it natively
- **Con**: Adds UI complexity on phone controller
- **Implementation complexity**: LOW-MEDIUM (1.5 hours)

Approach:
- Canvas drawing tool toggle (pencil/eraser)
- Size slider for eraser
- Eraser = drawing with background color
- Send full canvas image (already doing this)

### Feature 4: Teams
**Recommendation: INCLUDE** ✓

Trade-offs:
- **Pro**: Multiplies replayability and engagement
- **Pro**: Can be optional (backward compatible)
- **Con**: UI adds complexity to join flow
- **Con**: Scoring needs team aggregation
- **Implementation complexity**: MEDIUM (3-4 hours)

Approach:
- Lobby shows team selection before game starts
- Each round: one team member answers/draws
- Voting: visible team colors/names
- Results: team scoreboard, then final rankings
- Can be disabled in settings

---

## 3. IMPLEMENTATION SEQUENCE

### Phase 1: Structural Foundation (4-5 hours)
**Goal**: Game mode abstraction + file organization

1. **Refactor server.js into modules**
   - `game-logic.js`: Phase management, core game loop
   - `scoring.js`: Points calculation (will vary per mode)
   - `modes/` folder: Individual game mode handlers
     - `hot-take.js`
     - `speed-drawing.js`
     - `pictionary.js`
   - `teams.js`: Team management and scoring

2. **Create game mode interface**
   - Define: `startRound(mode, settings)` → handles mode-specific setup
   - Define: `processAnswer(mode, socketId, data)` → mode-specific validation
   - Define: `tallyVotes(mode, votes)` → mode-specific scoring
   - Define: `getVotingOptions(mode)` → what to show voters

3. **Update socket handlers** to be mode-agnostic
   - `socket.on('answer')` calls appropriate mode handler
   - `socket.on('vote')` validates mode-specific vote targets
   - Re-broadcast phase changes with mode context

4. **Add custom settings storage**
   - Create `/data/prompts.json` (user custom prompts)
   - Extend `game.customSettings`:
     ```js
     {
       roundTime: 60,
       voteTime: 20,
       totalRounds: 10,
       useCustomPrompts: true,
       customPromptList: [],
       teamMode: false,
       teamCount: 2
     }
     ```

### Phase 2: Custom Prompts (2-3 hours)
**Goal**: Load + mix default and custom prompts

1. **Backend changes (server.js)**
   - Add socket event: `socket.on('add-custom-prompt', (text) => {...})`
   - Add event: `socket.on('remove-custom-prompt', (index) => {...})`
   - Modify `pickPrompt()` to merge custom + default pools
   - Save custom prompts to `data/prompts.json` on change

2. **Frontend changes (TV + Phone)**
   - In lobby, show "Manage Prompts" button (host only)
   - Modal to add/edit/remove custom prompts
   - Show count of custom prompts selected
   - Preview during game setup

3. **Validation**
   - Max 200 char per prompt
   - Max 50 custom prompts per session
   - Sanitize HTML on server

### Phase 3: Host Customization (1-2 hours)
**Goal**: Configurable rounds + timers

1. **Backend changes**
   - Modify `startRound()` to use `game.customSettings.roundTime`
   - Modify voting timer to use `game.customSettings.voteTime`
   - Validate: roundTime 20-180s, voteTime 10-60s, rounds 3-20

2. **Frontend changes (TV + Phone)**
   - Replace round picker with expanded settings panel
   - Add sliders: Round Duration, Vote Duration
   - Live preview: "Total game: ~15 minutes"
   - Host only: controls visible in lobby

3. **Socket communication**
   - Host sends `socket.on('update-settings', { roundTime, voteTime, totalRounds })`
   - Server validates, updates `game.customSettings`
   - Broadcast to all players for UI feedback

### Phase 4: Teams System (3-4 hours)
**Goal**: Optional team-based gameplay

1. **Backend changes (teams.js + updates to server.js)**
   - Team creation on game start
   - Team member rotation for answers/drawings
   - Team-based scoring aggregation
   - Team display in results/scoreboard

2. **Game state additions**
   ```js
   game.teams = {
     'team-1': {
       name: 'Team A',
       color: '#667eea',
       players: [socketId1, socketId2],
       score: 0,
       currentAnswerer: 0 // index into players array
     }
   };
   game.teamMode = false;
   game.teamCount = 2; // or 3, 4, etc.
   ```

3. **Frontend changes (Phone)**
   - After name entry: "Choose your team"
   - Show available teams, color-coded
   - Option to auto-balance if not full
   - Avatar shows team color in join screen

4. **Frontend changes (TV)**
   - Scoreboard shows team scores prominently
   - Results show "Team A wins this round!"
   - Final scoreboard is teams, not individuals

5. **Socket changes**
   - `socket.on('join', { name, avatar, team })` now includes team
   - Assign to team on server (validation: team exists, has space)
   - Team rotation logic for next answerer

### Phase 5: Speed Drawing Mode (5-6 hours)
**Goal**: Drawing interface + voting on drawings

1. **Backend changes**
   ```js
   // In modes/speed-drawing.js
   - Handle drawing submission: socket.on('drawing', base64ImageData)
   - Store in game.drawings[socketId]
   - Validate image size (< 5MB)
   - In voting phase: send drawings instead of text
   ```

2. **Frontend changes (Phone controller)**
   - New UI: canvas drawing area
   - **Pencil tool**: color picker, size slider
   - **Eraser tool**: size slider, toggles mode
   - **Clear button**: start over
   - **Submit button**: send drawing when ready
   - Canvas: 400x400px (responsive)

3. **Frontend changes (TV display)**
   - During drawing phase: show "drawing in progress" with timer
   - Voting phase: display drawings in grid
   - Results: show each drawing + author + vote count

4. **Canvas implementation**
   ```js
   // Phone side:
   - Detect mouse/touch events
   - drawPixel() for pencil
   - clearPixel() for eraser
   - Interpolate between points for smooth lines
   - Send full canvas via canvas.toDataURL('image/png') when submitted

   // TV side:
   - img element in voting grid
   - Display images side-by-side (2-4 per row)
   ```

5. **Voting on drawings**
   - Visual voting grid (larger than text answers)
   - Click image to vote
   - Show vote counts as numbers overlay

### Phase 6: Pictionary Mode (4-5 hours)
**Goal**: One player draws, others guess the word

1. **Backend flow**
   - One player assigned as drawer per round
   - Others submit guesses (text input)
   - Voting: approve/reject guesses
   - Scoring: drawer gets points if correct answers submitted

2. **Game state additions**
   ```js
   // In pictionary round:
   game.currentDrawer = socketId;
   game.picturePrompt = word; // what to draw
   game.guesses = { [playerId]: 'their guess' };
   // Voting is "Is this the right word?" (yes/no per guess)
   ```

3. **Frontend changes (Phone)**
   - **If you're drawer**: Show the word, canvas to draw on (like Speed Drawing)
   - **If you're guesser**: Show drawing area (read-only) + text input for guess
   - Drawer sees drawing timer
   - Guessers see drawing timer and voting phase

4. **Frontend changes (TV)**
   - Highlight current drawer
   - Show the word they're drawing (viewers see blank canvas during draw time)
   - Reveal drawing + all guesses after time expires
   - Voting screen: show each guess, approve/reject

5. **Scoring logic**
   - Drawer: +1 point per correct guess
   - Guesser: +1 point if their guess is approved
   - (Adjust if needed for balance)

### Phase 7: Integration & Polish (2-3 hours)
**Goal**: Game mode selector + UI refinement

1. **Lobby redesign**
   - Game mode selector: Hot Take / Speed Drawing / Pictionary
   - Settings panel (customization)
   - Team toggle + count selector
   - Start game button

2. **Cross-mode consistency**
   - Ensure all modes use same:
     - Phase names and transitions
     - Scoreboard display
     - Results format
     - Error handling

3. **Testing & edge cases**
   - Team rebalancing if players disconnect mid-game
   - Ensure drawings don't block if socket fails
   - Handle late joiners in team mode
   - Verify scoring across all modes

---

## 4. DATA STRUCTURES & STATE CHANGES

### Game Object Evolution

**Current** (Hot Take only):
```js
game = {
  phase: 'lobby',
  players: { [socketId]: { name, score, avatar, token } },
  round: 0,
  totalRounds: 5,
  currentPrompt: '',
  answers: { [socketId]: answerText },
  votes: { [voterId]: answerId },
  usedPrompts: [],
  tvSocket: null,
  hostSocket: null,
  roundTimer: null,
}
```

**New** (Multi-mode):
```js
game = {
  // Existing
  phase: 'lobby',
  players: { [socketId]: { name, score, avatar, token, team } },
  round: 0,
  tvSocket: null,
  hostSocket: null,
  roundTimer: null,

  // New: Game mode
  gameMode: 'hot-take', // 'hot-take' | 'speed-drawing' | 'pictionary'

  // New: Custom settings
  customSettings: {
    roundTime: 60,
    voteTime: 20,
    totalRounds: 10,
    useCustomPrompts: false,
    customPromptList: [], // user-added prompts
  },

  // Hot Take + Speed Drawing
  currentPrompt: '',
  answers: { [socketId]: text/imageData },
  usedPrompts: [],

  // Speed Drawing specific
  drawings: { [socketId]: base64ImageData },

  // Pictionary specific
  currentDrawer: socketId,
  picturePrompt: word,
  guesses: { [socketId]: guessText },

  // Voting (all modes)
  votes: { [voterId]: answerId/drawingId/guessId },

  // Teams
  teamMode: false,
  teams: {
    'team-1': {
      name: 'Team A',
      color: '#667eea',
      players: [socketId1, socketId2],
      score: 0,
      currentAnswerIndex: 0,
    }
  },
}
```

### Socket Events (New)

**Host Game Setup**:
- `update-settings` → `{ roundTime, voteTime, totalRounds, teamMode, teamCount, gameMode }`
- `add-custom-prompt` → `{ text }`
- `remove-custom-prompt` → `{ index }`

**Gameplay (Mode-Specific)**:
- `drawing` → `{ imageData }` (Speed Drawing, Pictionary)
- `guess` → `{ text }` (Pictionary)

**Team Mode**:
- `join` → `{ name, avatar, team }` (updated)
- `team-update` → broadcast after join

---

## 5. FILE STRUCTURE PROPOSAL

```
/home/user/tv-party-game/
├── server.js (refactored: orchestration only, delegates to modules)
├── package.json
├── public/
│   ├── tv.html (updated for mode selection + settings)
│   ├── phone.html (updated for drawing canvas + team select)
│   └── style.css (extended for drawing UI + team colors)
├── src/ (NEW)
│   ├── game-logic.js (phase transitions, core loop)
│   ├── scoring.js (point calculation per mode)
│   ├── teams.js (team management)
│   ├── modes/
│   │   ├── hot-take.js (prompt generation, text validation)
│   │   ├── speed-drawing.js (canvas submission, drawing validation)
│   │   └── pictionary.js (drawer assignment, guess handling)
│   └── prompts.js (default + custom prompt management)
└── data/ (NEW)
    └── prompts.json (user custom prompts storage)
```

---

## 6. IMPLEMENTATION CHECKLIST

### Phase 1: Refactoring
- [ ] Create `src/` directory structure
- [ ] Extract `game-logic.js` from server.js core
- [ ] Move scoring logic → `src/scoring.js`
- [ ] Create `src/modes/hot-take.js` with existing logic
- [ ] Update server.js to use modules (require statements)
- [ ] Verify existing Hot Take game still works

### Phase 2: Custom Prompts
- [ ] Create `src/prompts.js` with merge logic
- [ ] Create `data/prompts.json` skeleton
- [ ] Add server socket events: `add-custom-prompt`, `remove-custom-prompt`
- [ ] Add TV UI: "Manage Prompts" modal
- [ ] Update `pickPrompt()` to use custom pool
- [ ] Test prompt selection across multiple games

### Phase 3: Host Customization
- [ ] Add sliders to TV lobby: roundTime, voteTime
- [ ] Validate ranges on server
- [ ] Update `startRound()` to use `customSettings.roundTime`
- [ ] Update voting timer to use `customSettings.voteTime`
- [ ] Broadcast settings to all clients for UI feedback
- [ ] Test with various time ranges

### Phase 4: Teams
- [ ] Create `src/teams.js`
- [ ] Add team selection to phone join flow
- [ ] Update game state with team structure
- [ ] Implement team rotation logic
- [ ] Update scoreboard to show team scores
- [ ] Update results display for team context
- [ ] Test team rebalancing on disconnect

### Phase 5: Speed Drawing
- [ ] Create `src/modes/speed-drawing.js`
- [ ] Add canvas UI to phone (pencil + eraser tools)
- [ ] Implement drawing submission to server
- [ ] Update TV to display drawings during vote phase
- [ ] Update results to show drawings + vote counts
- [ ] Test image transmission and display

### Phase 6: Pictionary
- [ ] Create `src/modes/pictionary.js`
- [ ] Implement drawer assignment logic
- [ ] Add drawer detection on phone (show canvas)
- [ ] Add guess submission for non-drawers
- [ ] Update voting to approve/reject guesses
- [ ] Update results to show drawing + accepted guesses
- [ ] Test drawer rotation across rounds

### Phase 7: Integration
- [ ] Game mode selector in lobby (TV + Phone)
- [ ] Ensure all modes use consistent phases
- [ ] Cross-mode testing: switch modes, verify state reset
- [ ] Polish UI for consistency across modes
- [ ] Test reconnection in each mode
- [ ] Stress test with 8+ players

---

## 7. KEY ARCHITECTURAL DECISIONS

### Decision 1: Shared vs Separate Scoring
**Choice**: Shared scoring engine with mode-specific multipliers
- All modes use same: `tallyVotes(mode, votes, voteCounts)` function
- Mode defines point values (e.g., Speed Drawing might be 2x faster voting)
- **Benefit**: One scoreboard logic, consistency

### Decision 2: Team Rotation Strategy
**Choice**: Sequential rotation within team for answers/drawings
- Team A round 1: Player 1 answers
- Team A round 2: Player 2 answers
- Team A round 3: Player 1 answers (cycle)
- **Benefit**: Fair distribution, predictable, simple logic
- **Alternative**: Let players choose (more complex)

### Decision 3: Drawing Transmission
**Choice**: Base64 canvas data on answer submit, not streaming
- Reduces bandwidth (one image per submission)
- Simpler error handling (one transmission = one socket event)
- **Trade-off**: Voters see final image, not animation of drawing
- **Mitigated by**: Visual timer showing "still drawing" during round time

### Decision 4: Custom Prompts Storage
**Choice**: JSON file on server (not database)
- Sufficient for 1-100 games per session
- Easy to backup/version control
- No dependency on external DB
- **Scale limit**: File-based works up to ~10K prompts (fine for MVP)

### Decision 5: Pictionary Scoring
**Choice**: Drawer gets +1 per correct guess, Guesser gets +1 per accepted guess
- Encourages both clear drawings and reasonable guesses
- Balances roles
- **Alternative**: Only drawer scores (favors drawing skill)

---

## 8. POTENTIAL CHALLENGES & MITIGATIONS

| Challenge | Mitigation |
|-----------|-----------|
| **Drawing images large**: Canvas → Base64 can exceed socket limits | Compress before sending, max 2MB per image |
| **Team rotation confusing**: Players forget whose turn it is | Show "Team A, Player 2 is answering" on TV prominently |
| **Pictionary drawer sees answers during voting**: Unfair | Keep drawer on "waiting" screen, don't show votes until done |
| **Custom prompts lost on server crash**: Data loss | Auto-save to file after each add, load on startup |
| **Phase transitions out of sync in multi-mode**: State mess | Validate phase transitions per mode in `startRound()` |
| **Eraser UX clunky**: Hard to switch modes | Visual toggle button + keyboard shortcut (E key) |
| **Late joiner in team mode**: Unbalanced teams | Auto-assign to smallest team or show error |

---

## 9. TESTING STRATEGY

### Unit Tests
- `scoring.js`: Verify points awarded per mode
- `teams.js`: Rotation logic, team assignment
- `modes/*.js`: Answer validation, state transitions

### Integration Tests
- Game flow for each mode: lobby → rounds → results → gameover
- Team creation and rotation across full game
- Custom prompt injection and selection
- Settings (timer) enforcement

### Live Testing Scenarios
1. **4 players, Hot Take, 3 rounds**: Baseline (existing)
2. **6 players, teams (2 teams), Speed Drawing, 5 rounds**: Full team + drawing
3. **5 players, Pictionary, custom prompts + extended timer**: All new features
4. **Disconnection/reconnection during drawing round**: Recovery
5. **Mix modes in succession**: Reset state properly

---

## 10. FUTURE EXPANSION HOOKS

The architecture supports:
- **Custom scoring rules**: Pass multiplier to `tallyVotes()`
- **More modes**: Create new `modes/xyz.js`, add to mode selector
- **Persistent sessions**: Add database without refactoring phases
- **Replays**: Store game history per session
- **Analytics**: Track player stats per mode per team

---

# RECOMMENDED IMPLEMENTATION ORDER

Based on effort + dependency:

1. **Start with Refactoring (Phase 1)** — unblocks everything, de-risks codebase
2. **Custom Prompts (Phase 2)** — quick win, improves replayability immediately
3. **Host Customization (Phase 3)** — enhances Hot Take without adding complexity
4. **Teams (Phase 4)** — foundational for multi-round strategy
5. **Speed Drawing (Phase 5)** — new mode, most UI work
6. **Pictionary (Phase 6)** — leverages Speed Drawing infra, adds gameplay depth
7. **Integration (Phase 7)** — final polish and cross-mode consistency

**Total estimated time**: 20-25 hours of development
- Phases 1-3: 7-8 hours (have working Hot Take + customization)
- Phases 4-6: 12-15 hours (full multi-mode system)
- Phase 7: 2-3 hours (integration & testing)

---

## Critical Files for Implementation

- **/home/user/tv-party-game/server.js** — Core game logic to refactor into modules; orchestrates all game phases and socket communication. Will become the central dispatcher after refactoring.

- **/home/user/tv-party-game/public/phone.html** — Phone controller UI requiring significant expansion for drawing canvas, team selection, and mode-specific screens. Will need conditional rendering for each game mode.

- **/home/user/tv-party-game/public/tv.html** — TV display orchestration; needs game mode selector, expanded settings panel, and mode-specific result/voting displays. Critical for UX consistency.

- **/home/user/tv-party-game/public/style.css** — Styling for all new UI elements (drawing canvas, team colors, game mode buttons). Will grow significantly but must maintain visual cohesion.

- **/home/user/tv-party-game/src/modes/hot-take.js** (NEW) — Extracted Hot Take logic becomes template for other modes. Sets pattern for `startRound()`, `processAnswer()`, scoring logic that Speed Drawing and Pictionary will follow.
