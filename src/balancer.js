//  The shared cursor needs no lock  because Node runs request handlers on a single thread.

export function createRoundRobin(backends, isHealthy = () => true) {
  let index = 0;
  return {
    next() {
      for (let i = 0; i < backends.length; i++) {
        const backend = backends[index];
        index = (index + 1) % backends.length;
        if (isHealthy(backend.id)) {
          return backend;
        }
      }
      return null;
    },
    release() {

    },
  };
}

// Least connections: always route to whichever backend has the fewest requests

export function createLeastConnections(backends, isHealthy = () => true) {
  const activeCounts = new Map();
  for (const backend of backends) {
    activeCounts.set(backend.id, 0);
  }

  return {
    next() {
      let chosen = null;
      let lowest = Infinity;

      for (const backend of backends) {
        if (!isHealthy(backend.id)) continue;
        const count = activeCounts.get(backend.id);
        if (count < lowest) {
          chosen = backend;
          lowest = count;
        }
      }

      if (chosen) {
        activeCounts.set(chosen.id, lowest + 1);
      }
      return chosen;
    },
    release(backend) {
      const count = activeCounts.get(backend.id);
      activeCounts.set(backend.id, count - 1);
    },
  };
}
