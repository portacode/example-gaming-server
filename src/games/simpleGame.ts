import { MapSchema, type } from "@colyseus/schema";
import { GameDefinition } from "../core/game/types";
import { BaseRoomState, PlayerPresenceState } from "../schema/BaseRoomState";

export const PLAYERS_PER_GAME = 4;

export interface SimpleJoinOptions {
  username?: string;
}

export type MovementMode = "idle" | "walk" | "run";

export interface SimplePlayer {
  sessionId: string;
  playerNumber: number;
  username: string;
  connected: boolean;
  heading: number;
  movementMode: MovementMode;
  jumping: boolean;
  lastAcceptedMoveAt: number;
  velocity: {
    x: number;
    z: number;
  };
  position: {
    x: number;
    y: number;
    z: number;
  };
}

export interface SimpleGameState {
  roomId: string;
  phase: "waiting" | "active";
  maxPlayers: number;
  players: Record<string, SimplePlayer>;
  lastPingBy: string;
  lastPingAt: number;
}

export interface SimpleGameView {
  roomId: string;
  phase: "waiting" | "active";
  connectedPlayers: number;
  maxPlayers: number;
  serverTime: number;
  self: {
    sessionId: string;
    playerNumber: number;
    username: string;
    connected: boolean;
    heading: number;
    movementMode: MovementMode;
    jumping: boolean;
    velocity: {
      x: number;
      z: number;
    };
    position: {
      x: number;
      y: number;
      z: number;
    };
  } | null;
  visiblePlayers: Array<{
    sessionId: string;
    playerNumber: number;
    username: string;
    connected: boolean;
    heading: number;
    movementMode: MovementMode;
    jumping: boolean;
    velocity: {
      x: number;
      z: number;
    };
    position: {
      x: number;
      y: number;
      z: number;
    };
  }>;
  lastPing: {
    username: string;
    at: number;
  } | null;
}

export interface PingAction {
  type: "ping";
}

export interface SteerAction {
  type: "steer";
  heading: number;
}

export interface MoveAction {
  type: "move";
  heading: number;
  movementMode: MovementMode;
  jumping: boolean;
  velocity: {
    x: number;
    z: number;
  };
  position: {
    x: number;
    y: number;
    z: number;
  };
}

export type SimpleGameAction = PingAction | SteerAction | MoveAction;

export class SimpleRoomState extends BaseRoomState {
  @type("string") lastPingBy = "";
  @type("number") lastPingAt = 0;
}

function getConnectedPlayers(state: SimpleGameState) {
  return Object.values(state.players).filter((player) => player.connected).length;
}

function sanitizeHorizontalPosition(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clampVerticalPosition(value: number) {
  return Math.max(0, Math.min(16, value));
}

function sanitizeVerticalPosition(value: number, fallback = 0) {
  return Number.isFinite(value) ? clampVerticalPosition(value) : fallback;
}

function ensurePlayerNumbers(state: SimpleGameState) {
  const usedNumbers = new Set<number>();

  Object.values(state.players).forEach((player) => {
    if (Number.isInteger(player.playerNumber) && player.playerNumber > 0) {
      usedNumbers.add(player.playerNumber);
    }
  });

  let nextNumber = 1;
  Object.values(state.players).forEach((player) => {
    if (Number.isInteger(player.playerNumber) && player.playerNumber > 0) {
      return;
    }

    while (usedNumbers.has(nextNumber)) {
      nextNumber += 1;
    }

    player.playerNumber = nextNumber;
    usedNumbers.add(nextNumber);
    nextNumber += 1;
  });
}

function createSpawnPosition(index: number) {
  const spacing = 4;
  const centeredIndex = index - (PLAYERS_PER_GAME - 1) / 2;

  return {
    x: centeredIndex * spacing,
    y: 1,
    z: 0,
  };
}

function canSeePlayer(viewer: SimplePlayer, target: SimplePlayer) {
  const dx = viewer.position.x - target.position.x;
  const dz = viewer.position.z - target.position.z;
  const distanceSquared = dx * dx + dz * dz;

  return distanceSquared <= VISIBILITY_RADIUS * VISIBILITY_RADIUS;
}

function normalizeAngle(angle: number) {
  const turn = Math.PI * 2;
  return ((angle % turn) + turn) % turn;
}

function clampSpeed(x: number, z: number, maxSpeed: number) {
  const speed = Math.hypot(x, z);
  if (speed <= maxSpeed || speed === 0) {
    return { x, z };
  }

  const scale = maxSpeed / speed;
  return {
    x: x * scale,
    z: z * scale,
  };
}

const MAX_SPEED = 18;
const WALK_SPEED = 2.4;
const VISIBILITY_RADIUS = 100;
const MAX_POSITION_TOLERANCE = 0.9;
const MAX_VERTICAL_SPEED = 10;
const MAX_VERTICAL_POSITION_TOLERANCE = 0.75;
const MIN_MOVE_DT_MS = 16;

function sanitizeMovementMode(value: string | undefined): MovementMode {
  return value === "walk" || value === "run" ? value : "idle";
}

function getMaxSpeedForMode(mode: MovementMode) {
  return mode === "run" ? MAX_SPEED : mode === "walk" ? WALK_SPEED : 0;
}

function syncPlayerPresenceMap(roomPlayers: MapSchema<PlayerPresenceState>, state: SimpleGameState) {
  const playerIds = new Set(Object.keys(state.players));

  roomPlayers.forEach((_, sessionId) => {
    if (!playerIds.has(sessionId)) {
      roomPlayers.delete(sessionId);
    }
  });

  Object.values(state.players).forEach((player) => {
    let presence = roomPlayers.get(player.sessionId);
    if (!presence) {
      presence = new PlayerPresenceState();
      presence.sessionId = player.sessionId;
      roomPlayers.set(player.sessionId, presence);
    }

    presence.username = player.username;
    presence.connected = player.connected;
  });
}

export const simpleGameDefinition: GameDefinition<
  SimpleGameState,
  SimpleRoomState,
  SimpleGameAction,
  SimpleJoinOptions,
  SimpleGameView,
  Record<string, never>
> = {
  createInitialState({ roomId, maxClients }) {
    return {
      roomId,
      phase: "waiting",
      maxPlayers: maxClients,
      players: {},
      lastPingBy: "",
      lastPingAt: 0,
    };
  },

  hasPlayer(state, sessionId) {
    return state.players[sessionId] !== undefined;
  },

  canJoin(state) {
    if (state.phase === "active") {
      return "Game already started";
    }
  },

  onPlayerJoin(state, { client, options }) {
    ensurePlayerNumbers(state);
    const username = options.username ?? `Player_${client.sessionId.slice(0, 6)}`;
    const spawnIndex = Object.keys(state.players).length;
    const spawnPosition = createSpawnPosition(spawnIndex);
    state.players[client.sessionId] = {
      sessionId: client.sessionId,
      playerNumber: spawnIndex + 1,
      username,
      connected: true,
      heading: 0,
      movementMode: "idle",
      jumping: false,
      lastAcceptedMoveAt: Date.now(),
      velocity: {
        x: 0,
        z: 0,
      },
      position: spawnPosition,
    };

    if (getConnectedPlayers(state) >= state.maxPlayers) {
      state.phase = "active";
    }
  },

  onPlayerReconnect(state, { client }) {
    ensurePlayerNumbers(state);
    const player = state.players[client.sessionId];
    if (player) {
      player.connected = true;
      player.lastAcceptedMoveAt = Date.now();
    }
  },

  onPlayerDisconnect(state, { client }) {
    const player = state.players[client.sessionId];
    if (player) {
      player.connected = false;
      player.lastAcceptedMoveAt = Date.now();
      player.movementMode = "idle";
      player.jumping = false;
      player.velocity.x = 0;
      player.velocity.z = 0;
    }
  },

  onPlayerLeave(state, { client }) {
    delete state.players[client.sessionId];
  },

  applyAction(state, { client }, action) {
    ensurePlayerNumbers(state);
    const player = state.players[client.sessionId];
    if (!player || !player.connected) {
      throw new Error("Player is not currently connected.");
    }

    switch (action.type) {
      case "ping":
        state.lastPingBy = player.username;
        state.lastPingAt = Date.now();
        return;
      case "steer":
        player.heading = normalizeAngle(action.heading);
        return;
      case "move": {
        const now = Date.now();
        const dtMs = Math.max(now - player.lastAcceptedMoveAt, MIN_MOVE_DT_MS);
        const dtSeconds = dtMs / 1000;
        const movementMode = sanitizeMovementMode(action.movementMode);
        const maxSpeed = getMaxSpeedForMode(movementMode);
        const reportedVelocity = clampSpeed(action.velocity.x, action.velocity.z, maxSpeed);
        const nextY = sanitizeVerticalPosition(action.position.y, player.position.y);
        const dx = action.position.x - player.position.x;
        const dy = nextY - player.position.y;
        const dz = action.position.z - player.position.z;
        const distance = Math.hypot(dx, dz);
        const maxDistance = maxSpeed * dtSeconds + MAX_POSITION_TOLERANCE;
        const maxVerticalDistance = MAX_VERTICAL_SPEED * dtSeconds + MAX_VERTICAL_POSITION_TOLERANCE;

        if (distance > maxDistance) {
          throw new Error(`Movement rejected: exceeded max travel (${distance.toFixed(2)} > ${maxDistance.toFixed(2)})`);
        }

        if (Math.abs(dy) > maxVerticalDistance) {
          throw new Error(`Movement rejected: exceeded max vertical travel (${Math.abs(dy).toFixed(2)} > ${maxVerticalDistance.toFixed(2)})`);
        }

        player.heading = normalizeAngle(action.heading);
        player.movementMode = movementMode;
        player.jumping = Boolean(action.jumping);
        player.velocity.x = reportedVelocity.x;
        player.velocity.z = reportedVelocity.z;
        player.position.x = sanitizeHorizontalPosition(action.position.x, player.position.x);
        player.position.y = nextY;
        player.position.z = sanitizeHorizontalPosition(action.position.z, player.position.z);
        player.lastAcceptedMoveAt = now;
        return;
      }
      default:
        throw new Error(`Unsupported action: ${(action as { type: string }).type}`);
    }
  },

  tick() {
    return false;
  },

  projectView(state, viewerSessionId) {
    ensurePlayerNumbers(state);
    const self = state.players[viewerSessionId];
    const visiblePlayers = self
      ? Object.values(state.players)
          .filter((player) => player.sessionId === self.sessionId || canSeePlayer(self, player))
          .map((player) => ({
            sessionId: player.sessionId,
            playerNumber: player.playerNumber,
            username: player.username,
            connected: player.connected,
            heading: player.heading,
            movementMode: player.movementMode,
            jumping: player.jumping,
            velocity: {
              x: player.velocity.x,
              z: player.velocity.z,
            },
            position: {
              x: player.position.x,
              y: player.position.y,
              z: player.position.z,
            },
          }))
      : [];

    return {
      roomId: state.roomId,
      phase: state.phase,
      connectedPlayers: getConnectedPlayers(state),
      maxPlayers: state.maxPlayers,
      serverTime: Date.now(),
      self: self
        ? {
            sessionId: self.sessionId,
            playerNumber: self.playerNumber,
            username: self.username,
            connected: self.connected,
            heading: self.heading,
            movementMode: self.movementMode,
            jumping: self.jumping,
            velocity: {
              x: self.velocity.x,
              z: self.velocity.z,
            },
            position: {
              x: self.position.x,
              y: self.position.y,
              z: self.position.z,
            },
          }
        : null,
      visiblePlayers,
      lastPing: state.lastPingAt
        ? {
            username: state.lastPingBy,
            at: state.lastPingAt,
          }
        : null,
    };
  },

  syncRoomState(roomState, state, roomId, maxClients) {
    roomState.roomId = roomId;
    roomState.phase = state.phase;
    roomState.connectedPlayers = getConnectedPlayers(state);
    roomState.maxPlayers = maxClients;
    roomState.lastPingBy = state.lastPingBy;
    roomState.lastPingAt = state.lastPingAt;
    syncPlayerPresenceMap(roomState.players, state);
  },

  isOpenForNewPlayers(state) {
    return state.phase !== "active";
  },
};
