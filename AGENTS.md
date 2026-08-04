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

### Current Status (Milestones 1–10 complete — v2 done)
**v1 (Playable Core) is complete**, and **v2 (Milestones 7–10) is
complete** — platforms + crouch (M7), minimap (M8), pre-match menu (M9),
and multiple bots + full difficulty tiers / cover-seeking (M10).
Next up is **v3 polish**, starting with **Milestone 11** (weapon
feedback: recoil, muzzle flash, tracers, hit markers).

Everything still lives in one file (`src/main.js`, plus `index.html` /
`src/style.css`); it hasn't been split into modules yet since it's still
small enough to stay readable. Uses `THREE.Timer` (not the deprecated
`THREE.Clock`) for per-frame delta-time.

**Working summary (what a fresh session can rely on):**
- **Pre-match menu (Milestone 9 complete):** `#prematch-menu` gates
  startup before the match. Player picks team size (`1v1`/`3v3`/`5v5`),
  bot difficulty (Easy/Medium/Hard), and kill target (`5`/`10`/`15`),
  then **Start Match** runs `startMatch()` →
  `buildArena(ARENA_SIZES[preset])` (ground/walls +
  `buildArenaCover()` + `buildCoverSlots()`) → `buildMinimapLayout()` →
  `initPhysics()` / `spawnBotsForMatch()` → `startRenderLoop()`, then
  reveals `#pause-overlay` ("Click to Play"). `matchConfig` stores
  `teamSize`, `difficulty`, `killTarget`, plus `allyBots`/`enemyBots`
  from `TEAM_SIZE_BOT_COUNTS` (player counts as one BLUE member). Menu
  hints (`TEAM_SIZE_HINTS`) describe the real spawned counts. Follow-ups
  from M9: arena cover density scales with preset size; player fire rate
  matched to bots; crouch camera eases instead of snapping.
- **Movement:** WASD + mouse look + Space jump + hold **C** crouch.
  Player is a Rapier `kinematicPositionBased` capsule
  (`PLAYER_RADIUS = 0.4`, `PLAYER_HALF_HEIGHT = 0.6` standing /
  `CROUCH_HALF_HEIGHT = 0.15` crouched) driven by
  `world.createCharacterController()`, with gravity/jump applied manually
  (`GRAVITY` / `JUMP_SPEED` — kinematic bodies ignore Rapier's own
  gravity). Crouch is a static height/speed change only (no slide):
  resizes the capsule with a foot-anchored Y adjust, uses
  `CROUCH_MOVE_SPEED` / `CROUCH_EYE_HEIGHT`, and refuses to stand up when
  a ceiling blocks the taller capsule (upward headroom raycast). Camera
  view eases between standing/crouch height over
  `CROUCH_CAMERA_TRANSITION_SECONDS` (0.15s) via `crouchCameraBlend` —
  physics capsule/eye used for shooting + LOS still snap immediately;
  jump/fall track the body with no lag. Respawn / OOB recovery call
  `snapCameraHeightToPlayer()`. Yaw/pitch are plain variables applied to
  `camera.rotation` (`rotation.order = "YXZ"`).
- **Pointer lock / focus handling:** After Start Match, game starts
  paused with `#pause-overlay` ("Click to Play"). `pointerlockchange`
  plus `blur`/`visibilitychange` pause on Escape / focus loss; resume
  re-locks the pointer (with Chrome Escape-cooldown retry). Clears
  `keysPressed` / `isFiring` on pause so held inputs can't stick across
  alt-tab. `matchReady` keeps pause/focus handlers from covering the
  pre-match menu before Start Match.
- **Arena + platforms:** Sized via `ARENA_SIZES` (`1v1`/`3v3`/`5v5` →
  30/45/60m); `GROUND_SIZE` / ground + boundary wall meshes come from
  `buildArena()` using the pre-match team-size preset.
  `buildArenaCover()` fills runtime `boxObstacleDefs` /
  `pillarObstacleDefs` / `rampObstacleDefs` /
  `elevatedStructurePieceDefs` from size-tiered templates: `BASE_*`
  (original 1v1 center cluster), `MID_RING_*` (3v3+), `OUTER_RING_*`
  (5v5) — same competitive language (center chokepoint, denser west,
  sparser east, N/S sightline breakers), not an empty rim around the
  same few props. End of `buildArenaCover()` also calls
  `buildCoverSlots()` (Hard-tier AI stand-points beside boxes/pillars).
  Solid cover stays ground-resting blockers (shorter ones still
  jump-on-top via the character controller — not walk-under). Elevated
  decks (east bridge, west raised platform, low crouch underpass, plus
  extra decks/underpasses on larger presets) have visible legs, open
  undercroft (stand-under ~2.25m on tall decks; crouch-only ~1.35m on
  low underpasses), and access ramps. Boundary walls use
  `WALL_HEIGHT = 6` plus invisible collision-only containment cuboids
  (`BOUNDARY_CONTAINMENT_HEIGHT = 20`) so players cannot climb over the
  rim from tall decks. Soft OOB recovery
  (`recoverPlayerFromOutOfBounds`, `OOB_MARGIN`) teleports the player to
  a random blue-team spawn if they somehow leave the ground pad — no
  death/score change.
- **Team spawns:** BLUE (`BLUE_TEAM_SPAWN_POINTS`, +Z / player side) vs
  RED (`RED_TEAM_SPAWN_POINTS`, -Z / enemy side), 5 candidates each.
  Match start shuffles both pools (`shuffleSpawnPoints()`): player takes
  blue `[0]`, ally bots take blue `[1…]`, enemies take shuffled red —
  avoids stacking at load. Respawn still picks randomly from that team's
  pool (player drop-in `y = PLAYER_SPAWN_DROP_Y`). Zones stay on opposite
  sides of the chokepoint so neither can immediately see/shoot into the
  other's spawn area.
- **Shooting + player HUD:** Hitscan gun (`world.castRayAndGetNormal()`),
  full-auto via `isFiring` + `FIRE_RATE_RPM` (**300**, matched to
  `BOT_FIRE_RATE_RPM` so kills aren't trivial from RPM alone),
  magazine/reload (`MAGAZINE_SIZE` / `RELOAD_TIME_MS`, manual R or auto
  on empty), tracers (`spawnTracer()` via `MUZZLE_OFFSET`) + impact
  flashes. Hit resolution uses `colliderToBot` Map — player damages
  **red bots only** (no friendly fire on blue allies). HUD: crosshair,
  ammo pill (low-ammo flash), health bar, low-health vignette. Debug "T"
  key still calls `damagePlayer(20)` for quick health/death testing. No
  visible gun model yet (polish later).
- **Multiple AI bots (Milestone 10 complete):** Live `bots[]` from
  `spawnBotsForMatch()` / `createBotInstance()` using
  `matchConfig.allyBots` / `enemyBots` via `TEAM_SIZE_BOT_COUNTS`:
  - 1v1 = 0 allies + 1 enemy
  - 3v3 = 2 allies + 3 enemies
  - 5v5 = 4 allies + 5 enemies
  Blue allies (`ALLY_BOT_COLOR = 0x3366cc`) + red enemies
  (`ENEMY_BOT_COLOR = 0xcc3333`); each owns kinematic body, own
  character controller, capsule + facing marker (`BOT_MARKER_OFFSET`),
  floating health bar, minimap dot. Shared AI (`updateAllBots()` →
  `updateBot()`): LOS via `hasLineOfSight()`; nearest visible hostile
  via `pickVisibleHostile()` / `getHostileCandidates()` — **team-gated**
  (blue → living red bots only, never the player or other blues; red →
  living player + living blue bots only, never other reds). Bot shots
  re-check team on hit (`damagePlayer` / `damageBot(target,
  BOT_DAMAGE_PER_HIT)`). Same logic all tiers; per-bot knobs from
  `DIFFICULTY_TIERS` copied at spawn:
  - Easy: reaction 900ms, spread 0.08, turn ~100°/s, no cover
  - Medium: reaction 500ms, spread 0.035, turn 180°/s, no cover
  - Hard: reaction 250ms, spread 0.015, turn ~270°/s, `usesCover: true`
  Hard cover-seeking: after damage within `COVER_SEEK_WINDOW_MS` (3s),
  path to a `coverSlots` stand-point that breaks threat LOS
  (`pickCoverSlot()` / `isSlotHiddenFromThreat()`), then
  `holdingCover` until the under-fire window ends (avoids slot hopping).
  When not engaging: chase `lastKnownTargetPosition`, else patrol
  `BOT_PATROL_POINTS` (`moveBotTowards()`). Fire cadence
  `BOT_FIRE_RATE_RPM = 300` (difficulty is reaction/aim/turn/cover, not
  RPM). Health = `PLAYER_MAX_HEALTH`; regen via `regenAllBotsHealth()`.
- **Floating health bars:** one `createFloatingHealthBar({ isEnemy })`
  per bot. Enemy bars LOS-gated (`playerCanSeeBot()`); ally bars always
  visible (`isEnemy: false`).
- **Respawn + spawn invulnerability:** On death, player shows
  `#death-overlay` with a live countdown on `#death-overlay-subtitle`
  (3…2…1 via `playerRespawnAt` / `updateDeathOverlayCountdown()`, synced
  to `RESPAWN_DELAY_MS`), then `respawnPlayer()` (random blue spawn, full
  health/ammo, camera crouch-blend snapped). Each bot disables collider +
  hides mesh/dot/bar, then `scheduleBotRespawn` → `respawnBot(bot)`
  re-enables/shows, picks a random team spawn, resets AI state
  (including `coverTarget` / `holdingCover`). `SPAWN_INVULNERABILITY_MS`
  (1.5s) via `playerInvulnerableUntil` / per-bot `invulnerableUntil`
  (early returns in `damagePlayer()` / `damageBot()`; tracers still land).
  Cues: pulsing blue `#spawn-invuln-overlay` for the player;
  `material.opacity = 0.5` per invulnerable bot.
- **Team score / timer HUD + win condition:** Top-center `#match-hud`
  shows BLUE/RED team scores (`blueScore` / `redScore`) and a count-up
  match timer (starts on first pointer-lock; doesn't subtract paused time —
  accepted v1 simplification). Scoring is team-based: red bot death →
  `blueScore++`; player death or blue ally death → `redScore++`
  (`handleBotDeath(bot)` / `handlePlayerDeath()`). First team to
  `killTarget` (menu: 5 / 10 / 15) wins via `endMatch()` →
  `#match-end-overlay` + `matchEnded` freezes simulation. Refresh page to
  play again (real "Play Again" is Milestone 13).
- **Minimap (Milestone 8 complete, multi-bot in M10):** Top-right
  `#minimap` (140×140 DOM panel). Static layout layer
  (`buildMinimapLayout()` → `#minimap-layout`) draws simplified XZ
  footprints from runtime cover/platform defs (boxes, pillars, ground
  ramps, elevated decks/access ramps; thin support legs omitted). Cover
  vs platform use distinct CSS fills. Each frame `updateMinimap()` maps
  `playerBody` + every living bot via `GROUND_SIZE` onto blue player /
  ally dots (`#3366cc`) and red enemy dots (`#cc3333`). Player marker
  rotates with `yaw` (facing chevron). Destroyed bots hide their dots.
  Bot dots created in JS (`createMinimapDot()`); `#minimap-player` stays
  in HTML. Larger arenas show the extra mid/outer-ring footprints.

Key tuning constants in `src/main.js` include: `ARENA_SIZES`,
`TEAM_SIZE_BOT_COUNTS`, `WALL_HEIGHT = 6`,
`BOUNDARY_CONTAINMENT_HEIGHT = 20`, `OOB_MARGIN = 0.5`, `MOVE_SPEED = 5`,
`JUMP_SPEED = 6`, `GRAVITY = 20`, `PLAYER_RADIUS = 0.4`,
`PLAYER_HALF_HEIGHT = 0.6`, `EYE_HEIGHT = 0.8`, `CROUCH_HALF_HEIGHT = 0.15`,
`CROUCH_EYE_HEIGHT = 0.35`, `CROUCH_MOVE_SPEED = 2.5`,
`CROUCH_CAMERA_TRANSITION_SECONDS = 0.15`, `GUN_DAMAGE = 25`,
`FIRE_RATE_RPM = 300` (= `BOT_FIRE_RATE_RPM`), `MAGAZINE_SIZE = 30`,
`RELOAD_TIME_MS = 1800`, `PLAYER_MAX_HEALTH = 100` (= `BOT_MAX_HEALTH`),
`HEALTH_REGEN_DELAY_MS = 5000`, `HEALTH_REGEN_RATE_PER_SECOND = 8`,
`BOT_MOVE_SPEED = 3`, `BOT_AIM_ANGLE_THRESHOLD_RADIANS`,
`COVER_SEEK_WINDOW_MS = 3000`, `DIFFICULTY_TIERS` (Easy/Medium/Hard
reaction / aim spread / turn speed / `usesCover`),
`BLUE_TEAM_SPAWN_POINTS` / `RED_TEAM_SPAWN_POINTS`, `killTarget` (menu
default 5), `RESPAWN_DELAY_MS = 3000`, `SPAWN_INVULNERABILITY_MS = 1500`.

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
      at the top of the screen. Kill target later became configurable via
      the Milestone 9 pre-match menu (`killTarget` in `src/main.js`).
      See "Current Status" above.

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
- [x] 8. Minimap: COMPLETE (later extended by M10 for N bots). Top-down
      indicator of player + bot positions that updates live, plus a
      simplified obstacle/platform layout for arena spatial awareness.
      Top-right `#minimap` DOM panel; blue player dot (yaw-facing
      chevron) + per-bot dots via `updateMinimap()` /
      `worldToMinimapPercent()` using `GROUND_SIZE` (destroyed bots hide
      their dots; ally dots added in Milestone 10 via
      `createMinimapDot()`). Static layout layer via
      `buildMinimapLayout()` → `#minimap-layout`: Milestone 3 cover
      footprints + Milestone 7 elevated decks/ramps (support legs
      omitted). Verify: move around and confirm dots track live over a
      readable top-down arena layout (chokepoint, cover, bridges).
- [x] 9. Pre-match menu: COMPLETE (core + follow-ups). Team size preset
      (1v1/3v3/5v5), bot difficulty (Easy/Medium/Hard), and kill target
      (5/10/15) shown in `#prematch-menu` before the match starts. Start
      Match applies arena size via `buildArena(ARENA_SIZES[preset])`,
      stores bot counts in `matchConfig` (player counts as one team
      member), sets `killTarget`; Milestone 10 consumes those counts for
      real multi-bot spawn + applies `DIFFICULTY_TIERS` knobs to every
      bot. Also includes follow-ups beyond the original M9 checklist —
      see "Current Status" above for details:
        - Arena cover density scaling: `buildArenaCover()` keeps the 1v1
          `BASE_*` cluster and adds `MID_RING_*` (3v3+) / `OUTER_RING_*`
          (5v5) obstacles/platforms so larger pads keep similar density
          and cover-flow (not empty rim around the same few props).
        - Player fire rate balanced to `FIRE_RATE_RPM = 300`, matching
          `BOT_FIRE_RATE_RPM`, so bot kills aren't trivial from RPM alone.
        - Smoothed crouch camera: `crouchCameraBlend` eases standing ↔
          crouch view over `CROUCH_CAMERA_TRANSITION_SECONDS` (0.15s);
          physics capsule/eye for shooting + LOS stay instant.
      Verify: menu appears first; each team-size preset changes arena
      size (30/45/60) with denser cover on larger presets; kill target
      ends the match at the chosen N; Easy vs Hard aim/reaction feels
      different; hold C camera eases (no snap); player fire rate feels
      comparable to the bot's.
- [x] 10. Multiple bots + difficulty tiers: COMPLETE. Spawns correct
      ally/enemy counts from `matchConfig` / `TEAM_SIZE_BOT_COUNTS`
      (`spawnBotsForMatch()` / `createBotInstance()` → live `bots[]`).
      Shared AI (`updateBot`) with explicit team-gated targeting
      (`pickVisibleHostile` / `getHostileCandidates`) — allies never
      target the player or each other; enemies never target other reds;
      player hitscan ignores blue allies (`colliderToBot`). Same AI
      logic all tiers; Easy/Medium/Hard differ by `reactionDelayMs`,
      `aimSpreadRadians`, `turnSpeedRadiansPerSec`, and Hard-only
      cover-seeking (`buildCoverSlots()` → `coverSlots`,
      `usesCover` + `COVER_SEEK_WINDOW_MS` / `holdingCover` after
      damage). Also wires per-bot floating bars, minimap dots, respawn,
      and team scoring (red death → BLUE; player/ally death → RED).
      Verify: each preset spawns the right bot counts on the minimap;
      allies never shoot you/each other; Easy misses more / reacts
      slower than Hard; Hard bots peel to crates/pillars after taking
      damage.

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
