# Headley Party Games

Free Jackbox-style party games. No app download — players join on their phones via room code or QR.

**Live:** https://tv-party-game.onrender.com/

## Game Modes

| Mode | Players | Phone-Only | Description |
|------|---------|-----------|-------------|
| Hot Take | 3–16 | Yes | Answer a spicy prompt. Funniest answer wins. |
| Night Falls | 5–16 | Yes | Werewolf/Mafia. Find the wolves before they eliminate everyone. |
| Speed Drawing | 3–16 | TV only | Draw the prompt, vote for the best art. |
| Pictionary | 3–16 | TV only | One draws, others guess. Classic. |

## Architecture

- **Backend:** Node/Express + Socket.io (`server.js`)
- **Frontend:** Three static HTML pages in `public/`
  - `index.html` — Landing page
  - `phone.html` — Player controller (phones)
  - `tv.html` — TV display (cast a laptop to TV)
- **Game logic:** `src/game-logic.js` — shared phase machine (lobby → prompt → vote → results)
- **Mode modules:** `src/modes/` — each mode exports its own logic
  - `hot-take.js` — prompt picker, answer validation
  - `speed-drawing.js` — drawing prompts, canvas data handling
  - `pictionary.js` — drawer selection, guess matching
  - `night-falls.js` — full werewolf engine (roles, night resolution, day votes, win conditions)
- **Other modules:**
  - `prompts.js` — prompt bank
  - `scoring.js` — point calculation
  - `teams.js` — team assignment
  - `settings.js` — configurable game settings
  - `reconnection-handler.js` — WebSocket reconnection

## How It Works

1. Host creates a room → gets a 4-letter code + QR
2. Players join on phones via code or QR scan
3. Host picks a game mode in the lobby
4. Game runs via Socket.io — server manages state, phones send actions, TV displays results
5. TV mode: cast laptop to TV for big-screen experience. Phone-only: everything on phones.

## Night Falls (Werewolf)

9 roles: Werewolf, Villager, Seer, Doctor, Bodyguard, Witch, Hunter, Cupid, Jester. Role count scales by player count (5–16). Night phase runs simultaneous actions (wolves vote, seer investigates, doctor protects, etc.). Day phase: discussion timer → vote → elimination. Win conditions: village, wolves, or jester.

## Dev

```bash
npm install
node server.js        # http://localhost:3000
PORT=3999 node server.js  # alternate port
```

## Deployment

Hosted on Render (free tier). Pushes to `main` auto-deploy.

## Known Limitations

- Speed Drawing and Pictionary require TV mode (drawings don't stream to phone voters yet)
- Render free tier spins down after inactivity — first load may take ~30s
- Night Falls needs 5+ players (use multiple browser tabs to test)
