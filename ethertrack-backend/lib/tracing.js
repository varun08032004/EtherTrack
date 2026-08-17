'use strict';

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { trace, SpanStatusCode, SpanKind, context } = require('@opentelemetry/api');
const { W3CTraceContextPropagator } = require('@opentelemetry/core');

let sdk = null;
let tracer = null;

const serviceName = 'ethertrack-api';
const serviceVersion = process.env.APP_VERSION || '1.0.0';
const deploymentEnv = process.env.NODE_ENV || 'development';

const resourceAttributes = {
  [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
  [SemanticResourceAttributes.SERVICE_VERSION]: serviceVersion,
  [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: deploymentEnv,
  [SemanticResourceAttributes.HOST_NAME]: process.env.HOSTNAME || 'localhost',
  [SemanticResourceAttributes.KUBERNETES_CLUSTER_NAME]: process.env.KUBERNETES_CLUSTER_NAME,
  [SemanticResourceAttributes.KUBERNETES_POD_NAME]: process.env.POD_NAME,
  [SemanticResourceAttributes.KUBERNETES_NAMESPACE]: process.env.KUBERNETES_NAMESPACE,
};

const resource = resourceFromAttributes(resourceAttributes);

const otlpExporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || 'http://localhost:4318/v1/traces',
  headers: {},
});

const sdkConfig = {
  resource,
  spanProcessor: new BatchSpanProcessor(otlpExporter, {
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
        ignoreIncomingPaths: ['/health', '/metrics', '/healthz', '/api/health'],
      },
      '@opentelemetry/instrumentation-http': {
        enabled: true,
        ignoreIncomingRequestHook: (request) => {
          const url = request.url || '';
          return url.includes('/health') ||
                 url.includes('/metrics') ||
                 url.includes('/favicon.ico');
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
    }),
  ],
};

function initTracing() {
  if (sdk) {
    console.log('[Tracing] Already initialized');
    return tracer;
  }

  try {
    sdk = new NodeSDK(sdkConfig);
    sdk.start();
    
    // Register W3C TraceContext propagator for trace context propagation
    const provider = trace.getTracerProvider();
    provider.propagator = new W3CTraceContextPropagator();
    
    tracer = trace.getTracer(serviceName, serviceVersion);
    console.log('[Tracing] OpenTelemetry initialized successfully');
    console.log('[Tracing] Exporting to:', process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || 'http://localhost:4318/v1/traces');
    console.log('[Tracing] W3C TraceContext propagator registered');

    process.on('SIGTERM', () => {
      shutdownTracing().catch(console.error);
    });

    process.on('SIGINT', () => {
      shutdownTracing().catch(console.error);
    });

    return tracer;
  } catch (error) {
    console.error('[Tracing] Failed to initialize:', error.message);
    return null;
  }
}

async function shutdownTracing() {
  if (sdk) {
    try {
      await sdk.shutdown();
      console.log('[Tracing] OpenTelemetry shut down gracefully');
    } catch (error) {
      console.error('[Tracing] Error during shutdown:', error.message);
    }
    sdk = null;
    tracer = null;
  }
}

function getTracer() {
  if (!tracer) {
    return trace.getTracer(serviceName, serviceVersion);
  }
  return tracer;
}

function createSpan(name, options = {}) {
  const tr = getTracer();
  return tr.startSpan(name, {
    kind: options.kind || SpanKind.INTERNAL,
    attributes: options.attributes,
    links: options.links,
  });
}

async function withSpan(name, fn, options = {}) {
  const tr = getTracer();
  return tr.startActiveSpan(name, {
    kind: options.kind || SpanKind.INTERNAL,
    attributes: options.attributes,
    links: options.links,
  }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

function traceDbQuery(operation, query, fn) {
  return withSpan(`db.query.${operation}`, async (span) => {
    span.setAttribute('db.system', 'postgresql');
    span.setAttribute('db.operation', operation);
    span.setAttribute('db.statement', query?.substring(0, 1000));
    try {
      return await fn();
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw error;
    }
  }, { kind: SpanKind.CLIENT });
}

function traceExternalCall(service, operation, fn) {
  return withSpan(`external.${service}.${operation}`, async (span) => {
    span.setAttribute('external.service', service);
    span.setAttribute('external.operation', operation);
    try {
      return await fn();
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw error;
    }
  }, { kind: SpanKind.CLIENT });
}

function traceBlockchainCall(method, fn) {
  return withSpan(`blockchain.${method}`, async (span) => {
    span.setAttribute('blockchain.method', method);
    span.setAttribute('blockchain.chain', process.env.POLYGON_NETWORK || 'sepolia');
    try {
      return await fn();
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw error;
    }
  }, { kind: SpanKind.CLIENT });
}

function traceJob(jobName, fn) {
  return withSpan(`job.${jobName}`, async (span) => {
    span.setAttribute('job.name', jobName);
    try {
      return await fn();
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw error;
    }
  }, { kind: SpanKind.INTERNAL });
}

function traceBusinessOperation(operationName, fn, attributes) {
  return withSpan(`business.${operationName}`, async (span) => {
    if (attributes) {
      Object.entries(attributes).forEach(([key, value]) => {
        span.setAttribute(key, value);
      });
    }
    try {
      return await fn();
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw error;
    }
  }, { kind: SpanKind.INTERNAL, attributes });
}

function injectTraceContext(headers = {}) {
  const carrier = {};
  const setter = {
    set: (carrier, key, value) => { carrier[key] = value; }
  };
  const provider = trace.getTracerProvider();
  const propagator = provider?._delegate?.propagator;
  if (propagator) {
    propagator.inject(context.active(), carrier, setter);
  }
  return { ...headers, ...carrier };
}

function extractTraceContext(headers) {
  const provider = trace.getTracerProvider();
  const propagator = provider?._delegate?.propagator;
  if (!propagator) {
    return headers;
  }
  const getter = {
    get: (carrier, key) => carrier[key]
  };
  return propagator.extract(context.active(), headers, getter);
}

module.exports = {
  initTracing,
  shutdownTracing,
  getTracer,
  createSpan,
  withSpan,
  traceDbQuery,
  traceExternalCall,
  traceBlockchainCall,
  traceJob,
  traceBusinessOperation,
  injectTraceContext,
  extractTraceContext,
  trace,
  SpanStatusCode,
  SpanKind,
  context,
};