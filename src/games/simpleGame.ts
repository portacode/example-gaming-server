import { MapSchema, type } from "@colyseus/schema";
import { GameDefinition } from "../core/game/types";
import { BaseRoomState, PlayerPresenceState } from "../schema/BaseRoomState";

export const PLAYERS_PER_GAME = 2;

export interface SimpleJoinOptions {
  username?: string;
}

export interface SimplePlayer {
  sessionId: string;
  username: string;
  connected: boolean;
  heading: number;
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
    username: string;
    connected: boolean;
    heading: number;
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
    username: string;
    connected: boolean;
    heading: number;
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

function clampPosition(value: number) {
  return Math.max(-14, Math.min(14, value));
}

function clampVerticalPosition(value: number) {
  return Math.max(0, Math.min(16, value));
}

function createSpawnPosition(index: number) {
  const radius = 6;
  const angle = (index / Math.max(1, PLAYERS_PER_GAME)) * Math.PI * 2;

  return {
    x: Math.cos(angle) * radius,
    y: 1,
    z: Math.sin(angle) * radius,
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

const MAX_SPEED = 7.5;
const VISIBILITY_RADIUS = 100;
const MAX_POSITION_TOLERANCE = 0.9;
const MIN_MOVE_DT_MS = 16;

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
    const username = options.username ?? `Player_${client.sessionId.slice(0, 6)}`;
    const spawnIndex = Object.keys(state.players).length;
    const spawnPosition = createSpawnPosition(spawnIndex);
    state.players[client.sessionId] = {
      sessionId: client.sessionId,
      username,
      connected: true,
      heading: normalizeAngle(angleToHeading(spawnPosition)),
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
      player.velocity.x = 0;
      player.velocity.z = 0;
    }
  },

  onPlayerLeave(state, { client }) {
    delete state.players[client.sessionId];
  },

  applyAction(state, { client }, action) {
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
        const reportedVelocity = clampSpeed(action.velocity.x, action.velocity.z, MAX_SPEED);
        const dx = action.position.x - player.position.x;
        const dz = action.position.z - player.position.z;
        const distance = Math.hypot(dx, dz);
        const maxDistance = MAX_SPEED * dtSeconds + MAX_POSITION_TOLERANCE;

        if (distance > maxDistance) {
          throw new Error(`Movement rejected: exceeded max travel (${distance.toFixed(2)} > ${maxDistance.toFixed(2)})`);
        }

        player.heading = normalizeAngle(action.heading);
        player.velocity.x = reportedVelocity.x;
        player.velocity.z = reportedVelocity.z;
        player.position.x = clampPosition(action.position.x);
        player.position.y = clampVerticalPosition(action.position.y);
        player.position.z = clampPosition(action.position.z);
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
    const self = state.players[viewerSessionId];
    const visiblePlayers = self
      ? Object.values(state.players)
          .filter((player) => player.sessionId === self.sessionId || canSeePlayer(self, player))
          .map((player) => ({
            sessionId: player.sessionId,
            username: player.username,
            connected: player.connected,
            heading: player.heading,
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
            username: self.username,
            connected: self.connected,
            heading: self.heading,
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

function angleToHeading(position: { x: number; z: number }) {
  return Math.atan2(position.z, position.x);
}
