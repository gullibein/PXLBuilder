# Different kinds of platformer: physics, pieces and levels

Status: proposal (stage 0). Starts with the speed platformer: momentum, slopes, loops, springs and fast scrolling.

## 1. Why a "Sonic" request gives a Mario game today

A request for a Sonic-like game currently goes like this:

- **Physics:** the engine has one way to move a platformer character. It accelerates quickly to a fixed top speed (200 px/s), stops at once, and the ground under it doesn't matter (a ramp is only a way up). There is no momentum, no rolling, and no speed gained down a hill or lost going up one.
- **Terrain:** square tiles and 45° ramps, all boxes. There are no curves, so there are no loops, quarter-pipes or rolling hills.
- **Camera:** it follows the player at one gentle rate. It never looks ahead, so at speed the player runs into what they can't see.
- **Pieces:** every platformer starts with the same objects: ? blocks, bricks, pipes, a walker to stomp. The AI redraws them, so a "Sonic" game still has ? blocks and brick pyramids, only reskinned.
- **Levels:** the engine builds two kinds, classic and puzzle. A speed game gets classic levels: short, one screen high, made of stairs, gaps and pipes.

So the AI did what it could with the pieces it had. The engine needs the physics, the pieces and the level builder of each kind of platformer.

## 2. The idea: a platformer "kind"

Each kind is four things, chosen together when the game is made and kept by the game (the level profile's genre, as now):

| Part | What it is | Speed platformer |
|---|---|---|
| Movement | How the player moves: a movement style of the Character Controller with its numbers | Momentum: slow to start, very fast at top speed, slopes speed it up and slow it down, rolling, spin dash |
| Terrain and pieces | The starter objects | Curved ground (hills, quarter-pipes, loops), springs (also sideways and diagonal), dash pads, rings to collect, spikes, enemies beaten by rolling into them. No ? blocks or pipes |
| Camera | How the view follows | Looks ahead the way the player is going, catches up fast, little vertical shake |
| Level builder | Structures, patterns and checks | Long, wide levels with a high road and a low road, built from loops, hills, launches and ring trails |

Classic and puzzle become the first two kinds, unchanged. Later kinds follow the same pattern, each starting with its engine work:

- **Precision (Celeste, Super Meat Boy):** wall slide and wall jump, dash and dash refill.
- **Run and gun (Mega Man):** camera locked rooms.
- **Room-to-room exploration (Hollow Knight):** rooms joined at their edges.

All of it stays editable by hand and by prompt: movement is fields on a component, pieces are ordinary objects with scripts, and levels are ordinary levels.

**Original, not copied:** the engine supplies the kind of game (its physics, pieces and level making). The hero and the art are the game's own: drawn by the AI or the user, never copies of a company's characters. The AI guide will say so.

## 3. Engine work for the speed platformer

### 3.1 Momentum movement

A new movement style, `momentum`, on the Character Controller (the default stays `platformer`, so existing games don't change). Its fields:

- `topSpeed`: the most running gives (for example 600 px/s, three times today's).
- `accel` and `decel`: slow to build up, quick to brake.
- `friction`: how fast speed falls off with no key held (low, so it rolls on).
- `slopeFactor`: gravity along the ground. Down a slope it speeds up; up a slope it slows; too slow on a steep slope, it slides back.
- **Rolling:** Down while moving. Less friction, a stronger pull from slopes, and enemies are beaten by touching them.
- **Spin dash:** Down + Jump to charge, release to shoot off.
- **Jumping:** keeps the running speed, and goes off at right angles to the ground (a jump off a ramp goes forward and up).
- **Spin attack:** in a jump or a roll, touching an enemy beats it (a condition the existing Stomp and Hurts scripts can read).

### 3.2 Curved ground and running along it

This is the big piece.

- **New terrain shapes:** shallow slopes (22.5°), quarter circles in a few sizes (a loop is four of them), and half-pipes. Each is a tile with a height for every pixel column, the way classic speed games do it.
- **Running along the surface:** a momentum character follows the surface it is on, round curves, up walls and over ceilings. Its ground can be the floor, a wall or the ceiling. Too slow on a wall or a ceiling, it drops off. Leaving a curve's end, it flies off along the curve's direction.
- **Loops:** the entry and exit of a loop cross each other, so a loop needs a pass-through switch (the path in is solid until the top is passed, then the way out is). It's built in as a loop object of a few sizes, so a loop is one piece to place, not twelve tiles to get right.
- **Other characters:** everything else (enemies, crates) treats the new shapes as solid ground with their height profile, so nothing else changes.

### 3.3 Speed camera

New Camera Target fields:

- `lookAhead`: how far ahead it looks in the direction of travel, growing with speed.
- `catchUp`: how fast it follows at top speed.
- `verticalDeadZone`: how far the player moves up or down before the view follows.

The defaults keep today's behaviour.

### 3.4 Speed pieces

- **Dash pad:** a boost to top speed in its direction.
- **Springs:** upward, sideways and diagonal; the existing Spring script gets a direction.
- **Rings:** a collectible. Optionally, the player loses rings instead of health when hit, and dies only when hit with none. The rings scatter and can be grabbed back.
- **Enemies:** walkers and fliers, beaten by rolling or jumping into them.
- **Checkpoint:** a post that sets where the player comes back.
- **Speed starter:** a starter set of its own (like the top-down and RPG ones), with these pieces, the momentum player and the speed camera.

## 4. The speed level builder

- **Size:** long levels (150–300 cells) and taller ones (2–3 screens), with a high road (faster, harder) and a low road (slower, safer), joined by springs and drops.
- **Patterns:** rolling hills, a loop, a quarter-pipe launch over a gap, a spring stair, a dash-pad straight, a half-pipe, ring trails along arcs, a line of enemies to roll through, a drop to the low road, a spike strip to jump.
- **Validation:** the route solver works cell by cell with jumps from a table, so it can't judge momentum. Two checks replace it here:
  1. **Static checks:** every surface joins, every loop has its run-up, no drop leads out of the level, and the goal is on both roads.
  2. **The route bot as the gate,** on the real runtime. Speed levels are mostly "hold right, jump at the right moments", which a bot plays well. A level counts as validated only when the bot finishes it along the low road, and along the high road too where there is one.

  Measured as for classic and puzzle: how many of a sweep validate, and how long they take.

## 5. The AI

- **New genre:** `speed` in the level profile. The AI picks it from the request ("Sonic", "fast", "speed", "momentum", loops) and moves the game to the speed starter. The existing switch_starter mechanism does this.
- **Guide:** a short "kinds of platformer" table, so the AI knows what each kind has, and never fills a speed game with ? blocks and pipes.
- **Themes:** the existing themes, plus one or two that suit speed games (for example a "checkered hills" look of its own).

## 6. Stages

Each stage is tested and reported on before the next.

| Stage | What | Done when |
|---|---|---|
| S1 | Momentum movement on today's terrain: slopes speed it up and slow it down, rolling, spin dash, jumps that keep speed, spin attack. Existing games unchanged | Physics tests: top speed, slope gain and loss, roll, dash, jump off a ramp; every existing test unchanged |
| S2 | Curved ground: new terrain shapes with height profiles; running round curves, up walls and over ceilings; dropping off when slow; loop objects with the pass-through | Runtime tests: a loop run at speed goes round and comes out; too slow, it falls; quarter-pipe launches; enemies stand on curves |
| S3 | Speed camera: look-ahead, catch-up, vertical dead zone | Camera tests at speed: the player stays in the middle third ahead of the way it goes |
| S4 | Speed pieces and the speed starter: dash pads, directional springs, rings (with losing rings when hit), checkpoints, enemies beaten by rolling; 8×8 art for all | Each piece tested in play; a new speed game starts with them |
| S5 | Speed level builder: layouts with two roads, 10+ patterns, the static checks and the route bot as the gate | A sweep of levels all validated by the bot; timings measured |
| S6 | AI: the speed genre, starter choice, guide table, themes | A "Sonic-like" request (the stub AI in tests) gives a speed game: momentum player, speed pieces, speed levels |
| Later | The next kinds, each engine work first: precision (wall jump, dash), rooms (camera locks), exploration (rooms joined at edges) | — |

S2 is the largest and riskiest. Running round curves is a different kind of physics from the box-against-box movement the engine has. It's kept to momentum characters, so nothing else is at risk.
