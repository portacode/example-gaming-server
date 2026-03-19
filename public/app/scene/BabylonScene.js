const SKY_PRESETS = {
  "qwantani-afternoon": { // Very plain blue sky with bright sun
    label: "Qwantani",
    file: "/assets/world/sky/optimized/qwantani-afternoon.jpg",
  },
  "overcast-soil": { // Looks like the sky when its about to rain
    label: "Overcast",
    file: "/assets/world/sky/optimized/overcast-soil.jpg",
  },
  "rocky-ridge": { // Blue sky with little clouds and a yello sun rising on the horizon
    label: "Rocky Ridge",
    file: "/assets/world/sky/optimized/rocky-ridge.jpg",
  },
};

export const WORLD_SKY_PRESET = "overcast-soil";
const CAMERA_INITIAL_ALPHA = Math.PI;
const CAMERA_BETA_MIN = 0.62;
const CAMERA_BETA_MAX = 1.85;
const CAMERA_TRANSITION_BETA = 1.02;
const CAMERA_RADIUS_NEAR = 2.4;
const CAMERA_RADIUS_FAR = 8.5;
const CAMERA_TARGET_Y_NEAR = 1.48;
const CAMERA_TARGET_Y_FAR = 0.92;
const CAMERA_RADIUS_SMOOTHING = 12;
const CAMERA_OCCLUSION_PADDING = 0.45;
const MAX_EXTRAPOLATION_MS = 180;
const SNAP_DISTANCE = 2.5;
const POSITION_CORRECTION_RATE = 9;
const CAMERA_FOCUS_SMOOTHING = 10;
const MIN_INTERPOLATION_DELAY_MS = 35;
const MAX_INTERPOLATION_DELAY_MS = 180;
const DEFAULT_SNAPSHOT_INTERVAL_MS = 50;
const OFFSET_SMOOTHING = 0.12;
const INTERVAL_SMOOTHING = 0.2;
const JITTER_SMOOTHING = 0.15;
const MOVEMENT_SEND_INTERVAL_MS = 50;
const MOVEMENT_FORCE = 18;
const MOVEMENT_DRAG = 4.5;
const MAX_SPEED = 7.5;
const PLAYER_VISUAL_Y_OFFSET = 1;
const TARGET_AVATAR_HEIGHT = 2.2;
const PLAYER_LABEL_Y_OFFSET = 3.2;
const PLAYER_LABEL_WIDTH = 2.6;
const PLAYER_LABEL_HEIGHT = 0.7;
const PLAYER_LABEL_TEXTURE_WIDTH = 512;
const PLAYER_LABEL_TEXTURE_HEIGHT = 128;
const PLAYER_COLLIDER_RADIUS = 0.35;
const PLAYER_COLLIDER_HEIGHT = 1.8;
const PLAYER_GRAVITY = 28;
const PLAYER_MAX_FALL_SPEED = 24;
const CHARACTER_MODEL_URL = "/assets/characters/Character.glb";
const WORLD_MODEL_URL = "/assets/world/low-poly_industrial_building.glb";
const GROUND_DIFFUSE_URL = "/assets/world/textures/asphalt_01_diff_1k.jpg";
const ROTATION_SMOOTHING = 12;
const REMOTE_ROTATION_SPEED_THRESHOLD = 0.6;
const WALK_ANIMATION_SPEED_THRESHOLD = 0.15;
const GROUND_SIZE = 2400;
const GROUND_TEXTURE_REPEAT = 180;
const DEFAULT_UNKNOWN_ASSET_WEIGHT = 1024 * 1024;
const ASSET_METADATA = {
  characterModel: { label: "Character model", estimatedBytes: 2 * 1024 * 1024 },
  worldModel: { label: "World model", estimatedBytes: 8 * 1024 * 1024 },
  groundTexture: { label: "Ground texture", estimatedBytes: 512 * 1024 },
  "sky:qwantani-afternoon": { label: "Sky preset: Qwantani", estimatedBytes: 1024 * 1024 },
  "sky:overcast-soil": { label: "Sky preset: Overcast", estimatedBytes: 1024 * 1024 },
  "sky:rocky-ridge": { label: "Sky preset: Rocky Ridge", estimatedBytes: 1024 * 1024 },
};

function cloneVector(position) {
  return {
    x: position.x,
    y: position.y,
    z: position.z,
  };
}

function cloneVelocity(velocity) {
  return {
    x: velocity.x,
    z: velocity.z,
  };
}

function lerpPosition(start, end, alpha) {
  return {
    x: BABYLON.Scalar.Lerp(start.x, end.x, alpha),
    y: BABYLON.Scalar.Lerp(start.y, end.y, alpha),
    z: BABYLON.Scalar.Lerp(start.z, end.z, alpha),
  };
}

function clampSpeed(x, z, maxSpeed) {
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

function extrapolateLinear(snapshot, deltaMs) {
  const deltaSeconds = deltaMs / 1000;
  return {
    x: snapshot.position.x + snapshot.velocity.x * deltaSeconds,
    y: snapshot.position.y,
    z: snapshot.position.z + snapshot.velocity.z * deltaSeconds,
  };
}

function integrateMovement(snapshot, heading, deltaMs) {
  const deltaSeconds = deltaMs / 1000;
  const velocity = cloneVelocity(snapshot.velocity);
  const forceX = Math.cos(heading) * MOVEMENT_FORCE;
  const forceZ = Math.sin(heading) * MOVEMENT_FORCE;

  velocity.x += forceX * deltaSeconds;
  velocity.z += forceZ * deltaSeconds;

  const dragFactor = Math.max(0, 1 - MOVEMENT_DRAG * deltaSeconds);
  velocity.x *= dragFactor;
  velocity.z *= dragFactor;

  const clampedVelocity = clampSpeed(velocity.x, velocity.z, MAX_SPEED);
  velocity.x = clampedVelocity.x;
  velocity.z = clampedVelocity.z;

  return {
    x: snapshot.position.x + velocity.x * deltaSeconds,
    y: snapshot.position.y,
    z: snapshot.position.z + velocity.z * deltaSeconds,
  };
}

function getHeadingFromCamera(position, cameraPosition) {
  return Math.atan2(
    position.z - cameraPosition.z,
    position.x - cameraPosition.x,
  );
}

export class BabylonScene {
  constructor({ canvas, onMovementChange, onLoadProgress }) {
    this.canvas = canvas;
    this.onMovementChange = onMovementChange;
    this.onLoadProgress = onLoadProgress;
    this.engine = null;
    this.scene = null;
    this.camera = null;
    this.playerMeshes = new Map();
    this.playerStates = new Map();
    this.selfPosition = null;
    this.selfSessionId = null;
    this.lastHeading = null;
    this.lastMovementSentAt = 0;
    this.lastSentPosition = null;
    this.lastSentVelocity = null;
    this.skyDome = null;
    this.cameraFocus = null;
    this.cameraFocusPosition = null;
    this.serverOffsetMs = null;
    this.snapshotIntervalMs = DEFAULT_SNAPSHOT_INTERVAL_MS;
    this.snapshotJitterMs = 0;
    this.lastSnapshotServerTime = null;
    this.lastSnapshotArrivalTime = null;
    this.characterAssetContainer = null;
    this.characterLoadPromise = null;
    this.worldAssetContainer = null;
    this.worldLoadPromise = null;
    this.worldRoot = null;
    this.worldColliders = [];
    this.worldCollidersVisible = false;
    this.worldColliderStats = {
      attempted: 0,
      created: 0,
      failed: 0,
      failedMeshes: [],
    };
    this.worldImportStats = {
      rootNodeCount: 0,
      childMeshCount: 0,
      meshNames: [],
      rootNodeNames: [],
      rootNodeTypes: [],
      sceneMeshCount: 0,
      sceneMeshNames: [],
    };
    this.worldImportedMeshes = [];
    this.worldMeshes = [];
    this.worldSurfaceMeshes = [];
    this.worldBounds = null;
    this.groundDecorRoot = null;
    this.assetProgress = new Map();
    this.assetUrls = new Map();
    this.objectUrls = [];
    this.lastActiveLoadLabel = "Starting downloads...";
  }

  async init() {
    this.engine = new BABYLON.Engine(this.canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color4(0.93, 0.97, 1, 1);
    this.scene.collisionsEnabled = true;

    await this.enablePhysics();
    await this.preloadAssets();
    await this.createEnvironment();

    this.engine.runRenderLoop(() => {
      this.updateRenderedPlayers();
      this.updateCameraFraming();
      this.syncMovementIntent();
      this.scene.render();
    });

    window.addEventListener("resize", () => {
      this.engine.resize();
    });
  }

  applyView(view) {
    if (!this.scene) {
      return;
    }

    this.recordSnapshotTiming(view.serverTime);

    const visibleIds = new Set(view.visiblePlayers.map((player) => player.sessionId));

    for (const [sessionId, avatar] of this.playerMeshes.entries()) {
      if (!visibleIds.has(sessionId)) {
        this.disposePlayerAvatar(avatar);
        this.playerMeshes.delete(sessionId);
        this.playerStates.delete(sessionId);
      }
    }

    view.visiblePlayers.forEach((player) => {
      let avatar = this.playerMeshes.get(player.sessionId);
      if (!avatar) {
        avatar = this.createPlayerAvatar(player.sessionId === view.self?.sessionId);
        this.playerMeshes.set(player.sessionId, avatar);
      }

      this.updateAvatarLabel(avatar, player);
      this.recordPlayerSnapshot(player.sessionId, player, view.serverTime);
    });

    if (view.self && this.camera) {
      this.selfSessionId = view.self.sessionId;
    } else {
      this.selfSessionId = null;
      this.selfPosition = null;
      this.lastHeading = null;
      this.lastSentPosition = null;
      this.lastSentVelocity = null;
      this.cameraFocusPosition = null;
    }
  }

  recordSnapshotTiming(serverTime) {
    const arrivalTime = Date.now();
    const observedOffset = arrivalTime - serverTime;

    if (this.serverOffsetMs === null) {
      this.serverOffsetMs = observedOffset;
    } else {
      this.serverOffsetMs += (observedOffset - this.serverOffsetMs) * OFFSET_SMOOTHING;
    }

    if (this.lastSnapshotServerTime !== null) {
      const serverInterval = Math.max(1, serverTime - this.lastSnapshotServerTime);
      this.snapshotIntervalMs += (serverInterval - this.snapshotIntervalMs) * INTERVAL_SMOOTHING;

      const arrivalInterval = this.lastSnapshotArrivalTime === null
        ? serverInterval
        : Math.max(1, arrivalTime - this.lastSnapshotArrivalTime);
      const jitterSample = Math.abs(arrivalInterval - serverInterval);
      this.snapshotJitterMs += (jitterSample - this.snapshotJitterMs) * JITTER_SMOOTHING;
    }

    this.lastSnapshotServerTime = serverTime;
    this.lastSnapshotArrivalTime = arrivalTime;
  }

  getEstimatedServerTime() {
    if (this.serverOffsetMs === null) {
      return Date.now();
    }

    return Date.now() - this.serverOffsetMs;
  }

  getInterpolationDelayMs() {
    const targetDelay = this.snapshotIntervalMs * 2 + this.snapshotJitterMs * 2;
    return BABYLON.Scalar.Clamp(
      targetDelay,
      MIN_INTERPOLATION_DELAY_MS,
      MAX_INTERPOLATION_DELAY_MS,
    );
  }

  recordPlayerSnapshot(sessionId, player, serverTime) {
    let state = this.playerStates.get(sessionId);
    if (!state) {
      state = {
        snapshots: [],
        renderedPosition: cloneVector(player.position),
        heading: player.heading,
        localVelocity: cloneVelocity(player.velocity),
      };
      this.playerStates.set(sessionId, state);
    }

    state.heading = player.heading;
    state.snapshots.push({
      serverTime,
      heading: player.heading,
      velocity: cloneVelocity(player.velocity),
      position: cloneVector(player.position),
    });

    if (state.snapshots.length > 8) {
      state.snapshots.splice(0, state.snapshots.length - 8);
    }

    if (!state.renderedPosition) {
      state.renderedPosition = cloneVector(player.position);
    }

    if (!state.localVelocity) {
      state.localVelocity = cloneVelocity(player.velocity);
    }
  }

  updateRenderedPlayers() {
    if (!this.scene) {
      return;
    }

    const deltaSeconds = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
    const renderTime = this.getEstimatedServerTime() - this.getInterpolationDelayMs();

    for (const [sessionId, avatar] of this.playerMeshes.entries()) {
      const state = this.playerStates.get(sessionId);
      if (!state || state.snapshots.length === 0) {
        continue;
      }

      const isSelf = sessionId === this.selfSessionId;
      if (isSelf) {
        const targetPosition = this.integrateSelfCollisionTarget(state, deltaSeconds);
        state.renderedPosition = this.resolveSelfCollisionPosition(
          avatar,
          state,
          targetPosition,
          deltaSeconds,
        );
      } else {
        const targetPosition = this.interpolateRemotePosition(state, renderTime);
        state.renderedPosition = this.blendRenderedPosition(
          state.renderedPosition ?? cloneVector(targetPosition),
          targetPosition,
          deltaSeconds,
        );
      }

      avatar.root.position.set(
        state.renderedPosition.x,
        state.renderedPosition.y - PLAYER_VISUAL_Y_OFFSET,
        state.renderedPosition.z,
      );
      this.updateAvatarOrientation(avatar, state, deltaSeconds, isSelf);
      this.updateAvatarAnimation(avatar, state);

      if (isSelf) {
        this.selfPosition = cloneVector(state.renderedPosition);
      }
    }
  }

  interpolateRemotePosition(state, renderTime) {
    const snapshots = state.snapshots;
    let previous = snapshots[0];
    let next = null;

    for (const snapshot of snapshots) {
      if (snapshot.serverTime <= renderTime) {
        previous = snapshot;
        continue;
      }

      next = snapshot;
      break;
    }

    if (next) {
      const span = Math.max(1, next.serverTime - previous.serverTime);
      const alpha = BABYLON.Scalar.Clamp((renderTime - previous.serverTime) / span, 0, 1);
      return lerpPosition(previous.position, next.position, alpha);
    }

    const latest = snapshots[snapshots.length - 1];
    const extrapolationMs = BABYLON.Scalar.Clamp(renderTime - latest.serverTime, 0, MAX_EXTRAPOLATION_MS);
    return extrapolateLinear(latest, extrapolationMs);
  }

  integrateSelfCollisionTarget(state, deltaSeconds) {
    const currentPosition = state.renderedPosition ?? { x: 0, y: 1, z: 0 };
    const velocity = state.localVelocity ?? { x: 0, z: 0 };
    if (this.lastHeading === null && this.camera) {
      this.lastHeading = getHeadingFromCamera(currentPosition, this.camera.position);
    }
    const heading = this.lastHeading ?? state.heading ?? 0;
    const forceX = Math.cos(heading) * MOVEMENT_FORCE;
    const forceZ = Math.sin(heading) * MOVEMENT_FORCE;

    velocity.x += forceX * deltaSeconds;
    velocity.z += forceZ * deltaSeconds;

    const dragFactor = Math.max(0, 1 - MOVEMENT_DRAG * deltaSeconds);
    velocity.x *= dragFactor;
    velocity.z *= dragFactor;

    const clampedVelocity = clampSpeed(velocity.x, velocity.z, MAX_SPEED);
    velocity.x = clampedVelocity.x;
    velocity.z = clampedVelocity.z;
    state.localVelocity = velocity;

    return {
      x: currentPosition.x + velocity.x * deltaSeconds,
      y: currentPosition.y,
      z: currentPosition.z + velocity.z * deltaSeconds,
    };
  }

  blendRenderedPosition(current, target, deltaSeconds) {
    const distance = BABYLON.Vector3.Distance(
      new BABYLON.Vector3(current.x, current.y, current.z),
      new BABYLON.Vector3(target.x, target.y, target.z),
    );

    if (distance > SNAP_DISTANCE) {
      return cloneVector(target);
    }

    const alpha = 1 - Math.exp(-POSITION_CORRECTION_RATE * deltaSeconds);
    return lerpPosition(current, target, alpha);
  }

  resolveSelfCollisionPosition(avatar, state, targetPosition, deltaSeconds) {
    const collisionProxy = this.ensureLocalCollisionProxy(avatar, targetPosition);
    const currentPosition = {
      x: collisionProxy.position.x,
      y: collisionProxy.position.y + PLAYER_VISUAL_Y_OFFSET,
      z: collisionProxy.position.z,
    };

    const horizontalDelta = new BABYLON.Vector3(
      targetPosition.x - currentPosition.x,
      0,
      targetPosition.z - currentPosition.z,
    );
    const requestedHorizontalDelta = horizontalDelta.clone();

    avatar.verticalVelocity = Math.max(
      avatar.verticalVelocity - PLAYER_GRAVITY * deltaSeconds,
      -PLAYER_MAX_FALL_SPEED,
    );

    const previousX = collisionProxy.position.x;
    const previousY = collisionProxy.position.y;
    const previousZ = collisionProxy.position.z;
    collisionProxy.moveWithCollisions(new BABYLON.Vector3(
      requestedHorizontalDelta.x,
      avatar.verticalVelocity * deltaSeconds,
      requestedHorizontalDelta.z,
    ));

    const actualHorizontalDelta = new BABYLON.Vector3(
      collisionProxy.position.x - previousX,
      0,
      collisionProxy.position.z - previousZ,
    );
    const deltaY = collisionProxy.position.y - previousY;
    if (deltaY >= -0.001 && avatar.verticalVelocity < 0) {
      avatar.verticalVelocity = 0;
    }

    if (deltaSeconds > 0) {
      state.localVelocity = {
        x: actualHorizontalDelta.x / deltaSeconds,
        z: actualHorizontalDelta.z / deltaSeconds,
      };
    }

    return {
      x: collisionProxy.position.x,
      y: collisionProxy.position.y + PLAYER_VISUAL_Y_OFFSET,
      z: collisionProxy.position.z,
    };
  }

  ensureLocalCollisionProxy(avatar, targetPosition) {
    if (avatar.collisionProxy) {
      return avatar.collisionProxy;
    }

    const proxy = BABYLON.MeshBuilder.CreateBox(
      `player-collision-proxy-${this.playerMeshes.size}`,
      {
        width: PLAYER_COLLIDER_RADIUS * 2,
        depth: PLAYER_COLLIDER_RADIUS * 2,
        height: PLAYER_COLLIDER_HEIGHT,
      },
      this.scene,
    );
    proxy.isVisible = false;
    proxy.visibility = 0;
    proxy.isPickable = false;
    proxy.checkCollisions = true;
    proxy.ellipsoid = new BABYLON.Vector3(
      PLAYER_COLLIDER_RADIUS,
      PLAYER_COLLIDER_HEIGHT * 0.5,
      PLAYER_COLLIDER_RADIUS,
    );
    proxy.ellipsoidOffset = new BABYLON.Vector3(0, PLAYER_COLLIDER_HEIGHT * 0.5, 0);
    proxy.position.set(
      targetPosition.x,
      targetPosition.y - PLAYER_VISUAL_Y_OFFSET,
      targetPosition.z,
    );

    avatar.collisionProxy = proxy;
    avatar.verticalVelocity = 0;
    return proxy;
  }

  async enablePhysics() {
    const havok = await HavokPhysics();
    const plugin = new BABYLON.HavokPlugin(true, havok);
    this.scene.enablePhysics(new BABYLON.Vector3(0, -9.81, 0), plugin);
  }

  async createEnvironment() {
    this.camera = new BABYLON.ArcRotateCamera(
      "camera",
      CAMERA_INITIAL_ALPHA,
      1.18,
      CAMERA_RADIUS_FAR,
      new BABYLON.Vector3(0, 0, 0),
      this.scene,
    );
    this.camera.attachControl(this.canvas, true);
    this.cameraFocus = new BABYLON.TransformNode("camera-focus", this.scene);
    this.camera.lockedTarget = this.cameraFocus;
    this.camera.lowerBetaLimit = CAMERA_BETA_MIN;
    this.camera.upperBetaLimit = CAMERA_BETA_MAX;
    this.camera.lowerRadiusLimit = CAMERA_RADIUS_NEAR;
    this.camera.upperRadiusLimit = 16;
    this.camera.wheelDeltaPercentage = 0.02;
    this.camera.panningSensibility = 0;
    this.camera.inertia = 0.85;
    this.camera.radius = CAMERA_RADIUS_FAR;

    this.applySkyPreset(WORLD_SKY_PRESET);

    const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.88;

    const sun = new BABYLON.DirectionalLight("sun", new BABYLON.Vector3(-0.55, -1, -0.25), this.scene);
    sun.position = new BABYLON.Vector3(12, 20, 8);
    sun.intensity = 1.35;

    const shadowGenerator = new BABYLON.ShadowGenerator(1024, sun);
    shadowGenerator.useBlurExponentialShadowMap = true;
    shadowGenerator.blurKernel = 24;
    await this.instantiateWorld(shadowGenerator);
  }

  updateCameraFraming() {
    if (!this.camera || !this.cameraFocus) {
      return;
    }

    const trackedPosition = this.getTrackedPlayerPosition();
    if (!trackedPosition) {
      return;
    }

    const transitionFactor = BABYLON.Scalar.Clamp(
      (this.camera.beta - CAMERA_TRANSITION_BETA) / (CAMERA_BETA_MAX - CAMERA_TRANSITION_BETA),
      0,
      1,
    );
    const easedTransition = transitionFactor * transitionFactor * (3 - 2 * transitionFactor);
    const targetY = BABYLON.Scalar.Lerp(CAMERA_TARGET_Y_FAR, CAMERA_TARGET_Y_NEAR, easedTransition);
    const desiredRadius = BABYLON.Scalar.Lerp(CAMERA_RADIUS_FAR, CAMERA_RADIUS_NEAR, easedTransition);
    const desiredFocus = {
      x: trackedPosition.x,
      y: trackedPosition.y + targetY,
      z: trackedPosition.z,
    };
    const deltaSeconds = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
    const smoothing = 1 - Math.exp(-CAMERA_FOCUS_SMOOTHING * deltaSeconds);

    if (!this.cameraFocusPosition) {
      this.cameraFocusPosition = desiredFocus;
    } else {
      this.cameraFocusPosition = lerpPosition(this.cameraFocusPosition, desiredFocus, smoothing);
    }

    this.cameraFocus.position.set(
      this.cameraFocusPosition.x,
      this.cameraFocusPosition.y,
      this.cameraFocusPosition.z,
    );

    const occlusionAdjustedRadius = this.resolveCameraRadiusForOcclusion(
      new BABYLON.Vector3(
        this.cameraFocusPosition.x,
        this.cameraFocusPosition.y,
        this.cameraFocusPosition.z,
      ),
      desiredRadius,
    );
    const radiusSmoothing = 1 - Math.exp(-CAMERA_RADIUS_SMOOTHING * deltaSeconds);
    this.camera.radius = BABYLON.Scalar.Lerp(this.camera.radius, occlusionAdjustedRadius, radiusSmoothing);
  }

  resolveCameraRadiusForOcclusion(focus, desiredRadius) {
    if (!this.worldMeshes.length) {
      return desiredRadius;
    }

    const desiredCameraPosition = this.getArcCameraPositionForRadius(focus, desiredRadius);
    const offset = desiredCameraPosition.subtract(focus);
    const distance = offset.length();
    if (distance <= 0.0001) {
      return desiredRadius;
    }

    const direction = offset.scale(1 / distance);
    const ray = new BABYLON.Ray(focus, direction, distance);
    const hit = this.scene.pickWithRay(ray, (mesh) => this.worldMeshes.includes(mesh), false);

    if (!hit?.hit || hit.distance === undefined || hit.distance === null) {
      return desiredRadius;
    }

    return BABYLON.Scalar.Clamp(
      hit.distance - CAMERA_OCCLUSION_PADDING,
      this.camera.lowerRadiusLimit ?? CAMERA_RADIUS_NEAR,
      desiredRadius,
    );
  }

  getArcCameraPositionForRadius(target, radius) {
    const sinBeta = Math.sin(this.camera.beta);
    return new BABYLON.Vector3(
      target.x + radius * Math.cos(this.camera.alpha) * sinBeta,
      target.y + radius * Math.cos(this.camera.beta),
      target.z + radius * Math.sin(this.camera.alpha) * sinBeta,
    );
  }

  getTrackedPlayerPosition() {
    return this.selfPosition;
  }

  async preloadAssets() {
    await Promise.all([
      this.preloadAllSkyPresets(),
      this.preloadCharacterModel(),
      this.preloadWorldModel(),
      this.preloadGroundTextures(),
    ]);
  }

  getAssetMetadata(assetId) {
    return ASSET_METADATA[assetId] ?? {
      label: assetId,
      estimatedBytes: DEFAULT_UNKNOWN_ASSET_WEIGHT,
    };
  }

  reportAssetProgress(assetId, update = {}) {
    const metadata = this.getAssetMetadata(assetId);
    const previous = this.assetProgress.get(assetId) ?? {
      id: assetId,
      label: metadata.label,
      loaded: 0,
      total: 0,
      estimatedBytes: metadata.estimatedBytes,
      status: "pending",
    };
    const next = {
      ...previous,
      ...update,
    };

    if (next.loaded < 0) {
      next.loaded = 0;
    }
    if (next.total < 0) {
      next.total = 0;
    }
    if (next.total > 0 && next.loaded > next.total) {
      next.loaded = next.total;
    }
    if (next.status === "complete") {
      next.loaded = next.total > 0 ? next.total : Math.max(next.loaded, next.estimatedBytes);
    }

    this.assetProgress.set(assetId, next);

    if (next.status === "loading" || next.status === "complete") {
      this.lastActiveLoadLabel = next.label;
    }

    this.emitLoadProgress();
  }

  emitLoadProgress() {
    if (!this.onLoadProgress) {
      return;
    }

    const assets = Array.from(this.assetProgress.values());
    if (!assets.length) {
      this.onLoadProgress({
        percent: 0,
        activeLabel: this.lastActiveLoadLabel,
        statusText: "Preparing the world before the game becomes interactive.",
        loadedBytes: 0,
        totalBytes: 0,
      });
      return;
    }

    let weightedLoaded = 0;
    let weightedTotal = 0;
    let totalKnownBytes = 0;
    let loadedKnownBytes = 0;
    let completeCount = 0;
    let pendingCount = 0;

    assets.forEach((asset) => {
      const weight = asset.total > 0 ? asset.total : asset.estimatedBytes;
      const loaded = asset.total > 0
        ? Math.min(asset.loaded, asset.total)
        : asset.status === "complete"
          ? weight
          : asset.loaded > 0
            ? Math.min(asset.loaded, weight)
            : 0;

      weightedLoaded += loaded;
      weightedTotal += weight;

      if (asset.total > 0) {
        totalKnownBytes += asset.total;
        loadedKnownBytes += Math.min(asset.loaded, asset.total);
      }

      if (asset.status === "complete") {
        completeCount += 1;
      } else {
        pendingCount += 1;
      }
    });

    const activeAsset = assets.find((asset) => asset.status === "loading");
    const activeLabel = activeAsset?.label ?? this.lastActiveLoadLabel;
    const percent = weightedTotal > 0 ? (weightedLoaded / weightedTotal) * 100 : 0;
    const statusText = pendingCount > 0
      ? `Downloading assets (${completeCount}/${assets.length})`
      : "Assets downloaded. Building the world...";

    this.onLoadProgress({
      percent,
      activeLabel,
      statusText,
      loadedBytes: loadedKnownBytes,
      totalBytes: totalKnownBytes,
    });
  }

  async preloadAllSkyPresets() {
    await Promise.all(Object.keys(SKY_PRESETS).map((skyKey) => this.preloadSkyPreset(skyKey)));
  }

  async preloadSkyPreset(skyKey) {
    const preset = SKY_PRESETS[skyKey] ?? SKY_PRESETS[WORLD_SKY_PRESET];
    await this.fetchAssetAsObjectUrl(`sky:${skyKey}`, preset.file);
  }

  async preloadGroundTextures() {
    await this.fetchAssetAsObjectUrl("groundTexture", GROUND_DIFFUSE_URL);
  }

  getAssetUrl(assetId, fallbackUrl) {
    return this.assetUrls.get(assetId) ?? fallbackUrl;
  }

  async fetchAssetAsObjectUrl(assetId, url) {
    if (this.assetUrls.has(assetId)) {
      return this.assetUrls.get(assetId);
    }

    this.reportAssetProgress(assetId, { status: "loading", loaded: 0, total: 0 });

    const response = await fetch(url);
    if (!response.ok) {
      this.reportAssetProgress(assetId, { status: "error" });
      throw new Error(`Failed to preload asset: ${url} (${response.status})`);
    }

    const total = Number(response.headers.get("content-length")) || 0;
    const reader = response.body?.getReader();

    if (!reader) {
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      this.assetUrls.set(assetId, objectUrl);
      this.objectUrls.push(objectUrl);
      this.reportAssetProgress(assetId, {
        status: "complete",
        loaded: blob.size,
        total: total || blob.size,
      });
      return objectUrl;
    }

    const chunks = [];
    let loaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        this.reportAssetProgress(assetId, {
          status: "loading",
          loaded,
          total,
        });
      }
    }

    const blob = new Blob(chunks);
    const objectUrl = URL.createObjectURL(blob);
    this.assetUrls.set(assetId, objectUrl);
    this.objectUrls.push(objectUrl);
    this.reportAssetProgress(assetId, {
      status: "complete",
      loaded,
      total: total || loaded,
    });
    return objectUrl;
  }

  applySkyPreset(skyKey) {
    const preset = SKY_PRESETS[skyKey] ?? SKY_PRESETS[WORLD_SKY_PRESET];
    const skyUrl = this.getAssetUrl(`sky:${skyKey}`, preset.file);

    if (this.skyDome) {
      this.skyDome.dispose();
    }

    this.skyDome = new BABYLON.PhotoDome(
      "sky-dome",
      skyUrl,
      {
        resolution: 32,
        size: 1200,
      },
      this.scene,
    );

    this.scene.clearColor = new BABYLON.Color4(0.72, 0.81, 0.92, 1);
  }

  async preloadCharacterModel() {
    if (this.characterAssetContainer || this.characterLoadPromise) {
      return this.characterLoadPromise;
    }

    this.reportAssetProgress("characterModel", { status: "loading", loaded: 0, total: 0 });
    this.characterLoadPromise = BABYLON.SceneLoader.LoadAssetContainerAsync(
      CHARACTER_MODEL_URL,
      undefined,
      this.scene,
      (event) => {
        this.reportAssetProgress("characterModel", {
          status: "loading",
          loaded: event.loaded ?? 0,
          total: event.lengthComputable ? event.total ?? 0 : 0,
        });
      },
    ).then((container) => {
      this.characterAssetContainer = container;
      this.reportAssetProgress("characterModel", { status: "complete" });
    }).catch((error) => {
      console.error("Failed to load character model", error);
      this.characterAssetContainer = null;
      this.reportAssetProgress("characterModel", { status: "error" });
    }).finally(() => {
      this.characterLoadPromise = null;
    });

    return this.characterLoadPromise;
  }

  async preloadWorldModel() {
    if (this.worldAssetContainer || this.worldLoadPromise) {
      return this.worldLoadPromise;
    }

    this.reportAssetProgress("worldModel", { status: "loading", loaded: 0, total: 0 });
    this.worldLoadPromise = BABYLON.SceneLoader.LoadAssetContainerAsync(
      WORLD_MODEL_URL,
      undefined,
      this.scene,
      (event) => {
        this.reportAssetProgress("worldModel", {
          status: "loading",
          loaded: event.loaded ?? 0,
          total: event.lengthComputable ? event.total ?? 0 : 0,
        });
      },
    ).then((container) => {
      this.worldAssetContainer = container;
      this.reportAssetProgress("worldModel", { status: "complete" });
    }).catch((error) => {
      console.error("Failed to load world model", error);
      this.worldAssetContainer = null;
      this.reportAssetProgress("worldModel", { status: "error" });
      throw error;
    }).finally(() => {
      this.worldLoadPromise = null;
    });

    return this.worldLoadPromise;
  }

  async instantiateWorld(shadowGenerator) {
    if (!this.worldAssetContainer) {
      throw new Error(`World asset was not loaded: ${WORLD_MODEL_URL}`);
    }

    const previousSceneMeshIds = new Set((this.scene?.meshes ?? []).map((mesh) => mesh.uniqueId));
    const instance = this.worldAssetContainer.instantiateModelsToScene(
      (name) => `${name}-world`,
      false,
    );
    const root = new BABYLON.TransformNode("world-root", this.scene);
    instance.rootNodes.forEach((node) => {
      node.parent = root;
    });

    this.worldRoot = root;
    this.captureWorldImportStats(root, instance.rootNodes, previousSceneMeshIds);
    this.positionWorldAtOrigin(root);
    this.prepareWorldMeshes(root, shadowGenerator);
    this.createTexturedGround();
    this.buildAutoWorldColliders(root);
  }

  captureWorldImportStats(root, rootNodes = [], previousSceneMeshIds = new Set()) {
    const childMeshes = this.getNodeMeshes(root)
      .filter((mesh) => this.isRenderableWorldMesh(mesh));
    const sceneMeshes = (this.scene?.meshes ?? [])
      .filter((mesh) => this.isRenderableWorldMesh(mesh));
    this.worldImportedMeshes = sceneMeshes.filter((mesh) => !previousSceneMeshIds.has(mesh.uniqueId));
    this.worldImportStats = {
      rootNodeCount: rootNodes.length,
      childMeshCount: childMeshes.length,
      meshNames: childMeshes.map((mesh) => mesh.name || `mesh-${mesh.uniqueId}`),
      rootNodeNames: rootNodes.map((node) => node?.name || `node-${node?.uniqueId ?? "unknown"}`),
      rootNodeTypes: rootNodes.map((node) => node?.getClassName?.() ?? typeof node),
      sceneMeshCount: sceneMeshes.length,
      sceneMeshNames: sceneMeshes.map((mesh) => mesh.name || `mesh-${mesh.uniqueId}`),
    };
  }

  positionWorldAtOrigin(root) {
    const bounds = this.computeHierarchyBounds(root);
    if (!this.areBoundsFinite(bounds)) {
      return;
    }

    const center = bounds.min.add(bounds.max).scale(0.5);
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= bounds.min.y;
  }

  prepareWorldMeshes(root, shadowGenerator) {
    this.worldMeshes = this.worldImportedMeshes.length
      ? [...this.worldImportedMeshes]
      : this.getNodeMeshes(root).filter((mesh) => this.isRenderableWorldMesh(mesh));
    this.worldSurfaceMeshes = [...this.worldMeshes];
    this.worldBounds = this.worldMeshes.length
      ? this.computeMeshBounds(this.worldMeshes)
      : this.computeHierarchyBounds(root);

    this.worldMeshes.forEach((mesh) => {
      mesh.receiveShadows = true;
      mesh.isPickable = true;
      mesh.checkCollisions = true;
      shadowGenerator.addShadowCaster(mesh);
    });
  }

  createTexturedGround() {
    if (this.groundDecorRoot) {
      this.groundDecorRoot.dispose(false, true);
    }

    const root = new BABYLON.TransformNode("ground-decor-root", this.scene);
    const ground = BABYLON.MeshBuilder.CreateGround(
      "ground-texture-plane",
      { width: GROUND_SIZE, height: GROUND_SIZE, subdivisions: 2 },
      this.scene,
    );
    ground.parent = root;
    ground.position.y = -0.03;
    ground.receiveShadows = true;
    ground.isPickable = true;
    ground.checkCollisions = true;

    const material = new BABYLON.StandardMaterial("ground-texture-material", this.scene);
    const diffuseTexture = new BABYLON.Texture(
      this.getAssetUrl("groundTexture", GROUND_DIFFUSE_URL),
      this.scene,
      false,
      false,
      BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
    );
    diffuseTexture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    diffuseTexture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    diffuseTexture.uScale = GROUND_TEXTURE_REPEAT;
    diffuseTexture.vScale = GROUND_TEXTURE_REPEAT;
    material.diffuseTexture = diffuseTexture;

    material.specularColor = new BABYLON.Color3(0.18, 0.18, 0.18);
    material.emissiveColor = new BABYLON.Color3(0.015, 0.015, 0.015);
    ground.material = material;

    this.groundDecorRoot = root;
    this.worldSurfaceMeshes = [...this.worldSurfaceMeshes, ground];
  }

  buildAutoWorldColliders(root) {
    this.disposeWorldColliders();
    this.refreshWorldMeshBounds(root);
    this.worldColliderStats = {
      attempted: this.worldMeshes.length,
      created: 0,
      failed: 0,
      failedMeshes: [],
    };

    this.worldMeshes.forEach((mesh, index) => {
      const collider = this.createWorldMeshCollider(mesh, index);
      if (collider) {
        this.worldColliders.push(collider);
        this.worldColliderStats.created += 1;
      } else {
        this.worldColliderStats.failed += 1;
        this.worldColliderStats.failedMeshes.push(mesh.name || `mesh-${mesh.uniqueId}`);
      }
    });
  }

  disposeWorldColliders() {
    this.worldColliders.forEach(({ aggregate, sourceMesh }) => {
      aggregate?.dispose?.();
      sourceMesh.renderOverlay = false;
      sourceMesh.overlayAlpha = 0;
      sourceMesh.showBoundingBox = false;
      sourceMesh.renderOutline = false;
    });
    this.worldColliders = [];
  }

  refreshWorldMeshBounds(root) {
    root.computeWorldMatrix?.(true);
    this.getNodeMeshes(root).forEach((mesh) => {
      mesh.computeWorldMatrix?.(true);
      if (typeof mesh.refreshBoundingInfo === "function") {
        mesh.refreshBoundingInfo(true);
      }
    });
  }

  createWorldMeshCollider(mesh, index) {
    if (!mesh || mesh.getTotalVertices() <= 0) {
      return null;
    }

    mesh.metadata = {
      ...(mesh.metadata ?? {}),
      worldColliderIndex: index,
    };
    mesh.renderOverlay = this.worldCollidersVisible;
    mesh.overlayColor = new BABYLON.Color3(1, 0.5, 0.1);
    mesh.overlayAlpha = this.worldCollidersVisible ? 0.35 : 0;
    mesh.showBoundingBox = this.worldCollidersVisible;
    mesh.renderOutline = this.worldCollidersVisible;
    mesh.outlineColor = new BABYLON.Color3(1, 0.52, 0.12);
    mesh.outlineWidth = 0.08;

    return {
      aggregate: null,
      sourceMesh: mesh,
      sourceName: mesh.name || `mesh-${mesh.uniqueId}`,
    };
  }

  setWorldColliderDebugVisible(visible) {
    this.worldCollidersVisible = visible;
    this.worldColliders.forEach(({ sourceMesh }) => {
      sourceMesh.renderOverlay = visible;
      sourceMesh.overlayAlpha = visible ? 0.35 : 0;
      sourceMesh.showBoundingBox = visible;
      sourceMesh.renderOutline = visible;
    });
  }

  areWorldCollidersVisible() {
    return this.worldCollidersVisible;
  }

  getWorldColliderCount() {
    return this.worldColliders.length;
  }

  getWorldColliderStats() {
    return {
      ...this.worldColliderStats,
      failedMeshes: [...this.worldColliderStats.failedMeshes],
    };
  }

  getWorldImportStats() {
    return {
      ...this.worldImportStats,
      meshNames: [...this.worldImportStats.meshNames],
      rootNodeNames: [...this.worldImportStats.rootNodeNames],
      rootNodeTypes: [...this.worldImportStats.rootNodeTypes],
      sceneMeshNames: [...this.worldImportStats.sceneMeshNames],
    };
  }

  getWorldMeshRuntimeBounds() {
    return this.worldMeshes.map((mesh) => {
      const bounds = mesh.getBoundingInfo().boundingBox;
      const center = bounds.centerWorld;
      const min = bounds.minimumWorld;
      const max = bounds.maximumWorld;
      return {
        name: mesh.name || `mesh-${mesh.uniqueId}`,
        center: {
          x: Number(center.x.toFixed(2)),
          y: Number(center.y.toFixed(2)),
          z: Number(center.z.toFixed(2)),
        },
        min: {
          x: Number(min.x.toFixed(2)),
          y: Number(min.y.toFixed(2)),
          z: Number(min.z.toFixed(2)),
        },
        max: {
          x: Number(max.x.toFixed(2)),
          y: Number(max.y.toFixed(2)),
          z: Number(max.z.toFixed(2)),
        },
      };
    });
  }

  areBoundsFinite(bounds) {
    return Number.isFinite(bounds.min.x)
      && Number.isFinite(bounds.min.y)
      && Number.isFinite(bounds.min.z)
      && Number.isFinite(bounds.max.x)
      && Number.isFinite(bounds.max.y)
      && Number.isFinite(bounds.max.z);
  }

  isRenderableWorldMesh(mesh) {
    return !!mesh
      && mesh.isEnabled()
      && mesh.getTotalVertices() > 0
      && typeof mesh.getBoundingInfo === "function";
  }

  projectPositionToWorldSurface(position) {
    if (!this.worldSurfaceMeshes.length || !this.worldBounds) {
      return cloneVector(position);
    }

    const rayStartY = this.worldBounds.max.y + TARGET_AVATAR_HEIGHT * 4;
    const rayLength = rayStartY - this.worldBounds.min.y + TARGET_AVATAR_HEIGHT * 8;
    const ray = new BABYLON.Ray(
      new BABYLON.Vector3(position.x, rayStartY, position.z),
      new BABYLON.Vector3(0, -1, 0),
      rayLength,
    );
    const hit = this.scene.pickWithRay(ray, (mesh) => this.worldSurfaceMeshes.includes(mesh), false);

    if (!hit?.hit || !hit.pickedPoint) {
      return cloneVector(position);
    }

    return {
      x: position.x,
      y: hit.pickedPoint.y + PLAYER_VISUAL_Y_OFFSET,
      z: position.z,
    };
  }

  createPlayerAvatar(isSelf) {
    if (this.characterAssetContainer) {
      const instance = this.characterAssetContainer.instantiateModelsToScene(
        (name) => `${name}-${this.playerMeshes.size}`,
        false,
      );
      const root = new BABYLON.TransformNode(`player-root-${this.playerMeshes.size}`, this.scene);

      instance.rootNodes.forEach((node) => {
        node.parent = root;
      });

      this.normalizeAvatar(root);
      this.tintAvatar(instance, isSelf);
      const animationGroups = this.selectAvatarAnimationGroups(instance.animationGroups);
      const lockedNodes = this.captureLockedAnimationNodes(instance);
      const animationRanges = animationGroups.all.map((group) => this.getAnimationPlaybackRange(group));
      animationGroups.all.forEach((group, index) => {
        const range = animationRanges[index];
        group.targetedAnimations.forEach(({ animation }) => {
          animation.loopMode = BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE;
        });
        group.normalize(range.from, range.to);
        group.stop();
        group.goToFrame(range.from);
        group.speedRatio = 1;
      });

      return {
        root,
        animationGroups,
        animationRanges,
        lockedNodes,
        collisionProxy: null,
        verticalVelocity: 0,
        labelPlane: this.createPlayerLabelPlane(root),
        labelText: "",
      };
    }

    return this.createFallbackAvatar(isSelf);
  }

  createFallbackAvatar(isSelf) {
    const root = new BABYLON.TransformNode(`player-root-${this.playerMeshes.size}`, this.scene);
    const mesh = BABYLON.MeshBuilder.CreateCapsule(
      `player-${this.playerMeshes.size}`,
      { radius: 0.65, height: TARGET_AVATAR_HEIGHT },
      this.scene,
    );
    const material = new BABYLON.StandardMaterial(`player-material-${this.playerMeshes.size}`, this.scene);
    material.diffuseColor = isSelf ? new BABYLON.Color3(0.19, 0.53, 0.95) : new BABYLON.Color3(0.91, 0.37, 0.2);
    material.emissiveColor = isSelf ? new BABYLON.Color3(0.03, 0.08, 0.18) : new BABYLON.Color3(0.15, 0.06, 0.02);
    mesh.material = material;
    mesh.receiveShadows = true;
    mesh.parent = root;
    mesh.position.y = PLAYER_VISUAL_Y_OFFSET;

    return {
      root,
      animationGroups: {
        all: [],
        idle: null,
        walk: null,
      },
      animationRanges: [],
      lockedNodes: [],
      collisionProxy: null,
      verticalVelocity: 0,
      labelPlane: this.createPlayerLabelPlane(root),
      labelText: "",
    };
  }

  normalizeAvatar(root) {
    const bounds = this.computeHierarchyBounds(root);
    if (!Number.isFinite(bounds.min.y) || !Number.isFinite(bounds.max.y)) {
      return;
    }
    const currentHeight = Math.max(0.001, bounds.max.y - bounds.min.y);
    const scale = TARGET_AVATAR_HEIGHT / currentHeight;
    root.scaling.setAll(scale);

    const scaledBounds = this.computeHierarchyBounds(root);
    const yOffset = -scaledBounds.min.y;

    root.getChildTransformNodes(true).forEach((node) => {
      if (node.parent === root) {
        node.position.y += yOffset;
      }
    });

    root.getChildMeshes(true).forEach((mesh) => {
      if (mesh.parent === root) {
        mesh.position.y += yOffset;
      }
      mesh.receiveShadows = true;
    });
  }

  computeHierarchyBounds(root) {
    const childMeshes = this.getNodeMeshes(root);
    return this.computeMeshBounds(childMeshes);
  }

  computeMeshBounds(meshes) {
    let min = new BABYLON.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    let max = new BABYLON.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

    meshes.forEach((mesh) => {
      const info = mesh.getHierarchyBoundingVectors(true);
      min = BABYLON.Vector3.Minimize(min, info.min);
      max = BABYLON.Vector3.Maximize(max, info.max);
    });

    return { min, max };
  }

  getNodeMeshes(node) {
    const meshes = [];
    if (typeof node.getBoundingInfo === "function") {
      meshes.push(node);
    }

    if (typeof node.getChildMeshes === "function") {
      node.getChildMeshes(true).forEach((mesh) => {
        if (!meshes.includes(mesh)) {
          meshes.push(mesh);
        }
      });
    }

    return meshes;
  }

  tintAvatar(instance, isSelf) {
    const tint = isSelf ? new BABYLON.Color3(0.72, 0.88, 1) : new BABYLON.Color3(1, 0.82, 0.72);
    const emissive = isSelf ? new BABYLON.Color3(0.03, 0.08, 0.18) : new BABYLON.Color3(0.12, 0.05, 0.02);

    instance.rootNodes.forEach((node) => {
      node.getChildMeshes(true).forEach((mesh) => {
        if (!mesh.material || typeof mesh.material.clone !== "function") {
          return;
        }

        mesh.material = mesh.material.clone(`${mesh.material.name}-${isSelf ? "self" : "other"}-${this.playerMeshes.size}`);
        if ("albedoColor" in mesh.material && mesh.material.albedoColor) {
          mesh.material.albedoColor = mesh.material.albedoColor.multiply(tint);
        } else if ("diffuseColor" in mesh.material && mesh.material.diffuseColor) {
          mesh.material.diffuseColor = mesh.material.diffuseColor.multiply(tint);
        }

        if ("emissiveColor" in mesh.material) {
          mesh.material.emissiveColor = emissive;
        }
      });
    });
  }

  selectAvatarAnimationGroups(animationGroups) {
    const motionGroups = animationGroups.filter((group) => !/t[\s_-]*pose/i.test(group.name ?? ""));
    const availableGroups = motionGroups.length ? motionGroups : animationGroups;
    const findGroup = (pattern) => availableGroups.find((group) => pattern.test(group.name ?? ""));

    return {
      all: availableGroups,
      idle: findGroup(/\bidle\b/i) ?? availableGroups[0] ?? null,
      walk: findGroup(/\bwalk(?:ing)?\b/i) ?? findGroup(/\bwaking\b/i) ?? availableGroups[0] ?? null,
    };
  }

  captureLockedAnimationNodes(instance) {
    const namesToLock = new Set(["lpBip Footsteps", "lpBip_01"]);
    const lockedNodes = [];

    instance.rootNodes.forEach((rootNode) => {
      const transformNodes = [rootNode, ...rootNode.getChildTransformNodes(true)];
      transformNodes.forEach((node) => {
        if (!namesToLock.has(node.name)) {
          return;
        }

        lockedNodes.push({
          node,
          position: node.position.clone(),
          rotationQuaternion: node.rotationQuaternion ? node.rotationQuaternion.clone() : null,
          rotation: node.rotation.clone(),
          scaling: node.scaling.clone(),
        });
      });
    });

    return lockedNodes;
  }

  getAnimationPlaybackRange(group) {
    let from = Number.POSITIVE_INFINITY;
    let to = Number.NEGATIVE_INFINITY;
    group.targetedAnimations.forEach((targetedAnimation) => {
      const keys = targetedAnimation.animation.getKeys();
      if (!keys.length) {
        return;
      }

      from = Math.min(from, keys[0].frame);
      to = Math.max(to, keys[keys.length - 1].frame);
    });

    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) {
      return {
        from: group.from,
        to: group.to,
      };
    }

    return { from, to };
  }

  updateAvatarAnimation(avatar, state) {
    if (!avatar.animationGroups?.all?.length) {
      return;
    }

    const latest = state.snapshots[state.snapshots.length - 1];
    const velocity = state.localVelocity ?? latest?.velocity ?? { x: 0, z: 0 };
    const speed = Math.hypot(velocity.x, velocity.z);
    const activeGroup = speed > WALK_ANIMATION_SPEED_THRESHOLD
      ? (avatar.animationGroups.walk ?? avatar.animationGroups.idle ?? avatar.animationGroups.all[0])
      : (avatar.animationGroups.idle ?? avatar.animationGroups.walk ?? avatar.animationGroups.all[0]);

    avatar.animationGroups.all.forEach((group, index) => {
      const range = avatar.animationRanges[index] ?? { from: group.from, to: group.to };
      if (group === activeGroup) {
        if (!group.isPlaying) {
          group.goToFrame(range.from);
          group.play(true);
        }
        group.speedRatio = 1;
        return;
      }

      if (group.isPlaying) {
        group.stop();
      }
      group.goToFrame(range.from);
    });

    avatar.lockedNodes.forEach(({ node, position, rotationQuaternion, rotation, scaling }) => {
      node.position.copyFrom(position);
      if (rotationQuaternion) {
        if (!node.rotationQuaternion) {
          node.rotationQuaternion = rotationQuaternion.clone();
        } else {
          node.rotationQuaternion.copyFrom(rotationQuaternion);
        }
      } else if (node.rotationQuaternion) {
        node.rotationQuaternion = null;
      }
      node.rotation.copyFrom(rotation);
      node.scaling.copyFrom(scaling);
    });
  }

  updateAvatarOrientation(avatar, state, deltaSeconds, isSelf) {
    let direction = null;

    if (isSelf && this.camera && this.selfPosition) {
      direction = new BABYLON.Vector3(
        this.selfPosition.x - this.camera.position.x,
        0,
        this.selfPosition.z - this.camera.position.z,
      );
    } else {
      const latest = state.snapshots[state.snapshots.length - 1];
      const velocity = latest ? new BABYLON.Vector3(latest.velocity.x, 0, latest.velocity.z) : null;
      const speedSquared = velocity ? velocity.lengthSquared() : 0;
      if (latest) {
        direction = new BABYLON.Vector3(Math.cos(latest.heading), 0, Math.sin(latest.heading));
      }
      if (velocity && speedSquared > REMOTE_ROTATION_SPEED_THRESHOLD * REMOTE_ROTATION_SPEED_THRESHOLD) {
        direction = velocity;
      }
    }

    if (!direction || direction.lengthSquared() < 0.0001) {
      return;
    }

    direction.normalize();
    const targetRotation = BABYLON.Quaternion.FromLookDirectionLH(direction, BABYLON.Vector3.Up())
      .multiply(BABYLON.Quaternion.FromEulerAngles(0, Math.PI, 0));
    const smoothing = 1 - Math.exp(-ROTATION_SMOOTHING * deltaSeconds);
    if (!avatar.root.rotationQuaternion) {
      avatar.root.rotationQuaternion = targetRotation;
      return;
    }

    avatar.root.rotationQuaternion = BABYLON.Quaternion.Slerp(
      avatar.root.rotationQuaternion,
      targetRotation,
      smoothing,
    );
  }

  createPlayerLabelPlane(root) {
    const plane = BABYLON.MeshBuilder.CreatePlane(`player-label-${this.playerMeshes.size}`, {
      width: PLAYER_LABEL_WIDTH,
      height: PLAYER_LABEL_HEIGHT,
    }, this.scene);
    const texture = new BABYLON.DynamicTexture(`player-label-texture-${this.playerMeshes.size}`, {
      width: PLAYER_LABEL_TEXTURE_WIDTH,
      height: PLAYER_LABEL_TEXTURE_HEIGHT,
    }, this.scene, true);
    const material = new BABYLON.StandardMaterial(`player-label-material-${this.playerMeshes.size}`, this.scene);
    material.diffuseTexture = texture;
    material.emissiveTexture = texture;
    material.opacityTexture = texture;
    material.disableLighting = true;
    material.backFaceCulling = false;
    plane.material = material;
    plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    plane.parent = root;
    plane.position.y = PLAYER_LABEL_Y_OFFSET;
    plane.isPickable = false;
    this.drawPlayerLabel(plane, "");
    return plane;
  }

  drawPlayerLabel(plane, text) {
    const texture = plane?.material?.diffuseTexture;
    if (!texture) {
      return;
    }

    const context = texture.getContext();
    context.clearRect(0, 0, PLAYER_LABEL_TEXTURE_WIDTH, PLAYER_LABEL_TEXTURE_HEIGHT);
    if (text) {
      context.fillStyle = "rgba(21, 24, 28, 0.78)";
      context.fillRect(8, 12, PLAYER_LABEL_TEXTURE_WIDTH - 16, PLAYER_LABEL_TEXTURE_HEIGHT - 24);
      context.strokeStyle = "rgba(255, 244, 214, 0.9)";
      context.lineWidth = 4;
      context.strokeRect(8, 12, PLAYER_LABEL_TEXTURE_WIDTH - 16, PLAYER_LABEL_TEXTURE_HEIGHT - 24);
      context.font = "bold 34px Georgia";
      context.fillStyle = "#fff7dc";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(text, PLAYER_LABEL_TEXTURE_WIDTH / 2, PLAYER_LABEL_TEXTURE_HEIGHT / 2 + 2);
    }
    texture.update();
  }

  updateAvatarLabel(avatar, player) {
    if (!avatar?.labelPlane) {
      return;
    }

    const playerNumber = Number.isInteger(player.playerNumber) && player.playerNumber > 0 ? player.playerNumber : "?";
    const nextText = `P${playerNumber} ${player.username}`;
    if (avatar.labelText === nextText) {
      return;
    }

    avatar.labelText = nextText;
    this.drawPlayerLabel(avatar.labelPlane, nextText);
  }

  disposePlayerAvatar(avatar) {
    avatar.animationGroups?.all?.forEach((group) => group.dispose());
    avatar.collisionProxy?.dispose(false, true);
    avatar.labelPlane?.material?.dispose(false, true);
    avatar.labelPlane?.dispose(false, true);
    avatar.root.dispose(false, true);
  }

  syncMovementIntent() {
    if (!this.selfPosition || !this.camera) {
      return;
    }

    const heading = getHeadingFromCamera(this.selfPosition, this.camera.position);
    const now = performance.now();
    const state = this.selfSessionId ? this.playerStates.get(this.selfSessionId) : null;
    const velocity = state?.localVelocity ?? state?.snapshots?.[state.snapshots.length - 1]?.velocity ?? { x: 0, z: 0 };

    if (this.lastHeading !== null) {
      const delta = Math.atan2(Math.sin(heading - this.lastHeading), Math.cos(heading - this.lastHeading));
      const speedDelta = Math.hypot(
        velocity.x - (this.lastSentVelocity?.x ?? 0),
        velocity.z - (this.lastSentVelocity?.z ?? 0),
      );
      const positionDelta = Math.hypot(
        this.selfPosition.x - (this.lastSentPosition?.x ?? this.selfPosition.x),
        this.selfPosition.z - (this.lastSentPosition?.z ?? this.selfPosition.z),
      );
      if (Math.abs(delta) < 0.04
        && speedDelta < 0.08
        && positionDelta < 0.08
        && now - this.lastMovementSentAt < MOVEMENT_SEND_INTERVAL_MS) {
        return;
      }
    }

    this.lastHeading = heading;
    this.lastMovementSentAt = now;
    this.lastSentVelocity = { x: velocity.x, z: velocity.z };
    this.lastSentPosition = cloneVector(this.selfPosition);
    this.onMovementChange?.({
      heading,
      velocity: {
        x: velocity.x,
        z: velocity.z,
      },
      position: cloneVector(this.selfPosition),
    });
  }
}
