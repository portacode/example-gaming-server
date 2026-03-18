# Example Gaming Server

A small but reusable multiplayer game server starter for students, prototypes, and early-stage teams. It combines a TypeScript Colyseus backend, a Babylon.js browser client, and a modular game-definition layer so you can ship a playable demo quickly without painting yourself into a corner.

[![Deploy with Portacode](https://img.shields.io/badge/Deploy%20with-Portacode-c95d2a?style=for-the-badge)](https://portacode.com/dashboard/?portafile=https%3A%2F%2Fraw.githubusercontent.com%2Fportacode%2Fexample-gaming-server%2Fmain%2Fportafile.yaml)

## What is in this repo

- `src/index.ts`: Express + Colyseus server bootstrap and static asset hosting.
- `src/core/game/`: the reusable abstraction layer. `BaseGameRoom` drives joins, reconnects, actions, ticking, room-state sync, and per-player projected views.
- `src/games/simpleGame.ts`: the example game definition. This is the main file to study when creating your own game logic.
- `src/rooms/GameRoom.ts`: the thin room binding that wires the example game into Colyseus.
- `src/schema/`: networked room state shared with clients.
- `public/app/`: browser client, network adapter, and Babylon scene setup.
- `public/assets/`: example character, world, texture, and sky assets.
- `Dockerfile`: production image for deployment.
- `portafile.yaml`: Portacode CI/CD workflow file for one-click provisioning and deployment.

## Structure at a glance

The reusable pattern in this project is:

1. Define your game rules in a typed `GameDefinition`.
2. Keep the authoritative internal state separate from the synced room state.
3. Project a player-specific view back to each client.
4. Plug the definition into a room class with minimal glue code.

That separation makes it easier to swap game rules, add more rooms, or replace the client without rewriting the server foundation.

## Getting started

### Local development

For day-to-day development, run the server directly with Node.js:

```bash
npm install
npm run dev
```

Open `http://localhost:5000`.

### Production-style local run with Docker Compose

This repo already includes both a [`Dockerfile`](/home/user/gaming/Dockerfile) and a [`docker-compose.yml`](/home/user/gaming/docker-compose.yml). If you want to run the stack the same way it is intended to be deployed, use:

```bash
docker compose up --build
```

That starts the game server on `http://localhost:5000` and also starts the bundled PostgreSQL service defined in the compose file.

### Docker image only

If you only want the app container without the compose stack:

```bash
docker build -t example-gaming-server .
docker run --rm -p 5000:5000 -e PORT=5000 example-gaming-server
```

## How to extend it

### Add a new game

1. Create a new definition beside `src/games/simpleGame.ts`.
2. Implement the `GameDefinition` contract from `src/core/game/types.ts`.
3. Add a room class like `src/rooms/GameRoom.ts` that points to your definition.
4. Register the room in `src/index.ts`.

### Change player limits or reconnect behavior

- Update `PLAYERS_PER_GAME` in `src/games/simpleGame.ts`.
- Update `RECONNECT_WINDOW_SECONDS` in `src/rooms/GameRoom.ts`.

### Add or replace game assets

1. Put new assets under `public/assets/...`.
2. Update the asset constants in `public/app/scene/BabylonScene.js`:
   - `CHARACTER_MODEL_URL`
   - `WORLD_MODEL_URL`
   - `GROUND_DIFFUSE_URL`
   - `WORLD_SKY_PRESET`
3. Reload the browser and verify loading progress plus collider/debug output.

The included sky presets are documented in `public/assets/world/sky/README.md`.

### Customize the frontend

- `public/app/network/GameNetworkClient.js` handles room join, leave, and reconnect flow.
- `public/app/scene/BabylonScene.js` handles asset loading, rendering, movement, camera behavior, and collider debug tools.
- `public/index.html` contains the UI shell and loading/debug panels.

## Deployment

### Portacode

This repo includes a Portacode CI/CD [`portafile.yaml`](/home/user/gaming/portafile.yaml) that deploys the repository using the existing [`docker-compose.yml`](/home/user/gaming/docker-compose.yml) stack. The workflow provisions an Ubuntu device, installs Docker plus the Compose plugin, clones this repository, runs `docker compose up -d --build`, and waits for port `5000` to respond.

Use the deploy button above, or open this direct Portacode URL:

```text
https://portacode.com/dashboard/?portafile=https%3A%2F%2Fraw.githubusercontent.com%2Fportacode%2Fexample-gaming-server%2Fmain%2Fportafile.yaml
```

After the device is created, Portacode runs the workflow from `portafile.yaml`, exposes port `5000`, and checks the deployed app for readiness.

### Other platforms

For non-Portacode deployment, the intended starting point is the existing compose stack:

```bash
docker compose up -d --build
```

If your target platform prefers a single container instead of Compose, the included [`Dockerfile`](/home/user/gaming/Dockerfile) can still be used directly.

## Notes

- The current example is stateless by default. You can add persistence later if your game needs accounts, inventories, matchmaking history, or analytics.
- [`docker-compose.yml`](/home/user/gaming/docker-compose.yml) includes PostgreSQL as part of the example stack, but the current server code does not yet use it directly.
