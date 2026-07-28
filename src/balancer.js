//  The shared cursor needs no lock  because Node runs request handlers on a single thread.

export function createRoundRobin(backends) {
  let index = 0;
  return {
    next() {
      const backend = backends[index];
      index = (index + 1) % backends.length;
      return backend;
    },
  };
}
