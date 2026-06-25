import { Injectable } from '@nestjs/common';
import { config } from '../../config';
import { ShipmentType } from '../models';
import { Connector } from '../connectors/connector.interface';
import { TrackTraceConnector } from '../connectors/track-trace.connector';
import { CarrierWebConnector } from '../connectors/carrier-web.connector';
import { CargoAiConnector } from '../connectors/cargoai.connector';
import { Pier2PierConnector } from '../connectors/pier2pier.connector';
import { DemoConnector } from '../connectors/demo.connector';

/**
 * Chooses the ordered list of connectors to try for a shipment (ТЗ §10).
 *
 * Live order:
 *   air  → CargoAI (if key) → track-trace.com → carrier website (fallback)
 *   sea  → Pier2Pier (free) → track-trace.com → carrier website (fallback)
 * Demo mode → the deterministic DemoConnector only.
 *
 * Notes:
 *  - For air, CargoAI is tried first when a key is present (reliable structured
 *    source); track-trace remains a fallback.
 *  - For sea, Pier2Pier is tried first: it serves server-rendered HTML and so
 *    works without a browser (unlike track-trace.com on a serverless host).
 *
 * Adding a new source = register its connector here; the pipeline is unchanged.
 */
@Injectable()
export class SourceRouter {
  constructor(
    private readonly trackTrace: TrackTraceConnector,
    private readonly carrierWeb: CarrierWebConnector,
    private readonly cargoai: CargoAiConnector,
    private readonly pier2pier: Pier2PierConnector,
    private readonly demo: DemoConnector,
  ) {}

  route(type: ShipmentType, demoMode: boolean): Connector[] {
    if (demoMode) return [this.demo];

    const chain: Connector[] = [];
    if (type === ShipmentType.AIR && (config.cargoaiApiKey || config.rapidapiKey)) {
      chain.push(this.cargoai);
    }
    if (type === ShipmentType.SEA) {
      chain.push(this.pier2pier);
    }
    chain.push(this.trackTrace);
    chain.push(this.carrierWeb);
    return chain.filter((c) => c.supports(type));
  }
}
