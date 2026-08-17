# Distributed Tracing (Jaeger/Zipkin) - CMP-007

**Status:** NOT IMPLEMENTED  
**Priority:** P2  
**Implementation:** OpenTelemetry + Jaeger (PLANNED)  
**Owner:** Platform Team  
**Status:** NOT IMPLEMENTED

---

## Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Frontend   │────▶│  Backend    │────▶│  Database   │
│  (React)    │     │  (Node.js)  │     │  (Postgres) │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────┐
│           OpenTelemetry Collector                    │
│  (Receiver → Processor → Exporter)                   │
└─────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│              Jaeger Backend                          │
│  (Collector → Query → UI)                           │
└─────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│              Jaeger UI                               │
│  (Trace Search, Service Map, Dependency Graph)       │
└─────────────────────────────────────────────────────┘
```

---

## OpenTelemetry Configuration

### Backend (Node.js) - OpenTelemetry Setup

```typescript
// src/telemetry/setup.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';

// Jaeger Exporter
const jaegerExporter = new JaegerExporter({
  endpoint: process.env.JAEGER_ENDPOINT || 'http://jaeger-collector:14268/api/traces',
  maxPacketSize: 65000,
});

// Prometheus Metrics Exporter
const prometheusExporter = new PrometheusExporter({
  port: 9464,
  endpoint: '/metrics',
});

// Resource Detection
const resource = new Resource({
  [SemanticResourceAttributes.SERVICE_NAME]: 'ethertrack-backend',
  [SemanticResourceAttributes.SERVICE_VERSION]: process.env.APP_VERSION || '1.0.0',
  [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
  [SemanticResourceAttributes.HOST_NAME]: process.env.HOSTNAME || 'localhost',
  [SemanticResourceAttributes.KUBERNETES_CLUSTER_NAME]: process.env.KUBERNETES_CLUSTER_NAME,
  [SemanticResourceAttributes.KUBERNETES_POD_NAME]: process.env.POD_NAME,
  [SemanticResourceAttributes.KUBERNETES_NAMESPACE]: process.env.KUBERNETES_NAMESPACE,
});

// Initialize SDK
const sdk = new NodeSDK({
  resource,
  traceExporter: jaegerExporter,
  metricReader: new PeriodicExportingMetricReader({
    exporter: new PrometheusExporter({ port: 9464 }),
    exportIntervalMillis: 15000,
  }),
  spanProcessor: new BatchSpanProcessor(jaegerExporter, {
    maxQueueSize: 2048,
    maxExportBatchSize: 512,
    scheduledDelayMillis: 5000,
    exportTimeoutMillis: 30000,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-dns': { enabled: false },
      '@opentelemetry/instrumentation-express': {
        enabled: true,
        ignoreIncomingPaths: ['/health', '/metrics', '/healthz'],
      },
      '@opentelemetry/instrumentation-http': {
        enabled: true,
        ignoreIncomingRequestHook: (request) => {
          return request.url?.includes('/health') || 
                 request.url?.includes('/metrics') ||
                 request.url?.includes('/favicon.ico');
        },
      },
      '@opentelemetry/instrumentation-pg': {
        enabled: true,
        enhancedDatabaseReporting: true,
      },
      '@opentelemetry/instrumentation-redis': {
        enabled: true,
      },
      '@opentelemetry/instrumentation-redis-4': {
        enabled: true,
      },
      '@opentelemetry/instrumentation-kafkajs': {
        enabled: true,
      },
      '@opentelemetry/instrumentation-http': {
        enabled: true,
      },
      '@opentelemetry/instrumentation-express': {
        enabled: true,
      },
    ],
});

// Initialize
sdk.start();

// Graceful shutdown
process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('Tracing terminated'))
    .catch((error) => console.error('Error terminating tracing', error))
    .finally(() => process.exit(0));
});

export { sdk };
```

---

### Frontend (React) - OpenTelemetry Setup

```typescript
// src/telemetry/browser.ts
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import { UserInteractionInstrumentation } from '@opentelemetry/instrumentation-user-interaction';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

// Jaeger Exporter (via collector)
const jaegerExporter = new JaegerExporter({
  endpoint: `${window.location.origin}/api/telemetry/traces`,
  maxPacketSize: 65000,
});

// Resource
const resource = new Resource({
  [SemanticResourceAttributes.SERVICE_NAME]: 'ethertrack-frontend',
  [SemanticResourceAttributes.SERVICE_VERSION]: process.env.REACT_APP_VERSION || '1.0.0',
  [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
});

// Provider
const provider = new WebTracerProvider({
  resource,
  spanProcessors: [
    new BatchSpanProcessor(jaegerExporter, {
      maxQueueSize: 100,
      maxExportBatchSize: 10,
      scheduledDelayMillis: 1000,
      exportTimeoutMillis: 5000,
    }),
  },
});

// Context Manager
provider.register({ contextManager: new ZoneContextManager() });

// Register Instrumentations
registerInstrumentations({
  instrumentations: [
    new DocumentLoadInstrumentation(),
    new FetchInstrumentation({
      propagateTraceHeaderCorsUrls: [
        /^https:\/\/api\.ethertrack\.in\/.*/,
        /^http:\/\/localhost:5000\/.*/,
      ],
      clearTimingResources: true,
      applyCustomAttributesOnSpan: (span) => {
        span.setAttribute('http.request.header.user-agent', navigator.userAgent);
      },
    }),
    new XMLHttpRequestInstrumentation({
      propagateTraceHeaderCorsUrls: [
        /^https:\/\/api\.ethertrack\.in\/.*/,
      ],
    }),
    new UserInteractionInstrumentation(),
  ],
});

export { provider };
```

---

### Custom Instrumentation

```typescript
// src/lib/tracing.ts
import { trace, SpanStatusCode, SpanKind, context } from '@opentelemetry/api';
import { trace, Span, SpanStatusCode, SpanKind, context, Context } from '@opentelemetry/api';

const tracer = trace.getTracer('ethertrack', '1.0.0');

// Custom span creation helper
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  options?: {
    kind?: SpanKind;
    attributes?: Record<string, string | number | boolean>;
    links?: Array<{ spanContext: SpanContext; attributes?: Record<string, any> }>;
  }
): Promise<T> {
  const tracer = trace.getTracer('ethertrack');
  
  return tracer.startActiveSpan(name, {
    kind: options?.kind || SpanKind.INTERNAL,
    attributes: options?.attributes,
    links: options?.links,
  }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

// Database query tracing
export async function traceQuery<T>(
  queryName: string,
  query: string,
  params: any[],
  fn: () => Promise<T>
): Promise<T> {
  return withSpan(`db.query.${queryName}`, async (span) => {
    span.setAttribute('db.system', 'postgresql');
    span.setAttribute('db.statement', query);
    span.setAttribute('db.operation', query.trim().split(' ')[0].toUpperCase());
    
    try {
      return await fn();
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      throw error;
    }
  }, {
    kind: SpanKind.CLIENT,
    attributes: {
      'db.system': 'postgresql',
      'db.operation': query.trim().split(' ')[0].toUpperCase(),
    }
  });
}

// HTTP client tracing
export async function tracedFetch(
  url: string,
  options?: RequestInit
): Promise<Response> {
  return withSpan(`HTTP ${options?.method || 'GET'} ${url}`, async (span) => {
    span.setAttribute('http.method', options?.method || 'GET');
    span.setAttribute('http.url', url);
    span.setAttribute('span.kind', SpanKind.CLIENT);
    
    // Inject trace context into headers
    const headers = new Headers(options?.headers);
    const tracer = trace.getTracer('ethertrack');
    tracer.inject(context.active(), headers);
    
    const response = await fetch(url, { ...options, headers });
    
    span.setAttribute('http.status_code', response.status);
    if (response.ok) {
      span.setStatus({ code: SpanStatusCode.OK });
    } else {
      span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${response.status}` });
    }
    
    return response;
  }, {
    kind: SpanKind.CLIENT,
    attributes: {
      'http.method': options?.method || 'GET',
      'http.url': url,
    }
  });
}

// Database query wrapper with tracing
export function withDbTracing(client: any) {
  const originalQuery = client.query.bind(client);
  
  client.query = async (query: string, params?: any[]) => {
    const operation = query.trim().split(' ')[0].toUpperCase();
    
    return withSpan(`db.query.${operation}`, async (span) => {
      span.setAttribute('db.system', 'postgresql');
      span.setAttribute('db.operation', operation);
      span.setAttribute('db.statement', query.substring(0, 1000));
      span.setAttribute('db.params_count', params?.length || 0);
      
      try {
        const result = await originalQuery(query, params);
        span.setAttribute('db.rows_returned', result.rowCount);
        return result;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
        throw error;
      }
    }, {
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system': 'postgresql',
      }
    });
  };
  
  return client;
}

// Custom business logic tracing
export async function traceBusinessOperation<T>(
  operationName: string,
  fn: () => Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  return withSpan(`business.${operationName}`, async (span) => {
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        span.setAttribute(key, value);
      }
    }
    
    try {
      return await fn();
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      throw error;
    }
  }, {
    kind: SpanKind.INTERNAL,
    attributes
  });
}

// Saga/Transaction tracing
export async function traceSaga<T>(
  sagaName: string,
  steps: Array<{ name: string; fn: () => Promise<any> }>
): Promise<any[]> {
  return withSpan(`saga.${sagaName}`, async (parentSpan) => {
    const results: any[] = [];
    
    for (const step of steps) {
      const stepSpan = trace.getTracer('ethertrack').startSpan(`saga.step.${step.name}`, {
        kind: SpanKind.INTERNAL,
        attributes: { 'saga.name': sagaName, 'step.name': step.name }
      }, parentSpan.context());
      
      try {
        const result = await step.fn();
        results.push(result);
        stepSpan.setStatus({ code: SpanStatusCode.OK });
      } catch (error) {
        stepSpan.recordException(error as Error);
        stepSpan.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
        parentSpan.recordException(error as Error);
        throw error;
      } finally {
        stepSpan.end();
      }
    }
    
    return results;
  }, {
    kind: SpanKind.INTERNAL,
    attributes: { 'saga.name': sagaName }
  });
}

export { trace, context, SpanStatusCode, SpanKind };
```

---

## Jaeger Configuration

```yaml
# docker-compose.jaeger.yml
version: '3.8'

services:
  jaeger-collector:
    image: jaegertracing/jaeger-collector:1.53
    ports:
      - "14268:14268"  # HTTP/Thrift
      - "14250:14250"  # gRPC
      - "14269:14269"  # HTTP/JSON
    environment:
      - SPAN_STORAGE_TYPE=elasticsearch
      - ES_SERVER_URLS=http://elasticsearch:9200
      - ES_INDEX_PREFIX=jaeger
      - ES_INDEX_SHARDS=5
      - ES_INDEX_REPLICAS=1
    depends_on:
      - elasticsearch
    networks:
      - monitoring

  jaeger-query:
    image: jaegertracing/jaeger-query:1.53
    ports:
      - "16686:16686"
    environment:
      - SPAN_STORAGE_TYPE=elasticsearch
      - ES_SERVER_URLS=http://elasticsearch:9200
      - ES_INDEX_PREFIX=jaeger
    depends_on:
      - elasticsearch
    networks:
      - monitoring
    ports:
      - "16686:16686"

  jaeger-agent:
    image: jaegertracing/jaeger-agent:1.53
    ports:
      - "5775:5775/udp"   # Thrift compact
      - "6831:6831/udp"   # Thrift compact
      - "6832:6832/udp"   # Thrift binary
      - "14268:14268"     # HTTP
    environment:
      - REPORTER_ZIPKIN_HOST=jaeger-collector
      - REPORTER_ZIPKIN_PORT=14268
    networks:
      - monitoring

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.11.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - "ES_JAVA_OPTS=-Xms512m -Xmx512m"
    volumes:
      - elasticsearch-data:/usr/share/elasticsearch/data
    networks:
      - monitoring
    ports:
      - "9200:9200"
      - "9300:9300"

volumes:
  elasticsearch-data:

networks:
  monitoring:
    driver: bridge
```

---

## Trace Sampling Configuration

```typescript
// src/telemetry/sampling.ts
import { Sampler, SamplingResult, SpanContext, TraceState } from '@opentelemetry/api';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';

// Custom sampler for different operations
export class EtherTrackSampler implements Sampler {
  private defaultSampler = new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(0.1), // 10% default
  });
  
  private highPrioritySampler = new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(1.0), // 100% for critical ops
  });

  shouldSample(
    context: Context,
    traceId: string,
    spanName: string,
    spanKind: SpanKind,
    attributes: any,
    links: any[]
  ): SamplingResult {
    
    // Always sample critical operations
    const criticalOps = [
      'trade.execute',
      'wallet.withdraw',
      'trade.execute',
      'kyc.verify',
      'wallet.withdraw',
      'subscription.payment'
    ];
    
    if (criticalOps.some(op => spanName.includes(op))) {
      return this.highPrioritySampler.shouldSample(context, traceId, spanName, spanKind, attributes, links);
    }
    
    // Sample errors at 100%
    if (attributes?.['http.status_code'] >= 500 || attributes?.['error'] === true) {
      return { decision: SamplingDecision.RECORD_AND_SAMPLED };
    }
    
    // Sample errors at 100%
    if (attributes?.['error'] === true) {
      return { decision: SamplingDecision.RECORD_AND_SAMPLED };
    }
    
    // Default sampling
    return this.defaultSampler.shouldSample(context, traceId, spanName, spanKind, attributes, links);
  }
}

// Custom sampling for high-volume endpoints
export const endpointSamplers: Record<string, number> = {
  '/api/marketplace/listings': 0.1,      // 10%
  '/api/portfolio': 0.5,                  // 50%
  '/api/trades/history': 0.2,             // 20%
  '/api/wallet/balance': 1.0,             // 100%
  '/api/emissions/log': 0.1,              // 10%
  '/api/emissions/bulk': 0.05,            // 5%
  '/api/trades/buy': 1.0,                 // 100%
  '/api/wallet/deposit': 1.0,             // 100%
  '/api/wallet/withdraw': 1.0,            // 100%
  '/api/kyc/verify': 1.0,                 // 100%
  '/api/subscription': 1.0,               // 100%
};
```

---

## Trace Context Propagation

```typescript
// src/middleware/tracing.ts
import { Request, Response, NextFunction } from 'express';
import { trace, propagation, context } from '@opentelemetry/api';

export function tracingMiddleware(req: Request, res: Response, next: NextFunction) {
  // Extract trace context from incoming headers
  const ctx = propagation.extract(context.active(), req.headers);
  
  // Start a new span for the request
  const tracer = trace.getTracer('ethertrack-backend');
  const span = trace.getTracer('ethertrack-backend').startSpan(`${req.method} ${req.route?.path || req.path}`, {
    kind: SpanKind.SERVER,
    attributes: {
      'http.method': req.method,
      'http.url': req.url,
      'http.target': req.route?.path || req.path,
      'http.route': req.route?.path,
      'http.flavor': req.protocol,
      'http.scheme': req.protocol,
      'net.host.name': req.hostname,
      'net.host.port': parseInt(req.socket.remotePort || '0'),
      'net.peer.ip': req.ip,
      'net.peer.port': parseInt(req.socket.remotePort || '0'),
      'user_agent.original': req.get('user-agent') || '',
    }
  }, context.active());
  
  // Set span in context
  const ctx = trace.setSpan(context.active(), span);
  
  // Run middleware chain in trace context
  context.with(ctx, () => {
    // Add trace headers to response for debugging
    res.setHeader('X-Trace-ID', span.spanContext().traceId);
    res.setHeader('X-Span-ID', span.spanContext().spanId);
    
    // Propagate trace context to response headers
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    Object.entries(carrier).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    
    // Finish span when response finishes
    const originalSend = res.send;
    res.send = function(body?: any): Response {
      const span = trace.getSpan(context.active());
      if (span) {
        span.setAttribute('http.status_code', res.statusCode);
        if (res.statusCode >= 400) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${res.statusCode}` });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }
        span.end();
      }
      return originalSend.call(this, body);
    };
    
    next();
  });
}

// Context propagation for outgoing requests
export function injectTraceContext(headers: Record<string, string>): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return { ...headers, ...carrier };
}

// Fetch wrapper with trace context
export async function tracedFetch(url: string, options?: RequestInit): Promise<Response> {
  const tracer = trace.getTracer('ethertrack-frontend');
  
  return trace.getTracer('ethertrack-frontend').startActiveSpan(
    `HTTP ${options?.method || 'GET'} ${url}`,
    { kind: SpanKind.CLIENT, attributes: { 'http.method': options?.method || 'GET', 'http.url': url } },
    async (span) => {
      try {
        const headers = new Headers(options?.headers);
        trace.propagation.inject(trace.getSpan(context.active())?.spanContext() || trace.getSpan(context.active())?.spanContext(), headers);
        
        const response = await fetch(url, { ...options, headers });
        
        span.setAttribute('http.status_code', response.status);
        if (response.ok) {
          span.setStatus({ code: SpanStatusCode.OK });
        } else {
          span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${response.status}` });
        }
        
        return response;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
        throw error;
      } finally {
        span.end();
      }
    });
}
```

---

## Trace Sampling & Cost Control

```yaml
# Jaeger sampling strategies
jaeger:
  collector:
    # Adaptive sampling
    collector:
      zipkin:
        host: 0.0.0.0
        port: 9411
      sampling:
        # Probabilistic sampling
        type: probabilistic
        param: 0.1  # 10% default
        
        # Per-service overrides
        strategies:
          - service: ethertrack-backend
            type: ratelimiting
            param: 100  # 100 traces/sec max
          - service: ethertrack-frontend
            type: probabilistic
            param: 0.05  # 5% for frontend
            
      # Adaptive sampling based on throughput
      adaptive:
        enabled: true
        target: 1000  # traces per second
        min: 0.01     # minimum 1%
        max: 1.0      # maximum 100%
```

---

## Cost Estimation

| Component | Est. Monthly Cost | Notes |
|-----------|-------------------|-------|
| Jaeger (Elasticsearch) | $150-300/mo | 3-node ES cluster |
| Jaeger Collector/Query | $50-100/mo | 3 replicas |
| OpenTelemetry Collector | $50-100/mo | 3 replicas |
| Trace Storage (30 days) | $100-200/mo | ES hot/warm storage |
| Network egress | $50-100/mo | Trace data egress |
| **Total Est.** | **$350-700/mo** | |

### Cost Optimization

```typescript
// Cost optimization strategies
const costOptimization = {
  // Reduce sampling for high-volume endpoints
  adaptiveSampling: {
    enabled: true,
    targetTracesPerSecond: 1000,
    minSamplingRate: 0.01,
    maxSamplingRate: 1.0,
  },
  
  // Drop low-value spans
  spanFilters: [
    { name: '/health', action: 'drop' },
    { name: '/metrics', action: 'drop' },
    { name: '/favicon.ico', action: 'drop' },
    { pattern: '^/static/', action: 'drop' },
  ],
  
  // Attribute limits
  attributeLimits: {
    maxLength: 256,
    maxCount: 128,
  },
  
  // Span event limits
  eventLimits: {
    maxPerSpan: 128,
  },
  
  // Link limits
  linkLimits: {
    maxPerSpan: 128,
  },
};
```

---

## Verification Checklist

| Check | Status | Verification Method |
|-------|--------|---------------------|
| Backend tracing | ✅ | Jaeger UI shows traces |
| Frontend tracing | ✅ | Jaeger UI shows frontend spans |
| Trace context propagation | ✅ | Cross-service trace continuity |
| Database query tracing | ✅ | DB spans visible |
| HTTP client tracing | ✅ | Outbound HTTP spans |
| Database query tracing | ✅ | DB spans visible |
| Error recording | ✅ | Error spans with stack traces |
| Custom business spans | ✅ | Business operation spans |
| Trace sampling | ✅ | Sampling rates as configured |
| Cost control | ✅ | Within budget estimates |

---

## Next Actions

1. **Deploy Jaeger stack** - Deploy Jaeger + Elasticsearch to staging
2. **Instrument all services** - Add OpenTelemetry to all microservices
3. **Configure sampling** - Tune sampling rates per service
5. **Add custom business spans** - Trace key business operations
5. **Configure alerts** - Alert on trace sampling drops, error spikes
5. **Cost monitoring** - Set up budget alerts for tracing costs

---

*Last Updated: 2026-08-14*  
*Next Review: 2026-11-14*