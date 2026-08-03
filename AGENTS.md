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

### Current Status (as of Milestone 4)
For a fresh session picking this project back up:
- **Built so far:** Milestones 1 (project scaffold), 2 (first-person
  movement), 2.5 (pointer lock + focus handling), 3 (arena with
  obstacles), and 4 (shooting + health) are done and checked off below.
  Next up is Milestone 5 (one AI bot).
- **File structure:** Everything lives in one file, `src/main.js`, plus
  `index.html` and `src/style.css`. The project hasn't been split into
  multiple JS modules yet — it's still small enough for one file to stay
  readable; revisit this once more systems (bots, minimap, menus) exist.
- **Player movement:** The player is a Rapier `kinematicPositionBased`
  rigid body with a capsule collider (radius 0.4, half-height 0.6), moved
  each frame via `world.createCharacterController()` (Rapier's built-in
  character controller) rather than a dynamic physics body — this gives
  precise FPS-style control instead of bouncy physics. Gravity and jump
  velocity are applied manually in the render loop (kinematic bodies
  aren't affected by Rapier's own gravity).
- **Camera/mouse look:** Yaw/pitch are tracked as plain variables in
  `src/main.js` and applied to `camera.rotation` with
  `rotation.order = "YXZ"` (needed so look up/down and look left/right
  combine correctly without gimbal issues).
- **Pointer lock + pause overlay (Milestone 2.5):** a full-screen
  `#pause-overlay` (`index.html`/`style.css`) shows "Click to Play"
  (or "Paused — Click to Resume" after the first play) whenever the game
  isn't pointer-locked. A single `isPaused` flag in `src/main.js` gates
  all physics/movement in the render loop's `tick()` — nothing moves or
  falls while paused. It's driven by the `pointerlockchange` event (which
  fires for Escape, programmatic unlock, and browser-forced release
  alike), plus explicit `blur`/`visibilitychange` listeners as a safety
  net for focus loss (alt-tab, switching tabs) in case a browser doesn't
  auto-release pointer lock on its own. `showPauseOverlay()` also clears
  `keysPressed` so a key held down when focus is lost can't stay "stuck".
- **Arena sizing (Milestone 3):** `ARENA_SIZES` in `src/main.js` maps
  `"1v1"`/`"3v3"`/`"5v5"` to arena widths (30/45/60 meters), per the
  Visual Style scaling rule. `GROUND_SIZE` currently just reads
  `ARENA_SIZES["1v1"]` since there's no pre-match menu yet - Milestone 9
  will pick the size based on the player's menu selection instead.
- **Boundary walls:** 4 simple gray box walls (`wallDefs`) were added
  around the edge of the ground plane during Milestone 2 to test wall
  collision. Since they're computed from `GROUND_SIZE`, Milestone 3 just
  reused them as-is (they scale automatically) instead of replacing them.
- **Interior obstacles (Milestone 3):** a varied mix of static crate-
  colored cover in `src/main.js` - 7 boxes (`boxObstacleDefs`: a split
  center wall plus assorted crates/low walls), 4 round pillars
  (`pillarObstacleDefs`, using Rapier's cylinder collider), and 1 tilted
  ramp (`rampObstacleDef`, a box rotated ~15 degrees via a THREE.Quaternion
  copied into Rapier's rotation format). Shapes/sizes are intentionally
  varied (not a repeating grid/mirrored pattern), and the *layout* is
  deliberately designed for competitive flow, not just visuals: a center
  wall-with-a-gap is the main chokepoint and sightline-breaker (blocks the
  direct spawn-to-spawn view), a second crate-to-pillar gap forms a
  narrower chokepoint on the west flank, the west side is kept denser/
  tighter (firefight cover) while the east side is kept sparser (an open
  repositioning lane), and both the player's spawn `(0, _, 5)` and a
  reserved mirrored spot for the future enemy bot spawn `(0, _, -5)` are
  kept clear of obstacles sitting directly on top of them. That reserved
  spot is now occupied by Milestone 4's temporary test target (see below)
  — Milestone 5 should replace it with the real bot at the same position.
  Side effect worth knowing about for Milestone 7: because these are
  ordinary static Rapier colliders, the character controller already lets
  the player jump on top of the shorter ones with zero extra code - see
  the note under Milestone 7 below about reusing this instead of rebuilding
  platform-top collision from scratch. Walking *underneath* an obstacle and
  the crouch mechanic itself are still not built - that's still Milestone
  7's job.
- **Shooting (Milestone 4, full-auto):** the gun is "hitscan" (an instant
  Rapier raycast, `world.castRayAndGetNormal()`, no travelling bullet)
  fired from the camera. It's full-auto: holding left-click keeps firing
  at a fixed rate (`FIRE_RATE_RPM = 750`, i.e. `FIRE_INTERVAL_MS` apart)
  via an `isFiring` flag set on `mousedown`/cleared on `mouseup` (and on
  pause/focus-loss, alongside the existing `keysPressed` reset - see
  `showPauseOverlay()`) that's checked every frame in `tick()`
  (`tryFireShot()` in `startRenderLoop`). It automatically hits every
  existing wall/obstacle collider from Milestone 3 with no extra work.
  Hits spawn a short-lived tracer line (`spawnTracer()`) and impact flash
  (`spawnImpactFlash()`), both plain Three.js meshes added to the scene
  and removed a few frames later with `setTimeout` - no particle library
  needed. The tracer's visual start point is offset from the camera
  center (`MUZZLE_OFFSET`, via `camera.localToWorld()`) so it doesn't
  render invisibly end-on when firing straight ahead - the actual
  hit-detection ray still fires from the exact camera center for
  accuracy. There's no visible gun model yet (per the Visual Style spec,
  that's fine for now).
- **Ammo + reload (Milestone 4 extension):** a simple arcade-style
  magazine - `MAGAZINE_SIZE = 30`, `RELOAD_TIME_MS = 1800`ms - tracked via
  `currentAmmo`/`isReloading` in `src/main.js`. Firing is blocked
  (`canFire()`) whenever the magazine is empty or a reload is in progress.
  Reloading can start two ways, both funneled through the same
  `startReload()` (which itself no-ops if already reloading/full, so
  there's no conflict between the two): manually via "R" (in the
  `keydown` listener, gated the same way as the "T" debug key below), or
  automatically the instant `currentAmmo` hits 0 (in `fireShot()`).
- **Test target + player health (Milestone 4, see also above):** since
  Milestone 5's real bot doesn't exist yet, two TEMPORARY stand-ins let the
  damage pipeline be tested end-to-end - both are commented in
  `src/main.js` as temporary so they're easy to find and remove/replace:
    - A shootable red capsule (`targetMesh`/`targetCollider`, 100 HP) at
      the reserved `(0, _, -5)` spot, destroyed (mesh + collider removed)
      after 4 hits. No respawn - refreshing the page resets it.
    - A debug-only "T" key (`damagePlayer(20)`, in the `keydown` listener)
      that damages the player directly, since nothing can shoot back yet.
  The player's own health (`playerHealth`, updated by `damagePlayer()`)
  reaching 0 sets `isDead`, which freezes movement/shooting in `tick()`
  (alongside `isPaused`) and shows a `#death-overlay` message. No respawn
  logic yet - that's Milestone 6.
- **HUD (Milestone 4 extension):** everything below is plain HTML/CSS
  (`index.html`/`style.css`), matching the pause overlay's existing
  DOM-based approach - no canvas-drawn UI or image assets anywhere yet.
    - `#crosshair`: a simple white "+" reticle at screen center (built
      from two CSS pseudo-element bars), purely visual - the actual
      raycast always fires from the exact camera center regardless.
    - `#ammo-hud` (bottom-right corner): a dark pill showing `"18 / 30"`
      (or `"Reloading..."`) in `#ammo-text`, next to a small CSS-drawn
      brass bullet icon (`#ammo-icon`) - both updated by
      `updateAmmoDisplay()`. Below `LOW_AMMO_RATIO` (20% of the magazine)
      the text flashes red (`.ammo-low` class) as a reload reminder.
    - `#health-hud` (bottom-left corner): the `#health-bar-fill` bar
      (green/orange/red by threshold) next to a small CSS-drawn red
      medkit icon (`#health-icon`), both driven by `damagePlayer()`.
    - `#vignette`: a full-screen radial-gradient red glow that fades in
      around the screen edges (via its `.active` class) once health drops
      to/below `LOW_HEALTH_VIGNETTE_THRESHOLD` (25%), toggled in
      `damagePlayer()`.
- **Key tuning constants (all in `src/main.js`):** `ARENA_SIZES` (see
  above), `WALL_HEIGHT = 3`, `WALL_THICKNESS = 1`, `MOVE_SPEED = 5` (m/s),
  `JUMP_SPEED = 6` (m/s), `GRAVITY = 20` (stronger than real-world 9.81
  for a snappier game feel), `PLAYER_RADIUS = 0.4`, `PLAYER_HALF_HEIGHT
  = 0.6`, `EYE_HEIGHT = 0.8`, `GUN_DAMAGE = 25`, `GUN_RANGE = 100`,
  `FIRE_RATE_RPM = 750`, `MAGAZINE_SIZE = 30`, `RELOAD_TIME_MS = 1800`,
  `PLAYER_MAX_HEALTH = 100`, `TARGET_MAX_HEALTH = 100`.
- **Note:** Uses `THREE.Timer` (not the older `THREE.Clock`, which the
  installed Three.js version has deprecated) for per-frame delta-time.

### v1 — Playable Core
- [x] 1. Project scaffold: Vite + Three.js + Rapier running, empty scene
 renders (ground plane + camera). Verify: `npm run dev` shows a scene
 with no console errors.
- [x] 2. First-person movement: WASD to move, mouse to look, Space to jump,
      player collides with ground/walls via Rapier. Verify: can walk around
      the whole scene, can't clip through the ground or walls, jump works.
- [x] 2.5. Pointer lock + focus handling (see dedicated section below):
      click-to-play overlay, Escape pauses + shows resume overlay, losing
      window focus auto-pauses, resuming reliably works every time. Verify:
      click away mid-test, alt-tab, press Escape — each time, resuming
      restores working mouse-look with no dead states.
- [x] 3. Arena with obstacles: walls + a few static obstacles placed (no
      platforms yet). Verify: obstacles block movement and bullets (once
      shooting exists) correctly.
- [x] 4. Shooting + health: raycast gun fires on click, deals damage,
      health bar UI updates, player can "die" (health hits 0). Verify: can
      shoot a test target/wall and see hit feedback; health bar decreases
      when taking test damage.
- [ ] 5. One AI bot: sees player, aims, shoots back, has health/can die.
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
