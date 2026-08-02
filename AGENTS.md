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

### v1 — Playable Core
- [x] 1. Project scaffold: Vite + Three.js + Rapier running, empty scene
 renders (ground plane + camera). Verify: `npm run dev` shows a scene
 with no console errors.
- [x] 2. First-person movement: WASD to move, mouse to look, Space to jump,
      player collides with ground/walls via Rapier. Verify: can walk around
      the whole scene, can't clip through the ground or walls, jump works.
- [ ] 2.5. Pointer lock + focus handling (see dedicated section below):
      click-to-play overlay, Escape pauses + shows resume overlay, losing
      window focus auto-pauses, resuming reliably works every time. Verify:
      click away mid-test, alt-tab, press Escape — each time, resuming
      restores working mouse-look with no dead states.
- [ ] 3. Arena with obstacles: walls + a few static obstacles placed (no
      platforms yet). Verify: obstacles block movement and bullets (once
      shooting exists) correctly.
- [ ] 4. Shooting + health: raycast gun fires on click, deals damage,
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
