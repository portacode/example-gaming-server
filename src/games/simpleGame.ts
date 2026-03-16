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
  } | null;
  visiblePlayers: Array<{
    sessionId: string;
    username: string;
    connected: boolean;
  }>;
  lastPing: {
    username: string;
    at: number;
  } | null;
}

export interface PingAction {
  type: "ping";
}

export type SimpleGameAction = PingAction;

export class SimpleRoomState extends BaseRoomState {
  @type("string") lastPingBy = "";
  @type("number") lastPingAt = 0;
}

function getConnectedPlayers(state: SimpleGameState) {
  return Object.values(state.players).filter((player) => player.connected).length;
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
    state.players[client.sessionId] = {
      sessionId: client.sessionId,
      username,
      connected: true,
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
      default:
        throw new Error(`Unsupported action: ${(action as { type: string }).type}`);
    }
  },

  projectView(state, viewerSessionId) {
    const self = state.players[viewerSessionId];

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
          }
        : null,
      visiblePlayers: Object.values(state.players).map((player) => ({
        sessionId: player.sessionId,
        username: player.username,
        connected: player.connected,
      })),
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
