export class GameNetworkClient {
  constructor({ onRoomState, onPlayerView, onLog, onConnectionChange }) {
    this.onRoomState = onRoomState;
    this.onPlayerView = onPlayerView;
    this.onLog = onLog;
    this.onConnectionChange = onConnectionChange;
    this.client = null;
    this.room = null;
    this.reconnectAttempts = 0;
    this.manualLeave = false;
    this.reconnectTokenStorageKey = "game:reconnectionToken";
  }

  async connect(username) {
    const endpoint = this.buildEndpoint();
    this.manualLeave = false;
    this.onConnectionChange({ state: "connecting" });
    this.onLog(`Connecting to ${endpoint}...`);
    this.client = this.client || new Colyseus.Client(endpoint);
    const room = await this.client.joinOrCreate("game_room", { username });
    this.onLog(`Joined room ${room.roomId} as ${username}`);
    this.bindRoom(room);
  }

  async reconnectFromStoredSession() {
    const token = this.readStoredReconnectToken();
    if (!token) {
      return false;
    }

    const endpoint = this.buildEndpoint();
    this.manualLeave = false;
    this.onConnectionChange({ state: "reconnecting", attempt: 1, maxAttempts: 3 });
    this.onLog(`Attempting reload reconnect to ${endpoint}...`);
    this.client = this.client || new Colyseus.Client(endpoint);
    this.reconnectAttempts = 1;

    try {
      const room = await this.client.reconnect(token);
      this.onLog(`Recovered session in room ${room.roomId}`);
      this.bindRoom(room);
      return true;
    } catch (error) {
      this.onLog(`Stored reconnect failed: ${error}`);
      const message = String(error);
      const terminal = /invalid or expired/i.test(message);

      if (terminal) {
        this.clearStoredReconnectToken();
        this.onConnectionChange({ state: "disconnected", reason: "token_expired" });
        return false;
      }

      this.scheduleReconnect(token);
      return true;
    }
  }

  sendAction(action) {
    if (!this.room) {
      return;
    }

    this.room.send("action", action);
  }

  leave() {
    this.clearStoredReconnectToken();

    if (!this.room) {
      return;
    }

    this.manualLeave = true;
    const room = this.room;
    this.room = null;
    room.leave();
  }

  buildEndpoint() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${location.host}`;
  }

  bindRoom(nextRoom) {
    this.room = nextRoom;
    this.manualLeave = false;
    this.reconnectAttempts = 0;
    this.storeReconnectToken(nextRoom.reconnectionToken);
    this.onConnectionChange({ state: "connected", roomId: nextRoom.roomId });

    nextRoom.onStateChange((state) => {
      this.onRoomState(state);
    });

    nextRoom.onMessage("playerView", (view) => {
      this.onPlayerView(view);
    });

    nextRoom.onMessage("actionError", (error) => {
      this.onLog(`Action error: ${error.message}`);
    });

    nextRoom.onLeave((code) => {
      this.onLog(`Disconnected from room (code ${code})`);
      const shouldReconnect = !this.manualLeave && code !== 1000 && code !== 4001;
      const token = nextRoom.reconnectionToken;

      if (this.room === nextRoom) {
        this.room = null;
      }

      if (!shouldReconnect || !token || this.reconnectAttempts >= 3) {
        if (this.manualLeave || code === 4001 || !token) {
          this.clearStoredReconnectToken();
        }
        this.onConnectionChange({
          state: "disconnected",
          reason: this.manualLeave ? "left" : code === 4001 ? "rejected" : "closed",
        });
        this.manualLeave = false;
        return;
      }

      this.reconnectAttempts += 1;
      this.scheduleReconnect(token);
    });
  }

  scheduleReconnect(token) {
    this.onConnectionChange({
      state: "reconnecting",
      attempt: this.reconnectAttempts,
      maxAttempts: 3,
    });

    window.setTimeout(async () => {
      try {
        this.onLog(`Attempting reconnect ${this.reconnectAttempts}/3...`);
        const rejoinedRoom = await this.client.reconnect(token);
        this.onLog(`Reconnected to room ${rejoinedRoom.roomId}`);
        this.bindRoom(rejoinedRoom);
      } catch (error) {
        this.onLog(`Reconnect failed: ${error}`);
        const message = String(error);
        const terminal = /invalid or expired/i.test(message);

        if (terminal || this.reconnectAttempts >= 3) {
          if (terminal) {
            this.clearStoredReconnectToken();
          }
          this.onConnectionChange({
            state: "disconnected",
            reason: terminal ? "token_expired" : "reconnect_failed",
          });
          return;
        }

        this.reconnectAttempts += 1;
        this.scheduleReconnect(token);
      }
    }, this.reconnectAttempts * 1000);
  }

  storeReconnectToken(token) {
    if (!token) {
      return;
    }

    try {
      window.sessionStorage.setItem(this.reconnectTokenStorageKey, token);
    } catch {
      this.onLog("Unable to persist reconnect token in session storage.");
    }
  }

  readStoredReconnectToken() {
    try {
      return window.sessionStorage.getItem(this.reconnectTokenStorageKey);
    } catch {
      return null;
    }
  }

  clearStoredReconnectToken() {
    try {
      window.sessionStorage.removeItem(this.reconnectTokenStorageKey);
    } catch {
      // Ignore storage cleanup failures.
    }
  }
}
