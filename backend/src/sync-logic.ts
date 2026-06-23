export interface GameState {
  stamina: number;
  maxStamina: number;
  lifetimeSwipes: number;
  lastRecoveryTime: number;
  souls: number;
  isAdFree: boolean;
  outs?: number;
  lastOutRecoveryTime?: number;
  swipesSinceLastOutRecovery?: number;
}

export function mergeGameStates(client: GameState, server: GameState): GameState {
  const now = Date.now();
  const RECOVERY_INTERVAL = 60000; // 60 seconds
  const OUT_RECOVERY_INTERVAL = 3600000; // 1 hour (3600000 ms)

  // 1. Establish the merged base values
  const maxStamina = Math.max(client.maxStamina, server.maxStamina);
  const souls = Math.max(client.souls, server.souls);
  const lifetimeSwipes = Math.max(client.lifetimeSwipes, server.lifetimeSwipes);
  const isAdFree = client.isAdFree || server.isAdFree;

  // 2. Compute dynamic stamina recovery based on elapsed time
  let clientCalculatedStamina = client.stamina;
  let clientAdjustedRecovery = client.lastRecoveryTime;
  if (client.stamina < client.maxStamina) {
    const elapsed = Math.max(0, now - client.lastRecoveryTime);
    const pointsToAdd = Math.floor(elapsed / RECOVERY_INTERVAL);
    clientCalculatedStamina = Math.min(client.maxStamina, client.stamina + pointsToAdd);
    clientAdjustedRecovery = now - (elapsed % RECOVERY_INTERVAL);
  } else {
    clientAdjustedRecovery = now;
  }

  let serverCalculatedStamina = server.stamina;
  let serverAdjustedRecovery = server.lastRecoveryTime;
  if (server.stamina < server.maxStamina) {
    const elapsed = Math.max(0, now - server.lastRecoveryTime);
    const pointsToAdd = Math.floor(elapsed / RECOVERY_INTERVAL);
    serverCalculatedStamina = Math.min(server.maxStamina, server.stamina + pointsToAdd);
    serverAdjustedRecovery = now - (elapsed % RECOVERY_INTERVAL);
  } else {
    serverAdjustedRecovery = now;
  }

  // 3. Compute dynamic out recovery based on elapsed time
  let clientOuts = client.outs ?? 0;
  let clientLastOutRecovery = client.lastOutRecoveryTime ?? 0;
  if (clientOuts > 0 && clientLastOutRecovery > 0) {
    const elapsed = Math.max(0, now - clientLastOutRecovery);
    const outsToRecover = Math.floor(elapsed / OUT_RECOVERY_INTERVAL);
    if (outsToRecover > 0) {
      clientOuts = Math.max(0, clientOuts - outsToRecover);
      clientLastOutRecovery = clientOuts === 0 ? 0 : clientLastOutRecovery + outsToRecover * OUT_RECOVERY_INTERVAL;
    }
  }

  let serverOuts = server.outs ?? 0;
  let serverLastOutRecovery = server.lastOutRecoveryTime ?? 0;
  if (serverOuts > 0 && serverLastOutRecovery > 0) {
    const elapsed = Math.max(0, now - serverLastOutRecovery);
    const outsToRecover = Math.floor(elapsed / OUT_RECOVERY_INTERVAL);
    if (outsToRecover > 0) {
      serverOuts = Math.max(0, serverOuts - outsToRecover);
      serverLastOutRecovery = serverOuts === 0 ? 0 : serverLastOutRecovery + outsToRecover * OUT_RECOVERY_INTERVAL;
    }
  }

  // 4. Resolve conflict based on lifetimeSwipes progress (the state that swiped more is the latest state)
  let stamina = clientCalculatedStamina;
  let lastRecoveryTime = clientAdjustedRecovery;
  let outs = clientOuts;
  let lastOutRecoveryTime = clientLastOutRecovery;
  let swipesSinceLastOutRecovery = client.swipesSinceLastOutRecovery ?? 0;

  if (server.lifetimeSwipes > client.lifetimeSwipes) {
    stamina = serverCalculatedStamina;
    lastRecoveryTime = serverAdjustedRecovery;
    outs = serverOuts;
    lastOutRecoveryTime = serverLastOutRecovery;
    swipesSinceLastOutRecovery = server.swipesSinceLastOutRecovery ?? 0;
  } else if (client.lifetimeSwipes === server.lifetimeSwipes) {
    // If swipes are equal, pick the lower stamina (safer against client-side memory modifications)
    stamina = Math.min(clientCalculatedStamina, serverCalculatedStamina);
    lastRecoveryTime = clientCalculatedStamina <= serverCalculatedStamina ? clientAdjustedRecovery : serverAdjustedRecovery;
    
    // Pick the higher outs (safer against client-side resetting of outs)
    outs = Math.max(clientOuts, serverOuts);
    lastOutRecoveryTime = clientOuts >= serverOuts ? clientLastOutRecovery : serverLastOutRecovery;
    swipesSinceLastOutRecovery = clientOuts >= serverOuts ? (client.swipesSinceLastOutRecovery ?? 0) : (server.swipesSinceLastOutRecovery ?? 0);
  }

  // Cap at the new merged maxStamina
  stamina = Math.min(maxStamina, stamina);
  if (stamina >= maxStamina) {
    lastRecoveryTime = now;
  }

  // If outs is 0, make sure recovery time is 0
  if (outs === 0) {
    lastOutRecoveryTime = 0;
  }

  return {
    stamina,
    maxStamina,
    lifetimeSwipes,
    lastRecoveryTime,
    souls,
    isAdFree,
    outs,
    lastOutRecoveryTime,
    swipesSinceLastOutRecovery
  };
}
