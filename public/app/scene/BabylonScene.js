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
const CAMERA_BETA_MIN = 0.62;
const CAMERA_BETA_MAX = 1.85;
const CAMERA_TRANSITION_BETA = 1.02;
const CAMERA_RADIUS_NEAR = 2.4;
const CAMERA_RADIUS_FAR = 8.5;
const CAMERA_TARGET_Y_NEAR = 1.48;
const CAMERA_TARGET_Y_FAR = 0.92;
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
const MOVEMENT_FORCE = 18;
const MOVEMENT_DRAG = 4.5;
const MAX_SPEED = 7.5;
const POSITION_LIMIT = 14;
const PLAYER_VISUAL_Y_OFFSET = 1;
const TARGET_AVATAR_HEIGHT = 2.2;
const CHARACTER_MODEL_URL = "/assets/characters/low_poly_humanoid_robot.glb";
const ROTATION_SMOOTHING = 12;
const WALK_TRIM_START_SECONDS = 1;

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

function clampPosition(value) {
  return Math.max(-POSITION_LIMIT, Math.min(POSITION_LIMIT, value));
}

function extrapolateLinear(snapshot, deltaMs) {
  const deltaSeconds = deltaMs / 1000;
  return {
    x: clampPosition(snapshot.position.x + snapshot.velocity.x * deltaSeconds),
    y: snapshot.position.y,
    z: clampPosition(snapshot.position.z + snapshot.velocity.z * deltaSeconds),
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
    x: clampPosition(snapshot.position.x + velocity.x * deltaSeconds),
    y: snapshot.position.y,
    z: clampPosition(snapshot.position.z + velocity.z * deltaSeconds),
  };
}

export class BabylonScene {
  constructor({ canvas, onHeadingChange }) {
    this.canvas = canvas;
    this.onHeadingChange = onHeadingChange;
    this.engine = null;
    this.scene = null;
    this.camera = null;
    this.playerMeshes = new Map();
    this.playerStates = new Map();
    this.selfPosition = null;
    this.selfSessionId = null;
    this.lastHeading = null;
    this.lastHeadingSentAt = 0;
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
  }

  async init() {
    this.engine = new BABYLON.Engine(this.canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color4(0.93, 0.97, 1, 1);

    await this.enablePhysics();
    await this.createEnvironment();

    this.engine.runRenderLoop(() => {
      this.updateRenderedPlayers();
      this.updateCameraFraming();
      this.syncHeadingIntent();
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

      this.recordPlayerSnapshot(player.sessionId, player, view.serverTime);
    });

    if (view.self && this.camera) {
      this.selfSessionId = view.self.sessionId;
    } else {
      this.selfSessionId = null;
      this.selfPosition = null;
      this.lastHeading = null;
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
      const targetPosition = isSelf
        ? this.predictSelfPosition(state)
        : this.interpolateRemotePosition(state, renderTime);

      state.renderedPosition = this.blendRenderedPosition(
        state.renderedPosition ?? cloneVector(targetPosition),
        targetPosition,
        deltaSeconds,
      );

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

  predictSelfPosition(state) {
    const latest = state.snapshots[state.snapshots.length - 1];
    if (!latest) {
      return state.renderedPosition ?? { x: 0, y: 1, z: 0 };
    }

    const predictionMs = BABYLON.Scalar.Clamp(
      this.getEstimatedServerTime() - latest.serverTime,
      0,
      MAX_EXTRAPOLATION_MS,
    );
    const heading = this.lastHeading ?? latest.heading;
    return integrateMovement(latest, heading, predictionMs);
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

  async enablePhysics() {
    const havok = await HavokPhysics();
    const plugin = new BABYLON.HavokPlugin(true, havok);
    this.scene.enablePhysics(new BABYLON.Vector3(0, -9.81, 0), plugin);
  }

  async createEnvironment() {
    this.camera = new BABYLON.ArcRotateCamera(
      "camera",
      -Math.PI / 2,
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

    await this.preloadSkyPreset(WORLD_SKY_PRESET);
    this.applySkyPreset(WORLD_SKY_PRESET);
    await this.preloadCharacterModel();

    const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.88;

    const sun = new BABYLON.DirectionalLight("sun", new BABYLON.Vector3(-0.55, -1, -0.25), this.scene);
    sun.position = new BABYLON.Vector3(12, 20, 8);
    sun.intensity = 1.35;

    const shadowGenerator = new BABYLON.ShadowGenerator(1024, sun);
    shadowGenerator.useBlurExponentialShadowMap = true;
    shadowGenerator.blurKernel = 24;

    const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 36, height: 36 }, this.scene);
    ground.receiveShadows = true;
    const groundMaterial = new BABYLON.StandardMaterial("ground-material", this.scene);
    groundMaterial.diffuseColor = new BABYLON.Color3(0.73, 0.79, 0.69);
    groundMaterial.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04);
    ground.material = groundMaterial;
    new BABYLON.PhysicsAggregate(ground, BABYLON.PhysicsShapeType.BOX, { mass: 0, restitution: 0.1 }, this.scene);

    const groundDetail = BABYLON.MeshBuilder.CreateGround("ground-detail", { width: 35.4, height: 35.4 }, this.scene);
    groundDetail.position.y = 0.02;
    groundDetail.receiveShadows = true;
    const groundDetailMaterial = new BABYLON.StandardMaterial("ground-detail-material", this.scene);
    groundDetailMaterial.diffuseColor = new BABYLON.Color3(0.47, 0.58, 0.39);
    groundDetailMaterial.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);
    groundDetailMaterial.alpha = 0.24;
    groundDetail.material = groundDetailMaterial;

    const platform = BABYLON.MeshBuilder.CreateBox("platform", { width: 8, height: 1, depth: 8 }, this.scene);
    platform.position.y = 0.5;
    platform.position.x = -10;
    platform.position.z = -10;
    platform.receiveShadows = true;
    const platformMaterial = new BABYLON.StandardMaterial("platform-material", this.scene);
    platformMaterial.diffuseColor = new BABYLON.Color3(0.87, 0.7, 0.52);
    platform.material = platformMaterial;
    new BABYLON.PhysicsAggregate(platform, BABYLON.PhysicsShapeType.BOX, { mass: 0 }, this.scene);

    for (let i = 0; i < 6; i += 1) {
      const crate = BABYLON.MeshBuilder.CreateBox(`crate-${i}`, { size: 1.4 }, this.scene);
      crate.position = new BABYLON.Vector3(-10 + (i % 2) * 1.6, 2 + i * 1.2, -10 + Math.floor(i / 2) * 1.6);
      crate.receiveShadows = true;
      shadowGenerator.addShadowCaster(crate);
      const material = new BABYLON.StandardMaterial(`crate-material-${i}`, this.scene);
      material.diffuseColor = new BABYLON.Color3(0.65, 0.42, 0.25);
      crate.material = material;
      new BABYLON.PhysicsAggregate(crate, BABYLON.PhysicsShapeType.BOX, { mass: 1, restitution: 0.2 }, this.scene);
    }
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

    this.camera.radius = desiredRadius;
    this.cameraFocus.position.set(
      this.cameraFocusPosition.x,
      this.cameraFocusPosition.y,
      this.cameraFocusPosition.z,
    );
  }

  getTrackedPlayerPosition() {
    return this.selfPosition;
  }

  async preloadSkyPreset(skyKey) {
    const preset = SKY_PRESETS[skyKey] ?? SKY_PRESETS[WORLD_SKY_PRESET];

    await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`Failed to preload sky asset: ${preset.file}`));
      image.src = preset.file;
    });
  }

  applySkyPreset(skyKey) {
    const preset = SKY_PRESETS[skyKey] ?? SKY_PRESETS[WORLD_SKY_PRESET];

    if (this.skyDome) {
      this.skyDome.dispose();
    }

    this.skyDome = new BABYLON.PhotoDome(
      "sky-dome",
      preset.file,
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

    this.characterLoadPromise = BABYLON.SceneLoader.LoadAssetContainerAsync(
      CHARACTER_MODEL_URL,
      undefined,
      this.scene,
    ).then((container) => {
      this.characterAssetContainer = container;
    }).catch((error) => {
      console.error("Failed to load character model", error);
      this.characterAssetContainer = null;
    }).finally(() => {
      this.characterLoadPromise = null;
    });

    return this.characterLoadPromise;
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
      const animationRanges = animationGroups.map((group) => this.getAnimationPlaybackRange(group));
      animationGroups.forEach((group, index) => {
        const range = animationRanges[index];
        group.targetedAnimations.forEach(({ animation }) => {
          animation.loopMode = BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE;
        });
        group.normalize(range.from, range.to);
        group.stop();
        group.goToFrame(range.from);
        group.play(true);
        group.speedRatio = 1;
      });

      return {
        root,
        animationGroups,
        animationRanges,
        lockedNodes,
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
      animationGroups: [],
      animationRanges: [],
      lockedNodes: [],
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
    const childMeshes = root.getChildMeshes(true);
    let min = new BABYLON.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    let max = new BABYLON.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

    childMeshes.forEach((mesh) => {
      const info = mesh.getHierarchyBoundingVectors(true);
      min = BABYLON.Vector3.Minimize(min, info.min);
      max = BABYLON.Vector3.Maximize(max, info.max);
    });

    return { min, max };
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
    return motionGroups.length ? motionGroups : animationGroups;
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
    let maxFramePerSecond = 0;

    group.targetedAnimations.forEach((targetedAnimation) => {
      const keys = targetedAnimation.animation.getKeys();
      if (!keys.length) {
        return;
      }

      maxFramePerSecond = Math.max(maxFramePerSecond, targetedAnimation.animation.framePerSecond || 0);
      from = Math.min(from, keys[0].frame);
      to = Math.max(to, keys[keys.length - 1].frame);
    });

    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) {
      return {
        from: group.from,
        to: group.to,
      };
    }

    if (/walk/i.test(group.name ?? "") && maxFramePerSecond > 0) {
      const trimmedFrom = from + WALK_TRIM_START_SECONDS * maxFramePerSecond;
      if (trimmedFrom < to) {
        from = trimmedFrom;
      }
    }

    return { from, to };
  }

  updateAvatarAnimation(avatar, state) {
    if (!avatar.animationGroups.length) {
      return;
    }

    avatar.animationGroups.forEach((group, index) => {
      const range = avatar.animationRanges[index] ?? { from: group.from, to: group.to };
      if (!group.isPlaying) {
        group.goToFrame(range.from);
        group.play(true);
      }
      group.speedRatio = 1;
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
      if (velocity && velocity.lengthSquared() > 0.0001) {
        direction = velocity;
      } else if (latest) {
        direction = new BABYLON.Vector3(Math.cos(latest.heading), 0, Math.sin(latest.heading));
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

  disposePlayerAvatar(avatar) {
    avatar.animationGroups.forEach((group) => group.dispose());
    avatar.root.dispose(false, true);
  }

  syncHeadingIntent() {
    if (!this.selfPosition || !this.camera) {
      return;
    }

    const cameraPosition = this.camera.position;
    const heading = Math.atan2(
      this.selfPosition.z - cameraPosition.z,
      this.selfPosition.x - cameraPosition.x,
    );
    const now = performance.now();

    if (this.lastHeading !== null) {
      const delta = Math.atan2(Math.sin(heading - this.lastHeading), Math.cos(heading - this.lastHeading));
      if (Math.abs(delta) < 0.04 && now - this.lastHeadingSentAt < 250) {
        return;
      }
    }

    this.lastHeading = heading;
    this.lastHeadingSentAt = now;
    this.onHeadingChange?.(heading);
  }
}
