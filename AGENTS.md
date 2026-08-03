# Project: Browser FPS Game (Portfolio Piece)

## What this is
A first-person shooter that runs entirely in the browser, built to be linked
from an online portfolio for recruiters to try. It is single-player against
AI bots (no real multiplayer / networking).

The person building this is a BEGINNER coder using Cursor. Please:
- Prefer clear, well-commented code over clever/terse code.
- Explain briefly (in a code comment or short note) WHY a non-obvious
  decision was made, not just what the code does.
- Avoid introducing new libraries/dependencies without flagging it first —
  ask before adding something not already in package.json.
- Keep changes scoped to what was asked. Don't refactor unrelated code or
  "improve" things that weren't part of the request.

## Tech stack (do not change without discussion)
- Vite (bundler/dev server)
- Three.js (3D rendering)
- Rapier (@dimforge/rapier3d-compat) for physics/collision — do NOT hand-roll
  custom collision detection, use Rapier for player movement, gravity, and
  hitting platforms/walls.
- Plain JavaScript (no TypeScript, no React) — keep it simple.
- No backend server. This must remain a static site so it can deploy to
  Vercel with zero config as a static build.

## Deployment target
This will eventually be deployed to Vercel as a static site (build output
only, no server-side code, no database). Keep this in mind: no hardcoded
secrets, no server-only APIs, everything must work as static files served
to a browser.

## Milestone Checklist
Work through these IN ORDER. Do not start a milestone until the previous
one is checked off. After finishing a milestone, update this checklist
(change [ ] to [x]) and tell the user exactly how to verify it themselves
in the browser before moving on.

### Current Status (v1 complete — Milestones 1–6)
**v1 (Playable Core) is complete.** Milestones 1–6 are all checked off
below. Next up is **Milestone 7** (platforms + crouch) — the start of v2.

Everything still lives in one file (`src/main.js`, plus `index.html` /
`src/style.css`); it hasn't been split into modules yet since it's still
small enough to stay readable. Uses `THREE.Timer` (not the deprecated
`THREE.Clock`) for per-frame delta-time.

**Working v1 summary (what a fresh session can rely on):**
- **Movement:** WASD + mouse look + Space jump. Player is a Rapier
  `kinematicPositionBased` capsule (`PLAYER_RADIUS = 0.4`,
  `PLAYER_HALF_HEIGHT = 0.6`) driven by `world.createCharacterController()`,
  with gravity/jump applied manually (`GRAVITY` / `JUMP_SPEED` — kinematic
  bodies ignore Rapier's own gravity). Yaw/pitch are plain variables applied
  to `camera.rotation` (`rotation.order = "YXZ"`). Spawn:
  `PLAYER_SPAWN_POSITION` `(0, 3, 5)`.
- **Pointer lock / focus handling:** Game starts paused with
  `#pause-overlay` ("Click to Play"). `pointerlockchange` plus
  `blur`/`visibilitychange` pause on Escape / focus loss; resume re-locks
  the pointer (with Chrome Escape-cooldown retry). Clears `keysPressed` /
  `isFiring` on pause so held inputs can't stick across alt-tab.
- **Arena:** Sized via `ARENA_SIZES` (`1v1`/`3v3`/`5v5` → 30/45/60m);
  `GROUND_SIZE` currently hardcodes `"1v1"` until Milestone 9's pre-match
  menu. Static Rapier colliders for walls + varied interior cover
  (`boxObstacleDefs`, `pillarObstacleDefs`, `rampObstacleDef`) laid out for
  competitive flow — center chokepoint blocking the spawn-to-spawn
  sightline, denser west cover, sparser east open lane. Player spawn
  `(0, _, 5)`, bot spawn `(0, _, -5)`. Jumping on top of shorter obstacles
  already works as a side effect of ordinary colliders (reuse for
  Milestone 7); walk-under platforms and crouch are still unbuilt.
- **Shooting + player HUD:** Hitscan gun (`world.castRayAndGetNormal()`),
  full-auto via `isFiring` + `FIRE_RATE_RPM`, magazine/reload
  (`MAGAZINE_SIZE` / `RELOAD_TIME_MS`, manual R or auto on empty), tracers
  (`spawnTracer()` via `MUZZLE_OFFSET`) + impact flashes. HUD: crosshair,
  ammo pill (low-ammo flash), health bar, low-health vignette. Debug "T"
  key still calls `damagePlayer(20)` for quick health/death testing. No
  visible gun model yet (polish later).
- **One AI bot:** Red capsule + facing marker (`botGroup` /
  `BOT_MARKER_OFFSET`), own kinematic body + own character controller
  (`botCharacterController` — must stay separate from the player's).
  Vision-gated via `botCanSeePlayer()` raycast only (never omniscient);
  turn-speed-limited aim (`rotateGroupTowards()` /
  `BOT_TURN_SPEED_RADIANS_PER_SEC`); fires after `BOT_REACTION_DELAY_MS`
  once aimed within `BOT_AIM_ANGLE_THRESHOLD_RADIANS`, with
  `BOT_AIM_SPREAD_RADIANS` jitter. When it can't see the player: chases
  `botLastKnownPlayerPosition`, else patrols hand-placed
  `BOT_PATROL_POINTS` near cover (`moveBotTowards()`) — simple waypoint
  patrol, NOT Milestone 10's tactical cover-seeking. Health equals
  `PLAYER_MAX_HEALTH`; floating team-colored health bar; both sides regen
  after `HEALTH_REGEN_DELAY_MS` at `HEALTH_REGEN_RATE_PER_SECOND`.
- **Respawn + spawn invulnerability:** On death, player shows
  `#death-overlay` then `respawnPlayer()` after `RESPAWN_DELAY_MS` (3s)
  (teleport, full health/ammo). Bot disables collider + hides mesh, then
  `respawnBot()` re-enables/shows and resets AI state. Both get
  `SPAWN_INVULNERABILITY_MS` (1.5s) of no-damage
  (`playerInvulnerableUntil` / `botInvulnerableUntil` — early returns in
  `damagePlayer()` / `damageBot()`; tracers still land). Cues: pulsing blue
  `#spawn-invuln-overlay` for the player; `botMaterial.opacity = 0.5` for
  the bot.
- **Team score / timer HUD + win condition:** Top-center `#match-hud`
  shows BLUE/RED team scores (`blueScore` / `redScore`) and a count-up
  match timer (starts on first pointer-lock; doesn't subtract paused time —
  accepted v1 simplification). First team to `KILL_TARGET` wins via
  `endMatch()` → `#match-end-overlay` + `matchEnded` freezes simulation.
  **`KILL_TARGET` is currently hardcoded to 5** — it becomes configurable
  (alongside team size / difficulty) when Milestone 9 adds the pre-match
  menu. Refresh page to play again (real "Play Again" is Milestone 13).

Key tuning constants in `src/main.js` include: `ARENA_SIZES`,
`MOVE_SPEED = 5`, `JUMP_SPEED = 6`, `GRAVITY = 20`, `PLAYER_RADIUS = 0.4`,
`PLAYER_HALF_HEIGHT = 0.6`, `EYE_HEIGHT = 0.8`, `GUN_DAMAGE = 25`,
`FIRE_RATE_RPM = 750`, `MAGAZINE_SIZE = 30`, `RELOAD_TIME_MS = 1800`,
`PLAYER_MAX_HEALTH = 100`, `HEALTH_REGEN_DELAY_MS = 5000`,
`HEALTH_REGEN_RATE_PER_SECOND = 8`, `BOT_*` AI/movement/aim constants,
`KILL_TARGET = 5`, `RESPAWN_DELAY_MS = 3000`,
`SPAWN_INVULNERABILITY_MS = 1500`.

### v1 — Playable Core (COMPLETE)
- [x] 1. Project scaffold: Vite + Three.js + Rapier running, empty scene renders.
- [x] 2. First-person movement: WASD, mouse look, jump, collision via Rapier.
- [x] 2.5. Pointer lock + focus handling: click-to-play overlay, Escape/focus-loss pause, reliable resume.
- [x] 3. Arena with obstacles: walls + static obstacles placed (no platforms yet).
- [x] 4. Shooting + health: raycast gun fires on click, deals damage, health bar updates, player can die.
- [x] 5. One AI bot: sees player, aims, shoots back, has health/can die.
      Verify: bot reacts when player is in view, player can kill it, it
      can damage the player.
      Also includes several additions requested directly in a follow-up
      pass, beyond the milestone's original scope — see "Current Status"
      above for implementation details:
        - Basic movement: patrols hand-placed waypoints near cover when
          it can't see the player, and heads toward their last-known
          position after losing sight, instead of standing still.
        - Vision-gated, turn-speed-limited aiming: only tracks/faces the
          player while its line-of-sight raycast actually confirms it can
          see them (never through walls), and turns at a capped rate
          before it's allowed to fire — no more instant snap-aim.
        - A small team-colored floating health bar above its head.
        - Health regeneration for both the player and the bot after a few
          seconds without taking damage.
        - Bot max health set equal to the player's max health, for
          balance.
- [x] 6. Respawn + win condition: player and bot respawn after death,
      match ends at N kills, simple end-of-match state. Verify: die once,
      confirm respawn works; play to the kill target, confirm match ends.
      Also includes spawn invulnerability (1.5s no-damage after respawn
      for both sides, with a blue screen pulse for the player and mesh
      transparency for the bot) and a team-based score + match-timer HUD
      at the top of the screen. Kill target is hardcoded to 5 for now
      (`KILL_TARGET` in `src/main.js`); Milestone 9 will make it
      configurable via the pre-match menu. See "Current Status" above.

### v2 — Core Requested Features
- [ ] 7. Platforms + crouch: jumpable/walkable platforms, C key crouches
      (static height/speed change, no slide). Verify: can jump onto a
      platform, walk on it, walk underneath it, and crouch to fit under
      low obstacles.
      NOTE: several Milestone 3 obstacles (`boxObstacleDefs` /
      `pillarObstacleDefs` in `src/main.js`) already have working
      jump-on-top collision as a side effect of being ordinary static
      Rapier colliders — Rapier's character controller lets the player
      land on any short-enough box/pillar with no special code. Milestone
      7 should extend/reuse those existing obstacles (and their collider
      pattern) for the "jump on top" part rather than building separate
      platform objects from scratch. What's still missing and IS this
      milestone's job: the "walk underneath" part (an obstacle raised off
      the ground with clearance beneath it) and the crouch mechanic itself
      (C key, static height/speed change).
- [ ] 8. Minimap: top-down indicator of player + bot positions. Verify:
      minimap updates live as player/bots move.
- [ ] 9. Pre-match menu: team size preset (1v1/3v3/5v5 — see team size
      counting rule above) + bot difficulty selection, shown before match
      starts. Verify: selecting each preset spawns the correct bot counts.
- [ ] 10. Multiple bots + difficulty tiers: reaction delay / aim spread /
      cover usage differ by tier. Verify: Easy bots miss more and react
      slower than Hard bots (rough eyeball test is fine).
      NOTE: basic single-bot patrol/chase movement (`moveBotTowards()`,
      `BOT_PATROL_POINTS` in `src/main.js`) was already added ahead of
      schedule, requested directly during the Milestone 5 follow-up pass —
      see "Current Status" above. What's still missing and IS this
      milestone's job: multiple simultaneous bots, actual difficulty-tier
      parameters (varying reaction delay/aim spread per tier), and real
      cover-seeking behavior (today's patrol points are just hand-placed
      waypoints near cover, not bots reacting tactically to incoming fire).

### v3 — Polish (portfolio-ready)
- [ ] 11. Weapon feedback: recoil, muzzle flash, tracers, hit markers.
- [ ] 12. Audio: footsteps, gunshot, hit sound.
- [ ] 13. Kill feed + post-match summary screen (K/D) + Play Again button.
- [ ] 14. Pause menu with sensitivity slider, click-to-play/pointer lock
      handling.
- [ ] 15. Title/splash screen with player's name.


## Pointer Lock / Focus Handling (get this right early, not as an afterthought)
This is a common failure point in browser FPS projects — handle it deliberately:
- Game starts paused with a "Click to Play" overlay. Mouse-look does NOT
  work until the user clicks and pointer lock is granted.
- Clicking the overlay requests the browser's Pointer Lock API. Once
  granted, cursor disappears and mouse movement drives camera look.
- Pressing Escape (or the browser auto-releasing pointer lock) must pause
  the game AND show a resume overlay — never leave the game running with
  dead/broken mouse-look.
- If the browser tab/window loses focus (alt-tab, clicking another
  window), treat it the same as pointer lock loss: auto-pause, show the
  resume overlay. Do not let the game keep simulating or accept input
  while unfocused.
- Clicking the resume overlay must reliably re-lock and resume — no
  states where the user is stuck unable to re-enter the game.
- Test this explicitly: click away mid-game, alt-tab, press Escape, then
  try to resume — mouse-look must work correctly every time, not just
  the first time.

## Visual Style (v1 — keep simple, refine later)
- Team colors: BLUE = player's team (player + ally bots), RED = enemy team.
  Apply this consistently to: bot capsule color, minimap dots, kill feed
  text, and any team indicators in the HUD.
- Characters (bots): use simple placeholder shapes for now — a capsule
  primitive (Three.js CapsuleGeometry) colored by team, no detailed
  model/rig/animation. This is intentional (standard "greybox" practice)
  so gameplay/AI can be tested without wasting time on art that may
  change. Detailed character models are a later polish item, not v1/v2.
- Weapon (first-person view): simple placeholder shape is fine (or even
  no visible gun model yet) — do not spend time on a detailed weapon
  model until the Milestone Checklist reaches polish (v3).
- Bullets: a thin glowing tracer line from gun to impact point, plus a
  small flash/particle at the impact point. No 3D bullet model needed.
- Arena size scales with match size (bigger team size = bigger arena, so
  fights stay dense and players aren't wasting time just walking around
  empty space):
    - 1v1: small arena
    - 3v3: medium arena
    - 5v5: medium-large arena (still not huge — keep it fast-paced)
  Exact dimensions are Cursor's call, but should visibly scale up between
  these three, not stay fixed.

## Game design spec
- Perspective: first-person
- Controls: WASD move, mouse look, Space = jump, C = crouch (hold)
- Arena: obstacles and platforms (jump up onto them, walk on top, walk
  underneath), sized per the Visual Style scaling rule above. No
  crouch-slide for now — crouch is a static height/speed change only.
- HUD: health bar, minimap, kill feed
- Pre-match menu: choose team size preset (1v1, 3v3, 5v5) and bot
  difficulty (Easy / Medium / Hard — 3 tiers only).
  IMPORTANT — team size counting: the player counts as one member of
  their own team. So "3v3" means 3 total players per side, which is
  2 ALLY BOTS + the human player on one team, vs 3 ENEMY BOTS on the
  other team. Do NOT add 3 ally bots on top of the human player.
    - 1v1 = 0 ally bots + player, vs 1 enemy bot
    - 3v3 = 2 ally bots + player, vs 3 enemy bots
    - 5v5 = 4 ally bots + player, vs 5 enemy bots
- Bot AI difficulty differences should be limited to: reaction delay,
  aim accuracy/spread, and whether they use cover. Do NOT build separate
  behavior trees per difficulty — same logic, different parameters.
- Match: first to N kills (or timer), respawn on death, post-match
  summary screen (K/D) with a "Play Again" button
- Health regeneration: both the player and bots gradually regenerate
  health after a few seconds without taking damage, up to their max
  health (see `HEALTH_REGEN_DELAY_MS`/`HEALTH_REGEN_RATE_PER_SECOND` in
  "Current Status" above). Regeneration stops entirely once dead/destroyed
  — it never brings a dead player or destroyed bot back.

## Explicitly out of scope for now (do not build unless asked)
- Multiplayer / networking / websockets
- Multiple weapons (start with one gun)
- Crouch-sliding under platforms with momentum
- Mobile touch controls
- User accounts / saved progress / leaderboards

## Working style
- Build and verify one milestone at a time (movement, then shooting, then
  AI, etc.) — don't jump ahead to later milestones.
- After each change, tell the user exactly what to click/press to test it
  locally (`npm run dev`), since they are new to this.
- If something requires a decision (e.g. "how big should the arena be"),
  make a reasonable choice and say what you chose and why, rather than
  stopping to ask, unless it's a significant scope/library decision.
