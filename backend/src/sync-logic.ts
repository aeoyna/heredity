export interface GameState {
  stamina: number;
  maxStamina: number;
  lifetimeSwipes: number;
  lastRecoveryTime: number;
  souls: number;
  isAdFree: boolean;
}

export function mergeGameStates(client: GameState, server: GameState): GameState {
  const now = Date.now();
  const RECOVERY_INTERVAL = 60000; // 60 seconds

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

  // 3. Resolve conflict: pick the highest stamina status
  let stamina = Math.max(clientCalculatedStamina, serverCalculatedStamina);
  
  // Cap at the new merged maxStamina
  stamina = Math.min(maxStamina, stamina);

  let lastRecoveryTime = now;
  if (stamina >= maxStamina) {
    lastRecoveryTime = now;
  } else {
    // Inherit the recovery offset from the winning state to prevent timer resetting
    if (clientCalculatedStamina >= serverCalculatedStamina) {
      lastRecoveryTime = clientAdjustedRecovery;
    } else {
      lastRecoveryTime = serverAdjustedRecovery;
    }
  }

  return {
    stamina,
    maxStamina,
    lifetimeSwipes,
    lastRecoveryTime,
    souls,
    isAdFree
  };
}
