import { Module } from '@nestjs/common';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { DetectorService } from './detector/detector.service';
import { NormalizerService } from './normalizer/normalizer.service';
import { SourceRouter } from './router/source-router.service';
import { ResponseBuilder } from './builder/response.builder';
import { HeuristicParser } from './parsers/heuristic.parser';
import { AiParser } from './parsers/ai.parser';
import { TrackTraceConnector } from './connectors/track-trace.connector';
import { CarrierWebConnector } from './connectors/carrier-web.connector';
import { CargoAiConnector } from './connectors/cargoai.connector';
import { DemoConnector } from './connectors/demo.connector';

@Module({
  controllers: [TrackingController],
  providers: [
    TrackingService,
    DetectorService,
    NormalizerService,
    SourceRouter,
    ResponseBuilder,
    HeuristicParser,
    AiParser,
    TrackTraceConnector,
    CarrierWebConnector,
    CargoAiConnector,
    DemoConnector,
  ],
})
export class TrackingModule {}
