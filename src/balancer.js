//  The shared cursor needs no lock  because Node runs request handlers on a single thread.

export function createRoundRobin(backends) {
  let index = 0;
  return {
    next() {
      const backend = backends[index];
      index = (index + 1) % backends.length;
      return backend;
    },
    release() {
      
    },
  };
}

// Least connections: always route to whichever backend has the fewest requests

export function createLeastConnections(backends) {
  const activeCounts = new Map();
  for (const backend of backends) {
    activeCounts.set(backend.id, 0);
  }

  return {
    next() {
      let chosen = backends[0];
      let lowest = activeCounts.get(chosen.id);

      for (let i = 1; i < backends.length; i++) {
        const backend = backends[i];
        const count = activeCounts.get(backend.id);
        if (count < lowest) {
          chosen = backend;
          lowest = count;
        }
      }

      activeCounts.set(chosen.id, lowest + 1);
      return chosen;
    },
    release(backend) {
      const count = activeCounts.get(backend.id);
      activeCounts.set(backend.id, count - 1);
    },
  };
}
