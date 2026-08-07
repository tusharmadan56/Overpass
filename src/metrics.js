export function createMetricsCollector() {
  const stats = {
    totalRequests: 0,
    totalLatencyMs: 0,
    latencies: [],
    statusCounts: {},
    backendCounts: {},
    rateLimitRejections: 0,
  };

  function recordRequest(method, status, latencyMs, backend) {
    stats.totalRequests += 1;
    stats.totalLatencyMs += latencyMs;
    stats.latencies.push(latencyMs);

    if (!stats.statusCounts[status]) stats.statusCounts[status] = 0;
    stats.statusCounts[status] += 1;

    if (status === 429) {
      stats.rateLimitRejections += 1;
    }

    if (backend) {
      if (!stats.backendCounts[backend]) stats.backendCounts[backend] = 0;
      stats.backendCounts[backend] += 1;
    }
  }

  function getPercentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  function formatMetrics() {
    const lines = [];
    const avgLatency = stats.totalRequests > 0 ? stats.totalLatencyMs / stats.totalRequests : 0;

    lines.push('# HELP requests_total Total number of requests');
    lines.push('# TYPE requests_total counter');
    lines.push(`requests_total ${stats.totalRequests}`);

    lines.push('# HELP requests_by_status Requests by HTTP status');
    lines.push('# TYPE requests_by_status gauge');
    for (const [status, count] of Object.entries(stats.statusCounts)) {
      lines.push(`requests_by_status{status="${status}"} ${count}`);
    }

    lines.push('# HELP latency_ms_avg Average request latency');
    lines.push('# TYPE latency_ms_avg gauge');
    lines.push(`latency_ms_avg ${Math.round(avgLatency)}`);

    lines.push('# HELP latency_ms_p50 Median request latency');
    lines.push('# TYPE latency_ms_p50 gauge');
    lines.push(`latency_ms_p50 ${getPercentile(stats.latencies, 50)}`);

    lines.push('# HELP latency_ms_p99 99th percentile latency');
    lines.push('# TYPE latency_ms_p99 gauge');
    lines.push(`latency_ms_p99 ${getPercentile(stats.latencies, 99)}`);

    lines.push('# HELP ratelimit_rejections_total Rate limit rejections');
    lines.push('# TYPE ratelimit_rejections_total counter');
    lines.push(`ratelimit_rejections_total ${stats.rateLimitRejections}`);

    lines.push('# HELP requests_by_backend Requests per backend');
    lines.push('# TYPE requests_by_backend gauge');
    for (const [backend, count] of Object.entries(stats.backendCounts)) {
      lines.push(`requests_by_backend{backend="${backend}"} ${count}`);
    }

    return lines.join('\n');
  }

  return { recordRequest, formatMetrics };
}
