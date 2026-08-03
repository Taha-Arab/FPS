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

### Current Status (as of Milestone 5)
For a fresh session picking this project back up: Milestones 1–5 (project
scaffold, first-person movement, pointer lock/pause, arena obstacles,
shooting + health, one AI bot) are done and checked off below — next up is
Milestone 6 (respawn + win condition). Everything still lives in one file
(`src/main.js`, plus `index.html`/`src/style.css`); it hasn't been split
into modules yet since it's still small enough to stay readable. The player
is a Rapier `kinematicPositionBased` capsule body (radius 0.4, half-height
0.6) driven each frame by `world.createCharacterController()`, with
gravity/jump speed applied manually in the render loop (kinematic bodies
ignore Rapier's own gravity); yaw/pitch are plain variables applied to
`camera.rotation` (`rotation.order = "YXZ"`). Pointer lock/pause
(`isPaused`) is driven by the `pointerlockchange` event plus
`blur`/`visibilitychange` fallbacks, showing `#pause-overlay` and clearing
`keysPressed`/`isFiring` on pause. `ARENA_SIZES` maps `"1v1"`/`"3v3"`/`"5v5"`
to widths (30/45/60m); `GROUND_SIZE` currently hardcodes `"1v1"` until
Milestone 9 adds the pre-match menu. Obstacles (`wallDefs`,
`boxObstacleDefs`, `pillarObstacleDefs`, `rampObstacleDef`) are static
Rapier colliders laid out deliberately for competitive flow (a center
chokepoint blocking the spawn-to-spawn sightline, a denser west side for
cover, a sparser east side as an open lane), with the player spawn
`(0, _, 5)` and the bot spawn `(0, _, -5)`. As a side effect of being
ordinary static colliders, the character controller already lets the player
jump on top of the shorter ones — worth reusing for Milestone 7 — but
walking underneath an obstacle and the crouch mechanic are still unbuilt.
Shooting is hitscan (`world.castRayAndGetNormal()`), full-auto via an
`isFiring` flag and `FIRE_RATE_RPM`, with a tracer line (`spawnTracer()`)
and impact flash (`spawnImpactFlash()`) on hit, offset from camera center
via `MUZZLE_OFFSET` so tracers render visibly; there's no visible gun model
yet. Ammo/reload uses `MAGAZINE_SIZE`/`RELOAD_TIME_MS`, funneled through
`startReload()` (manual "R" key or automatic on empty magazine). A debug
"T" key (`damagePlayer(20)`) is still around as a convenience for quickly
testing the health bar/death state.

The AI bot (Milestone 5, plus a movement/health enhancement pass built
right after it — see below) is a single enemy that spawns at `(0, _, -5)`,
built from a `THREE.Group` (`botGroup`) containing the red capsule mesh
plus a small dark marker box (`BOT_MARKER_OFFSET`) stuck to its front —
since a plain capsule is rotationally symmetric, the marker is what makes
its facing/aim actually visible when it turns. Its Rapier setup is now a
`kinematicPositionBased` body (`botBody`) + capsule collider (`botCollider`)
plus its OWN `world.createCharacterController()` instance
(`botCharacterController`) — separate from the player's, since
`computedGrounded()`/`computedMovement()` are stateful per-controller
results from whichever `computeColliderMovement()` call ran most recently,
so sharing one instance between player and bot would corrupt whichever ran
second each frame. Each frame, `updateBot()` in `startRenderLoop()` casts a
ray from `getBotEyePosition()` to the player's current eye position
(`getPlayerEyePosition()`) via `botCanSeePlayer()` — this raycast is the
ONLY thing allowed to gate tracking/aiming, never omniscience. If
unobstructed: it stops moving, turns toward the player via
`rotateGroupTowards()` (rate-limited by `BOT_TURN_SPEED_RADIANS_PER_SEC`,
so it no longer snaps instantly), tracks how long it's been visible in
`botSpottedAtTime`, and once `BOT_REACTION_DELAY_MS` has elapsed AND it's
turned to within `BOT_AIM_ANGLE_THRESHOLD_RADIANS` of dead-on, fires via
`botFireShot()` at `BOT_FIRE_RATE_RPM`, aiming through `applyAimSpread()`
(a small random cone jitter, `BOT_AIM_SPREAD_RADIANS`) and damaging the
player via `damagePlayer()` on a hit. If sight is lost (or never
established): `botSpottedAtTime` resets to `null` (re-spotting always
requires the reaction delay again), and it moves via `moveBotTowards()` —
first toward `botLastKnownPlayerPosition` (continuously updated while
visible), then falling back to wandering between hand-placed
`BOT_PATROL_POINTS` near existing cover once that's reached or
`BOT_MOVE_TIMEOUT_MS` expires (`pickNewPatrolTarget()`). This is simple
waypoint patrol, NOT the tactical cover-seeking AI still reserved for
Milestone 10's difficulty tiers. The bot has its own health
(`botHealth`/`BOT_MAX_HEALTH`, now always equal to `PLAYER_MAX_HEALTH` for
balance) managed through `setBotHealth()`/`damageBot()`/`regenBotHealth()`,
is destroyed (mesh + collider removed) at 0 HP, and shows a small
team-colored floating health bar above its head
(`createFloatingHealthBar()`/`updateFloatingHealthBarPosition()`/
`updateFloatingHealthBarFill()` — a DOM/CSS overlay projected from its
world position each frame, matching how the rest of the HUD is built; no
occlusion testing against walls yet). No respawn or win/lose state yet,
that's explicitly Milestone 6.

Player health/death (`playerHealth`, `damagePlayer()`, `isDead`,
`#death-overlay`) works but has no respawn yet (that's Milestone 6), and
now goes through the same `setPlayerHealth()` shared-setter pattern as the
bot. Both the player and the bot regenerate health gradually — after
`HEALTH_REGEN_DELAY_MS` with no damage taken, `regenPlayerHealth()`/
`regenBotHealth()` (called every frame from `tick()`) raise health back
toward max at `HEALTH_REGEN_RATE_PER_SECOND`, routed back through the same
setters so the HUD/floating bar/vignette all stay in sync either
direction; both are no-ops once dead/destroyed. The HUD — crosshair, ammo
pill (with low-ammo flash), health bar, and a low-health vignette — is
plain HTML/CSS in `index.html`/`style.css`, matching the pause overlay's
DOM-based approach. Key tuning constants live in `src/main.js`:
`ARENA_SIZES`, `WALL_HEIGHT = 3`, `WALL_THICKNESS = 1`, `MOVE_SPEED = 5`,
`JUMP_SPEED = 6`, `GRAVITY = 20`, `PLAYER_RADIUS = 0.4`,
`PLAYER_HALF_HEIGHT = 0.6`, `EYE_HEIGHT = 0.8`, `GUN_DAMAGE = 25`,
`GUN_RANGE = 100`, `FIRE_RATE_RPM = 750`, `MAGAZINE_SIZE = 30`,
`RELOAD_TIME_MS = 1800`, `PLAYER_MAX_HEALTH = 100`,
`HEALTH_REGEN_DELAY_MS = 5000`, `HEALTH_REGEN_RATE_PER_SECOND = 8`,
`BOT_MAX_HEALTH` (= `PLAYER_MAX_HEALTH`), `BOT_SIGHT_RANGE = 100`,
`BOT_REACTION_DELAY_MS = 500`, `BOT_FIRE_RATE_RPM = 300`,
`BOT_DAMAGE_PER_HIT = 10`, `BOT_AIM_SPREAD_RADIANS = 0.035`,
`BOT_MOVE_SPEED = 3`, `BOT_TURN_SPEED_RADIANS_PER_SEC = PI`,
`BOT_AIM_ANGLE_THRESHOLD_RADIANS = 0.05`,
`BOT_WAYPOINT_ARRIVAL_RADIUS = 1.5`, `BOT_MOVE_TIMEOUT_MS = 6000`,
`BOT_PATROL_POINTS` (6 hand-placed waypoints).
Uses `THREE.Timer` (not the deprecated `THREE.Clock`) for per-frame delta-time.

### v1 — Playable Core
- [x] 1. Project scaffold: Vite + Three.js + Rapier running, empty scene renders.
- [x] 2. First-person movement: WASD, mouse look, jump, collision via Rapier.
- [x] 2.5. Pointer lock + focus handling: click-to-play overlay, Escape/focus-loss pause, reliable resume.
- [x] 3. Arena with obstacles: walls + static obstacles placed (no platforms yet).
- [x] 4. Shooting + health: raycast gun fires on click, deals damage, health bar updates, player can die.
- [x] 5. One AI bot: sees player, aims, shoots back, has health/can die.
      Verify: bot reacts when player is in view, player can kill it, it
      can damage the player.
- [ ] 6. Respawn + win condition: player and bot respawn after death,
      match ends at N kills, simple end-of-match state. Verify: die once,
      confirm respawn works; play to the kill target, confirm match ends.

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
