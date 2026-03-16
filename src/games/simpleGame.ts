import { MapSchema, type } from "@colyseus/schema";
import { GameDefinition } from "../core/game/types";
import { BaseRoomState, PlayerPresenceState } from "../schema/BaseRoomState";

export const PLAYERS_PER_GAME = 4;

export interface SimpleJoinOptions {
  username?: string;
}

export interface SimplePlayer {
  sessionId: string;
  username: string;
  connected: boolean;
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
  self: {
    sessionId: string;
    username: string;
    connected: boolean;
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

export interface MoveAction {
  type: "move";
  x: number;
  z: number;
}

export type SimpleGameAction = PingAction | MoveAction;

export class SimpleRoomState extends BaseRoomState {
  @type("string") lastPingBy = "";
  @type("number") lastPingAt = 0;
}

function getConnectedPlayers(state: SimpleGameState) {
  return Object.values(state.players).filter((player) => player.connected).length;
}

function clampMovement(value: number) {
  return Math.max(-1, Math.min(1, value));
}

function clampPosition(value: number) {
  return Math.max(-14, Math.min(14, value));
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

  return distanceSquared <= 144;
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
    const username = options.username ?? `Player_${client.sessionId.slice(0, 6)}`;
    const spawnIndex = Object.keys(state.players).length;
    state.players[client.sessionId] = {
      sessionId: client.sessionId,
      username,
      connected: true,
      position: createSpawnPosition(spawnIndex),
    };

    if (getConnectedPlayers(state) >= state.maxPlayers) {
      state.phase = "active";
    }
  },

  onPlayerReconnect(state, { client }) {
    const player = state.players[client.sessionId];
    if (player) {
      player.connected = true;
    }
  },

  onPlayerDisconnect(state, { client }) {
    const player = state.players[client.sessionId];
    if (player) {
      player.connected = false;
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
      case "move":
        player.position.x = clampPosition(player.position.x + clampMovement(action.x));
        player.position.z = clampPosition(player.position.z + clampMovement(action.z));
        return;
      default:
        throw new Error(`Unsupported action: ${(action as { type: string }).type}`);
    }
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
      self: self
        ? {
            sessionId: self.sessionId,
            username: self.username,
            connected: self.connected,
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
