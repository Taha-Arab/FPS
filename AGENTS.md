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

### Current Status (Milestones 1–7 complete)
**v1 (Playable Core) is complete**, and **Milestone 7** (platforms +
crouch) is done — including several follow-up fixes/features beyond the
core M7 checklist (see item 7 below). Next up is **Milestone 8**
(minimap).

Everything still lives in one file (`src/main.js`, plus `index.html` /
`src/style.css`); it hasn't been split into modules yet since it's still
small enough to stay readable. Uses `THREE.Timer` (not the deprecated
`THREE.Clock`) for per-frame delta-time.

**Working summary (what a fresh session can rely on):**
- **Movement:** WASD + mouse look + Space jump + hold **C** crouch.
  Player is a Rapier `kinematicPositionBased` capsule
  (`PLAYER_RADIUS = 0.4`, `PLAYER_HALF_HEIGHT = 0.6` standing /
  `CROUCH_HALF_HEIGHT = 0.15` crouched) driven by
  `world.createCharacterController()`, with gravity/jump applied manually
  (`GRAVITY` / `JUMP_SPEED` — kinematic bodies ignore Rapier's own
  gravity). Crouch is a static height/speed change only (no slide):
  resizes the capsule with a foot-anchored Y adjust, uses
  `CROUCH_MOVE_SPEED` / `CROUCH_EYE_HEIGHT`, and refuses to stand up when
  a ceiling blocks the taller capsule (upward headroom raycast).
  Yaw/pitch are plain variables applied to `camera.rotation`
  (`rotation.order = "YXZ"`).
- **Pointer lock / focus handling:** Game starts paused with
  `#pause-overlay` ("Click to Play"). `pointerlockchange` plus
  `blur`/`visibilitychange` pause on Escape / focus loss; resume re-locks
  the pointer (with Chrome Escape-cooldown retry). Clears `keysPressed` /
  `isFiring` on pause so held inputs can't stick across alt-tab.
- **Arena + platforms:** Sized via `ARENA_SIZES` (`1v1`/`3v3`/`5v5` →
  30/45/60m); `GROUND_SIZE` currently hardcodes `"1v1"` until Milestone
  9's pre-match menu. Solid Milestone 3 cover (`boxObstacleDefs` /
  `pillarObstacleDefs` / `rampObstacleDef`) stays as ground-resting
  blockers (shorter ones still jump-on-top via the character controller —
  not walk-under). Milestone 7 adds separate elevated bridges/platforms
  (`elevatedStructurePieceDefs`: east bridge, west raised platform, low
  crouch underpass) with visible legs, open undercroft (stand-under
  ~2.25m on tall decks; crouch-only ~1.35m on the low underpass), and
  ramps onto the decks. Placement was adjusted so new structures do not
  overlap Milestone 3 cover. Boundary walls use `WALL_HEIGHT = 6` plus
  invisible collision-only containment cuboids
  (`BOUNDARY_CONTAINMENT_HEIGHT = 20`) so players cannot climb over the
  rim from tall decks; tall decks were also nudged inward from the walls.
  Soft OOB recovery (`recoverPlayerFromOutOfBounds`, `OOB_MARGIN`)
  teleports the player to a random blue-team spawn if they somehow leave
  the ground pad — no death/score change. Competitive layout: center
  chokepoint, denser west cover, sparser east open lane.
- **Team spawns:** BLUE (`BLUE_TEAM_SPAWN_POINTS`, +Z / player side) vs
  RED (`RED_TEAM_SPAWN_POINTS`, -Z / enemy side). On match start and each
  respawn, pick randomly among that team's candidates (player drop-in
  `y = PLAYER_SPAWN_DROP_Y`). Points are clear of obstacles/platforms and
  stay on opposite sides of the chokepoint so neither team can immediately
  see/shoot into the other's spawn zone.
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
  Shared LOS helper `hasLineOfSight()`; bot AI vision via
  `botCanSeePlayer()` only (never omniscient); turn-speed-limited aim
  (`rotateGroupTowards()` / `BOT_TURN_SPEED_RADIANS_PER_SEC`); fires after
  `BOT_REACTION_DELAY_MS` once aimed within
  `BOT_AIM_ANGLE_THRESHOLD_RADIANS`, with `BOT_AIM_SPREAD_RADIANS` jitter.
  When it can't see the player: chases `botLastKnownPlayerPosition`, else
  patrols hand-placed `BOT_PATROL_POINTS` near cover (`moveBotTowards()`)
  — simple waypoint patrol, NOT Milestone 10's tactical cover-seeking.
  Health equals `PLAYER_MAX_HEALTH`; both sides regen after
  `HEALTH_REGEN_DELAY_MS` at `HEALTH_REGEN_RATE_PER_SECOND`.
- **Floating health bars:** `createFloatingHealthBar({ isEnemy })`. Enemy
  bars show only when the player has LOS (`playerCanSeeBot()` — same
  raycast pattern as bot vision, from the player's eye); ally bars stay
  always visible for team awareness (`isEnemy: false` when ally bots
  exist). No ally bots yet (Milestone 9/10).
- **Respawn + spawn invulnerability:** On death, player shows
  `#death-overlay` with a live countdown on `#death-overlay-subtitle`
  (3…2…1 via `playerRespawnAt` / `updateDeathOverlayCountdown()`, synced
  to `RESPAWN_DELAY_MS`), then `respawnPlayer()` (random blue spawn, full
  health/ammo). Bot disables collider + hides mesh, then `respawnBot()`
  re-enables/shows, picks a random red spawn, and resets AI state. Both
  get `SPAWN_INVULNERABILITY_MS` (1.5s) of no-damage
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
`WALL_HEIGHT = 6`, `BOUNDARY_CONTAINMENT_HEIGHT = 20`, `OOB_MARGIN = 0.5`,
`MOVE_SPEED = 5`, `JUMP_SPEED = 6`, `GRAVITY = 20`, `PLAYER_RADIUS = 0.4`,
`PLAYER_HALF_HEIGHT = 0.6`, `EYE_HEIGHT = 0.8`, `CROUCH_HALF_HEIGHT = 0.15`,
`CROUCH_EYE_HEIGHT = 0.35`, `CROUCH_MOVE_SPEED = 2.5`, `GUN_DAMAGE = 25`,
`FIRE_RATE_RPM = 750`, `MAGAZINE_SIZE = 30`, `RELOAD_TIME_MS = 1800`,
`PLAYER_MAX_HEALTH = 100`, `HEALTH_REGEN_DELAY_MS = 5000`,
`HEALTH_REGEN_RATE_PER_SECOND = 8`, `BOT_*` AI/movement/aim constants,
`BLUE_TEAM_SPAWN_POINTS` / `RED_TEAM_SPAWN_POINTS`,
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
- [x] 7. Platforms + crouch: COMPLETE (core + follow-ups). Core: jump-on-
      top / walk-across platforms and bridges with proper walk-underneath
      clearance; hold **C** crouches as a static height/speed change (no
      slide). Verify: ramp onto a deck and walk across; walk under a tall
      deck standing; hold C to fit under the low underpass (stay crouched
      if C is released while still under). New elevated structures live in
      `elevatedStructurePieceDefs` (east bridge, west raised platform, low
      crouch underpass) — separate from Milestone 3 solid cover, which was
      left unchanged (shorter boxes/pillars still jump-on-top via the
      character controller). Crouch uses `CROUCH_HALF_HEIGHT` /
      `CROUCH_MOVE_SPEED` / `CROUCH_EYE_HEIGHT` with a headroom ray before
      standing. Also includes follow-ups beyond the original M7 checklist
      — see "Current Status" above for details:
        - Obstacle/platform overlap fix: repositioned elevated structures
          so they no longer clip Milestone 3 cover.
        - Arena boundary-exit exploit fix: `WALL_HEIGHT = 6`, invisible
          `BOUNDARY_CONTAINMENT_HEIGHT` colliders, inward-nudged tall
          decks, soft OOB spawn recovery.
        - Enemy floating health bars only visible with player→bot line of
          sight (`playerCanSeeBot` / shared `hasLineOfSight`); ally bars
          remain always visible (`isEnemy: false` when allies exist).
        - Varied per-team spawn points (`BLUE_TEAM_SPAWN_POINTS` /
          `RED_TEAM_SPAWN_POINTS`) — random pick on match start and each
          respawn; zones stay separated by the center chokepoint.
        - Live respawn countdown on `#death-overlay-subtitle` (3…2…1)
          synced to `RESPAWN_DELAY_MS` via `playerRespawnAt`.
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
