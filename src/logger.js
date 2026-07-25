// Structured logging: one JSON object per line so logs are queryable by field

export function log(fields) {
  console.log(JSON.stringify({ time: new Date().toISOString(), ...fields }));
}
