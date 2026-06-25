import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { config } from '../config';
import { DetectorService } from './detector/detector.service';
import { SourceRouter } from './router/source-router.service';
import { ResponseBuilder } from './builder/response.builder';
import { ShipmentLogger } from './logger';
import {
  ErrorCode,
  emptyTrackResult,
  PipelineOptions,
  ShipmentInput,
  ShipmentType,
  TrackResult,
} from './models';
import { sleep } from './connectors/connector.interface';

export interface TrackingResponse {
  request_id: string;
  checked_at: string;
  summary: { total: number; success: number; failed: number };
  results: Record<string, unknown>[];
  results_short?: Record<string, unknown>[];
}

@Injectable()
export class TrackingService {
  constructor(
    private readonly detector: DetectorService,
    private readonly router: SourceRouter,
    private readonly builder: ResponseBuilder,
  ) {}

  async track(
    shipments: ShipmentInput[],
    opts: Partial<PipelineOptions> & { debug?: boolean } = {},
  ): Promise<TrackingResponse> {
    const demoMode = opts.demoMode ?? config.demoMode;
    const results: Record<string, unknown>[] = [];
    const resultsShort: Record<string, unknown>[] = [];

    // Bounded-concurrency processing. Sequential lookups blow past the
    // serverless duration limit once there are several slow live sources
    // (each up to TIMEOUT_MS), which is what caused FUNCTION_INVOCATION_TIMEOUT
    // on Vercel. We run up to `concurrency` numbers at once while preserving
    // input order. Demo mode is instant, so it runs all at once.
    const limit = demoMode
      ? shipments.length || 1
      : Math.max(1, config.concurrency);

    const fulls = await this.mapWithConcurrency(shipments, limit, (input) =>
      this.trackOne(input, demoMode, !!opts.debug),
    );

    for (const full of fulls) {
      results.push(full);
      if (opts.shortFormat) resultsShort.push(this.builder.buildShort(full));
    }

    const success = results.filter((r) => (r.errors as unknown[]).length === 0).length;
    const response: TrackingResponse = {
      request_id: `tracking-check-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`,
      checked_at: new Date().toISOString(),
      summary: { total: results.length, success, failed: results.length - success },
      results,
    };
    if (opts.shortFormat) response.results_short = resultsShort;
    return response;
  }

  /**
   * Runs `fn` over `items` with at most `limit` in flight, preserving the
   * original order in the returned array. Each item is processed independently;
   * `fn` itself never throws (trackOne is fully guarded).
   */
  private async mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    const workerCount = Math.min(Math.max(1, limit), items.length || 1);
    const workers = Array.from({ length: workerCount }, async () => {
      for (let i = next++; i < items.length; i = next++) {
        out[i] = await fn(items[i], i);
      }
    });
    await Promise.all(workers);
    return out;
  }

  /** Process a single number. Never throws — one bad number can't stop the run (ТЗ §9). */
  private async trackOne(
    input: ShipmentInput,
    demoMode: boolean,
    withDebug: boolean,
  ): Promise<Record<string, unknown>> {
    const logger = new ShipmentLogger(input.number);
    const retrievedAt = new Date().toISOString();

    try {
      const detection = this.detector.detect(input.number);
      logger.detect(detection.type);

      // Scenario 3 (ТЗ §2): invalid format → INVALID_FORMAT, no source call.
      if (detection.type === ShipmentType.UNKNOWN) {
        const r = emptyTrackResult();
        r.error = {
          code: ErrorCode.INVALID_FORMAT,
          message: 'Number does not match AWB (123-12345678) or container (ABCU1234567) format.',
          source: null,
        };
        return this.builder.buildFull({
          input,
          detection,
          result: r,
          primarySource: null,
          retrievedAt,
          debug: withDebug ? logger.toJSON() : undefined,
        });
      }

      const chain = this.router.route(detection.type, demoMode);
      const primarySource = chain[0]?.name ?? null;
      let result: TrackResult = emptyTrackResult();
      result.error = {
        code: ErrorCode.SOURCE_UNAVAILABLE,
        message: 'No source produced a result.',
        source: null,
      };

      for (let i = 0; i < chain.length; i++) {
        const connector = chain[i];
        if (i > 0) await sleep(config.rateLimitDelayMs); // politeness between sources
        try {
          const r = await connector.fetch({
            normalizedNumber: detection.normalized_number,
            type: detection.type,
            userCarrierHint: input.carrier ?? null,
            logger,
          });
          result = r;
          if (r.found) break; // success → stop trying fallbacks
        } catch (err) {
          // A connector should never throw, but guard anyway.
          logger.add(`connector_${connector.name}`, 'error', { reason: String(err) });
          result = emptyTrackResult();
          result.source_name = connector.name;
          result.error = {
            code: ErrorCode.SOURCE_UNAVAILABLE,
            message: 'Connector raised an unexpected error.',
            source: connector.name,
          };
        }
      }

      return this.builder.buildFull({
        input,
        detection,
        result,
        primarySource,
        retrievedAt,
        debug: withDebug ? logger.toJSON() : undefined,
      });
    } catch (err) {
      // Last-resort isolation so the overall batch always succeeds.
      const detection = { type: ShipmentType.UNKNOWN, normalized_number: input.number, carrier: null, warnings: [] };
      const r = emptyTrackResult();
      r.error = {
        code: ErrorCode.PARSING_FAILED,
        message: `Unexpected error: ${String(err)}`,
        source: null,
      };
      logger.add('fatal', 'error', { reason: String(err) });
      return this.builder.buildFull({
        input,
        detection,
        result: r,
        primarySource: null,
        retrievedAt,
        debug: withDebug ? logger.toJSON() : undefined,
      });
    }
  }
}
